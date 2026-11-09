import { copyFile, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

import { ATTACHMENTS_DIR } from "../attachments.ts";
import { boxUploadsDir } from "../bot-box/plan.ts";
import { DATA_DIR } from "../config.ts";
import { decodeAttachmentAttribute } from "../message-file.ts";
import { redactSecretsInText } from "../redact.ts";
import { inSecretFolder } from "../secret-folder.ts";
import { pageText } from "../wait-probes.ts";
import { pdfText } from "./pdf-text.ts";
import { PASS, type RouteContext, type RouteHandler } from "./table.ts";

export const MAX_FILE_SIZE = 50 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 5_000;
export const MAX_ZIP_UNCOMPRESSED = 50 * 1024 * 1024;
export const MAX_ZIP_TOTAL_UNCOMPRESSED = 100 * 1024 * 1024;
export const PAGE_WINDOW_CHARS = 12_000;

export interface ReadFileDeps {
  botId: string;
  threadId: string;
  ownsThread(botId: string, threadId: string): boolean;
  roots(): string[];
  vmWorkspace(): Promise<string | null>;
  readBody(): Promise<unknown>;
}

export interface ReadFileInput {
  path: string;
  offset?: number;
  find?: string;
  to_computer?: boolean;
}

export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export interface ZipArchive {
  entries: Map<string, ZipEntry>;
  read(name: string): Buffer;
}

export function openZip(buf: Buffer): ZipArchive {
  if (buf.length < 22) throw new Error("Invalid zip: file too short");
  const minPos = Math.max(0, buf.length - 65536 - 22);
  let eocdPos = -1;
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdPos = i;
      break;
    }
  }
  if (eocdPos === -1) throw new Error("Invalid zip: End of Central Directory record not found");

  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`Zip entry count (${totalEntries}) exceeds limit (${MAX_ZIP_ENTRIES})`);
  }
  const cdSize = buf.readUInt32LE(eocdPos + 12);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);
  if (cdOffset + cdSize > buf.length) {
    throw new Error("Invalid zip: Central Directory out of bounds");
  }

  const entries = new Map<string, ZipEntry>();
  let pos = cdOffset;
  let count = 0;
  while (pos < cdOffset + cdSize && count < totalEntries) {
    if (buf.readUInt32LE(pos) !== 0x02014b50) break;
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const uncompressedSize = buf.readUInt32LE(pos + 24);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);

    const name = buf.subarray(pos + 46, pos + 46 + nameLen).toString("utf8");
    entries.set(name, { name, method, compressedSize, uncompressedSize, localOffset });
    pos += 46 + nameLen + extraLen + commentLen;
    count++;
  }

  let totalDecompressed = 0;

  return {
    entries,
    read(name: string): Buffer {
      const entry = entries.get(name);
      if (!entry) throw new Error(`Zip entry not found: ${name}`);
      if (entry.uncompressedSize > MAX_ZIP_UNCOMPRESSED) {
        throw new Error(`Zip entry ${name} uncompressed size exceeds limit`);
      }
      totalDecompressed += entry.uncompressedSize;
      if (totalDecompressed > MAX_ZIP_TOTAL_UNCOMPRESSED) {
        throw new Error("Zip total uncompressed size exceeds limit");
      }

      const lfh = entry.localOffset;
      if (lfh + 30 > buf.length || buf.readUInt32LE(lfh) !== 0x04034b50) {
        throw new Error(`Invalid Local File Header for ${name}`);
      }
      const localNameLen = buf.readUInt16LE(lfh + 26);
      const localExtraLen = buf.readUInt16LE(lfh + 28);
      const dataStart = lfh + 30 + localNameLen + localExtraLen;
      const dataEnd = dataStart + entry.compressedSize;
      if (dataEnd > buf.length) {
        throw new Error(`Compressed data out of bounds for ${name}`);
      }
      const compressedData = buf.subarray(dataStart, dataEnd);

      if (entry.method === 0) {
        return Buffer.from(compressedData);
      }
      if (entry.method === 8) {
        return inflateRawSync(compressedData, { maxOutputLength: entry.uncompressedSize });
      }
      throw new Error(`Unsupported compression method ${entry.method} in zip for ${name}`);
    },
  };
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    const named = NAMED_ENTITIES[lower];
    if (named !== undefined) return named;
    if (body[0] !== "#") return whole;
    const code = body[1]?.toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

export function xmlToText(xml: string): string {
  let text = xml
    .replace(/<\/(?:w:p|a:p|p|div|tr|h[1-6])>/gi, "\n")
    .replace(/<(?:w:br|a:br|br)\b[^>]*\/?>/gi, "\n")
    .replace(/<(?:w:tab|a:tab)\b[^>]*\/?>/gi, "\t");
  text = text.replace(/<[^>]+>/g, "");
  text = decodeEntities(text);
  return text
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const IMAGE_EXTENSIONS: Record<string, true> = {
  ".png": true, ".jpg": true, ".jpeg": true, ".gif": true, ".webp": true,
  ".svg": true, ".bmp": true, ".ico": true, ".tiff": true, ".tif": true, ".avif": true,
};

const TEXT_EXTENSIONS: Record<string, true> = {
  ".md": true, ".markdown": true, ".txt": true, ".text": true, ".csv": true, ".tsv": true, ".json": true, ".jsonl": true, ".ndjson": true,
  ".xml": true, ".yaml": true, ".yml": true, ".log": true, ".sql": true, ".sh": true, ".bash": true, ".zsh": true,
  ".js": true, ".jsx": true, ".ts": true, ".tsx": true, ".mjs": true, ".cjs": true,
  ".py": true, ".rb": true, ".go": true, ".rs": true, ".c": true, ".cpp": true, ".cc": true, ".h": true, ".hpp": true,
  ".cs": true, ".java": true, ".kt": true, ".swift": true, ".php": true, ".css": true, ".scss": true, ".less": true,
  ".html": true, ".htm": true, ".toml": true, ".ini": true, ".conf": true, ".cfg": true, ".env": true, ".diff": true, ".patch": true,
  ".dockerfile": true, ".makefile": true,
};

export function isImageFile(ext: string, bytes: Buffer): boolean {
  if (IMAGE_EXTENSIONS[ext] === true) return true;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 6 && (bytes.subarray(0, 6).toString("latin1") === "GIF87a" || bytes.subarray(0, 6).toString("latin1") === "GIF89a")) return true;
  if (bytes.length >= 12 && bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP") return true;
  return false;
}

export function isPdfFile(ext: string, bytes: Buffer): boolean {
  return ext === ".pdf" || (bytes.length >= 5 && bytes.subarray(0, 5).toString("latin1") === "%PDF-");
}

export function isZipFile(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

export function isTextLike(bytes: Buffer): boolean {
  const checkLen = Math.min(bytes.length, 8192);
  for (let i = 0; i < checkLen; i++) {
    const b = bytes[i]!;
    if (b === 0) return false;
  }
  return true;
}

export async function extractFileContent(
  filename: string,
  bytes: Buffer,
): Promise<{ text: string; type: string; isImage?: boolean; notText?: boolean }> {
  const ext = extname(filename).toLowerCase();

  if (isImageFile(ext, bytes)) {
    return {
      text: "Attached images are seen directly by the model; you do not need read_file to view them.",
      type: "image",
      isImage: true,
    };
  }

  if (isPdfFile(ext, bytes)) {
    const parsed = await pdfText(bytes);
    if (!parsed || !parsed.text.trim()) {
      return {
        text: "This PDF has no readable text layer (it may be scanned or empty). Use to_computer: true to inspect or OCR it with Python.",
        type: "PDF (.pdf)",
      };
    }
    return { text: parsed.text, type: "PDF (.pdf)" };
  }

  if (isZipFile(bytes)) {
    try {
      const zip = openZip(bytes);
      if (ext === ".docx" || zip.entries.has("word/document.xml")) {
        const docXml = zip.read("word/document.xml").toString("utf8");
        return { text: xmlToText(docXml), type: "Word document (.docx)" };
      }
      const hasSlides = [...zip.entries.keys()].some((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k));
      if (ext === ".pptx" || hasSlides) {
        const slideEntries: Array<{ num: number; name: string }> = [];
        for (const name of zip.entries.keys()) {
          const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(name);
          if (match) {
            slideEntries.push({ num: parseInt(match[1]!, 10), name });
          }
        }
        slideEntries.sort((a, b) => a.num - b.num);
        const slidesText: string[] = [];
        for (const { num, name } of slideEntries) {
          const xml = zip.read(name).toString("utf8");
          const slideText = xmlToText(xml);
          slidesText.push(`[slide ${num}]\n${slideText}`);
        }
        return { text: slidesText.join("\n\n").trim(), type: "PowerPoint presentation (.pptx)" };
      }
      if (ext === ".xlsx" || zip.entries.has("xl/workbook.xml")) {
        const xml = zip.read("xl/workbook.xml").toString("utf8");
        const sheetNames: string[] = [];
        const regex = /<sheet\b[^>]*\bname=(["'])(.*?)\1/gi;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(xml)) !== null) {
          sheetNames.push(decodeEntities(match[2]!));
        }
        const sheets = sheetNames.length > 0 ? sheetNames.join(", ") : "(no sheets found)";
        return {
          text: `Sheets: ${sheets}\n\nUse data_load to inspect spreadsheet cells.`,
          type: "Excel spreadsheet (.xlsx)",
        };
      }
    } catch (error) {
      if (ext === ".docx" || ext === ".pptx" || ext === ".xlsx") {
        throw error;
      }
    }
  }

  if (ext === ".html" || ext === ".htm") {
    return { text: pageText(bytes.toString("utf8")), type: "HTML (.html)" };
  }

  if (TEXT_EXTENSIONS[ext] === true || isTextLike(bytes)) {
    const raw = bytes.toString("utf8");
    const isHtmlSnippet = /^\s*<!doctype|^\s*<html/i.test(raw);
    if (isHtmlSnippet) {
      return { text: pageText(raw), type: "HTML (.html)" };
    }
    return { text: raw, type: ext ? `${ext.slice(1).toUpperCase()} file` : "Plain text" };
  }

  return {
    text: `This file type (${ext || "unknown"}) cannot be read as text. Set to_computer: true to copy it into your Local VM workspace (/home/cua/workspace/uploads/${filename}) to inspect or process it with Python or shell tools.`,
    type: ext ? ext.slice(1).toUpperCase() : "binary",
    notText: true,
  };
}

function containedBy(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function formatFindWindows(
  text: string,
  find: string,
  offset: number,
): { matches: Array<{ offset: number; text: string }>; more: boolean; nextOffset?: number } {
  const total = text.length;
  const lowerText = text.toLowerCase();
  const terms = Array.from(
    new Set(
      find
        .split(" | ")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0),
    ),
  );
  const hits: Array<{ start: number; end: number }> = [];
  for (const term of terms) {
    let pos = offset;
    while (pos < lowerText.length) {
      const idx = lowerText.indexOf(term, pos);
      if (idx === -1) break;
      hits.push({ start: idx, end: idx + term.length });
      pos = idx + Math.max(1, term.length);
    }
  }
  hits.sort((a, b) => a.start - b.start || a.end - b.end);

  const windows: Array<{ start: number; end: number }> = [];
  for (const hit of hits) {
    const winStart = Math.max(0, hit.start - 300);
    const winEnd = Math.min(total, hit.end + 500);
    if (windows.length === 0) {
      windows.push({ start: winStart, end: winEnd });
      continue;
    }
    const last = windows[windows.length - 1]!;
    if (winStart <= last.end) {
      last.end = Math.max(last.end, winEnd);
    } else {
      windows.push({ start: winStart, end: winEnd });
    }
  }

  const more = hits.length > 20 || windows.length > 20;
  const selected = windows.slice(0, 20);
  const matches = selected.map((w) => ({
    offset: w.start,
    text: text.slice(w.start, w.end),
  }));
  const nextOffset = selected.length > 0 ? selected[selected.length - 1]!.end : undefined;

  return { matches, more, nextOffset };
}

export async function handleReadFile(
  deps: Omit<ReadFileDeps, "readBody">,
  body: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { status: 400, body: { error: "Send a JSON object." } };
  }
  const input = body as Record<string, unknown>;
  const rawPath = typeof input.path === "string" ? input.path.trim() : "";
  if (!rawPath || rawPath.length > 2048) {
    return { status: 400, body: { error: "read_file needs path: the file path from an <attached-file> tag or workspace." } };
  }
  let offset = 0;
  if (input.offset !== undefined) {
    if (!Number.isSafeInteger(input.offset) || (input.offset as number) < 0) {
      return { status: 400, body: { error: "offset must be a non-negative integer." } };
    }
    offset = input.offset as number;
  }
  let find: string | undefined;
  if (input.find !== undefined) {
    if (typeof input.find !== "string" || input.find.length < 2 || input.find.length > 200) {
      return { status: 400, body: { error: "find must be 2 to 200 characters." } };
    }
    find = input.find;
  }
  const toComputer = input.to_computer === true;

  const rawRoots = [
    ...deps.roots(),
    ATTACHMENTS_DIR,
    boxUploadsDir(DATA_DIR, deps.botId, deps.threadId),
    `/app/data/box-uploads/${deps.botId}/${deps.threadId}`,
  ];
  const canonicalRoots = (
    await Promise.all(
      rawRoots.map(async (r) => {
        try {
          const canonical = await realpath(r);
          return (await stat(canonical)).isDirectory() ? canonical : null;
        } catch {
          return null;
        }
      }),
    )
  ).filter((r): r is string => Boolean(r));

  if (canonicalRoots.length === 0) {
    return { status: 404, body: { error: "the linked file is unavailable: no conversation roots exist" } };
  }

  let cleanPath = decodeAttachmentAttribute(rawPath);
  if ((cleanPath.startsWith('"') && cleanPath.endsWith('"')) || (cleanPath.startsWith("'") && cleanPath.endsWith("'"))) {
    cleanPath = cleanPath.slice(1, -1).trim();
  }

  const boxPrefix = `/app/data/box-uploads/${deps.botId}/${deps.threadId}/`;
  if (cleanPath.startsWith(boxPrefix)) {
    const sub = cleanPath.slice(boxPrefix.length);
    cleanPath = join(boxUploadsDir(DATA_DIR, deps.botId, deps.threadId), sub);
  }

  const candidates = isAbsolute(cleanPath)
    ? [resolve(cleanPath)]
    : canonicalRoots.map((root) => resolve(root, cleanPath));

  let chosenCanonical: string | null = null;
  let sawOutside = false;

  for (const candidate of new Set(candidates)) {
    let canonical: string;
    try {
      canonical = await realpath(candidate);
    } catch {
      continue;
    }
    const isAllowed = canonicalRoots.some((r) => containedBy(r, canonical));
    if (!isAllowed) {
      sawOutside = true;
      continue;
    }
    if (inSecretFolder(canonical)) {
      return { status: 403, body: { error: "the linked file is in a protected folder" } };
    }
    const st = await stat(canonical);
    if (st.isDirectory()) {
      return { status: 400, body: { error: "the path points to a folder, not a file" } };
    }
    if (!st.isFile()) {
      return { status: 400, body: { error: "the path does not point to a regular file" } };
    }
    if (st.size > MAX_FILE_SIZE) {
      return { status: 413, body: { error: "File exceeds 50 MB limit" } };
    }
    chosenCanonical = canonical;
    break;
  }

  if (!chosenCanonical) {
    if (sawOutside) {
      return { status: 403, body: { error: "the linked file is outside this conversation's workspace" } };
    }
    return { status: 404, body: { error: `the linked file is unavailable: ${basename(cleanPath)} not found` } };
  }

  const fileName = basename(chosenCanonical);
  let toComputerPath: string | undefined;
  let toComputerError: string | undefined;

  if (toComputer) {
    const vmDir = await deps.vmWorkspace();
    if (!vmDir) {
      toComputerError = "to_computer is not available in this turn (no Local VM desktop is active).";
    } else {
      try {
        const uploadsDir = join(vmDir, "uploads");
        await mkdir(uploadsDir, { recursive: true });
        const dest = join(uploadsDir, fileName);
        await copyFile(chosenCanonical, dest);
        toComputerPath = `/home/cua/workspace/uploads/${fileName}`;
      } catch (err) {
        toComputerError = `Failed to copy to Local VM: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  const bytes = await readFile(chosenCanonical);
  let extracted: { text: string; type: string; isImage?: boolean; notText?: boolean };
  try {
    extracted = await extractFileContent(fileName, bytes);
  } catch (err) {
    return { status: 500, body: { error: `Failed to read file: ${err instanceof Error ? err.message : String(err)}` } };
  }

  const total = extracted.text.length;
  const headerLines = [`${fileName} (${extracted.type}${extracted.isImage || extracted.notText ? "" : `, ${total} characters`})`];
  if (toComputerPath) headerLines.push(`Copied to Local VM: ${toComputerPath}`);
  if (toComputerError) headerLines.push(`Note: ${toComputerError}`);
  const header = headerLines.join("\n");

  if (extracted.isImage || extracted.notText) {
    const formatted = `${header}\n\n${extracted.text}`;
    return {
      status: 200,
      body: {
        name: fileName,
        type: extracted.type,
        total,
        offset: 0,
        text: extracted.text,
        formatted: redactSecretsInText(formatted),
        ...(toComputerPath ? { toComputer: toComputerPath } : {}),
      },
    };
  }

  if (find !== undefined) {
    const { matches, more, nextOffset } = formatFindWindows(extracted.text, find, offset);
    const bodyText = matches.length === 0
      ? `No matches found for "${find}".`
      : matches.map((m) => `[offset ${m.offset}]\n${m.text}`).join("\n\n");
    const moreNote = more && nextOffset !== undefined
      ? `\n\n[More matches exist; continue with find and offset: ${nextOffset}]`
      : "";
    const formatted = `${header}\n\n${bodyText}${moreNote}`;
    return {
      status: 200,
      body: {
        name: fileName,
        type: extracted.type,
        total,
        offset,
        ...(nextOffset !== undefined ? { nextOffset } : {}),
        more,
        matches,
        text: bodyText,
        formatted: redactSecretsInText(formatted),
        ...(toComputerPath ? { toComputer: toComputerPath } : {}),
      },
    };
  }

  const slice = extracted.text.slice(offset, offset + PAGE_WINDOW_CHARS);
  const nextOffset = offset + slice.length;
  const more = nextOffset < total;
  const moreNote = more
    ? `\n\n[Showing characters ${offset} to ${nextOffset} of ${total}. Call read_file with path: "${rawPath}", offset: ${nextOffset} to continue reading]`
    : "";
  const formatted = `${header}\n\n${slice}${moreNote}`;

  return {
    status: 200,
    body: {
      name: fileName,
      type: extracted.type,
      total,
      offset,
      nextOffset,
      more,
      text: slice,
      formatted: redactSecretsInText(formatted),
      ...(toComputerPath ? { toComputer: toComputerPath } : {}),
    },
  };
}

export function createReadFileRoute(deps: ReadFileDeps): RouteHandler {
  return async (ctx: RouteContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== "/api/internal/files/read") return PASS;
    if (!deps.ownsThread(deps.botId, deps.threadId)) {
      return void ctx.json(ctx.res, 403, { error: "source conversation does not belong to sender" });
    }
    const rawBody = await deps.readBody();
    const outcome = await handleReadFile(deps, rawBody);
    return void ctx.json(ctx.res, outcome.status, outcome.body);
  };
}
