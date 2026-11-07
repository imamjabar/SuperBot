import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTalkServer, type TalkUpdate } from "../electron/talk-server.mjs";
import { launchVerificationServer } from "../scripts/control-omb.ts";

const owner = randomBytes(32).toString("base64url");
const realFetch = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
const request = (route: string, init?: RequestInit) => fetch(`${fixture.info.url}${route}`, init);
const json = { "content-type": "application/json" };
const mausBot = async () => (await (await request("/api/bots?messages=0")).json() as any).bots.find((b: any) => b.defaultBot);

beforeAll(async () => {
  globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-openmausbot-desktop-owner": owner } });
  fixture = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner });
}, 90_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await fixture?.close();
});

it.each([["on", true], ["off", false]])("with front desk %s, Talk asks in MausBot's main chat, follows the reply to the end and leaves both in its history", async (_mode, frontDesk) => {
  expect((await request("/api/config", { method: "PATCH", headers: json, body: JSON.stringify({ features: { frontDesk } }) })).status).toBe(200);
  const before = await mausBot();
  const talk = createTalkServer({ request });
  const chat = await talk.prepare();
  expect(chat).toEqual({ botId: before.id, threadId: before.threadId });
  const sendId = randomUUID(), updates: TalkUpdate[] = [];
  expect(await talk.ask({ chat, text: "What can you do?", sendId, signal: AbortSignal.timeout(60_000), onUpdate: u => updates.push(u) })).toBe("done");
  expect(updates[0]).toEqual({ kind: "thinking" });
  const done = updates.at(-1);
  expect(done).toMatchObject({ kind: "done", ok: true });
  if (done?.kind !== "done") return;
  const after = await mausBot();
  expect(after.threadId).toBe(before.threadId);
  expect(after.tasks.map((t: any) => t.threadId)).toEqual(before.tasks.map((t: any) => t.threadId));
  const history = (await (await request(`/api/threads/${chat.threadId}/messages`)).json() as any).messages;
  const asked = history.filter((m: any) => m.role === "user" && m.sendId === sendId);
  expect(asked).toHaveLength(1);
  expect(history.some((m: any) => m.role === "bot" && m.kind === "text" && m.requestMessageId === asked[0].id && m.text === done.text)).toBe(true);
}, 90_000);

it("a computer whose bots moved to My Cloud refuses a Talk send with moved", async () => {
  const talk = createTalkServer({ request });
  const chat = await talk.prepare();
  expect((await request("/api/move/freeze", { method: "POST", headers: json, body: "{}" })).status).toBe(200);
  try {
    expect(await talk.prepare()).toEqual(chat);
    await expect(talk.ask({ chat, text: "Still there?", sendId: randomUUID(), signal: AbortSignal.timeout(30_000), onUpdate: () => {} }))
      .rejects.toMatchObject({ name: "TalkServerError", code: "moved" });
  } finally {
    await request("/api/move/freeze", { method: "DELETE" });
  }
}, 90_000);
