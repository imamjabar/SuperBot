// Security: a bot names the address, so the page is fetched only through fetchPublicPage, which refuses this server,
// loopback and private networks on every redirect. Tests inject `fetchPage`; production never does.
import type { ServerResponse } from "node:http";

import type { json as sendJson } from "../harness/http.ts";
import { redactSecretsInText } from "../redact.ts";
import { fetchPublicPage, PAGE_MAX_BYTES, PAGE_TIMEOUT_MS, pageText } from "../wait-probes.ts";
import { PASS } from "./table.ts";

export interface WebFetchContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  readBody: () => Promise<unknown>;
}

export interface WebFetchDeps {
  fetchPage?: typeof fetchPublicPage;
}

export type WebFetchRoute = (ctx: WebFetchContext) => Promise<typeof PASS | void>;

const WEB_FETCH_PATH = "/api/internal/web/fetch";

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  apos: "'",
  nbsp: " ",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, body: string) => {
    const named = NAMED_ENTITIES[body.toLowerCase()];
    if (named !== undefined) return named;
    if (body[0] !== "#") return whole;
    const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return whole;
    return String.fromCodePoint(code);
  });
}

function cleanXmlText(raw: string): string {
  const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
  const tagless = unwrapped.replace(/<[^>]+>/g, " ");
  return decodeEntities(tagless).replace(/\s+/g, " ").trim();
}

function parseFeedItems(xml: string): string[] | null {
  const lines: string[] = [];
  const lower = xml.toLowerCase();
  let pos = 0;
  while (pos < xml.length) {
    const itemIdx = lower.indexOf("<item", pos);
    const entryIdx = lower.indexOf("<entry", pos);
    let startTag = -1;
    let endTagStr = "";
    if (itemIdx !== -1 && (entryIdx === -1 || itemIdx < entryIdx)) {
      startTag = itemIdx;
      endTagStr = "</item>";
    } else if (entryIdx !== -1) {
      startTag = entryIdx;
      endTagStr = "</entry>";
    } else {
      break;
    }
    const endTagIdx = lower.indexOf(endTagStr, startTag);
    if (endTagIdx === -1) break;
    const itemBlock = xml.slice(startTag, endTagIdx + endTagStr.length);
    pos = endTagIdx + endTagStr.length;

    let title = "";
    const titleMatch = itemBlock.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = cleanXmlText(titleMatch[1]);

    let link = "";
    const linkMatch = itemBlock.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
    if (linkMatch && linkMatch[1].trim()) {
      link = cleanXmlText(linkMatch[1]);
    } else {
      const hrefMatch = itemBlock.match(/<link\s+[^>]*href=["']([^"']+)["']/i);
      if (hrefMatch) link = hrefMatch[1].trim();
    }

    let date = "";
    const dateMatch = itemBlock.match(/<(?:pubdate|updated|dc:date)(?:\s[^>]*)?>([\s\S]*?)<\/(?:pubdate|updated|dc:date)>/i);
    if (dateMatch) date = cleanXmlText(dateMatch[1]);

    const parts = [title, link, date].filter(Boolean);
    if (parts.length > 0) {
      lines.push(parts.join(" — "));
    }
  }
  return lines.length > 0 ? lines : null;
}

export function createWebFetchRoutes(deps?: WebFetchDeps) {
  const fetchPage = deps?.fetchPage ?? fetchPublicPage;

  return async (ctx: WebFetchContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== WEB_FETCH_PATH) return PASS;

    const rawBody = await ctx.readBody();
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
      return void ctx.json(ctx.res, 400, { error: "Send a JSON object." });
    }
    const body = rawBody as Record<string, unknown>;
    if (typeof body.url !== "string" || !body.url.trim() || body.url.length > 2048) {
      return void ctx.json(ctx.res, 400, { error: "url must be a non-empty string of at most 2048 characters." });
    }
    let offset = 0;
    if (body.offset !== undefined) {
      if (!Number.isSafeInteger(body.offset) || (body.offset as number) < 0) {
        return void ctx.json(ctx.res, 400, { error: "offset must be a non-negative integer." });
      }
      offset = body.offset as number;
    }

    const page = await fetchPage(body.url.trim(), { maxBytes: PAGE_MAX_BYTES, timeoutMs: PAGE_TIMEOUT_MS });
    if (!page.ok) {
      const status = page.refused ? 400 : 502;
      return void ctx.json(ctx.res, status, { error: page.error });
    }

    const decoded = page.body.toString("utf8");
    const contentTypeHeader = String(page.headers["content-type"] ?? "");
    const mimeType = contentTypeHeader.split(";")[0].trim().toLowerCase();
    const isHtml = mimeType.includes("html") || /^\s*<!doctype|^\s*<html/i.test(decoded);
    const isFeedOrXml = mimeType.includes("xml") || mimeType.includes("rss") || mimeType.includes("atom") || /^\s*<\?xml|^\s*<(?:rss|feed)[\s>]/i.test(decoded);

    let title: string | undefined;
    let text = "";

    if (isHtml) {
      const titleMatch = decoded.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
      if (titleMatch) title = cleanXmlText(titleMatch[1]) || undefined;
      text = pageText(decoded);
    } else if (isFeedOrXml) {
      const feedLines = parseFeedItems(decoded);
      const titleMatch = decoded.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
      if (titleMatch) title = cleanXmlText(titleMatch[1]) || undefined;
      if (feedLines && feedLines.length > 0) {
        text = feedLines.join("\n");
      } else {
        text = pageText(decoded);
      }
    } else {
      text = decoded;
    }

    text = redactSecretsInText(text);
    if (title !== undefined) {
      title = redactSecretsInText(title);
    }

    const total = text.length;
    const slice = text.slice(offset, offset + 12000);
    const more = offset + slice.length < total;

    return void ctx.json(ctx.res, 200, {
      url: page.url.href,
      ...(title !== undefined ? { title } : {}),
      contentType: contentTypeHeader || (isHtml ? "text/html" : "text/plain"),
      text: slice,
      offset,
      total,
      more,
    });
  };
}
