import { existsSync, mkdirSync, readFileSync, appendFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";
import { saveFile } from "./attachments.ts";
import type { Store } from "./store.ts";
import type { Message } from "../shared/wire.ts";

function safe(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function slug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function escapeCsv(val: string): string {
  if (val.includes('"') || val.includes(",") || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

async function* asChunks(buf: Uint8Array): AsyncIterable<Uint8Array> {
  yield buf;
}

function readRows(filePath: string): Array<Record<string, string>> {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const rows: Array<Record<string, string>> = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        rows.push(parsed as Record<string, string>);
      }
    } catch {}
  }
  return rows;
}

export function createJobNotes(
  store: Pick<Store, "taskByThread" | "messagesFor" | "appendMessage">,
  dir = join(DATA_DIR, "job-notes"),
) {
  const delivered = new Set<string>();

  return {
    handle(botId: string, jobThreadId: string, body: unknown): { status: number; body: Record<string, unknown> } {
      const task = store.taskByThread(botId, jobThreadId);
      if (!task?.openedBy?.reportsBack) {
        return { status: 409, body: { error: "job_notes works only in a job that reports back to a chat." } };
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return { status: 400, body: { error: "job_notes needs add, read, or find." } };
      }
      const record = body as Record<string, unknown>;
      const { add, read, find } = record;
      if (add === undefined && read === undefined && find === undefined) {
        return { status: 400, body: { error: "job_notes needs add, read, or find." } };
      }

      const filePath = join(dir, `${safe(botId)}--${safe(jobThreadId)}.jsonl`);
      const existingRows = readRows(filePath);

      if (add !== undefined) {
        if (!Array.isArray(add)) {
          return { status: 400, body: { error: "add must be an array of row objects." } };
        }
        if (existingRows.length + add.length > 2000) {
          return { status: 409, body: { error: `job_notes limit of 2,000 rows reached (currently ${existingRows.length} rows, cannot add ${add.length}).` } };
        }
        const cleanedRows: Array<Record<string, string>> = [];
        for (const item of add) {
          if (!item || typeof item !== "object" || Array.isArray(item)) {
            return { status: 400, body: { error: "Each row in add must be an object." } };
          }
          const keys = Object.keys(item);
          if (keys.length > 30) {
            return { status: 400, body: { error: "Rows may have at most 30 keys." } };
          }
          const cleaned: Record<string, string> = {};
          for (const [k, v] of Object.entries(item)) {
            if (k.length > 60) {
              return { status: 400, body: { error: `Key "${k.slice(0, 20)}..." exceeds 60 characters.` } };
            }
            const str = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
            cleaned[k] = str.slice(0, 2000);
          }
          cleanedRows.push(cleaned);
        }
        mkdirSync(dir, { recursive: true });
        appendFileSync(filePath, cleanedRows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
        existingRows.push(...cleanedRows);
      }

      const columns: string[] = [];
      const seen = new Set<string>();
      for (const row of existingRows) {
        for (const k of Object.keys(row)) {
          if (!seen.has(k)) {
            seen.add(k);
            columns.push(k);
          }
        }
      }

      if (find !== undefined) {
        if (typeof find !== "string" || find.trim().length < 2) {
          return { status: 400, body: { error: "find needs at least 2 characters." } };
        }
        if (find.trim().length > 200) {
          return { status: 400, body: { error: "find takes at most 200 characters." } };
        }
        const query = find.trim().toLowerCase();
        const items = existingRows.filter((row) => Object.values(row).some((v) => v.toLowerCase().includes(query))).slice(0, 50);
        return { status: 200, body: { rows: existingRows.length, columns, items } };
      }

      if (read === true) {
        const items = existingRows.slice(-30);
        return { status: 200, body: { rows: existingRows.length, columns, items } };
      }

      return { status: 200, body: { rows: existingRows.length, columns } };
    },

    async deliver(input: { botId: string; jobThreadId: string; parentThreadId: string; title: string; requestMessageId?: string }): Promise<void> {
      const key = `${input.botId}--${input.jobThreadId}`;
      if (delivered.has(key)) return;
      delivered.add(key);
      try {
        const filePath = join(dir, `${safe(input.botId)}--${safe(input.jobThreadId)}.jsonl`);
        const rows = readRows(filePath);
        const fileSlug = slug(input.title) || "job";
        const attachments: NonNullable<Message["attachments"]> = [];

        if (rows.length > 0) {
          const columns: string[] = [];
          const seen = new Set<string>();
          for (const row of rows) {
            for (const k of Object.keys(row)) {
              if (!seen.has(k)) {
                seen.add(k);
                columns.push(k);
              }
            }
          }
          const lines = [columns.map(escapeCsv).join(",")];
          for (const row of rows) {
            lines.push(columns.map((c) => escapeCsv(row[c] ?? "")).join(","));
          }
          const csvBuffer = Buffer.from("\uFEFF" + lines.join("\r\n"), "utf8");
          const savedCsv = await saveFile(asChunks(csvBuffer), `${fileSlug}.csv`, "text/csv");
          attachments.push({ kind: "file", path: savedCsv.path, mime: savedCsv.mime, name: savedCsv.name });
        }

        const messages = store.messagesFor(input.jobThreadId) ?? [];
        const lastBotText = messages.findLast((m) => m.role === "bot" && m.kind === "text" && typeof m.text === "string")?.text;
        if (lastBotText && lastBotText.length > 12_000) {
          const mdBuffer = Buffer.from(lastBotText, "utf8");
          const savedMd = await saveFile(asChunks(mdBuffer), `${fileSlug}.md`, "text/markdown");
          attachments.push({ kind: "file", path: savedMd.path, mime: savedMd.mime, name: savedMd.name });
        }

        if (attachments.length > 0) {
          store.appendMessage(input.parentThreadId, {
            role: "bot",
            kind: "text",
            text: "",
            attachments,
            ...(input.requestMessageId ? { requestMessageId: input.requestMessageId } : {}),
          });
        }

        if (existsSync(filePath)) {
          try {
            unlinkSync(filePath);
          } catch {}
        }
      } catch (error) {
        console.warn("[job-notes] delivery failed", error);
      }
    },
  };
}
