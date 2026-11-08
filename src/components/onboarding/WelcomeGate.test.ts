import { createElement, type EffectCallback, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, LOCAL_VIEWER, WELCOME_VERSION, type WelcomeViewer } from "@/lib/onboarding";
import { setLocale } from "@/lib/i18n";
import { WELCOME_DRAFT_KEY } from "@/lib/welcome-draft";

const fixture = vi.hoisted(() => ({ values: [] as unknown[], index: 0, effects: [] as EffectCallback[] }));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  useState: (initial: unknown) => {
    const index = fixture.index++;
    if (!(index in fixture.values)) fixture.values[index] = typeof initial === "function" ? initial() : initial;
    return [fixture.values[index], (next: unknown) => {
      fixture.values[index] = typeof next === "function" ? next(fixture.values[index]) : next;
    }];
  },
  useEffect: (effect: EffectCallback) => {
    fixture.effects.push(effect);
  },
}));
const store = vi.hoisted(() => ({ state: {} as Record<string, unknown>, dispatch: vi.fn(), api: vi.fn() }));
vi.mock("@/state/store", () => ({ api: store.api, useStore: () => ({ state: store.state, dispatch: store.dispatch }) }));
vi.mock("@/lib/analytics", () => ({ emailGateDone: () => false }));
// The gate's job is choosing; the flow itself has its own recipe.
vi.mock("./WelcomeFlow", () => ({ WelcomeFlow: () => null }));
import { useWelcomeViewer, WelcomeGate } from "./WelcomeGate";
import { WelcomeFlow } from "./WelcomeFlow";

type Node = ReactElement<Record<string, unknown> & { onClick?: () => void; onClose?: () => void; onDone?: (botId: string | null) => void; children?: ReactNode }>;
function render(component: () => ReactNode) {
  fixture.index = 0;
  fixture.effects = [];
  let tree: ReactNode = null;
  function Capture() {
    tree = component();
    return tree;
  }
  const html = renderToStaticMarkup(createElement(Capture));
  return { html, tree: tree as Node | null };
}
const gate = (viewer: WelcomeViewer | null) => render(() => WelcomeGate({ viewer }));
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
}

const fresh = { onboarding: EMPTY_ONBOARDING };
const LOCAL_PAGE = { ogb: { platform: "darwin", remoteClient: { active: false }, workspaces: {} } };
// A server page the desktop app opened: preload exposes only its remote-safe subset, still truthy.
const REMOTE_PAGE = { ogb: { platform: "darwin", workspaces: {}, getCapabilities: () => ({}) } };
beforeEach(() => {
  fixture.values = [];
  fixture.index = 0;
  fixture.effects = [];
  store.dispatch.mockReset();
  store.api.mockReset();
  store.state = { config: fresh, welcomeOpen: false, appSettingsOpen: false, appSettingsSection: "general", bots: [] };
  vi.stubGlobal("window", {});
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("fetch", vi.fn());
  setLocale("en");
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("who gets the welcome flow", () => {
  it("opens the desktop flow for the desktop app's own window, exactly as before", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    const { tree } = gate(LOCAL_VIEWER);
    expect(tree?.type).toBe(WelcomeFlow);
    expect(tree?.props).toMatchObject({ replay: false });
  });

  it("lands in the chat with the bot the person chose on the Chief screen", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    store.state = { ...store.state, bots: [{ id: "maus", chiefOfStaff: true }, { id: "research" }] };
    gate(LOCAL_VIEWER).tree!.props.onDone!("research");
    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "research" });
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleWelcome", open: false });
  });

  it("with no choice made, lands with the Chief of Staff wherever it sits in the list, else the first bot", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    const finish = () => gate(LOCAL_VIEWER).tree!.props.onDone!(null);
    store.state = { ...store.state, bots: [{ id: "old", hidden: true, chiefOfStaff: true }, { id: "helper" }, { id: "chief", chiefOfStaff: true }] };
    finish();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "chief" });
    fixture.values = [];
    store.dispatch.mockReset();
    store.state = { ...store.state, bots: [{ id: "old", hidden: true }, { id: "helper" }] };
    finish();
    expect(store.dispatch).toHaveBeenCalledWith({ type: "select", id: "helper" });
    fixture.values = [];
    store.dispatch.mockReset();
    store.state = { ...store.state, bots: [] };
    finish();
    expect(store.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));
  });

  it("never starts the app tour when the welcome is finished or skipped, nor after a reload", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    store.state = { ...store.state, bots: [{ id: "first" }] };
    gate(LOCAL_VIEWER).tree!.props.onDone!(null);
    expect(store.dispatch).toHaveBeenCalledWith({ type: "toggleWelcome", open: false });
    // Reloaded: the welcome is saved as done, and nothing opens in its place.
    fixture.values = [];
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-10-23T00:00:00.000Z", version: WELCOME_VERSION } } };
    expect(gate(LOCAL_VIEWER).tree).toBeNull();
    // A replay from Settings closes the same way, and stays where the person was unless they chose a bot.
    store.dispatch.mockReset();
    store.state = { ...store.state, welcomeOpen: true };
    gate(LOCAL_VIEWER).tree!.props.onDone!(null);
    expect(store.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "toggleTour" }));
    expect(store.dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: "select" }));
  });

  it("adds nothing for a member of a server, such as the owner's own paired browser", () => {
    const { tree, html } = gate({ canSave: false });
    expect(tree).toBeNull();
    expect(html).toBe("");
    store.state = { ...store.state, welcomeOpen: true };
    const replay = gate({ canSave: false }).tree!;
    expect(replay.type).toBe(WelcomeFlow);
    expect(replay.props).toMatchObject({ replay: true });
  });

  it("shows nothing to a remote client member or while a browser's session is unknown", () => {
    expect(gate(null).tree).toBeNull();
    vi.stubGlobal("window", { ogb: { remoteClient: { active: true } } });
    expect(gate({ canSave: false }).tree).toBeNull();
    expect(gate(LOCAL_VIEWER).tree).toBeNull();
  });

  it("stays closed after the welcome was finished", () => {
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-09-23T00:00:00.000Z", version: WELCOME_VERSION } } };
    expect(gate(LOCAL_VIEWER).tree).toBeNull();
  });

  it("forgets a welcome draft once the welcome is done, however it was finished", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    localStorage.setItem(WELCOME_DRAFT_KEY, "kept");
    gate(LOCAL_VIEWER);
    for (const effect of fixture.effects) effect();
    expect(localStorage.getItem(WELCOME_DRAFT_KEY), "a welcome still due keeps its draft").toBe("kept");
    store.state = { ...store.state, config: { onboarding: { ...EMPTY_ONBOARDING, completedAt: "2026-10-23T00:00:00.000Z", version: WELCOME_VERSION } } };
    gate(LOCAL_VIEWER);
    for (const effect of fixture.effects) effect();
    expect(localStorage.getItem(WELCOME_DRAFT_KEY)).toBeNull();
  });

  it("steps aside while Settings is open on the organization sign-in it offers, and is back after", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    store.state = { ...store.state, appSettingsOpen: true, appSettingsSection: "organization" };
    expect(gate(LOCAL_VIEWER).tree).toBeNull();
    store.state = { ...store.state, appSettingsOpen: false };
    expect(gate(LOCAL_VIEWER).tree?.type).toBe(WelcomeFlow);
  });
});

describe("useWelcomeViewer", () => {
  const viewer = () => {
    let value: WelcomeViewer | null = null;
    render(() => {
      value = useWelcomeViewer();
      return null;
    });
    return value;
  };

  it("knows the desktop app's own window without asking", () => {
    vi.stubGlobal("window", LOCAL_PAGE);
    expect(viewer()).toEqual(LOCAL_VIEWER);
    for (const effect of fixture.effects) effect();
    expect(store.api).not.toHaveBeenCalled();
  });

  it("asks the server from a remote page the desktop app opened, whose bridge is reduced", async () => {
    vi.stubGlobal("window", REMOTE_PAGE);
    store.api.mockResolvedValueOnce({ kind: "session", scopes: ["client"] });
    expect(viewer()).toBeNull();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(store.api).toHaveBeenCalledExactlyOnceWith("/api/auth/session", { timeoutMs: 10_000 });
    expect(viewer()).toEqual({ canSave: false });
  });

  it("asks a browser's server once and reads the scope from the answer", async () => {
    store.api.mockResolvedValueOnce({ kind: "session", scopes: ["client"] });
    expect(viewer()).toBeNull();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(store.api).toHaveBeenCalledExactlyOnceWith("/api/auth/session", { timeoutMs: 10_000 });
    expect(viewer()).toEqual({ canSave: false });
  });

  it("keeps today's behaviour when the answer does not come", async () => {
    store.api.mockRejectedValueOnce(new Error("offline"));
    viewer();
    for (const effect of fixture.effects) effect();
    await flush();
    expect(viewer()).toEqual(LOCAL_VIEWER);
  });
});
