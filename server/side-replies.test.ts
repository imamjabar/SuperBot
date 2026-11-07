import { rmSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { createSideReplies, SIDE_LANE_TITLE } from "./side-replies.ts";
import { Store } from "./store.ts";

const sonnet: ModelSelection = { instanceId: "claude", model: "claude-sonnet-5" };

beforeEach(() => rmSync(DATA_DIR, { recursive: true, force: true }));

function fixture() {
  const store = new Store(() => sonnet);
  const bot = store.createBot({ name: "Scout" });
  const sideReplies = createSideReplies(store);
  const answers = (threadId: string, text: string) => store.messagesFor(threadId).filter((row) => row.role === "bot" && row.text === text);
  const ask = (text: string, reply: (lane: string) => void) => sideReplies.answer({
    botId: bot.id, threadId: bot.threadId, text,
    start: async (lane) => { const asked = store.appendMessage(lane, { role: "user", kind: "text", text }); reply(lane); return { message: asked }; },
  });
  return { store, bot, answers, ask };
}

describe("the Quick replies lane", () => {
  it("lands each answer in the main chat that asked, exactly once, tied to the person's message", async () => {
    const { store, bot, answers, ask } = fixture();
    let lane = "";
    const { message } = await ask("What time is it?", (id) => {
      lane = id;
      store.appendMessage(id, { role: "bot", kind: "text", text: "It is 21:15", requestMessageId: store.messagesFor(id).at(-1)!.id });
    });
    expect(store.taskByThread(bot.id, lane)?.title).toBe(SIDE_LANE_TITLE);
    expect(answers(bot.threadId, "It is 21:15")).toEqual([expect.objectContaining({ requestMessageId: message.id })]);
    expect(store.taskByThread(bot.id, bot.threadId)?.unread).toBe(true);

    await ask("And the date?", (id) => { store.appendMessage(id, { role: "bot", kind: "text", text: "It is the 7th" }); });
    expect(answers(bot.threadId, "It is 21:15"), "an earlier answer is not mirrored again").toHaveLength(1);
    expect(answers(bot.threadId, "It is the 7th")).toHaveLength(1);
  });

  it("mirrors only the bot's words, never its tool rows or the lane's own prompt", async () => {
    const { store, bot, ask } = fixture();
    const before = store.messagesFor(bot.threadId).length;
    await ask("Check the inbox", (id) => { store.appendMessage(id, { role: "bot", kind: "activity", tool: { name: "Read", ok: true } }); });
    expect(store.messagesFor(bot.threadId).slice(before).map((row) => [row.role, row.text])).toEqual([["user", "Check the inbox"]]);
  });
});
