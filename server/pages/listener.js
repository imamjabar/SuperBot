// The pages listener: a second HTTP server, on its own port and so its own origin, that serves published pages and nothing
// else. It never serves an app route and never reads credentials or cookies. Only the owner's reverse proxy or tunnel
// (Tailscale Funnel) puts this port on the internet; the app's own port stays private.
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve, sep } from "node:path";
import { pipeline } from "node:stream";
import { IDLE_HTTP_SERVER } from "../due-timer.js";
import { PAGE_MANIFEST, pageFileSegments, pagesRoot } from "./paths.js";
const CONTENT_TYPES = {
    html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8",
    js: "text/javascript; charset=utf-8", mjs: "text/javascript; charset=utf-8",
    css: "text/css; charset=utf-8", json: "application/json; charset=utf-8", csv: "text/csv; charset=utf-8",
    md: "text/markdown; charset=utf-8", txt: "text/plain; charset=utf-8", svg: "image/svg+xml",
    parquet: "application/octet-stream", arrow: "application/vnd.apache.arrow.file",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", ico: "image/x-icon",
    woff: "font/woff", woff2: "font/woff2", ttf: "font/ttf", otf: "font/otf",
};
// Security: no allow-same-origin, so every page runs in an opaque origin: it cannot read another page's storage or set
// cookies on this shared host.
const PAGE_HEADERS = {
    "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads",
    // The sandboxed page's own fetches of its data files are cross-origin.
    "Access-Control-Allow-Origin": "*",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "cross-origin",
    "Cache-Control": "no-cache",
};
const PAGE_PATH = /^\/p\/([a-z0-9]{20,63})(\/.*)?$/;
function plain(res, status, body, extra = {}) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "Content-Length": Buffer.byteLength(body), "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store", ...extra });
    res.end(body);
}
async function manifestOf(pageDir) {
    try {
        const parsed = JSON.parse(await readFile(join(pageDir, PAGE_MANIFEST), "utf8"));
        return Array.isArray(parsed.files) ? new Set(parsed.files.filter((file) => typeof file === "string")) : null;
    }
    catch {
        return null;
    }
}
const matches = (header, etag) => header !== undefined && (header.trim() === "*" || header.split(",").some((tag) => tag.trim().replace(/^W\//, "") === etag));
/** The listener's handler for `<dataDir>/published-pages`. */
export function createPagesHandler(dataDir) {
    const root = pagesRoot(dataDir);
    return async (req, res) => {
        if (req.method !== "GET" && req.method !== "HEAD")
            return plain(res, 405, "Method not allowed", { Allow: "GET, HEAD" });
        const raw = req.url ?? "";
        const queryAt = raw.search(/[?#]/);
        const path = queryAt < 0 ? raw : raw.slice(0, queryAt), query = queryAt >= 0 && raw[queryAt] === "?" ? raw.slice(queryAt).split("#")[0] : "";
        if (path === "/health")
            return plain(res, 200, "ok");
        const match = PAGE_PATH.exec(path);
        if (!match)
            return plain(res, 404, "Not found");
        const pageId = match[1], rest = match[2];
        if (rest === undefined)
            return plain(res, 301, "", { Location: `/p/${pageId}/${query}` });
        let parts;
        try {
            parts = rest.slice(1).split("/").map((segment) => decodeURIComponent(segment));
        }
        catch {
            return plain(res, 400, "Bad request");
        }
        if (parts.some((part) => part.includes("/")))
            return plain(res, 404, "Not found");
        let relative = parts.join("/");
        if (relative === "" || relative.endsWith("/"))
            relative += "index.html";
        const segments = pageFileSegments(relative);
        if (!segments)
            return plain(res, 404, "Not found");
        const pageDir = join(root, pageId);
        const manifest = await manifestOf(pageDir);
        if (!manifest?.has(relative))
            return plain(res, 404, "Not found");
        const file = resolve(pageDir, ...segments);
        if (!file.startsWith(resolve(pageDir) + sep))
            return plain(res, 404, "Not found");
        const info = await lstat(file).catch(() => null);
        if (!info?.isFile())
            return plain(res, 404, "Not found");
        const etag = `"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}"`;
        const headers = { ...PAGE_HEADERS, ETag: etag };
        if (matches(req.headers["if-none-match"], etag)) {
            res.writeHead(304, headers);
            return void res.end();
        }
        res.writeHead(200, { ...headers, "Content-Type": CONTENT_TYPES[extname(file).slice(1).toLowerCase()] ?? "application/octet-stream", "Content-Length": info.size });
        if (req.method === "HEAD")
            return void res.end();
        pipeline(createReadStream(file), res, () => { });
    };
}
export async function listenPages(options) {
    const handle = createPagesHandler(options.dataDir);
    const server = createServer(IDLE_HTTP_SERVER, (req, res) => {
        handle(req, res).catch((error) => {
            console.error("pages: listener failed", error);
            if (res.headersSent)
                res.destroy();
            else
                plain(res, 500, "Server error");
        });
    });
    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host ?? "127.0.0.1", () => {
            server.off("error", reject);
            resolveListen();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string") {
        server.close();
        throw new Error("Pages listener did not get a TCP address");
    }
    return { server, port: address.port, close: () => void server.close() };
}
/** Starts the listener at server start; a port that cannot be bound is logged and the rest of the server goes on. */
export async function startPagesListener(config, dataDir) {
    try {
        const listener = await listenPages({ dataDir, port: config.port });
        console.log(`pages: listener on http://127.0.0.1:${listener.port}${config.publicUrl ? ` (public address ${config.publicUrl})` : " (no OMB_PAGES_PUBLIC_URL: publishing is off)"}`);
        return listener;
    }
    catch (error) {
        console.error(`pages: listener unavailable: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
