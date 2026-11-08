import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

import { initialState, StoreContext, type AppState, type Bot } from "@/state/store";
import { ChatHeadPill } from "./ChatHeadPill";

const bot = (threadId: string, title = "New thread"): Bot => ({
  id: "rooms", threadId, mainThreadId: "main", name: "Rooms", title: "", description: "", notifications: true, color: "green", unread: false,
  modelSelection: { instanceId: "claude", model: "test" }, messages: [],
  tasks: [{ threadId: "main", title: "Shared chat", createdAt: 1 }, { threadId: "own", title, createdAt: 2 }],
} as unknown as Bot);
const pill = (of: Bot) => renderToStaticMarkup(createElement(StoreContext.Provider,
  { value: { state: { ...initialState } as AppState, dispatch: vi.fn(), flushBotPatches: vi.fn(), refreshInstances: vi.fn(), refreshModels: vi.fn() } as never },
  createElement(ChatHeadPill, { bot: of, avatar: { state: "idle", motion: "none", motionKey: 0, animated: false } as never, onToggle: vi.fn() })));

it("says nothing extra on the bot's main conversation, and another conversation keeps its own name", () => {
  expect(pill(bot("main"))).not.toContain("Shared chat");
  expect(pill(bot("own"))).toContain("New conversation");
  expect(pill(bot("own", "Quarter numbers"))).toContain("Quarter numbers");
});
