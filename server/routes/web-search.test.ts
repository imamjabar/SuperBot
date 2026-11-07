import type { ServerResponse } from "node:http";
import { describe, expect, it } from "vitest";

import { commandCodeSearch, createWebSearchRoutes, type SearchGateway, type WebSearchContext } from "./web-search.ts";

const GATEWAY: SearchGateway = { url: "https://api.commandcode.ai/alpha/web-search", key: "cc-fixture-key" };

interface Sent {
  url: string;
  init: RequestInit;
}

function gatewayAnswering(status: number, body: unknown) {
  const sent: Sent[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { sent, fake };
}

async function search(body: unknown, deps: { gateway?: SearchGateway; fetch: typeof fetch }) {
  let status = 0, answer: Record<string, unknown> = {};
  const ctx: WebSearchContext = {
    method: "POST",
    path: "/api/internal/web/search",
    res: {} as ServerResponse,
    json: (_res, code, payload) => { status = code; answer = (payload ?? {}) as Record<string, unknown>; },
    readBody: async () => body,
  };
  await createWebSearchRoutes({ gateway: () => deps.gateway, fetch: deps.fetch })(ctx);
  return { status, body: answer };
}

const RESULTS = {
  query: "news",
  results: [
    { title: "World", url: "https://www.reuters.com/world/", snippet: "Top stories" },
    { title: "Elsewhere", url: "https://example.org/news", snippet: "Other" },
    { title: "Wire", url: "https://reuters.com/business/", snippet: "Markets" },
  ],
};

describe("web_search through the Command Code gateway", () => {
  it("is set up only for the Command Code gateway with a key", () => {
    expect(commandCodeSearch({ url: "https://api.commandcode.ai/provider/v1", key: "k" })).toEqual({ url: "https://api.commandcode.ai/alpha/web-search", key: "k" });
    expect(commandCodeSearch({ url: "https://api.commandcode.ai/provider/v1" })).toBeUndefined();
    expect(commandCodeSearch({ url: "https://openrouter.ai/api/v1", key: "k" })).toBeUndefined();
    expect(commandCodeSearch({ url: "http://api.commandcode.ai/provider/v1", key: "k" })).toBeUndefined();
    expect(commandCodeSearch(undefined)).toBeUndefined();
  });

  it("sends the query with the key to the gateway alone and keeps only the allowed domains", async () => {
    const { sent, fake } = gatewayAnswering(200, RESULTS);
    const { status, body } = await search({ query: "  reuters news  ", numResults: 2, allowed_domains: ["Reuters.com"] }, { gateway: GATEWAY, fetch: fake });
    expect(status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe(GATEWAY.url);
    expect(sent[0]!.init.redirect).toBe("error");
    expect((sent[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer cc-fixture-key");
    expect(JSON.parse(String(sent[0]!.init.body))).toEqual({ query: "reuters news", numResults: 2, allowedDomains: ["reuters.com"] });
    expect(body.results).toEqual([RESULTS.results[0], RESULTS.results[2]]);
    expect(body.next).toContain("web_fetch");
  });

  it("drops a blocked domain even when the gateway returns it, and stops at numResults", async () => {
    const { fake } = gatewayAnswering(200, RESULTS);
    const { body } = await search({ query: "news", numResults: 1, blocked_domains: ["reuters.com"] }, { gateway: GATEWAY, fetch: fake });
    expect(body.results).toEqual([RESULTS.results[1]]);
  });

  it.each([
    ["a one-letter query", { query: "a" }],
    ["more than ten results", { query: "news", numResults: 11 }],
    ["both domain filters", { query: "news", allowed_domains: ["a.com"], blocked_domains: ["b.com"] }],
  ])("refuses %s without calling the gateway", async (_case, request) => {
    const { sent, fake } = gatewayAnswering(200, RESULTS);
    expect((await search(request, { gateway: GATEWAY, fetch: fake })).status).toBe(400);
    expect(sent).toHaveLength(0);
  });

  it("says search is not set up, and never calls out, without the gateway key", async () => {
    const { sent, fake } = gatewayAnswering(200, RESULTS);
    const { status, body } = await search({ query: "news" }, { fetch: fake });
    expect(status).toBe(503);
    expect(String(body.error)).toContain("web_fetch");
    expect(sent).toHaveLength(0);
  });

  it("reports a gateway failure without echoing its body", async () => {
    const { fake } = gatewayAnswering(403, { error: { message: "cc-fixture-key refused" } });
    const { status, body } = await search({ query: "news" }, { gateway: GATEWAY, fetch: fake });
    expect(status).toBe(502);
    expect(String(body.error)).not.toContain("cc-fixture-key");
  });
});
