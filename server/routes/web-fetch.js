import { redactSecretsInText } from "../redact.js";
import { fetchPublicPage, pageText } from "../wait-probes.js";
import { embeddedPageData, jsonDataText, postingDataUrl } from "./page-data.js";
import { pdfText } from "./pdf-text.js";
import { PASS } from "./table.js";
const WEB_FETCH_PATH = "/api/internal/web/fetch";
const FETCH_MAX_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 30_000;
const NAMED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    "#39": "'",
    apos: "'",
    nbsp: " ",
};
function decodeEntities(text) {
    return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+|#39);/gi, (whole, body) => {
        const named = NAMED_ENTITIES[body.toLowerCase()];
        if (named !== undefined)
            return named;
        if (body[0] !== "#")
            return whole;
        const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isInteger(code) || code < 0 || code > 0x10ffff)
            return whole;
        return String.fromCodePoint(code);
    });
}
function cleanXmlText(raw) {
    const unwrapped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1");
    const tagless = unwrapped.replace(/<[^>]+>/g, " ");
    return decodeEntities(tagless).replace(/\s+/g, " ").trim();
}
function parseFeedItems(xml) {
    const lines = [];
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
        }
        else if (entryIdx !== -1) {
            startTag = entryIdx;
            endTagStr = "</entry>";
        }
        else {
            break;
        }
        const endTagIdx = lower.indexOf(endTagStr, startTag);
        if (endTagIdx === -1)
            break;
        const itemBlock = xml.slice(startTag, endTagIdx + endTagStr.length);
        pos = endTagIdx + endTagStr.length;
        let title = "";
        const titleMatch = itemBlock.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
        if (titleMatch)
            title = cleanXmlText(titleMatch[1]);
        let link = "";
        const linkMatch = itemBlock.match(/<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i);
        if (linkMatch && linkMatch[1].trim()) {
            link = cleanXmlText(linkMatch[1]);
        }
        else {
            const hrefMatch = itemBlock.match(/<link\s+[^>]*href=["']([^"']+)["']/i);
            if (hrefMatch)
                link = hrefMatch[1].trim();
        }
        let date = "";
        const dateMatch = itemBlock.match(/<(?:pubdate|updated|dc:date)(?:\s[^>]*)?>([\s\S]*?)<\/(?:pubdate|updated|dc:date)>/i);
        if (dateMatch)
            date = cleanXmlText(dateMatch[1]);
        const parts = [title, link, date].filter(Boolean);
        if (parts.length > 0) {
            lines.push(parts.join(" — "));
        }
    }
    return lines.length > 0 ? lines : null;
}
const SIGN_IN_STATUS = new Set([401, 407]);
const BLOCKED_STATUS = new Set([403, 429, 503]);
const SIGN_IN_PATH = /(?:^|[/._-])(?:log-?in|sign-?in|auth|sso)(?:$|[/._-])/i;
const PASSWORD_FIELD = /<input\b[^>]*\btype\s*=\s*["']?password\b/i;
/** Below this a page with a password field is a sign-in form, not an article with a sign-in box. */
const SIGN_IN_TEXT_MAX = 1_500;
/** Below this a page that ships scripts and an empty app mount or a noscript notice shows its words only once they run. */
const SCRIPT_TEXT_MAX = 200;
const SCRIPT_SHELL = /<noscript\b|<div\b[^>]*\bid\s*=\s*["']?(?:root|app|__next|__nuxt)["']?[^>]*>\s*<\/div>/i;
const BOT_CHALLENGE_TEXT = /Just a moment|Attention Required|Access denied|Are you a robot|verify you are (?:a )?human|captcha/i;
const BOT_CHALLENGE_HTML = /cf-chl|challenge-platform|_Incapsula_/;
const CHALLENGE_TEXT_MAX = 1_500;
/** Why a page's text needs the built-in browser, or undefined when web_fetch read it. */
export function browserNeed(page) {
    if (page.status !== undefined && BLOCKED_STATUS.has(page.status))
        return "blocked";
    if (page.status !== undefined && SIGN_IN_STATUS.has(page.status))
        return "sign-in";
    if (page.url && SIGN_IN_PATH.test(page.url.pathname) && !SIGN_IN_PATH.test(page.requested.pathname))
        return "sign-in";
    if (page.html === undefined)
        return undefined;
    const length = page.text?.length ?? 0;
    if (length < CHALLENGE_TEXT_MAX) {
        const title = page.title ?? (page.html.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i)?.[1] ?? "");
        if (BOT_CHALLENGE_TEXT.test(title) || BOT_CHALLENGE_TEXT.test(page.text ?? "") || BOT_CHALLENGE_HTML.test(page.html)) {
            return "blocked";
        }
    }
    if (PASSWORD_FIELD.test(page.html) && length < SIGN_IN_TEXT_MAX)
        return "sign-in";
    if (length < SCRIPT_TEXT_MAX && /<script\b/i.test(page.html) && SCRIPT_SHELL.test(page.html))
        return "script";
    return undefined;
}
const BROWSER_NEXT = {
    "sign-in": "This page asks to sign in, so web_fetch cannot read it.",
    script: "This page shows its text only after its scripts run, so web_fetch got almost nothing.",
    blocked: "This site refuses automated reads from SuperBot's server (a bot wall), so web_fetch cannot read it.",
};
function browserNext(need) {
    if (need === "blocked") {
        return `${BROWSER_NEXT.blocked} Try it once in the built-in browser (browser_navigate, then browser_snapshot). If that is blocked too and you have a Local VM desktop, open it in Chrome there, wait about 30 seconds and click the human check once; a check still there, or a login, goes to the person with request_sign_in. Otherwise get the same facts from another source (search for them) and say which site could not be read. Do not call web_fetch on it again.`;
    }
    return `${BROWSER_NEXT[need]} Open it in the built-in browser (browser_navigate, then browser_snapshot)${need === "sign-in" ? "; the person may need to sign in there" : ""}. Do not call web_fetch on it again. With no browser this turn, say that this page needs the browser; use a desktop only when no browser can open it.`;
}
function postingJson(body) {
    try {
        return jsonDataText(JSON.parse(body));
    }
    catch {
        return "";
    }
}
export function createWebFetchRoutes(deps) {
    const fetchPage = deps?.fetchPage ?? fetchPublicPage;
    return async (ctx) => {
        if (ctx.method !== "POST" || ctx.path !== WEB_FETCH_PATH)
            return PASS;
        const rawBody = await ctx.readBody();
        if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody)) {
            return void ctx.json(ctx.res, 400, { error: "Send a JSON object." });
        }
        const body = rawBody;
        if (typeof body.url !== "string" || !body.url.trim() || body.url.length > 2048) {
            return void ctx.json(ctx.res, 400, { error: "url must be a non-empty string of at most 2048 characters." });
        }
        let offset = 0;
        if (body.offset !== undefined) {
            if (!Number.isSafeInteger(body.offset) || body.offset < 0) {
                return void ctx.json(ctx.res, 400, { error: "offset must be a non-negative integer." });
            }
            offset = body.offset;
        }
        let find;
        if (body.find !== undefined) {
            if (typeof body.find !== "string" || body.find.length < 2 || body.find.length > 200) {
                return void ctx.json(ctx.res, 400, { error: "find must be 2 to 200 characters." });
            }
            find = body.find;
        }
        const requested = URL.canParse(body.url.trim()) ? new URL(body.url.trim()) : undefined;
        const page = await fetchPage(body.url.trim(), { maxBytes: FETCH_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS });
        if (!page.ok) {
            const need = requested ? browserNeed({ status: page.status, requested }) : undefined;
            if (need) {
                return void ctx.json(ctx.res, 200, {
                    url: requested.href,
                    ...(page.status !== undefined ? { status: page.status } : {}),
                    needsBrowser: need,
                    next: browserNext(need),
                });
            }
            const status = page.refused ? 400 : 502;
            return void ctx.json(ctx.res, status, { error: page.error });
        }
        const contentTypeHeader = String(page.headers["content-type"] ?? "");
        const mimeType = contentTypeHeader.split(";")[0].trim().toLowerCase();
        const isPdf = contentTypeHeader.toLowerCase().includes("application/pdf") || page.body.subarray(0, 5).toString("latin1") === "%PDF-";
        let title;
        let text = "";
        let isHtml = false;
        if (isPdf) {
            const parsed = await pdfText(page.body);
            if (!parsed) {
                return void ctx.json(ctx.res, 502, { error: "This PDF could not be read (damaged or password-protected)." });
            }
            const stripped = parsed.text.replace(/\[page \d+\]/g, "").trim();
            if (!stripped) {
                return void ctx.json(ctx.res, 502, { error: "This PDF has no text layer (scanned pages), so web_fetch cannot read it." });
            }
            text = parsed.text;
            const firstLine = stripped.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0);
            if (firstLine) {
                title = firstLine.slice(0, 200);
            }
        }
        else {
            const decoded = page.body.toString("utf8");
            isHtml = mimeType.includes("html") || /^\s*<!doctype|^\s*<html/i.test(decoded);
            const isFeedOrXml = mimeType.includes("xml") || mimeType.includes("rss") || mimeType.includes("atom") || /^\s*<\?xml|^\s*<(?:rss|feed)[\s>]/i.test(decoded);
            if (isHtml) {
                const titleMatch = decoded.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
                if (titleMatch)
                    title = cleanXmlText(titleMatch[1]) || undefined;
                text = pageText(decoded);
                const thin = text.length < 1500;
                const postingApi = thin ? postingDataUrl(page.url) : undefined;
                const posting = postingApi ? await fetchPage(postingApi, { maxBytes: FETCH_MAX_BYTES, timeoutMs: FETCH_TIMEOUT_MS }) : undefined;
                const postingData = posting?.ok ? postingJson(posting.body.toString("utf8")) : "";
                const data = [postingData && `Posting data (${postingApi}):\n${postingData}`, embeddedPageData(decoded, { appState: thin && !postingData })].filter(Boolean).join("\n\n");
                const need = requested ? browserNeed({ requested, url: page.url, html: decoded, text, title }) : undefined;
                if (need && (need !== "script" || !data)) {
                    const pageStatus = "status" in page && typeof page.status === "number" ? page.status : 200;
                    return void ctx.json(ctx.res, 200, {
                        url: page.url.href,
                        ...(title !== undefined ? { title: redactSecretsInText(title) } : {}),
                        status: pageStatus,
                        needsBrowser: need,
                        next: browserNext(need),
                    });
                }
                if (data) {
                    text = thin ? (text ? `${data}\n\n${text}` : data) : `${text}\n\n${data}`;
                }
            }
            else if (isFeedOrXml) {
                const feedLines = parseFeedItems(decoded);
                const titleMatch = decoded.match(/<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i);
                if (titleMatch)
                    title = cleanXmlText(titleMatch[1]) || undefined;
                if (feedLines && feedLines.length > 0) {
                    text = feedLines.join("\n");
                }
                else {
                    text = pageText(decoded);
                }
            }
            else {
                text = decoded;
            }
        }
        text = redactSecretsInText(text);
        if (title !== undefined) {
            title = redactSecretsInText(title);
        }
        const total = text.length;
        if (find !== undefined) {
            const lowerText = text.toLowerCase();
            const terms = Array.from(new Set(find
                .split(" | ")
                .map((t) => t.trim().toLowerCase())
                .filter((t) => t.length > 0)));
            const hits = [];
            for (const term of terms) {
                let pos = offset;
                while (pos < lowerText.length) {
                    const idx = lowerText.indexOf(term, pos);
                    if (idx === -1)
                        break;
                    hits.push({ start: idx, end: idx + term.length });
                    pos = idx + Math.max(1, term.length);
                }
            }
            hits.sort((a, b) => a.start - b.start || a.end - b.end);
            const windows = [];
            for (const hit of hits) {
                const winStart = Math.max(0, hit.start - 300);
                const winEnd = Math.min(total, hit.end + 500);
                if (windows.length === 0) {
                    windows.push({ start: winStart, end: winEnd });
                    continue;
                }
                const last = windows[windows.length - 1];
                if (winStart <= last.end) {
                    last.end = Math.max(last.end, winEnd);
                }
                else {
                    windows.push({ start: winStart, end: winEnd });
                }
            }
            const more = hits.length > 20 || windows.length > 20;
            const matches = windows.slice(0, 20).map((w) => ({
                offset: w.start,
                text: text.slice(w.start, w.end),
            }));
            return void ctx.json(ctx.res, 200, {
                url: page.url.href,
                ...(title !== undefined ? { title } : {}),
                contentType: isPdf ? "application/pdf" : (contentTypeHeader || (isHtml ? "text/html" : "text/plain")),
                total,
                find,
                matches,
                more,
            });
        }
        const slice = text.slice(offset, offset + 12000);
        const more = offset + slice.length < total;
        return void ctx.json(ctx.res, 200, {
            url: page.url.href,
            ...(title !== undefined ? { title } : {}),
            contentType: isPdf ? "application/pdf" : (contentTypeHeader || (isHtml ? "text/html" : "text/plain")),
            text: slice,
            offset,
            total,
            more,
        });
    };
}
