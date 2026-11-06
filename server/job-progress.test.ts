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
  const lines: Array<{ threadId: string; name: string }> = [];
  const nodes = [root, ...jobs];
  const progress = createJobProgress(
    { all: () => nodes, node: (id) => nodes.find((one) => one.id === id) },
    { appendMessage: (threadId, message) => { lines.push({ threadId, name: message.tool!.name }); return message as never; }, taskByThread: () => ({ title: "VPS research" }) as never },
    () => at,
  );
  progress.stop();
  return { lines, tick: (minutes: number) => { at = minutes * MIN; progress.check(); } };
}

describe("progress notes for a bot's own background job", () => {
  it("notes the chat once at each mark while the job runs, never twice for the same mark", () => {
    const w = world([node({})]);
    w.tick(1);
    expect(w.lines).toEqual([]);
    w.tick(2);
    w.tick(3);
    w.tick(6);
    expect(w.lines).toEqual([
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
