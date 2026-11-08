import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { HandoffView } from "../coordinator.ts";
import { createShareAnswer } from "./share-answer.ts";

const PRIVATE = join("/data", "task-workspaces");
const node = (id: string, parentId: string | undefined, threadId: string): HandoffView => ({
  id, rootId: "root", ...(parentId ? { parentId } : {}), threadId, botId: "bolt", key: "bolt", text: "", createdAt: 0, status: "running",
  result: "", reported: false, executions: 1, approvalGranted: false, kind: "work", restarts: 0, mode: "consult", reply: "resume",
});

function rule(over: { pinned?: Record<string, string | null>; botFolder?: string } = {}) {
  const asked: Record<string, string> = { "scout-turn": "scout-chat", "quill-turn": "quill-chat" };
  return createShareAnswer({
    askedFrom: (one) => (one.parentId ? asked[one.parentId] : undefined),
    pinned: (_botId, threadId) => over.pinned?.[threadId],
    botFolder: () => over.botFolder,
    privateFolders: PRIVATE,
  });
}
const first = node("a", "scout-turn", "bolt-for-scout");
const joiner = node("b", "quill-turn", "bolt-for-quill");

describe("whether a bot's answer to one requester may answer another's same request", () => {
  it("shares it where the same people see both conversations and the bot works in the same folder", () => {
    expect(rule()(first, joiner)).toBe(true);
    expect(rule({ botFolder: "/work/site" })(first, joiner)).toBe(true);
    expect(rule({ pinned: { "bolt-for-scout": "/work/site" }, botFolder: "/work/site" })(first, joiner)).toBe(true);
  });

  it("counts two conversations' own private folders as one: neither holds anything of a requester's", () => {
    expect(rule({ pinned: { "bolt-for-scout": join(PRIVATE, "bolt", "bolt-for-scout"), "bolt-for-quill": null } })(first, joiner)).toBe(true);
  });


  it("never shares an answer the bot worked out in another folder: a question about files is answered from the files there", () => {
    expect(rule({ pinned: { "bolt-for-scout": "/work/site", "bolt-for-quill": "/work/app" } })(first, joiner)).toBe(false);
    expect(rule({ pinned: { "bolt-for-scout": "/work/site" } })(first, joiner)).toBe(false);
  });

  it("never shares one whose requester is unknown", () => {
    expect(rule()(node("a", undefined, "bolt-for-scout"), joiner)).toBe(false);
    expect(rule()(first, node("b", "gone-turn", "bolt-for-quill"))).toBe(false);
  });
});
