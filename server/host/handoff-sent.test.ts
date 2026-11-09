import { describe, expect, it } from "vitest";

import { outsideRoomNote, receivedRow, sentRow } from "./handoff-sent.ts";

const sender = { id: "chief", name: "Chief", color: "blue" };
const recipient = { id: "buyer", name: "Buyer Research", color: "green" };
const sales = { id: "sales", name: "Sales", here: true };

describe("sentRow", () => {
  it("says a bot outside the addressed room got the work directly, and links to its thread", () => {
    const row = sentRow({ sender, recipient, threadId: "buyer-work", title: "@Chief · work", room: sales, via: "direct" });
    expect(row).toMatchObject({
      tool: { name: "Sent to Buyer Research directly: it isn't in this room.", ok: true },
      sentDirectly: { name: "Buyer Research" },
      threadRef: { botId: "buyer", threadId: "buyer-work", title: "@Chief · work" },
    });
    expect(row.comm).toBeUndefined();
    const elsewhere = sentRow({ sender, recipient, threadId: "buyer-work", room: { ...sales, here: false }, via: "direct" });
    expect(elsewhere.tool?.name).toBe("Sent to Buyer Research directly: it isn't in Sales.");
    expect(elsewhere.sentDirectly).toEqual({ name: "Buyer Research", room: "Sales" });
  });

  it("keeps the room chip, the lane link and a plain direct hand-off as they were", () => {
    expect(sentRow({ sender, recipient, threadId: "sales-thread", room: { ...sales, here: false }, via: "room", reason: "why" })).toMatchObject({
      tool: { name: "Sent to Buyer Research · Sales", ok: true, output: "why" },
      comm: { groupId: "sales", threadId: "sales-thread", withBotId: "buyer" },
    });
    const lane = sentRow({ sender, recipient, threadId: "lane", title: "Sales · job", room: sales, via: "lane" });
    expect([lane.tool?.name, lane.threadRef?.threadId, lane.sentDirectly]).toEqual(["Sent to Buyer Research", "lane", undefined]);
    const direct = sentRow({ sender, recipient, threadId: "buyer-work", via: "direct" });
    expect([direct.tool?.name, direct.threadRef?.title, direct.sentDirectly]).toEqual(["Sent to Buyer Research", "Teammate work", undefined]);
  });
});

describe("receivedRow", () => {
  it("links direct hand-off to recipient thread and sender in from", () => {
    const row = receivedRow({ sender, recipient, threadId: "buyer-work", title: "@Chief · work", via: "direct" });
    expect(row).toMatchObject({
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief", color: "blue" },
      tool: { name: "Message from Chief", ok: true },
      threadRef: { botId: "buyer", threadId: "buyer-work", title: "@Chief · work" },
    });
    expect(row.comm).toBeUndefined();
  });

  it("links room hand-off with comm and withBotId set to sender", () => {
    const row = receivedRow({ sender, recipient, threadId: "sales-thread", room: sales, via: "room" });
    expect(row).toMatchObject({
      role: "bot",
      kind: "activity",
      from: { botId: "chief", name: "Chief", color: "blue" },
      tool: { name: "Message from Chief", ok: true },
      comm: { groupId: "sales", threadId: "sales-thread", withBotId: "chief", withName: "Chief", withColor: "blue" },
    });
    expect(row.threadRef).toBeUndefined();
  });
});

describe("outsideRoomNote", () => {
  it("leads a receipt only when the bot isn't in the room the work was addressed to", () => {
    expect(outsideRoomNote(sales, "direct")).toBe("it isn't in this room, so it got this directly: ");
    expect(outsideRoomNote({ ...sales, here: false }, "direct")).toBe("it isn't in Sales, so it got this directly: ");
    expect(outsideRoomNote(sales, "room")).toBe("");
    expect(outsideRoomNote(undefined, "direct")).toBe("");
  });
});
