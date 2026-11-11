// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@/lib/i18n";
import { MESSAGE_ROW, MessageActions, PRESS_MENU } from "./MessageActions";

let host: HTMLDivElement;
let root: Root;

const row = () => host.querySelector<HTMLElement>(`[${MESSAGE_ROW}]`)!;
const body = () => host.querySelector<HTMLElement>("p")!;
const tray = () => host.querySelector<HTMLElement>('[data-testid="message-actions"]')!;
const shown = () => tray().dataset.shown === "true";
const more = () => tray().querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')!;
const items = () => [...host.querySelectorAll<HTMLButtonElement>("[role=menuitem]")];

const pointer = (type: string, target: Element, pointerType: string) =>
  act(async () => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: type !== "pointerenter" && type !== "pointerleave", pointerType }));
  });

let picked: string[] = [];

async function render(forceOpen = false, press = false) {
  await act(async () => {
    root.render(
      createElement("div", { [MESSAGE_ROW]: "" },
        createElement("div", { "data-chat-bubble": "" }, createElement("p", null, "an answer"), createElement("a", { href: "https://example.test" }, "a link")),
        createElement(MessageActions, {
          side: "bot",
          forceOpen,
          ...(press ? { press: { onReply: () => picked.push("reply"), copy: "an answer" } } : {}),
          menu: [
            { key: "pin", icon: null, label: "Pin message", onSelect: () => picked.push("pin") },
            { key: "raw", icon: null, label: "Show raw markdown", onSelect: () => picked.push("raw") },
          ],
          children: createElement("button", { type: "button" }, "copy"),
        }),
      ),
    );
  });
}

beforeEach(() => {
  setLocale("en");
  picked = [];
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("message actions row", () => {
  it("shows while the pointer is over the message and hides when it leaves", async () => {
    await render();
    expect(shown()).toBe(false);
    await pointer("pointerenter", row(), "mouse");
    expect(shown()).toBe(true);
    await pointer("pointerleave", row(), "mouse");
    expect(shown()).toBe(false);
  });

  it("does not treat a touch passing over as a hover", async () => {
    await render();
    await pointer("pointerenter", row(), "touch");
    expect(shown()).toBe(false);
  });

  it("shows on a tap of the message and hides on the next", async () => {
    await render();
    await pointer("pointerdown", body(), "touch");
    await pointer("pointerup", body(), "touch");
    expect(shown()).toBe(true);
    await pointer("pointerdown", body(), "touch");
    await pointer("pointerup", body(), "touch");
    expect(shown()).toBe(false);
  });

  it("shows on a long press of the message", async () => {
    vi.useFakeTimers();
    await render();
    await pointer("pointerdown", body(), "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(shown()).toBe(true);
  });

  it("opens Reply, Copy and Select text before the rest of the menu on a long press, not on a link's", async () => {
    vi.useFakeTimers();
    await render(false, true);
    expect(row().hasAttribute(PRESS_MENU)).toBe(true);
    await pointer("pointerdown", host.querySelector("a")!, "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(items()).toHaveLength(0);
    await pointer("pointerup", host.querySelector("a")!, "touch");
    await pointer("pointerdown", body(), "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(items().map((item) => item.textContent)).toEqual(["Reply", "Copy message", "Select text", "Pin message", "Show raw markdown"]);
    expect(more().getAttribute("aria-expanded")).toBe("false");
    await act(async () => items()[0]!.click());
    expect(picked).toEqual(["reply"]);
    expect(items()).toHaveLength(0);
  });

  it("selects the whole bubble on Select text and lets it go once the selection is cleared", async () => {
    vi.useFakeTimers();
    await render(false, true);
    await pointer("pointerdown", body(), "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => items().find((item) => item.textContent === "Select text")!.click());
    expect(window.getSelection()!.toString()).toContain("an answer");
    expect(row().hasAttribute("data-selecting")).toBe(true);
    await act(async () => {
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event("selectionchange"));
    });
    expect(row().hasAttribute("data-selecting")).toBe(false);
  });

  it("drops the selection when the finger lands outside the message", async () => {
    vi.useFakeTimers();
    await render(false, true);
    await pointer("pointerdown", body(), "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    await act(async () => items().find((item) => item.textContent === "Select text")!.click());
    await pointer("pointerdown", document.body, "touch");
    expect(window.getSelection()!.toString()).toBe("");
    expect(row().hasAttribute("data-selecting")).toBe(false);
  });

  it("does not reveal actions after a canceled touch at the same position", async () => {
    vi.useFakeTimers();
    await render();
    await pointer("pointerdown", body(), "touch");
    await pointer("pointercancel", body(), "touch");
    await act(async () => { vi.advanceTimersByTime(500); });
    expect(shown()).toBe(false);
    await pointer("pointerup", body(), "touch");
    expect(shown()).toBe(false);
  });

  it("opens the more menu with the moved actions and closes it on a pick", async () => {
    await render();
    await pointer("pointerenter", row(), "mouse");
    expect(items()).toHaveLength(0);
    await act(async () => more().click());
    expect(more().getAttribute("aria-expanded")).toBe("true");
    expect(items().map((item) => item.textContent)).toEqual(["Pin message", "Show raw markdown"]);
    await pointer("pointerleave", row(), "mouse");
    expect(shown()).toBe(true);
    await act(async () => items()[0]!.click());
    expect(picked).toEqual(["pin"]);
    expect(items()).toHaveLength(0);
  });

  it("closes the menu on Escape", async () => {
    await render();
    await act(async () => more().click());
    expect(items()).toHaveLength(2);
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(items()).toHaveLength(0);
  });

  it("keeps a row that must stay reachable out", async () => {
    await render(true);
    expect(shown()).toBe(true);
    await pointer("pointerleave", row(), "mouse");
    expect(shown()).toBe(true);
  });
});
