import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { setLocale, t } from "@/lib/i18n";
import type { Bot, Task } from "@/state/store";
import { JobPresence } from "./JobPresence";

vi.mock("@/state/store", async (importOriginal) => {
  const actual = await importOriginal<object>();
  return {
    ...actual,
    useStore: () => ({ state: {}, dispatch: vi.fn() }),
  };
});


setLocale("en");

const baseBot: Bot = {
  id: "b",
  threadId: "chat",
  name: "Bot",
  title: "",
  description: "",
  color: "blue",
  notifications: true,
  unread: false,
  modelSelection: { instanceId: "test", model: "m" },
  messages: [],
};

const runningTask: Task = {
  threadId: "job-1",
  title: "VPS research",
  createdAt: 1,
  busy: true,
  openedBy: { botId: "b", name: "Bot", threadId: "chat", reportsBack: true, at: 1 },
};

describe("JobPresence", () => {
  it("renders live status lines for running report-back jobs with open and stop buttons", () => {
    const markup = renderToStaticMarkup(createElement(JobPresence, { bot: { ...baseBot, tasks: [runningTask] } }));
    expect(markup).toContain("data-job-presence");
    expect(markup).toContain("#VPS research");
    expect(markup).toContain(t("chat.job.open", { title: "VPS research" }));
    expect(markup).toContain(t("chat.job.stop", { title: "VPS research" }));
  });

  it("renders nothing when no jobs match the running criteria", () => {
    const variations: Task[][] = [
      [],
      [{ ...runningTask, busy: false }],
      [{ ...runningTask, openedBy: { botId: "b", name: "Bot", threadId: "other", reportsBack: true, at: 1 } }],
      [{ ...runningTask, openedBy: { botId: "teammate", name: "Teammate", threadId: "chat", reportsBack: true, at: 1 } }],
      [{ ...runningTask, openedBy: { botId: "b", name: "Bot", threadId: "chat", at: 1 } }],
    ];
    for (const tasks of variations) {
      const markup = renderToStaticMarkup(createElement(JobPresence, { bot: { ...baseBot, tasks } }));
      expect(markup).not.toContain("data-job-presence");
      expect(markup).toBe("");
    }
  });
});
