import { pageText } from "../wait-probes.ts";

/** Greenhouse and others ship a posting's HTML entity-escaped inside their page data. */
const ESCAPED_MARKUP = /&lt;\/?[a-z]/i;
const TOKEN_LIKE = /^[\w-]{24,}$/;
const JSON_LIKE = /^[[{]/;
const NOISE_KEYS = /^(?:__typename|id|uuid|.*Id|.*_id|.*Url|.*_url|url|href|src|image|logo|icon|css|style|hash|token|nonce|version)$/i;

function isNoiseKey(key: string, parent: unknown): boolean {
  if (key.toLowerCase() === "url" && parent !== null && typeof parent === "object" && !Array.isArray(parent)) {
    const obj = parent as Record<string, unknown>;
    if ("title" in obj || "name" in obj) return false;
  }
  return NOISE_KEYS.test(key);
}

function formatPath(segments: string[]): string {
  const kept = segments.length > 6 ? segments.slice(-6) : segments;
  let res = "";
  for (const seg of kept) {
    if (seg.startsWith("[")) {
      res += seg;
    } else if (res.length === 0) {
      res = seg;
    } else {
      res += "." + seg;
    }
  }
  return res;
}

function flattenNode(
  node: unknown,
  segments: string[],
  lines: string[],
  seenStrings: Set<string>,
  depth: number,
): void {
  if (depth > 30 || node === null || node === undefined) return;

  if (typeof node === "string") {
    const markup = ESCAPED_MARKUP.test(node) ? node.replace(/&lt;/g, "<").replace(/&gt;/g, ">") : node;
    let cleaned = /<[^>]+>/.test(markup) ? pageText(markup) : markup.replace(/\s+/g, " ").trim();
    if (cleaned.length === 0 || TOKEN_LIKE.test(cleaned) || (cleaned.length > 200 && JSON_LIKE.test(cleaned))) return;
    if (cleaned.length > 20_000) {
      cleaned = cleaned.slice(0, 20_000) + "…";
    }
    if (seenStrings.has(cleaned)) return;
    seenStrings.add(cleaned);
    const path = formatPath(segments);
    lines.push(path ? `${path}: ${cleaned}` : cleaned);
    return;
  }

  if (typeof node === "number") {
    if (!Number.isFinite(node)) return;
    const path = formatPath(segments);
    lines.push(path ? `${path}: ${node}` : String(node));
    return;
  }

  if (typeof node === "boolean") {
    const path = formatPath(segments);
    lines.push(path ? `${path}: ${node}` : String(node));
    return;
  }

  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      flattenNode(node[i], [...segments, `[${i}]`], lines, seenStrings, depth + 1);
    }
    return;
  }

  if (typeof node === "object") {
    for (const [key, val] of Object.entries(node)) {
      if (isNoiseKey(key, node)) continue;
      flattenNode(val, [...segments, key], lines, seenStrings, depth + 1);
    }
  }
}

function extractJsonObject(str: string, startIndex: number): string | null {
  if (str[startIndex] !== "{") return null;
  let depth = 0;
  let inString: '"' | "'" | null = null;
  let escape = false;

  for (let i = startIndex; i < str.length; i++) {
    const ch = str[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (inString !== null) {
      if (ch === inString) {
        inString = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return str.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

function cleanCdata(raw: string): string {
  return raw
    .replace(/^\s*\/\/\s*<!\[CDATA\[/i, "")
    .replace(/^\s*<!\[CDATA\[/i, "")
    .replace(/\/\/\s*\]\]>\s*$/i, "")
    .replace(/\]\]>\s*$/i, "")
    .trim();
}

/** A parsed JSON document as `path: value` lines, noise keys and duplicates left out. */
export function jsonDataText(value: unknown): string {
  const lines: string[] = [];
  flattenNode(value, [], lines, new Set(), 0);
  return lines.join("\n").slice(0, 200_000);
}

/** Greenhouse job-board pages load the posting's text by script; its public job API returns it with the pay range. */
export function postingDataUrl(url: URL): string | undefined {
  const posting = /^\/([\w-]+)\/jobs\/(\d+)\/?$/.exec(url.pathname);
  if (!posting || !/^(?:job-boards|boards)\.greenhouse\.io$/.test(url.hostname)) return undefined;
  return `https://boards-api.greenhouse.io/v1/boards/${posting[1]}/jobs/${posting[2]}?pay_transparency=true`;
}

/** Extracts structured schema (JSON-LD) and, with `appState`, app state (Next.js, Ashby, Remix, Nuxt) embedded in HTML. */
export function embeddedPageData(html: string, { appState = true }: { appState?: boolean } = {}): string {
  const seenStrings = new Set<string>();
  const structuredLines: string[] = [];
  const appLines: string[] = [];

  const scriptRegex = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(html)) !== null) {
    const attrs = scriptMatch[1];
    const content = cleanCdata(scriptMatch[2]);
    if (/\btype\s*=\s*["']?application\/ld\+json(?:\s*;[^"'>]*)?["']?(?:\s|>|$)/i.test(attrs)) {
      try {
        const parsed = JSON.parse(content);
        flattenNode(parsed, [], structuredLines, seenStrings, 0);
      } catch {
        continue;
      }
    } else if (appState && /\bid\s*=\s*["']?__NEXT_DATA__["']?(?:\s|>|$)/i.test(attrs)) {
      try {
        const parsed = JSON.parse(content);
        flattenNode(parsed, [], appLines, seenStrings, 0);
      } catch {
        continue;
      }
    }
  }

  const assignmentRegex = /(?:window\.)?(__appData|__remixContext|__INITIAL_STATE__|__NUXT__)\s*=\s*/g;
  let assignMatch: RegExpExecArray | null;
  while (appState && (assignMatch = assignmentRegex.exec(html)) !== null) {
    let braceIdx = assignMatch.index + assignMatch[0].length;
    while (braceIdx < html.length && /\s/.test(html[braceIdx])) {
      braceIdx++;
    }
    if (html[braceIdx] !== "{") continue;
    const jsonStr = extractJsonObject(html, braceIdx);
    if (!jsonStr) continue;
    try {
      const parsed = JSON.parse(jsonStr);
      flattenNode(parsed, [], appLines, seenStrings, 0);
      assignmentRegex.lastIndex = braceIdx + jsonStr.length;
    } catch {
      continue;
    }
  }

  const sections: string[] = [];
  if (structuredLines.length > 0) {
    sections.push(["Structured data:", ...structuredLines].join("\n"));
  }
  if (appLines.length > 0) {
    sections.push(["Page data:", ...appLines].join("\n"));
  }
  let result = sections.join("\n\n");
  if (result.length > 200_000) {
    result = result.slice(0, 200_000);
  }
  return result;
}
