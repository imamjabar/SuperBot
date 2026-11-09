import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, Group } from "@/state/store";
import { Select } from "./Select";

const fixture = vi.hoisted(() => ({ queued: {} as Record<string, unknown[]>, bots: [] as Bot[], dispatch: vi.fn() }));
vi.mock("@/state/store", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/state/store")>(),
  useStore: () => ({ state: { bots: fixture.bots, pendingQueued: fixture.queued }, dispatch: fixture.dispatch }),
}));

const { BotActivityPicker, GroupTaskPicker } = await import("./TaskPicker");
const bot: Bot = {
  id: "pepper", name: "Pepper", color: "green", threadId: "current", title: "", description: "",
  notifications: true, unread: false, busy: true, messages: [], modelSelection: { instanceId: "fake", model: "fake" },
  tasks: [
    { threadId: "current", title: "Current chat", createdAt: 1, busy: true, activity: "working" },
    { threadId: "idle", title: "Quiet history", createdAt: 2, busy: false },
    { threadId: "waiting", title: "Approval needed", createdAt: 3, busy: false, activity: "waiting-on-you" },
    { threadId: "working", title: "Research", createdAt: 4, busy: true, activity: "working" },
    { threadId: "queued", title: "Next job", createdAt: 5, busy: false },
    { threadId: "unread", title: "Finished reply", createdAt: 6, unread: true },
  ],
};
beforeEach(() => { fixture.queued = {}; fixture.bots = []; fixture.dispatch.mockClear(); });

describe("optional bot thread picker", () => {
  it("hides quiet histories and creation but keeps sibling activity reachable", () => {
    fixture.queued = { queued: [{ queueId: "pending" }] };
    const markup = renderToStaticMarkup(createElement(BotActivityPicker, { bot }));
    expect(markup).toContain('aria-label="Other activity (4)"');
    expect(markup).toContain('value="waiting">Approval needed · Waiting');
    expect(markup).toContain('value="working">Research · Working');
    expect(markup).toContain('value="queued">Next job · Queued');
    expect(markup).toContain('value="unread">Finished reply · Unread');
    expect(markup).not.toContain("Quiet history");
    expect(markup).toContain("Current chat");
    expect(markup).not.toContain('value="current"');
    expect(markup).not.toContain("All threads");
    expect(markup).not.toContain("New thread");
    expect(markup).not.toContain("Rename");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("selects the exact sibling without creating or stopping work", () => {
    const picker = BotActivityPicker({ bot });
    const select = picker!.props.children[0];
    expect(select.type).toBe(Select);
    select.props.onChange({ target: { value: "waiting" } });
    expect(fixture.dispatch).toHaveBeenCalledExactlyOnceWith({ type: "switchTask", botId: "pepper", threadId: "waiting" });
  });

  it("renders nothing when only the selected conversation is working", () => {
    expect(renderToStaticMarkup(createElement(BotActivityPicker, { bot: { ...bot, tasks: bot.tasks!.slice(0, 2) } }))).toBe("");
    expect(fixture.dispatch).not.toHaveBeenCalled();
  });

  it("does not remove channel history controls", () => {
    const group: Group = { id: "team", name: "Team", threadId: "team-current", memberIds: [], defaultResponder: { kind: "everyone" }, bulletin: "", createdAt: 1, unread: false, messages: [],
      tasks: [{ threadId: "team-current", title: "Channel discussion", createdAt: 1 }] };
    expect(renderToStaticMarkup(createElement(GroupTaskPicker, { group }))).toContain('aria-label="All threads"');
  });
});
