import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { fetchPublicPage } from "../wait-probes.ts";
import { PASS } from "./table.ts";
import { createValidPdf } from "./pdf-text.test.ts";
import { createWebFetchRoutes, type WebFetchContext, type WebFetchRoute } from "./web-fetch.ts";

interface RouteResponse {
  result: typeof PASS | void;
  status: number;
  body: Record<string, unknown>;
}

describe("web_fetch internal route", () => {
  let server: Server;
  let port = 0;
  let serverHits = 0;

  beforeAll(async () => {
    server = createServer((req, res) => {
      serverHits++;
      const path = req.url ?? "/";
      if (path === "/html") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <title>Test Page Title</title>
              <style>body { color: red; }</style>
              <script>alert("hidden");</script>
            </head>
            <body>
              <h1>Hello World</h1>
              <p>This is readable text.</p>
            </body>
          </html>
        `);
      } else if (path === "/rss") {
        res.setHeader("content-type", "application/rss+xml");
        res.end(`
          <?xml version="1.0" encoding="UTF-8"?>
          <rss version="2.0">
            <channel>
              <title>Sample Feed</title>
              <item>
                <title>First Headline</title>
                <link>https://example.com/item1</link>
                <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
              </item>
              <item>
                <title>Second Headline</title>
                <link>https://example.com/item2</link>
                <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
              </item>
            </channel>
          </rss>
        `);
      } else if (path === "/long") {
        res.setHeader("content-type", "text/plain");
        res.end("X".repeat(25000));
      } else if (path === "/news/today") {
        res.writeHead(302, { location: "/account/login?next=/news/today" }).end();
      } else if (path.startsWith("/account/login")) {
        res.setHeader("content-type", "text/html");
        res.end(`<html><head><title>Sign in</title></head><body><form><input name="user"><input type="password" name="pw"><button>Sign in</button></form></body></html>`);
      } else if (path === "/members") {
        res.writeHead(401).end();
      } else if (path === "/app") {
        res.setHeader("content-type", "text/html");
        res.end(`<!doctype html><html><head><title>Dashboard</title><script src="/bundle.js"></script></head><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>`);
      } else if (path === "/article") {
        res.setHeader("content-type", "text/html");
        res.end(`<html><body><form><input type="password" name="pw"></form><article>${"Harga VPS Singapura naik. ".repeat(80)}</article></body></html>`);
      } else if (path === "/app-with-data") {
        res.setHeader("content-type", "text/html");
        res.end(`<!doctype html><html><head><title>Job Board</title><script src="/bundle.js"></script><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Senior ML Engineer","datePosted":"2026-08-01","baseSalary":{"value":{"minValue":190000}}}</script></head><body><div id="root"></div><noscript>Enable JavaScript</noscript></body></html>`);
      } else if (path === "/find-body") {
        res.setHeader("content-type", "text/plain");
        let bodyText = ".".repeat(1000) + "salary" + ".".repeat(74) + "visa";
        for (let i = 0; i < 23; i++) {
          bodyText += ".".repeat(994) + "salary";
        }
        bodyText += ".".repeat(1000);
        res.end(bodyText);
      } else if (path === "/long-with-next") {
        res.setHeader("content-type", "text/html");
        res.end(`<!doctype html><html><head><title>Long Next Page</title><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"company":"Acme"}}}</script></head><body><article>${"Visible article content that exceeds fifteen hundred characters. ".repeat(30)}</article></body></html>`);
      } else if (path === "/pdf") {
        res.setHeader("content-type", "application/pdf");
        res.end(createValidPdf());
      } else if (path === "/pdf-notext") {
        res.setHeader("content-type", "application/pdf");
        res.end(createValidPdf(null));
      } else if (path === "/blocked-403") {
        res.writeHead(403).end();
      } else if (path === "/blocked-429") {
        res.writeHead(429).end();
      } else if (path === "/blocked-503") {
        res.writeHead(503).end();
      } else if (path === "/cloudflare") {
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(`<!DOCTYPE html><html><head><title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/scripts/cf-chl.js"></script></head><body><div id="challenge">Verify you are human</div></body></html>`);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(() => {
    server.closeAllConnections();
    server.close();
  });

  const testFetchPage: typeof fetchPublicPage = (url, options = {}) =>
    fetchPublicPage(url, {
      ...options,
      lookup: async () => [{ address: "127.0.0.1", family: 4 }],
      allow: () => true,
    });

  async function callRoute(
    handler: WebFetchRoute,
    options: {
      method?: string;
      path?: string;
      body?: unknown;
    },
  ): Promise<RouteResponse> {
    let capturedStatus = 0;
    let capturedBody: Record<string, unknown> = {};
    const ctx: WebFetchContext = {
      method: options.method ?? "POST",
      path: options.path ?? "/api/internal/web/fetch",
      res: {} as unknown as ServerResponse,
      json: (_res, status, body) => {
        capturedStatus = status;
        capturedBody = (body ?? {}) as Record<string, unknown>;
      },
      readBody: async () => options.body,
    };
    const result = await handler(ctx);
    return { result, status: capturedStatus, body: capturedBody };
  }

  it("reads HTML page with title and readable text without script or style", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/html` },
    });
    expect(status).toBe(200);
    expect(body.title).toBe("Test Page Title");
    expect(body.text).toContain("Hello World This is readable text.");
    expect(body.text).not.toContain("alert");
    expect(body.text).not.toContain("color: red");
    expect(body.contentType).toContain("text/html");
    expect(body.offset).toBe(0);
    expect(body.more).toBe(false);
  });

  it("formats RSS feed as one line per item with title and link", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/rss` },
    });
    expect(status).toBe(200);
    expect(body.title).toBe("Sample Feed");
    const lines = String(body.text).split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("First Headline — https://example.com/item1 — Mon, 01 Jan 2024 12:00:00 GMT");
    expect(lines[1]).toBe("Second Headline — https://example.com/item2 — Tue, 02 Jan 2024 12:00:00 GMT");
  });

  it("supports offset paging with stable total and more flag", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const first = await callRoute(handler, {
      body: { url: `http://status.test:${port}/long`, offset: 0 },
    });
    expect(first.status).toBe(200);
    expect(String(first.body.text).length).toBe(12000);
    expect(first.body.offset).toBe(0);
    expect(first.body.total).toBe(25000);
    expect(first.body.more).toBe(true);

    const second = await callRoute(handler, {
      body: { url: `http://status.test:${port}/long`, offset: 12000 },
    });
    expect(second.status).toBe(200);
    expect(String(second.body.text).length).toBe(12000);
    expect(second.body.offset).toBe(12000);
    expect(second.body.total).toBe(25000);
    expect(second.body.more).toBe(true);

    const third = await callRoute(handler, {
      body: { url: `http://status.test:${port}/long`, offset: 24000 },
    });
    expect(third.status).toBe(200);
    expect(String(third.body.text).length).toBe(1000);
    expect(third.body.offset).toBe(24000);
    expect(third.body.total).toBe(25000);
    expect(third.body.more).toBe(false);
  });

  it("default deps refuse loopback address with 400 and never hit the server", async () => {
    const handler = createWebFetchRoutes();
    const hitsBefore = serverHits;
    const { status, body } = await callRoute(handler, {
      body: { url: `http://127.0.0.1:${port}/html` },
    });
    expect(status).toBe(400);
    expect(String(body.error)).toContain("points at this computer or a private network");
    expect(serverHits).toBe(hitsBefore);
  });

  it("rejects bad body with 400", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const missingUrl = await callRoute(handler, { body: {} });
    expect(missingUrl.status).toBe(400);

    const emptyUrl = await callRoute(handler, { body: { url: "   " } });
    expect(emptyUrl.status).toBe(400);

    const negativeOffset = await callRoute(handler, { body: { url: "https://example.com", offset: -1 } });
    expect(negativeOffset.status).toBe(400);

    const floatOffset = await callRoute(handler, { body: { url: "https://example.com", offset: 1.5 } });
    expect(floatOffset.status).toBe(400);

    const notAnObject = await callRoute(handler, { body: "not-json" });
    expect(notAnObject.status).toBe(400);
  });

  it("returns PASS for other paths or methods", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const otherPath = await callRoute(handler, { path: "/api/internal/other" });
    expect(otherPath.result).toBe(PASS);

    const otherMethod = await callRoute(handler, { method: "GET" });
    expect(otherMethod.result).toBe(PASS);
  });

  it.each([
    ["a redirect to a sign-in form", "/news/today", "sign-in", 200],
    ["a 401 answer", "/members", "sign-in", 401],
    ["a page that shows nothing until its scripts run", "/app", "script", 200],
  ] as const)("hands %s to the built-in browser instead of returning its text", async (_case, path, need, expectedStatus) => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}${path}` } });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBe(need);
    expect(body.status).toBe(expectedStatus);
    expect(String(body.next)).toContain("built-in browser (browser_navigate");
    expect(body.text).toBeUndefined();
  });

  it("reads PDF served as application/pdf with text and supports find", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}/pdf` } });
    expect(status).toBe(200);
    expect(body.contentType).toBe("application/pdf");
    expect(body.text).toContain("[page 1]");
    expect(body.text).toContain("Hello SuperBot");

    const findRes = await callRoute(handler, { body: { url: `http://status.test:${port}/pdf`, find: "SuperBot" } });
    expect(findRes.status).toBe(200);
    expect(findRes.body.contentType).toBe("application/pdf");
    expect(findRes.body.find).toBe("SuperBot");
    expect(Array.isArray(findRes.body.matches)).toBe(true);
    const matches = findRes.body.matches as Array<{ text: string }>;
    expect(matches[0]?.text).toContain("SuperBot");
  });

  it("returns 502 with no-text-layer error when reading a PDF with no text", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}/pdf-notext` } });
    expect(status).toBe(502);
    expect(body).toEqual({ error: "This PDF has no text layer (scanned pages), so web_fetch cannot read it." });
  });

  it.each([
    ["403", "/blocked-403", 403],
    ["429", "/blocked-429", 429],
    ["503", "/blocked-503", 503],
  ] as const)("returns needsBrowser blocked with status for HTTP %s", async (_name, path, expectedStatus) => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}${path}` } });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBe("blocked");
    expect(body.status).toBe(expectedStatus);
    expect(String(body.next)).toContain("This site refuses automated reads from SuperBot's server (a bot wall)");
  });

  it("detects Cloudflare challenge page and returns needsBrowser blocked", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}/cloudflare` } });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBe("blocked");
    expect(body.status).toBe(200);
    expect(String(body.next)).toContain("This site refuses automated reads from SuperBot's server (a bot wall)");
  });

  it("reads an article that carries a sign-in box as text", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}/article` } });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBeUndefined();
    expect(String(body.text)).toContain("Harga VPS Singapura naik.");
  });

  it("still reports a missing page as an error", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, { body: { url: `http://status.test:${port}/gone` } });
    expect(status).toBe(502);
    expect(body).toEqual({ error: "The page answered 404." });
  });

  it("reads app-shell HTML carrying JSON-LD data without needing browser", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/app-with-data` },
    });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBeUndefined();
    expect(String(body.text)).toContain("title: Senior ML Engineer");
    expect(String(body.text)).toContain("minValue: 190000");
  });

  it("still reports needsBrowser script on app shell without embedded data", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/app` },
    });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBe("script");
  });

  it("returns merged windows with correct offsets, total, and more when over 20 hits for find", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/find-body`, find: "salary | visa" },
    });
    expect(status).toBe(200);
    expect(body.find).toBe("salary | visa");
    expect(typeof body.total).toBe("number");
    expect(body.more).toBe(true);
    const matches = body.matches as Array<{ offset: number; text: string }>;
    expect(matches).toHaveLength(20);
    expect(matches[0].offset).toBe(700);
    expect(matches[0].text).toContain("salary");
    expect(matches[0].text).toContain("visa");
  });

  it("rejects find shorter than 2 characters with 400", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/find-body`, find: "a" },
    });
    expect(status).toBe(400);
    expect(body).toEqual({ error: "find must be 2 to 200 characters." });
  });

  it("fetches boards-api URL for thin Greenhouse page and returns Posting data with plain text content", async () => {
    const greenhousePageUrl = "https://job-boards.greenhouse.io/artefact/jobs/8829736002";
    const boardsApiUrl = "https://boards-api.greenhouse.io/v1/boards/artefact/jobs/8829736002?pay_transparency=true";
    const fakeFetchPage: typeof fetchPublicPage = async (urlStr) => {
      if (urlStr === greenhousePageUrl) {
        return {
          ok: true,
          url: new URL(greenhousePageUrl),
          headers: { "content-type": "text/html" },
          body: Buffer.from("<!doctype html><html><head><title>Artefact Job</title></head><body><div id=\"app\"></div></body></html>"),
        };
      }
      if (urlStr === boardsApiUrl) {
        return {
          ok: true,
          url: new URL(boardsApiUrl),
          headers: { "content-type": "application/json" },
          body: Buffer.from(
            JSON.stringify({
              title: "Senior AI Engineer",
              content: "<p>Lead machine learning <strong>infrastructure</strong>.</p>",
              pay_input_ranges: [{ min_cents: 18000000, max_cents: 22000000, currency: "USD" }],
            }),
          ),
        };
      }
      return { ok: false, refused: false, error: "Not found", status: 404 };
    };

    const handler = createWebFetchRoutes({ fetchPage: fakeFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: greenhousePageUrl },
    });
    expect(status).toBe(200);
    expect(body.needsBrowser).toBeUndefined();
    const text = String(body.text);
    expect(text.startsWith("Posting data (")).toBe(true);
    expect(text).toContain("title: Senior AI Engineer");
    expect(text).toMatch(/content: Lead machine learning infrastructure ?\./);
    expect(text).not.toContain("<p>");
    expect(text).not.toContain("<strong>");
  });

  it("omits Page data for a long (>1500 chars) page with __NEXT_DATA__", async () => {
    const handler = createWebFetchRoutes({ fetchPage: testFetchPage });
    const { status, body } = await callRoute(handler, {
      body: { url: `http://status.test:${port}/long-with-next` },
    });
    expect(status).toBe(200);
    expect(String(body.text).length).toBeGreaterThan(1500);
    expect(body.text).not.toContain("Page data:");
    expect(body.text).not.toContain("Acme");
  });
});
