import { mkdtempSync, readFileSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { request as httpRequest, type IncomingHttpHeaders } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PAGE_FILE_EXTENSIONS } from "../../shared/published-page.ts";
import { createPagesHost } from "./host.ts";
import { listenPages, type PagesListener } from "./listener.ts";
import { pagesRoot } from "./paths.ts";

const SECRET = "TOP-SECRET-OUTSIDE-THE-PAGE";
const SANDBOX = "sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
const TYPES: Record<string, string> = {
  "index.html": "text/html; charset=utf-8", "old.htm": "text/html; charset=utf-8", "app.js": "text/javascript; charset=utf-8", "mod.mjs": "text/javascript; charset=utf-8",
  "style.css": "text/css; charset=utf-8", "data.json": "application/json; charset=utf-8", "data.csv": "text/csv; charset=utf-8", "notes.md": "text/markdown; charset=utf-8",
  "readme.txt": "text/plain; charset=utf-8", "logo.svg": "image/svg+xml", "data.parquet": "application/octet-stream", "data.arrow": "application/vnd.apache.arrow.file",
  "a.png": "image/png", "a.jpg": "image/jpeg", "a.jpeg": "image/jpeg", "a.gif": "image/gif", "a.webp": "image/webp", "a.avif": "image/avif", "a.ico": "image/x-icon",
  "a.woff": "font/woff", "a.woff2": "font/woff2", "a.ttf": "font/ttf", "a.otf": "font/otf",
};

let dir: string;
let listener: PagesListener;
let pageId: string;
let otherId: string;

interface Answer { status: number; headers: IncomingHttpHeaders; body: string }
const send = (method: string, path: string, headers: Record<string, string> = {}) => new Promise<Answer>((resolve, reject) => {
  const req = httpRequest({ host: "127.0.0.1", port: listener.port, method, path, headers }, (res) => {
    const chunks: Buffer[] = [];
    res.on("data", (chunk: Buffer) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
  });
  req.on("error", reject);
  req.end();
});
const get = (path: string, headers?: Record<string, string>) => send("GET", path, headers);

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "omb-pages-listener-"));
  const host = createPagesHost({ dataDir: dir, publicUrl: "https://pages.example.test" });
  const files = [...Object.keys(TYPES).map((path) => ({ path, data: Buffer.from(path === "index.html" ? "<h1>Home</h1>" : `body of ${path}`) })),
    { path: "sub/index.html", data: Buffer.from("<h1>Sub</h1>") }, { path: "sub/data.csv", data: Buffer.from("a,b\n1,2\n") },
    { path: "my file (1).txt", data: Buffer.from("spaced") }];
  const made = await host.publish(files);
  const other = await host.publish([{ path: "index.html", data: Buffer.from("<h1>Other</h1>") }, { path: "private.txt", data: Buffer.from(SECRET) }]);
  if (!made.ok || !other.ok) throw new Error("setup failed");
  pageId = made.pageId;
  otherId = other.pageId;
  writeFileSync(join(dir, "secret.txt"), SECRET);
  writeFileSync(join(pagesRoot(dir), pageId, "extra.txt"), "on disk, not in the manifest");
  symlinkSync(join(dir, "secret.txt"), join(pagesRoot(dir), pageId, "linked.txt"));
  const manifestPath = join(pagesRoot(dir), pageId, ".manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: string[] };
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, files: [...manifest.files, "linked.txt"] }));
  listener = await listenPages({ dataDir: dir, port: 0 });
});
afterAll(() => {
  listener?.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("the pages listener", () => {
  it("answers /health with ok", async () => {
    expect(await get("/health")).toMatchObject({ status: 200, body: "ok" });
  });

  it("serves every extension a page may hold with its content type", async () => {
    const covered = new Set(Object.keys(TYPES).map((path) => path.split(".").pop()!));
    expect([...PAGE_FILE_EXTENSIONS].filter((extension) => !covered.has(extension))).toEqual([]);
    for (const [path, type] of Object.entries(TYPES)) {
      const answer = await get(`/p/${pageId}/${path}`);
      expect(answer.status, path).toBe(200);
      expect(answer.headers["content-type"], path).toBe(type);
      expect(answer.body).toBe(path === "index.html" ? "<h1>Home</h1>" : `body of ${path}`);
    }
  });

  it("sandboxes every page file in an opaque origin, forbids sniffing, and allows its own cross-origin fetches", async () => {
    for (const path of ["index.html", "app.js", "data.csv", "logo.svg"]) {
      const { headers } = await get(`/p/${pageId}/${path}`);
      expect(headers["content-security-policy"]).toBe(SANDBOX);
      expect(headers["content-security-policy"]).not.toContain("allow-same-origin");
      expect(headers["x-content-type-options"]).toBe("nosniff");
      expect(headers["access-control-allow-origin"]).toBe("*");
      expect(headers["referrer-policy"]).toBe("no-referrer");
      expect(headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(headers["cache-control"]).toBe("no-cache");
      expect(headers.etag).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
      expect(headers["set-cookie"]).toBeUndefined();
    }
  });

  it("resolves a page's index.html at its folder and in a sub-folder, and a file with a space in its name", async () => {
    expect((await get(`/p/${pageId}/`)).body).toBe("<h1>Home</h1>");
    expect((await get(`/p/${pageId}/?utm=1`)).body).toBe("<h1>Home</h1>");
    expect((await get(`/p/${pageId}/sub/`)).body).toBe("<h1>Sub</h1>");
    expect((await get(`/p/${pageId}/sub/data.csv`)).body).toBe("a,b\n1,2\n");
    expect((await get(`/p/${pageId}/my%20file%20(1).txt`)).body).toBe("spaced");
  });

  it("redirects a page's address without the closing slash, keeping the query", async () => {
    const answer = await get(`/p/${pageId}`);
    expect(answer.status).toBe(301);
    expect(answer.headers.location).toBe(`/p/${pageId}/`);
    expect((await get(`/p/${pageId}?x=1`)).headers.location).toBe(`/p/${pageId}/?x=1`);
  });

  it("answers 404 for everything that isn't a file in a page's manifest", async () => {
    for (const path of [`/p/${pageId}/extra.txt`, `/p/${pageId}/.manifest.json`, `/p/${pageId}/nothing.html`, `/p/${pageId}/sub`, `/p/${pageId}/sub/missing/`,
      `/p/${"z".repeat(26)}/`, `/p/${pageId.toUpperCase()}/`, "/", "/p/", "/p", "/api/config", "/api/health", "/hooks/x", `/other/${pageId}/`]) {
      const answer = await get(path);
      expect(answer.status, path).toBe(404);
      expect(answer.body.length, path).toBeLessThan(40);
      expect(answer.headers["content-type"]).toBe("text/plain; charset=utf-8");
    }
  });

  it("refuses traversal out of a page, literal or encoded, and never leaks another page or the data folder", async () => {
    for (const path of [`/p/${pageId}/../secret.txt`, `/p/${pageId}/../${otherId}/private.txt`, `/p/${pageId}/%2e%2e/secret.txt`, `/p/${pageId}/%2E%2E/%2E%2E/secret.txt`,
      `/p/${pageId}/..%2fsecret.txt`, `/p/${pageId}/%2e%2e%2f%2e%2e%2fsecret.txt`, `/p/${pageId}/sub%2f..%2f..%2fsecret.txt`, `/p/${pageId}/..%5csecret.txt`,
      `/p/${pageId}/%252e%252e/secret.txt`, `/p/${pageId}/sub/..%2findex.html`, `/p/${pageId}//index.html`, `/p/${pageId}/%00.html`,
      `/p/${pageId}/linked.txt`, `/p/${pageId}/..;/secret.txt`]) {
      const answer = await get(path);
      expect([400, 404], path).toContain(answer.status);
      expect(answer.body, path).not.toContain(SECRET);
    }
  });

  it("answers 400 for a bad percent-encoding", async () => {
    for (const path of [`/p/${pageId}/%E0%A4%A`, `/p/${pageId}/%zz`, `/p/${pageId}/a%`]) expect((await get(path)).status, path).toBe(400);
  });

  it("takes only GET and HEAD", async () => {
    for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
      const answer = await send(method, `/p/${pageId}/`);
      expect(answer.status, method).toBe(405);
      expect(answer.headers.allow).toBe("GET, HEAD");
    }
    expect((await send("POST", "/health")).status).toBe(405);
  });

  it("answers 304 to a matching If-None-Match, and a new ETag once the file changes", async () => {
    const first = await get(`/p/${pageId}/style.css`);
    const etag = first.headers.etag!;
    for (const header of [etag, `W/${etag}`, `"other", ${etag}`, "*"]) {
      const answer = await get(`/p/${pageId}/style.css`, { "if-none-match": header });
      expect(answer.status, header).toBe(304);
      expect(answer.body).toBe("");
      expect(answer.headers.etag).toBe(etag);
    }
    expect((await get(`/p/${pageId}/style.css`, { "if-none-match": '"nope"' })).status).toBe(200);
    const file = join(pagesRoot(dir), pageId, "style.css");
    writeFileSync(file, "a much longer stylesheet than before");
    utimesSync(file, new Date(), new Date(Date.now() + 5000));
    const changed = await get(`/p/${pageId}/style.css`, { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.etag).not.toBe(etag);
  });

  it("answers HEAD with the headers and no body", async () => {
    const answer = await send("HEAD", `/p/${pageId}/data.csv`);
    expect(answer.status).toBe(200);
    expect(answer.body).toBe("");
    expect(answer.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(answer.headers["content-length"]).toBe(String("body of data.csv".length));
    expect(answer.headers["content-security-policy"]).toBe(SANDBOX);
    expect((await send("HEAD", `/p/${pageId}/missing.html`)).status).toBe(404);
  });

  it("stops serving a page the moment it is unpublished", async () => {
    const host = createPagesHost({ dataDir: dir, publicUrl: "https://pages.example.test" });
    const made = await host.publish([{ path: "index.html", data: Buffer.from("<p>gone soon</p>") }]);
    if (!made.ok) throw new Error(made.message);
    expect((await get(`/p/${made.pageId}/`)).status).toBe(200);
    await host.unpublish(made.pageId);
    expect((await get(`/p/${made.pageId}/`)).status).toBe(404);
  });
});
