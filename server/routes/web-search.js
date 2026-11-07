import { redactSecretsInText } from "../redact.js";
import { PASS } from "./table.js";
const WEB_SEARCH_PATH = "/api/internal/web/search";
const COMMAND_CODE_HOST = "api.commandcode.ai";
/** Command Code's CLI calls this route on the API origin with the same bearer key as its provider API (command-code 1.88.5). */
const COMMAND_CODE_SEARCH_ROUTE = "/alpha/web-search";
const SEARCH_TIMEOUT_MS = 20_000;
const DEFAULT_RESULTS = 5;
export const MAX_RESULTS = 10;
const MAX_DOMAINS = 20;
/** The search endpoint when the workspace OpenAI-compatible connection is the Command Code gateway with a key. */
export function commandCodeSearch(compat) {
    if (!compat?.key || !compat.url || !URL.canParse(compat.url))
        return undefined;
    const base = new URL(compat.url);
    if (base.protocol !== "https:" || base.hostname !== COMMAND_CODE_HOST)
        return undefined;
    return { url: `${base.origin}${COMMAND_CODE_SEARCH_ROUTE}`, key: compat.key };
}
function domains(value) {
    if (value === undefined)
        return undefined;
    if (!Array.isArray(value) || value.length > MAX_DOMAINS || !value.every((d) => typeof d === "string" && d.trim() && d.length <= 253))
        return null;
    return value.map((d) => d.trim().toLowerCase().replace(/^\*?\./, ""));
}
function inDomains(url, list) {
    if (!URL.canParse(url))
        return false;
    const host = new URL(url).hostname.toLowerCase();
    return list.some((domain) => host === domain || host.endsWith(`.${domain}`));
}
function results(body) {
    const list = body?.results;
    if (!Array.isArray(list))
        return undefined;
    return list.flatMap((item) => {
        const { title, url, snippet } = (item ?? {});
        if (typeof url !== "string" || !/^https?:\/\//i.test(url))
            return [];
        return [{
                title: redactSecretsInText(typeof title === "string" ? title.slice(0, 300) : url),
                url,
                snippet: redactSecretsInText(typeof snippet === "string" ? snippet.slice(0, 600) : ""),
            }];
    });
}
export function createWebSearchRoutes(deps) {
    const send = deps.fetch ?? fetch;
    return async (ctx) => {
        if (ctx.method !== "POST" || ctx.path !== WEB_SEARCH_PATH)
            return PASS;
        const raw = await ctx.readBody();
        if (!raw || typeof raw !== "object" || Array.isArray(raw))
            return void ctx.json(ctx.res, 400, { error: "Send a JSON object." });
        const body = raw;
        const query = typeof body.query === "string" ? body.query.trim() : "";
        if (query.length < 2 || query.length > 400)
            return void ctx.json(ctx.res, 400, { error: "query must be 2 to 400 characters." });
        if (body.numResults !== undefined && (!Number.isSafeInteger(body.numResults) || body.numResults < 1 || body.numResults > MAX_RESULTS)) {
            return void ctx.json(ctx.res, 400, { error: `numResults must be a whole number from 1 to ${MAX_RESULTS}.` });
        }
        const numResults = body.numResults ?? DEFAULT_RESULTS;
        const allowed = domains(body.allowed_domains), blocked = domains(body.blocked_domains);
        if (allowed === null || blocked === null)
            return void ctx.json(ctx.res, 400, { error: `allowed_domains and blocked_domains must be lists of at most ${MAX_DOMAINS} domain names.` });
        if (allowed?.length && blocked?.length)
            return void ctx.json(ctx.res, 400, { error: "Pass allowed_domains or blocked_domains, not both." });
        const gateway = deps.gateway();
        if (!gateway) {
            return void ctx.json(ctx.res, 503, { error: "Web search is not set up on this server: it runs through the Command Code gateway key (OPENAI_COMPAT_URL https://api.commandcode.ai/provider/v1). Read a known address with web_fetch instead." });
        }
        let answer;
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
        }
        catch {
            return void ctx.json(ctx.res, 502, { error: "Web search did not answer. Try again shortly, or read a known address with web_fetch." });
        }
        if (!answer.ok)
            return void ctx.json(ctx.res, 502, { error: `Web search answered ${answer.status}. Try again shortly, or read a known address with web_fetch.` });
        const found = results(await answer.json().catch(() => null));
        if (!found)
            return void ctx.json(ctx.res, 502, { error: "Web search sent an answer without results. Try again shortly." });
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
