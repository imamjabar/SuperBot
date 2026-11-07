// Security: the Command Code key goes only to the gateway's own origin, and redirects are refused so it never follows one.
import type { ServerResponse } from "node:http";

import type { json as sendJson } from "../harness/http.ts";
import { redactSecretsInText } from "../redact.ts";
import { PASS } from "./table.ts";

export interface WebSearchContext {
  method: string;
  path: string;
  res: ServerResponse;
  json: typeof sendJson;
  readBody: () => Promise<unknown>;
}

export interface SearchGateway {
  url: string;
  key: string;
}

export interface WebSearchDeps {
  gateway: () => SearchGateway | undefined;
  fetch?: typeof fetch;
}

const WEB_SEARCH_PATH = "/api/internal/web/search";
const COMMAND_CODE_HOST = "api.commandcode.ai";
/** Command Code's CLI calls this route on the API origin with the same bearer key as its provider API (command-code 1.88.5). */
const COMMAND_CODE_SEARCH_ROUTE = "/alpha/web-search";
const SEARCH_TIMEOUT_MS = 20_000;
const DEFAULT_RESULTS = 5;
export const MAX_RESULTS = 10;
const MAX_DOMAINS = 20;

/** The search endpoint when the workspace OpenAI-compatible connection is the Command Code gateway with a key. */
export function commandCodeSearch(compat: { url?: string; key?: string } | undefined): SearchGateway | undefined {
  if (!compat?.key || !compat.url || !URL.canParse(compat.url)) return undefined;
  const base = new URL(compat.url);
  if (base.protocol !== "https:" || base.hostname !== COMMAND_CODE_HOST) return undefined;
  return { url: `${base.origin}${COMMAND_CODE_SEARCH_ROUTE}`, key: compat.key };
}

function domains(value: unknown): string[] | undefined | null {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > MAX_DOMAINS || !value.every((d) => typeof d === "string" && d.trim() && d.length <= 253)) return null;
  return value.map((d: string) => d.trim().toLowerCase().replace(/^\*?\./, ""));
}

function inDomains(url: string, list: string[]): boolean {
  if (!URL.canParse(url)) return false;
  const host = new URL(url).hostname.toLowerCase();
  return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function results(body: unknown): SearchResult[] | undefined {
  const list = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(list)) return undefined;
  return list.flatMap((item) => {
    const { title, url, snippet } = (item ?? {}) as Record<string, unknown>;
    if (typeof url !== "string" || !/^https?:\/\//i.test(url)) return [];
    return [{
      title: redactSecretsInText(typeof title === "string" ? title.slice(0, 300) : url),
      url,
      snippet: redactSecretsInText(typeof snippet === "string" ? snippet.slice(0, 600) : ""),
    }];
  });
}

export function createWebSearchRoutes(deps: WebSearchDeps) {
  const send = deps.fetch ?? fetch;

  return async (ctx: WebSearchContext): Promise<typeof PASS | void> => {
    if (ctx.method !== "POST" || ctx.path !== WEB_SEARCH_PATH) return PASS;

    const raw = await ctx.readBody();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return void ctx.json(ctx.res, 400, { error: "Send a JSON object." });
    const body = raw as Record<string, unknown>;
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (query.length < 2 || query.length > 400) return void ctx.json(ctx.res, 400, { error: "query must be 2 to 400 characters." });
    if (body.numResults !== undefined && (!Number.isSafeInteger(body.numResults) || (body.numResults as number) < 1 || (body.numResults as number) > MAX_RESULTS)) {
      return void ctx.json(ctx.res, 400, { error: `numResults must be a whole number from 1 to ${MAX_RESULTS}.` });
    }
    const numResults = (body.numResults as number | undefined) ?? DEFAULT_RESULTS;
    const allowed = domains(body.allowed_domains), blocked = domains(body.blocked_domains);
    if (allowed === null || blocked === null) return void ctx.json(ctx.res, 400, { error: `allowed_domains and blocked_domains must be lists of at most ${MAX_DOMAINS} domain names.` });
    if (allowed?.length && blocked?.length) return void ctx.json(ctx.res, 400, { error: "Pass allowed_domains or blocked_domains, not both." });

    const gateway = deps.gateway();
    if (!gateway) {
      return void ctx.json(ctx.res, 503, { error: "Web search is not set up on this server: it runs through the Command Code gateway key (OPENAI_COMPAT_URL https://api.commandcode.ai/provider/v1). Read a known address with web_fetch instead." });
    }

    let answer: Response;
    try {
      answer = await send(gateway.url, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
        headers: { Authorization: `Bearer ${gateway.key}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          numResults,
          ...(allowed?.length ? { allowedDomains: allowed } : {}),
          ...(blocked?.length ? { blockedDomains: blocked } : {}),
        }),
      });
    } catch {
      return void ctx.json(ctx.res, 502, { error: "Web search did not answer. Try again shortly, or read a known address with web_fetch." });
    }
    if (!answer.ok) return void ctx.json(ctx.res, 502, { error: `Web search answered ${answer.status}. Try again shortly, or read a known address with web_fetch.` });

    const found = results(await answer.json().catch(() => null));
    if (!found) return void ctx.json(ctx.res, 502, { error: "Web search sent an answer without results. Try again shortly." });
    const kept = found
      .filter((result) => (allowed?.length ? inDomains(result.url, allowed) : !(blocked?.length && inDomains(result.url, blocked))))
      .slice(0, numResults);
    return void ctx.json(ctx.res, 200, {
      query,
      results: kept,
      next: kept.length
        ? "Read the pages you need with web_fetch (one call per page) and cite them as [Title](URL)."
        : "No results. Try a broader or differently worded query, or loosen the domain filters.",
    });
  };
}
