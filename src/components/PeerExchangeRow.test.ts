// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PeerExchangeRow } from "./PeerExchangeRow";

describe("PeerExchangeRow", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    flushSync(() => root.unmount());
    host.remove();
  });

  it("shows collapsed row by default, and click reveals the hidden content", () => {
    flushSync(() => {
      root.render(
        createElement(
          PeerExchangeRow,
          {
            fromName: "Chief Assistant Bot",
            toName: "Designer Bot",
            count: 2,
          },
          createElement("div", { "data-testid": "request-bubble" }, "@Designer Bot Ping Imam now..."),
          createElement("div", { "data-testid": "reply-bubble" }, "Sent. One-line confirmation: pinged Imam."),
        ),
      );
    });

    const toggle = host.querySelector<HTMLButtonElement>('[data-testid="peer-exchange-toggle"]');
    expect(toggle).toBeTruthy();
    expect(toggle?.textContent).toContain("↔ Chief Assistant Bot → Designer Bot · 2 messages");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");

    expect(host.textContent).not.toContain("@Designer Bot Ping Imam now...");
    expect(host.querySelector('[data-testid="request-bubble"]')).toBeNull();

    flushSync(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("true");
    expect(host.textContent).toContain("@Designer Bot Ping Imam now...");
    expect(host.querySelector('[data-testid="request-bubble"]')).toBeTruthy();
    expect(host.querySelector('[data-testid="peer-exchange-messages"]')).toBeTruthy();

    flushSync(() => {
      toggle?.click();
    });

    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
    expect(host.textContent).not.toContain("@Designer Bot Ping Imam now...");
  });

  it("respects forceOpen prop to start expanded", () => {
    flushSync(() => {
      root.render(
        createElement(
          PeerExchangeRow,
          {
            fromName: "Chief Assistant Bot",
            toName: "Designer Bot",
            count: 1,
            forceOpen: true,
          },
          createElement("div", null, "Force opened content"),
        ),
      );
    });

    expect(host.textContent).toContain("↔ Chief Assistant Bot → Designer Bot · 1 message");
    expect(host.textContent).toContain("Force opened content");
  });
});
