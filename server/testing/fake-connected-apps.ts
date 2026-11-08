// A loopback stand-in for the managed connected-apps service (cloudflare/composio-broker): the connected list, and an MCP
// endpoint that answers the Google tools the way Composio's multi-execute tool does, as the default connected account.
import { createServer } from "node:http";

import { CALENDAR_LIST_TOOL, CALENDARS_TOOL, GMAIL_FETCH_TOOL, GMAIL_MESSAGE_TOOL, GMAIL_PROFILE_TOOL, GMAIL_THREAD_TOOL } from "../connected-reads.ts";

export interface FakeConnectedApps {
  url: string;
  token: string;
  apiKey: string;
  env: Record<string, string>;
  connected: Record<string, boolean>;
  address: string;
  /** Google Calendar event resources of the primary calendar. */
  events: unknown[];
  /** Composio GMAIL_FETCH_EMAILS messages. */
  emails: unknown[];
  calendars: unknown[];
  /** A thread's messages by thread id; unset, the inbox entries with that thread id. */
  threads: Record<string, unknown[]>;
  /** While set, every Gmail tool answers with this error, as Composio passes Google's on. */
  gmailError?: string;
  /** Every tool call that reached the service, with its arguments and the whole multi-execute item. */
  calls: Array<{ tool: string; arguments: unknown; item: Record<string, unknown> }>;
  close(): Promise<void>;
}

type Frame = { id?: unknown; method?: string; params?: { name?: string; arguments?: { tools?: Array<Record<string, unknown>> } } };

class ToolFailure extends Error {}
// Google's own answer for a message that is gone, as Composio passes it on.
const NOT_FOUND = "Requested entity was not found.";
const field = (value: unknown, name: string): unknown => (value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined);

export async function startFakeConnectedApps(): Promise<FakeConnectedApps> {
  const fake: Omit<FakeConnectedApps, "url" | "token" | "close"> = {
    connected: { gmail: true, googlecalendar: true }, address: "me@example.test", events: [], emails: [], calls: [], threads: {},
    calendars: [{ id: "me@example.test", primary: true, accessRole: "owner", selected: true }],
  };

  function answer(slug: string, args: unknown): unknown {
    if (slug.startsWith("GMAIL_") && fake.gmailError) throw new ToolFailure(fake.gmailError);
    if (slug === CALENDAR_LIST_TOOL) return { items: fake.events };
    if (slug === CALENDARS_TOOL) return { items: fake.calendars };
    if (slug === GMAIL_FETCH_TOOL) {
      const after = Number(/after:(\d+)/.exec(String(field(args, "query")))?.[1] ?? 0) * 1000;
      return { messages: fake.emails.filter((message) => Date.parse(String(field(message, "messageTimestamp"))) >= after) };
    }
    if (slug === GMAIL_PROFILE_TOOL) return { emailAddress: fake.address };
    if (slug === GMAIL_MESSAGE_TOOL) {
      const message = fake.emails.find((one) => field(one, "messageId") === field(args, "message_id"));
      if (!message) throw new ToolFailure(NOT_FOUND);
      return message;
    }
    if (slug === GMAIL_THREAD_TOOL) {
      const threadId = field(args, "thread_id");
      return { messages: fake.threads[String(threadId)] ?? fake.emails.filter((message) => field(message, "threadId") === threadId) };
    }
    return { id: `fake-${slug.toLowerCase()}` };
  }

  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    res.setHeader("content-type", "application/json");
    const reqUrl = req.url ?? "";
    const reqPath = reqUrl.split("?")[0]!;
    if (req.method === "POST" && reqPath === "/api/v3.1/tool_router/session") {
      const body = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>;
      return res.end(JSON.stringify({
        session_id: "trs_fake_session",
        mcp: { type: "http", url: `http://127.0.0.1:${port}/v1/mcp` },
        config: { user_id: body.user_id ?? "openmausbot_test", auth_configs: body.auth_configs ?? {} },
      }));
    }
    if (req.method === "GET" && reqPath.startsWith("/api/v3.1/tool_router/session/") && reqPath.endsWith("/toolkits")) {
      return res.end(JSON.stringify({
        items: Object.entries(fake.connected).filter(([, c]) => c).map(([slug]) => ({
          slug,
          connected_account: { id: `ca_${slug}`, status: "ACTIVE" },
        })),
      }));
    }
    if (req.method === "GET" && reqPath.startsWith("/api/v3.1/tool_router/session/")) {
      return res.end(JSON.stringify({
        session_id: "trs_fake_session",
        mcp: { type: "http", url: `http://127.0.0.1:${port}/v1/mcp` },
        config: { user_id: "openmausbot_test", auth_configs: {} },
      }));
    }
    if (req.method === "GET" && reqPath.startsWith("/api/v3.1/connected_accounts")) {
      return res.end(JSON.stringify({
        items: Object.entries(fake.connected).filter(([, c]) => c).map(([slug]) => ({
          id: `ca_${slug}`,
          app_unique_id: slug,
          status: "ACTIVE",
        })),
      }));
    }
    if (req.method === "GET" && reqPath === "/api/v3.1/auth_configs") {
      return res.end(JSON.stringify({ items: [] }));
    }
    if (req.method === "GET" && reqPath.startsWith("/api/v3/toolkits")) {
      return res.end(JSON.stringify({ items: [] }));
    }
    if (req.method === "GET" && req.url === "/v1/connectors/connected") {
      return res.end(JSON.stringify({ services: Object.fromEntries(Object.entries(fake.connected).map(([slug, connected]) => [slug, { connected }])) }));
    }
    // A connection card's status check: the services it names.
    if (req.method === "GET" && req.url?.startsWith("/v1/connectors?")) {
      const asked = (new URL(req.url, "http://fake").searchParams.get("services") ?? "").split(",").filter(Boolean);
      return res.end(JSON.stringify({ services: Object.fromEntries(asked.map((slug) => [slug, { connected: fake.connected[slug] === true }])) }));
    }
    if (req.method === "POST" && req.url === "/v1/mcp") {
      const body = (raw ? JSON.parse(raw) : {}) as Frame;
      if (body.method === "initialize") {
        res.setHeader("mcp-session-id", "fake-session");
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "fake-connected-apps", version: "1" } } }));
      }
      if (body.method === "notifications/initialized") {
        res.statusCode = 202;
        return res.end();
      }
      if (body.method === "tools/list") {
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "COMPOSIO_MULTI_EXECUTE_TOOL", description: "Run app tools", inputSchema: { type: "object" } }] } }));
      }
      if (body.method === "tools/call") {
        const item = body.params?.name === "COMPOSIO_MULTI_EXECUTE_TOOL" ? body.params.arguments?.tools?.[0] ?? {} : { tool_slug: body.params?.name, arguments: body.params?.arguments };
        const slug = String(item.tool_slug ?? "");
        fake.calls.push({ tool: slug, arguments: item.arguments, item });
        let response: { successful: boolean; data: unknown; error: string | null };
        try {
          response = { successful: true, data: answer(slug, item.arguments), error: null };
        } catch (error) {
          if (!(error instanceof ToolFailure)) throw error;
          response = { successful: false, data: null, error: error.message };
        }
        const text = JSON.stringify({ successful: true, data: { results: [{ tool_slug: slug, response }] }, error: null });
        return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text }] } }));
      }
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: {} }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: "fake connected apps: unknown path" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return Object.assign(fake, {
    url: `http://127.0.0.1:${port}`,
    token: "c".repeat(64),
    apiKey: "ak_fake_project_key",
    env: {
      OMB_COMPOSIO_API: `http://127.0.0.1:${port}/api/v3.1`,
      OMB_COMPOSIO_TOOLKITS_API: `http://127.0.0.1:${port}/api/v3`,
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
