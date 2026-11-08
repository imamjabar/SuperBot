import { describe, expect, it } from "vitest";

import { createAutomationDestinations, type AutomationDestinationDeps } from "./automation-destinations.ts";
import type { Routine } from "./routines.ts";

function world() {
  const tasks = new Map([["person-chat", { threadId: "person-chat", title: "Person" }], ["hook-chat", { threadId: "hook-chat", title: "Hook · Results" }]]);
  let made = 0;
  const store = {
    bot: () => ({ id: "bot" }),
    createTask: (_botId: string, title: string) => { const task = { threadId: `made-${++made}`, title }; tasks.set(task.threadId, task); return task; },
    messagesFor: () => [],
    taskByThread: (_botId: string, threadId: string) => tasks.get(threadId),
  } as unknown as AutomationDestinationDeps["store"];
  const destinations = createAutomationDestinations({ store, mainThread: () => "main", runs: () => [] });
  return { destinations };
}
const routine = { id: "r", name: "Daily", botId: "bot", resultsThreadId: "person-chat" } as Routine;

describe("where an automation reports", () => {
  it("keeps the chat a person's routine chose", () => {
    expect(world().destinations.routine(routine, false)).toEqual({ threadId: "person-chat" });
  });

  it("reports to main thread when routine has no results thread", () => {
    const noResults = { id: "r2", name: "Daily", botId: "bot" } as Routine;
    expect(world().destinations.routine(noResults, false)).toEqual({ threadId: "main", main: true });
  });

  it("event reports to main thread", () => {
    expect(world().destinations.event({ webhookId: "w", webhookName: "Hook", botId: "bot" })).toBe("main");
  });
});
