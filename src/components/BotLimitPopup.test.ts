// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ state: { config: { cloudHome: true, botLimit: 5 } as Record<string, unknown>, bots: [] as unknown[] } }));
vi.mock("@/state/store", () => ({ useStore: () => ({ state: fixture.state, dispatch: vi.fn() }) }));
vi.mock("./Avatar", () => ({ MausAvatar: () => createElement("i", { "data-mark": "" }) }));

import { botLimitShown, closeBotLimit, showBotLimit } from "@/lib/bot-limit";
import { setLocale } from "@/lib/i18n";
import { BotLimitPopup } from "./BotLimitPopup";

const made = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `b${i}` }));

let root: Root;
let host: HTMLElement;
const dialog = () => document.querySelector<HTMLElement>("[data-bot-limit-popup]");
const buttons = () => [...dialog()!.querySelectorAll("button")].map((node) => node.textContent?.trim() || node.getAttribute("aria-label"));
const press = (label: string, within: ParentNode = document) => act(async () => {
  [...within.querySelectorAll("button")].find((node) => node.textContent?.trim() === label || node.getAttribute("aria-label") === label)!.click();
});
const key = (name: string, init: KeyboardEventInit = {}) => act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init })); });

async function open() {
  await act(async () => { root.render(createElement(BotLimitPopup)); });
  await act(async () => { showBotLimit(); });
  await act(async () => {});
}

beforeEach(() => {
  setLocale("en");
  fixture.state = { config: { cloudHome: true, botLimit: 5 }, bots: made(5) };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => { closeBotLimit(); root.unmount(); });
  host.remove();
});

describe("the bot limit popup", () => {
  it("shows nothing until something opens it", async () => {
    await act(async () => { root.render(createElement(BotLimitPopup)); });
    expect(dialog()).toBeNull();
  });

  it("says they've reached the bots limit and shows dismiss buttons", async () => {
    await open();
    expect(dialog()!.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.querySelector("h2")?.textContent).toBe("You've reached Starter's 5 bots");
    expect(dialog()!.querySelector("p")?.textContent).toBe("To create more, upgrade this Cloud. Every bot you have stays as it is.");
    expect(buttons()).toEqual(["Got it", "Close"]);
  });

  it.each([["Got it"], ["Close"]])("%s closes it, and the next press opens it again", async (label) => {
    await open();
    await press(label);
    expect(dialog()).toBeNull();
    await act(async () => { showBotLimit(); });
    expect(dialog()).not.toBeNull();
  });

  it("Escape closes it", async () => {
    await open();
    await key("Escape");
    expect(botLimitShown()).toBe(false);
  });
});
