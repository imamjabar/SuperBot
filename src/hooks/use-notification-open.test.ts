import type { EffectCallback } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialState, type Action, type AppState, type Bot, type ThreadTarget } from "@/state/store";

const fixture = vi.hoisted(() => ({
  effects: [] as EffectCallback[],
  target: null as ThreadTarget | null,
  showThreads: true,
}));

vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [
    fixture.target ?? (typeof initial === "function" ? (initial as () => ThreadTarget | null)() : initial),
    (next: ThreadTarget | null) => { fixture.target = next; },
  ],
  useEffect: (effect: EffectCallback) => { fixture.effects.push(effect); },
}));

vi.mock("@/lib/thread-preferences", () => ({
  useShowThreads: () => fixture.showThreads,
}));

import * as notify from "@/lib/notify";
import { takeNotificationTargetFromLocation, useNotificationOpen } from "./use-notification-open";
import { setNotificationOpenHandler } from "@/lib/notify";

const scout: Bot = {
  id: "scout", threadId: "scout-main", name: "Scout", title: "", description: "", notifications: true,
  color: "green", unread: false, messages: [], modelSelection: { instanceId: "fake", model: "test" },
  tasks: [{ threadId: "scout-main", title: "Main", createdAt: 1 }, { threadId: "scout-work", title: "Work", createdAt: 2 }],
};
const loading: AppState = { ...initialState, bots: [], selectedId: "" };
const ready: AppState = { ...initialState, bots: [scout], selectedId: "scout", hydrated: true };

function render(state: AppState, dispatch: (action: Action) => void) {
  fixture.effects = [];
  useNotificationOpen(state, dispatch);
  return fixture.effects.map((effect) => effect());
}

afterEach(() => {
  vi.unstubAllGlobals();
  setNotificationOpenHandler(null);
  fixture.effects = [];
  fixture.target = null;
  fixture.showThreads = true;
});

describe("takeNotificationTargetFromLocation", () => {
  it("returns null when no query params are present", () => {
    vi.stubGlobal("location", { search: "", pathname: "/" });
    expect(takeNotificationTargetFromLocation()).toBeNull();
  });

  it("extracts botId and threadId, and strips params from location", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", {
      search: "?open-bot=scout&open-thread=scout-work&foo=bar",
      pathname: "/",
      hash: "#heading",
    });

    const target = takeNotificationTargetFromLocation();
    expect(target).toEqual({ botId: "scout", threadId: "scout-work" });
    expect(replaceState).toHaveBeenCalledWith(null, "", "/?foo=bar#heading");
  });
});

describe("useNotificationOpen", () => {
  it("holds notification target until state is hydrated, then opens thread", () => {
    vi.stubGlobal("location", { search: "", pathname: "/" });
    const dispatch = vi.fn();
    const handlerSpy = vi.spyOn(notify, "setNotificationOpenHandler");
    render(loading, dispatch);

    const handler = handlerSpy.mock.calls.at(-1)?.[0];
    expect(handler).toBeDefined();

    handler!({ botId: "scout", threadId: "scout-work" });
    render(loading, dispatch);
    expect(dispatch).not.toHaveBeenCalled();

    render(ready, dispatch);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: "select", id: "scout" },
      { type: "switchTask", botId: "scout", threadId: "scout-work" },
      { type: "revealThread", threadId: "scout-work" },
    ]);
  });
});
