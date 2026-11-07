import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { fetchPublicPage } from "../wait-probes.ts";
import { PASS } from "./table.ts";
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
      } else {
        res.writeHead(404).end();
      }
    });
    const { promise, resolve } = Promise.withResolvers<void>();
    server.listen(0, "127.0.0.1", () => resolve());
    await promise;
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
});
