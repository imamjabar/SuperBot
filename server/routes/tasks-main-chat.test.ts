import { rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "../config.ts";
import type { ModelSelection } from "../contracts.ts";
import { json, readBody } from "../harness/http.ts";
import type { RequestAuth } from "../request-auth.ts";
import { Store, type BotRecord, type TaskRecord } from "../store.ts";
import { dispatchRoutes } from "./table.ts";
import { createTaskRoutes, type TaskRouteDeps } from "./tasks.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };
const PERSON = { kind: "session", session: { id: "s1" }, via: "cookie", scopes: ["admin", "client"] } as unknown as RequestAuth;
const BOT_SHELL = { kind: "loopback", scopes: ["client"], trust: "service" } as RequestAuth;
const servers: Server[] = [];

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((done) => server.close(done))));
});

async function fixture(auth: RequestAuth) {
  const store = new Store(() => sonnet);
  const bot = store.createBot({ name: "Scout" });
  // Only what creating a thread touches; a route reaching for anything else throws.
  const deps = {
    store, desktopManaged: false, cloudHome: false, hostedWorkspace: false,
    mainChat: (botId: string) => ({ threadId: store.bot(botId)!.threadId, title: "Chat" }),
    phoneSecretSubmissions: { hasBot: () => false, hasThread: () => false },
    threadStarters: { set: () => {} },
    actorKey: () => "person",
    publicBot: (record: BotRecord) => ({ id: record.id }),
    wireTask: (task: TaskRecord) => ({ threadId: task.threadId }),
  } as unknown as TaskRouteDeps;
  const routes = [createTaskRoutes(deps)];
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (!await dispatchRoutes(routes, { req, res, url, path: url.pathname, method: req.method ?? "GET", auth, json, readBody })) json(res, 404, {});
  });
  servers.push(server);
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const create = async (body: Record<string, unknown> = {}) => {
    const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bots/${bot.id}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as Record<string, unknown> };
  };
  return { store, bot, create };
}

describe("POST /api/bots/:id/tasks with one main chat", () => {
  it("refuses a person a new chat, names the main chat and keeps the bot's threads as they were", async () => {
    const { store, bot, create } = await fixture(PERSON);
    expect(await create()).toMatchObject({ status: 409, body: { code: "main_chat_only", mainThreadId: bot.threadId } });
    expect((await create()).body.error).toContain('main chat "Chat"');
    expect(store.tasks(bot.id).map((task) => task.threadId)).toEqual([bot.threadId]);
  });

  it("refuses a person a Quick asks thread too", async () => {
    const { store, bot, create } = await fixture(PERSON);
    expect(await create({ title: "Quick asks", select: false })).toMatchObject({ status: 409, body: { code: "main_chat_only" } });
    expect(store.tasks(bot.id)).toHaveLength(1);
  });

  it("still opens a thread for a caller that is not a person", async () => {
    const { store, bot, create } = await fixture(BOT_SHELL);
    expect((await create()).status).toBe(201);
    expect(store.tasks(bot.id)).toHaveLength(2);
  });
});
