// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { HomeScreen, type HomeBridge, type HomeView } from "./HomeScreen";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root | null = null;
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); });
function bridgeOf(view: HomeView) {
  return { state: vi.fn(async () => view), onState: vi.fn(() => () => {}), retry: vi.fn(async () => view), signIn: vi.fn(async () => {}), repair: vi.fn(async () => {}) } as unknown as HomeBridge;
}
async function mount(bridge: HomeBridge) {
  root = createRoot(host);
  await act(async () => { root!.render(createElement(HomeScreen, { bridge })); });
  await settle();
}
const click = async (selector: string) => { const element = host.querySelector<HTMLElement>(selector); expect(element, selector).toBeTruthy(); await act(async () => { element!.click(); }); await settle(); };
beforeEach(() => { setLocale("en"); host = document.createElement("div"); document.body.append(host); Object.assign(window, { ogb: {} }); });
afterEach(async () => { await act(async () => root?.unmount()); root = null; host.remove(); });

it("a server that didn't answer offers Try again", async () => {
  const offline = bridgeOf({ screen: "offline", name: "Server" });
  await mount(offline);
  expect(host.querySelector("[role='status'] span"), "no spinner going on for ever").toBeNull();
  const retried = offline.retry.mock.calls.length;
  await click("[data-home-action='retry']");
  expect(host.querySelector("[data-home-action='retry']")?.textContent).toBe("Try again");
  expect(offline.retry.mock.calls.length).toBe(retried + 1);
});
