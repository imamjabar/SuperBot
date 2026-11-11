import { useCallback, useEffect, useRef, type MouseEvent } from "react";
import { PAGE_ID } from "../../shared/published-page";
import type { Bot } from "@/state/store";
import { useOptionalStoreRef } from "@/state/store-ref";
import { openExternalLink } from "./app-links";
import { browserAvailable, builtInBrowserEnabled, type FeatureFlagConfig } from "./feature-flags";

/** A link to a page this server published: `<pagesUrl>/p/<page id>/…`, on the pages origin exactly. Never an app, chat or prompt link. */
export function isPublishedPageUrl(value: string | null | undefined, pagesUrl: string | undefined): value is string {
  if (typeof value !== "string" || !pagesUrl) return false;
  let url: URL, origin: string;
  try {
    url = new URL(value);
    origin = new URL(pagesUrl).origin;
  } catch { return false; }
  if (url.username || url.password || url.origin !== origin) return false;
  const id = /^\/p\/([^/]+)\//.exec(url.pathname)?.[1];
  return id !== undefined && PAGE_ID.test(id);
}

export interface PageOpenFacts {
  selectedId: string | null;
  bots: ReadonlyArray<Pick<Bot, "id" | "browser">>;
  groups: ReadonlyArray<{ id: string }>;
  config: FeatureFlagConfig | null | undefined;
  /** The desktop app's bridge, which only the desktop app's window has. */
  desktop: { remoteClient?: { active?: boolean } } | undefined;
}

/**
 * The bot whose browser, in the panel on the right, shows a published page; null opens it outside the chat instead (the
 * system browser in the desktop app, a new tab on the web). Only the desktop app's window, only a page link, and only a
 * bot chat whose browser is on and installed; never a room, and never the remote client, which has no such panel.
 */
export function pagePanelBot(url: string, facts: PageOpenFacts): string | null {
  if (!facts.desktop || facts.desktop.remoteClient?.active || !isPublishedPageUrl(url, facts.config?.pagesUrl)) return null;
  if (facts.groups.some((group) => group.id === facts.selectedId)) return null;
  const bot = facts.bots.find((candidate) => candidate.id === facts.selectedId);
  const engine = facts.config?.browserEngine;
  if (!bot || bot.browser === false || !builtInBrowserEnabled(facts.config) || !browserAvailable(facts.config)) return null;
  return engine?.installing || engine?.installError ? null : bot.id;
}

export interface PanelPage { botId: string; url: string; nonce: number; at: number }
/** A request older than this is dropped, so a panel opened much later never opens a page by surprise. */
const PANEL_PAGE_FRESH_MS = 10_000;
let pending: PanelPage | null = null, nonce = 0;
const takers = new Set<() => void>();

export function requestPanelPage(botId: string, url: string, now = Date.now()): void {
  pending = { botId, url, nonce: ++nonce, at: now };
  for (const take of takers) take();
}

/** Hands `open` each page asked for this bot's panel, once: the panel shows its browser and opens the page in a new tab. */
export function usePanelPage(botId: string, open: (page: PanelPage) => void): void {
  const latest = useRef(open);
  latest.current = open;
  useEffect(() => {
    const take = () => {
      const page = pending;
      if (!page || page.botId !== botId) return;
      pending = null;
      if (Date.now() - page.at <= PANEL_PAGE_FRESH_MS) latest.current(page);
    };
    take();
    takers.add(take);
    return () => { takers.delete(take); };
  }, [botId]);
}

/** Opens a link the way a published page's Open does: a page in the bot's browser panel when the desktop app has one,
 * anything else outside the chat. It never sends a message, starts a turn or opens a chat. */
export function usePageOpener(): (url: string) => void {
  // Outside the app's store (a message drawn on its own) there is no panel: the page opens outside the chat.
  const store = useOptionalStoreRef();
  const latest = useRef(store);
  latest.current = store;
  return useCallback((url: string) => {
    const app = latest.current, state = app?.state();
    const botId = app && state ? pagePanelBot(url, { selectedId: state.selectedId, bots: state.bots ?? [], groups: state.groups ?? [], config: state.config, desktop: window.ogb }) : null;
    if (!app || !botId) { void openExternalLink(url).catch(() => {}); return; }
    requestPanelPage(botId, url);
    app.dispatch({ type: "toggleComputer", open: true });
  }, []);
}

/** Where this server's pages are served, read when the link is drawn; undefined outside the app's store or before its owner sets one. */
export function usePagesUrl(): string | undefined {
  return useOptionalStoreRef()?.state().config?.pagesUrl;
}

/** A page link's click opens it like the card's Open; a click its hover card already took stays taken. */
export function withPageOpen<T extends { onClick?: (event: MouseEvent<HTMLElement>) => void }>(href: string | undefined, open: (url: string) => void, anchor: T, pagesUrl: string | undefined): T {
  if (!isPublishedPageUrl(href, pagesUrl)) return anchor;
  return { ...anchor, onClick: (event: MouseEvent<HTMLElement>) => {
    anchor.onClick?.(event);
    if (event.defaultPrevented) return;
    event.preventDefault();
    open(href);
  } };
}
