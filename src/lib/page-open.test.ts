// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isPublishedPageUrl, pagePanelBot, requestPanelPage, usePanelPage, withPageOpen, type PageOpenFacts, type PanelPage } from "./page-open";

const PAGES = "https://pages.example.test";
const PAGE = `${PAGES}/p/abcdefghijklmnopqrstuvwxyz/`;
const CONFIG = { features: { browser: true }, browserEngine: { kind: "engine" as const }, pagesUrl: PAGES };
const facts = (over: Partial<PageOpenFacts> = {}): PageOpenFacts => ({
  selectedId: "pepper", bots: [{ id: "pepper" }], groups: [{ id: "room" }],
  config: CONFIG, desktop: {}, ...over,
});

describe("a published page's link", () => {
  it("is only <pages url>/p/<page id>/…, never an app, chat or look-alike link", () => {
    expect(isPublishedPageUrl(PAGE, PAGES)).toBe(true);
    expect(isPublishedPageUrl(`${PAGE}charts/index.html?region=EU#top`, PAGES)).toBe(true);
    expect(isPublishedPageUrl(PAGE, "http://127.0.0.1:8801")).toBe(false);
    expect(isPublishedPageUrl("http://127.0.0.1:8801/p/abcdefghijklmnopqrstuvwxyz/", "http://127.0.0.1:8801")).toBe(true);
    for (const other of [
      "openmausbot://thread/t1?bot=pepper", "openmausbot://bot/pepper", "http://pages.example.test/p/abcdefghijklmnopqrstuvwxyz/",
      "https://pages.example.test/", "https://pages.example.test/p/", "https://pages.example.test/p/abc/", "https://pages.example.test/p/abcdefghijklmnopqrstuvwxyz",
      "https://pages.example.test/p/ABCDEFGHIJKLMNOPQRSTUVWXYZ/", "https://pages.example.test/health", "https://pages.example.test/other/abcdefghijklmnopqrstuvwxyz/",
      "https://www.pages.example.test/p/abcdefghijklmnopqrstuvwxyz/", "https://pages.example.test.evil.test/p/abcdefghijklmnopqrstuvwxyz/",
      "https://pages.example.test:8443/p/abcdefghijklmnopqrstuvwxyz/", "https://user:pw@pages.example.test/p/abcdefghijklmnopqrstuvwxyz/",
      "javascript:alert(1)", "not a url", "", undefined, null,
    ]) expect(isPublishedPageUrl(other, PAGES), String(other)).toBe(false);
  });

  it("is no page link at all until the server says where its pages are", () => {
    expect(isPublishedPageUrl(PAGE, undefined)).toBe(false);
  });
});

describe("where a published page opens", () => {
  it("in the desktop app, in the open bot chat's browser panel when that browser is on and installed", () => {
    expect(pagePanelBot(PAGE, facts())).toBe("pepper");
  });

  it("outside the chat everywhere else: the web, the remote client, a room, a bot without its browser, or a browser not ready", () => {
    const cases: Array<[string, Partial<PageOpenFacts>]> = [
      ["web", { desktop: undefined }],
      ["remote client", { desktop: { remoteClient: { active: true } } }],
      ["room", { selectedId: "room" }],
      ["no bot", { selectedId: "gone" }],
      ["bot's browser off", { bots: [{ id: "pepper", browser: false }] }],
      ["browser feature off", { config: { ...CONFIG, features: { browser: false } } }],
      ["not installed", { config: { ...CONFIG, browserEngine: { kind: "unavailable", installable: true } } }],
      ["installing", { config: { ...CONFIG, browserEngine: { kind: "engine", installing: true } } }],
      ["install failed", { config: { ...CONFIG, browserEngine: { kind: "engine", installError: "disk full" } } }],
      ["no pages address", { config: { features: { browser: true }, browserEngine: { kind: "engine" } } }],
    ];
    for (const [name, over] of cases) expect(pagePanelBot(PAGE, facts(over)), name).toBeNull();
  });

  it("never sends any other link to the panel", () => {
    for (const link of ["https://example.com/", "openmausbot://thread/t1?bot=pepper", `${PAGES}/`]) expect(pagePanelBot(link, facts())).toBeNull();
  });
});

describe("the panel's page requests", () => {
  const roots: Array<{ unmount(): void }> = [];
  afterEach(() => { for (const root of roots.splice(0)) root.unmount(); vi.useRealTimers(); });
  function panel(botId: string) {
    const got: PanelPage[] = [];
    const container = document.createElement("div"), root = createRoot(container);
    roots.push(root);
    function Panel() { usePanelPage(botId, (page) => got.push(page)); return null; }
    flushSync(() => root.render(createElement(Panel)));
    return got;
  }

  it("go once to the bot's panel, open now or opening next, and never to another bot's", () => {
    const pepper = panel("pepper"), salt = panel("salt");
    requestPanelPage("pepper", PAGE);
    expect(pepper.map((page) => page.url)).toEqual([PAGE]);
    expect(salt).toEqual([]);
    requestPanelPage("basil", PAGE);
    expect(panel("basil").map((page) => page.url)).toEqual([PAGE]);
    expect(panel("basil")).toEqual([]);
  });

  it("are dropped once stale, so a panel opened much later opens nothing by itself", () => {
    requestPanelPage("thyme", PAGE, Date.now() - 60_000);
    expect(panel("thyme")).toEqual([]);
  });
});

describe("a page link's click", () => {
  const click = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

  it("opens the page like its card's Open, after the link's own handler", () => {
    const open = vi.fn(), own = vi.fn();
    const event = click();
    withPageOpen(PAGE, open, { onClick: own }, PAGES).onClick!(event as never);
    expect(own).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledWith(PAGE);
  });

  it("stays taken when the link's own handler took it (a long press), and leaves other links alone", () => {
    const open = vi.fn();
    withPageOpen(PAGE, open, { onClick: (event) => event.preventDefault() }, PAGES).onClick!(click() as never);
    expect(open).not.toHaveBeenCalled();
    const anchor = { onClick: vi.fn() };
    expect(withPageOpen("https://example.com/", open, anchor, PAGES)).toBe(anchor);
  });
});
