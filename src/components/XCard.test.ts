// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale } from "@/lib/i18n";
import type { XConnectorStatus } from "../../shared/x-connector";

const fixture = vi.hoisted(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  return { api: vi.fn(), dispatch: vi.fn(), track: vi.fn(), config: {} as Record<string, unknown> };
});
vi.mock("@/state/store", () => ({ api: fixture.api, useStore: () => ({ state: { config: fixture.config }, dispatch: fixture.dispatch }) }));
vi.mock("@/lib/analytics", () => ({ track: fixture.track }));

import { XCard } from "./XCard";

const KEY = "treg_live_0123456789";

interface Server {
  own: boolean;
  check: { ok: boolean; check: "treg"; balanceUsd?: number; message?: string };
  calls: Array<[string, string, unknown]>;
}
let server: Server;
let host: HTMLDivElement;
let root: Root;
let onConnection: ReturnType<typeof vi.fn<(connected: boolean | null) => void>>;

const settle = () => act(async () => { for (let turn = 0; turn < 8; turn += 1) await Promise.resolve(); });
const card = () => host.querySelector<HTMLElement>('[data-app-tile="x"]')!;
const text = () => card().textContent ?? "";
const button = (label: string) => [...host.querySelectorAll("button")].find((element) => element.textContent?.trim() === label);
const field = () => host.querySelector<HTMLInputElement>("[data-x-key-form] input");
const configStatus = () => ({ treg: { configured: server.own } });

function serve() {
  fixture.api.mockImplementation(async (path: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    server.calls.push([method, path, body]);
    if (path.startsWith("/api/x/status") && method === "GET") {
      const status: XConnectorStatus = { using: server.own ? "own" : null, ownKey: server.own };
      return status;
    }
    if (path === "/api/config" && method === "PUT") { server.own = Boolean(body.treg.key); return configStatus(); }
    if (path === "/api/keys/test" && method === "POST") return server.check;
    throw new Error(`unexpected ${method} ${path}`);
  });
}

async function mount(state: Partial<Server>) {
  server = { own: false, check: { ok: true, check: "treg", balanceUsd: 4.25 }, calls: [], ...state };
  fixture.config = configStatus();
  serve();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(createElement(XCard, { onConnection })));
  await settle();
}

async function type(value: string) {
  const input = field()!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => { host.querySelector<HTMLFormElement>("[data-x-key-form]")!.requestSubmit(); });
  await settle();
}
async function click(label: string) {
  await act(async () => { button(label)!.click(); });
  await settle();
}

beforeEach(() => {
  setLocale("en");
  fixture.api.mockReset();
  fixture.dispatch.mockReset();
  fixture.track.mockReset();
  onConnection = vi.fn<(connected: boolean | null) => void>();
  (window as unknown as { ogb?: unknown }).ogb = undefined;
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("the X card in Apps", () => {
  it("asks for a treg key with a link to treg.to, saves it where keys go, tests it once and says it works", async () => {
    await mount({});
    expect(card().dataset.xState).toBe("none");
    expect(text()).toContain("Add your treg key");
    expect(host.querySelector<HTMLAnchorElement>('a[href="https://treg.to"]')?.textContent).toContain("Get a key at treg.to");
    expect(onConnection).toHaveBeenLastCalledWith(false);
    await type(KEY);
    await submit();
    expect(server.calls.filter(([method]) => method !== "GET")).toEqual([
      ["PUT", "/api/config", { treg: { key: KEY } }],
      ["POST", "/api/keys/test", { provider: "treg" }],
    ]);
    expect(fixture.dispatch).toHaveBeenCalledWith({ type: "configStatus", config: { treg: { configured: true } } });
    expect(card().dataset.xState).toBe("own");
    expect(text()).toContain("Using your treg key");
    expect(text()).toContain("treg is working ✓ Balance: $4.25.");
    expect(field()).toBeNull();
    expect(fixture.track).toHaveBeenCalledWith("api_key_saved", { provider: "treg", via: "apps", result: "ok" });
    expect(onConnection).toHaveBeenLastCalledWith(true);
  });

  it("saves a pasted key into the desktop's encrypted store when the app has one", async () => {
    const setCredential = vi.fn(async (_name: string, value: string) => { server.own = Boolean(value); return configStatus(); });
    (window as unknown as { ogb: unknown }).ogb = { setCredential };
    await mount({});
    await type(KEY);
    await submit();
    expect(setCredential).toHaveBeenCalledWith("tregApiKey", KEY);
    expect(server.calls.some(([method, path]) => method === "PUT" && path === "/api/config")).toBe(false);
  });

  it("refuses something that is not a key without saving it", async () => {
    await mount({});
    await type("my treg key");
    await submit();
    expect(text()).toContain("doesn't look like an API key");
    expect(server.calls.filter(([method]) => method !== "GET")).toEqual([]);
  });

  it("shows treg's plain reason when Test fails", async () => {
    await mount({ own: true, check: { ok: false, check: "treg", message: "treg rejected this key. Copy it again from treg.to." } });
    expect(card().dataset.xState).toBe("own");
    await click("Test");
    expect(text()).toContain("treg rejected this key. Copy it again from treg.to.");
  });

  it("removing the only key leaves no X, and the card asks for a key again", async () => {
    await mount({ own: true });
    expect(text()).toContain("Your bots search and read X with your own treg key. Calls are billed to your treg balance.");
    await click("Remove key");
    expect(server.calls).toContainEqual(["PUT", "/api/config", { treg: { key: "" } }]);
    expect(fixture.track).toHaveBeenCalledWith("api_key_removed", { provider: "treg", via: "apps" });
    expect(card().dataset.xState).toBe("none");
    expect(field()).not.toBeNull();
    expect(onConnection).toHaveBeenLastCalledWith(false);
  });

  it("speaks the app's language", async () => {
    setLocale("de");
    await mount({ own: true });
    expect(text()).toContain("Dein treg-Schlüssel wird verwendet");
    expect(text()).toContain("Aufrufe werden über dein treg-Guthaben abgerechnet.");
  });
});
