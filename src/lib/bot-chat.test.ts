import { describe, expect, it } from "vitest";
import type { Message } from "@/state/store";
import { botChatBubbles, botChatTarget } from "./bot-chat";

describe("botChatTarget", () => {
  const groups = [
    { id: "sales", threadId: "sales-t1" },
    { id: "eng", threadId: "eng-t1" },
  ];

  it("extracts target from comm row with explicit threadId", () => {
    const message = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      comm: { groupId: "sales", threadId: "comm-t1", withBotId: "buyer", withName: "Buyer", withColor: "green" },
    } as Message;
    const target = botChatTarget(message, "chief", groups);
    expect(target).toEqual({
      threadId: "comm-t1",
      botIds: ["chief", "buyer"],
    });
  });

  it("extracts target from comm row falling back to group threadId and dedupes equal participant", () => {
    const message = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      from: { botId: "chief", name: "Chief", color: "blue" },
      comm: { groupId: "sales", withBotId: "chief", withName: "Chief", withColor: "blue" },
    } as Message;
    const target = botChatTarget(message, "buyer", groups);
    expect(target).toEqual({
      threadId: "sales-t1",
      botIds: ["chief", "buyer"],
    });
  });

  it("returns null for comm row with unknown group and no threadId", () => {
    const message = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      comm: { groupId: "unknown", withBotId: "buyer", withName: "Buyer", withColor: "green" },
    } as Message;
    expect(botChatTarget(message, "chief", groups)).toBeNull();
  });

  it("extracts target for sender-side threadRef", () => {
    const message = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      from: { botId: "chief", name: "Chief", color: "blue" },
      threadRef: { botId: "buyer", threadId: "work-t1", title: "Buyer work" },
    } as Message;
    const target = botChatTarget(message, "chief", groups);
    expect(target).toEqual({
      threadId: "work-t1",
      botIds: ["chief", "buyer"],
      ownerBotId: "buyer",
    });
  });

  it("extracts target for receiver-side threadRef", () => {
    const message = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      from: { botId: "chief", name: "Chief", color: "blue" },
      threadRef: { botId: "buyer", threadId: "work-t1", title: "Buyer work" },
    } as Message;
    const target = botChatTarget(message, "buyer", groups);
    expect(target).toEqual({
      threadId: "work-t1",
      botIds: ["chief", "buyer"],
      ownerBotId: "buyer",
    });
  });

  it("returns null for own-job threadRef", () => {
    const ownJob = {
      id: "m1",
      role: "bot",
      kind: "activity",
      at: 1000,
      from: { botId: "chief", name: "Chief", color: "blue" },
      threadRef: { botId: "chief", threadId: "work-t1", title: "Chief own job" },
    } as Message;
    expect(botChatTarget(ownJob, "chief", groups)).toBeNull();

    const noFrom = {
      id: "m2",
      role: "bot",
      kind: "activity",
      at: 1000,
      threadRef: { botId: "chief", threadId: "work-t1", title: "Chief own job" },
    } as Message;
    expect(botChatTarget(noFrom, "chief", groups)).toBeNull();
  });
});

describe("botChatBubbles", () => {
  it("filters activity, whitespace, and reaction rows", () => {
    const messages = [
      { id: "1", role: "bot", kind: "activity", at: 1000, text: "Sent to Buyer" },
      { id: "2", role: "bot", kind: "text", at: 2000, text: "   " },
      { id: "3", role: "user", kind: "text", at: 3000, text: "👍", reaction: "👍" },
      { id: "4", role: "bot", kind: "text", at: 4000, text: "Hello from Bot" },
    ] as Message[];
    const clusters = botChatBubbles(messages, "bot1");
    expect(clusters).toHaveLength(1);
    expect(clusters[0].messages).toHaveLength(1);
    expect(clusters[0].messages[0].id).toBe("4");
  });

  it("clusters consecutive same-sender rows", () => {
    const messages = [
      { id: "1", role: "bot", kind: "text", at: 1000, text: "Message 1", from: { botId: "b1", name: "Bot 1" } },
      { id: "2", role: "bot", kind: "text", at: 2000, text: "Message 2", from: { botId: "b1", name: "Bot 1" } },
      { id: "3", role: "bot", kind: "text", at: 3000, text: "Message 3", from: { botId: "b2", name: "Bot 2" } },
    ] as Message[];
    const clusters = botChatBubbles(messages);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].sender.botId).toBe("b1");
    expect(clusters[0].messages.map((m) => m.id)).toEqual(["1", "2"]);
    expect(clusters[1].sender.botId).toBe("b2");
    expect(clusters[1].messages.map((m) => m.id)).toEqual(["3"]);
  });

  it("inserts a time separator after a 2 h gap", () => {
    const start = 1_700_000_000_000;
    const twoHoursLater = start + 2 * 60 * 60 * 1000;
    const messages = [
      { id: "1", role: "bot", kind: "text", at: start, text: "First message", from: { botId: "b1", name: "Bot 1" } },
      { id: "2", role: "bot", kind: "text", at: twoHoursLater, text: "Second message after 2h", from: { botId: "b1", name: "Bot 1" } },
    ] as Message[];
    const clusters = botChatBubbles(messages);
    expect(clusters).toHaveLength(2);
    expect(clusters[0].separatorAt).toBeUndefined();
    expect(clusters[1].separatorAt).toBe(twoHoursLater);
  });
});
