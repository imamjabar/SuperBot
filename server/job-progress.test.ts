import { describe, expect, it } from "vitest";

import type { HandoffView } from "./coordinator.ts";
import { createJobProgress } from "./job-progress.ts";

const MIN = 60_000;
const node = (patch: Partial<HandoffView>): HandoffView => ({
  id: "job", rootId: "root", parentId: "root", threadId: "job-thread", botId: "bot", key: "bot", text: "", createdAt: 0, status: "running",
  result: "", reported: false, executions: 1, startedAt: 0, approvalGranted: false, kind: "work", restarts: 0, mode: "work", reply: "resume", ...patch,
});
const root = node({ id: "root", parentId: undefined, threadId: "chat", status: "source" as HandoffView["status"] });

function world(jobs: HandoffView[]) {
  let at = 0;
  const lines: Array<{ threadId: string; name: string; requestMessageId?: string }> = [];
  const nodes = [root, ...jobs];
  const progress = createJobProgress(
    { all: () => nodes, node: (id) => nodes.find((one) => one.id === id) },
    {
      appendMessage: (threadId, message) => { lines.push({ threadId, name: message.tool?.name ?? message.text!, requestMessageId: message.requestMessageId }); return message as never; },
      taskByThread: () => ({ title: "VPS research", openedBy: { botId: "bot", name: "Bot", at: 0, reportsBack: true, threadId: "chat", requestMessageId: "ask-1" } }) as never,
      patchTask: () => null as never,
    },
    () => at,
  );
  progress.stop();
  return {
    lines,
    tick: (minutes: number) => { at = minutes * MIN; progress.check(); },
    post: (minutes: number, text: string, threadId = "job-thread") => { at = minutes * MIN; return progress.post("bot", threadId, text).status; },
  };
}

describe("progress notes for a bot's own background job", () => {
  it("notes the chat once at each mark while the job runs, never twice for the same mark", () => {
    const w = world([node({})]);
    w.tick(1);
    expect(w.lines).toEqual([]);
    w.tick(2);
    w.tick(3);
    w.tick(6);
    expect(w.lines).toMatchObject([
      { threadId: "chat", name: "Still working on #VPS research · 2 min" },
      { threadId: "chat", name: "Still working on #VPS research · 6 min" },
    ]);
  });

  it("stays quiet for a teammate's work, a room's, a finished job and one nothing waits on", () => {
    const w = world([
      node({ id: "teammate", botId: "other" }),
      node({ id: "room", groupId: "g" }),
      node({ id: "done", status: "completed" }),
      node({ id: "notice", reply: "none" }),
    ]);
    w.tick(30);
    expect(w.lines).toEqual([]);
  });
});

describe("a job's own progress updates", () => {
  it("posts to the chat it reports to, quoting the person's request", () => {
    const w = world([node({})]);
    expect(w.post(0, "Found 3 providers")).toBe(200);
    expect(w.lines).toEqual([{ threadId: "chat", name: "Found 3 providers", requestMessageId: "ask-1" }]);
  });

  it("allows one update a minute and six per job", () => {
    const w = world([node({})]);
    expect(w.post(0, "one")).toBe(200);
    expect(w.post(0.5, "too soon")).toBe(409);
    expect(w.post(1.02, "two")).toBe(200);
    for (const minute of [3, 5, 7, 9]) expect(w.post(minute, `at ${minute}`)).toBe(200);
    expect(w.post(11, "seventh")).toBe(409);
    expect(w.lines.map((line) => line.name)).toEqual(["one", "two", "at 3", "at 5", "at 7", "at 9"]);
  });

  it("refuses a thread with no running report-back job", () => {
    const w = world([node({ id: "teammate", botId: "other", threadId: "mate-thread" }), node({ id: "done", status: "completed", threadId: "done-thread" })]);
    expect(w.post(0, "x", "mate-thread")).toBe(409);
    expect(w.post(0, "x", "done-thread")).toBe(409);
    expect(w.post(0, "x", "nowhere")).toBe(409);
    expect(w.lines).toEqual([]);
  });

  it("refuses an empty or overlong update", () => {
    const w = world([node({})]);
    expect(w.post(0, "   ")).toBe(400);
    expect(w.post(0, "a".repeat(601))).toBe(400);
    expect(w.lines).toEqual([]);
  });

  it("skips the still-working note for three minutes after an update", () => {
    const w = world([node({})]);
    w.post(1, "Found 3 providers");
    w.tick(2);
    w.tick(5);
    expect(w.lines.map((line) => line.name)).toEqual(["Found 3 providers", "Still working on #VPS research · 5 min"]);
  });
});
