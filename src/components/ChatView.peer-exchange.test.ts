// @vitest-environment happy-dom
import { createElement, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Bot, InstanceInfo, Message } from "@/state/store";
import type { ApprovalModeSelector } from "./ApprovalModeSelector";
import type { ModelPicker } from "./ModelPicker";

const fixture = vi.hoisted(() => ({
  dispatch: vi.fn(),
  showToolCalls: false,
}));

vi.mock("@/state/store", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/state/store")>();
  return {
    ...original,
    useStore: () => ({
      state: {
        ...original.initialState,
        config: fixture.showToolCalls ? { features: { showToolCalls: true } } : null,
        instances: [{ instanceId: "test", driverKind: "codex", displayName: "Test" } as InstanceInfo],
      },
      dispatch: fixture.dispatch,
    }),
  };
});

vi.mock("./DesktopCapabilities", async (importOriginal) => ({
  ...await importOriginal<typeof import("./DesktopCapabilities")>(),
  useDesktopCapabilities: () => ({
    capabilities: {
      dictation: { available: false },
      host: { packaged: true, platform: "other" },
      localComputer: { available: false, reasonCode: "x", message: "" },
    },
    ready: true,
  }),
}));

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/lib/interface-mode", () => ({ useAdvancedMode: () => true, setAdvancedMode: vi.fn() }));
vi.mock("./SidebarPopoverMenu", async (importOriginal) => ({
  ...await importOriginal<typeof import("./SidebarPopoverMenu")>(),
  SidebarPopoverMenu: (props: { renderTrigger: (state: { open: boolean }) => unknown }) =>
    props.renderTrigger({ open: false }),
}));
vi.mock("@/lib/cloud-guest", () => ({ useCanWriteIn: () => null, useReactor: () => "user" }));
vi.mock("./CitationUI", async (importOriginal) => ({
  ...await importOriginal<typeof import("./CitationUI")>(),
  CitationSelectionToolbar: () => createElement("span"),
}));
vi.mock("./ModelPicker", () => ({
  ModelPicker: (_props: ComponentProps<typeof ModelPicker>) => createElement("span"),
}));
vi.mock("./ApprovalModeSelector", () => ({
  ApprovalModeSelector: (_props: ComponentProps<typeof ApprovalModeSelector>) => createElement("span"),
}));

import { ChatView } from "./ChatView";
const bot: Bot = {
  id: "designer",
  threadId: "selected",
  name: "Designer Bot",
  title: "",
  description: "",
  color: "blue",
  notifications: true,
  unread: false,
  busy: false,
  messages: [],
  modelSelection: { instanceId: "test", model: "profile-default" },
  tasks: [
    {
      threadId: "selected",
      title: "Selected",
      createdAt: 1,
      busy: false,
      activity: "idle",
      modelSelection: { instanceId: "test", model: "thread-model" },
      approvalMode: "ask",
    },
  ],
};

let host: HTMLDivElement;
let root: Root;
const render = (shown: Bot) => flushSync(() => root.render(createElement(ChatView, { bot: shown })));

beforeEach(() => {
  fixture.dispatch.mockClear();
  fixture.showToolCalls = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  flushSync(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("peer exchange collapsing in ChatView", () => {
  it("shows collapsed row by default, inbox bubble visible, and click reveals request text", () => {
    const messages: Message[] = [
      {
        id: "m1",
        at: 1000,
        role: "bot",
        kind: "text",
        roomRequest: { id: "req-1", phase: "request" },
        from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
        text: "@Designer Bot Ping Imam now...",
      },
      {
        id: "m2",
        at: 2000,
        role: "bot",
        kind: "activity",
        tool: { name: "agents_message_person", ok: true },
      },
      {
        id: "m3",
        at: 3000,
        role: "bot",
        kind: "text",
        inbox: { kind: "message", from: { name: "Designer Bot", botId: "designer" }, replies: true },
        text: "Halo Imam...",
      },
      {
        id: "m4",
        at: 4000,
        role: "bot",
        kind: "text",
        turnId: "turn-1",
        turnTerminal: true,
        text: "Sent. One-line confirmation: pinged Imam.",
      },
      {
        id: "m5",
        at: 5000,
        role: "bot",
        kind: "digest",
      },
    ];

    render({ ...bot, messages });

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="peer-exchange-toggle"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.textContent).toContain("Chief → Designer · 3");
    expect(toggle?.getAttribute("title")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Show");
    expect(toggle?.getAttribute("aria-label")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Show");
    expect(host.textContent).toContain("Halo Imam...");

    expect(host.textContent).not.toContain("@Designer Bot Ping Imam now...");
    expect(host.textContent).not.toContain("Sent. One-line confirmation");

    flushSync(() => {
      toggle?.click();
    });
    expect(toggle?.getAttribute("title")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Hide");
    expect(toggle?.getAttribute("aria-label")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Hide");
    expect(host.textContent).toContain("@Designer Bot Ping Imam now...");
    expect(host.textContent).toContain("Sent. One-line confirmation: pinged Imam.");
    expect(host.textContent).toContain("Halo Imam...");
  });

  it("folds requesting side activity rows into Chief → Designer · N while keeping bot text visible", () => {
    const chiefBot: Bot = {
      ...bot,
      id: "chief",
      name: "Chief Assistant Bot",
    };
    const messages: Message[] = [
      {
        id: "coord-1",
        at: 1000,
        role: "bot",
        kind: "activity",
        tool: { name: "agents_coordinate_bots", ok: true },
      },
      {
        id: "sent-1",
        at: 2000,
        role: "bot",
        kind: "activity",
        from: { botId: "chief", name: "Chief Assistant Bot", color: "blue" },
        tool: { name: "Sent to Designer Bot", ok: true },
        threadRef: { botId: "designer", threadId: "t-designer-1", title: "Teammate work" },
        roomRequest: { id: "req-42", phase: "request" },
      },
      {
        id: "reply-1",
        at: 3000,
        role: "bot",
        kind: "activity",
        from: { botId: "designer", name: "Designer Bot", color: "purple" },
        tool: { name: "Designer Bot replied", ok: true, output: "Mockup ready" },
        roomRequest: { id: "req-42", phase: "result" },
        threadRef: { botId: "designer", threadId: "t-designer-1", title: "Teammate work" },
      },
      {
        id: "resumed-1",
        at: 4000,
        role: "bot",
        kind: "activity",
        tool: { name: "Resumed with Designer Bot results, reviewing", ok: true },
      },
      {
        id: "reply-text",
        at: 5000,
        role: "bot",
        kind: "text",
        text: "Here is what Designer Bot created for you.",
      },
    ];

    render({ ...chiefBot, messages });

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="peer-exchange-toggle"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.textContent).toContain("Chief → Designer · 3");
    expect(toggle?.getAttribute("title")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Show");
    expect(toggle?.getAttribute("aria-label")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Show");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    expect(host.textContent).toContain("Here is what Designer Bot created for you.");
    expect(host.textContent).not.toContain("Mockup ready");

    flushSync(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(toggle?.getAttribute("title")).toBe("Chief Assistant Bot and Designer Bot talked: 3 messages. Hide");
    expect(host.textContent).toContain("Mockup ready");
    expect(host.textContent).toContain("Here is what Designer Bot created for you.");

    flushSync(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("Mockup ready");
    expect(host.textContent).toContain("Here is what Designer Bot created for you.");
  });
});
