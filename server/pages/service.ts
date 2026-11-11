import { join } from "node:path";
import type { PublishedPageCard } from "../../shared/published-page.ts";
import type { ChatApps } from "../chat-apps.ts";
import { createPagesInternalRoutes, createPublishedPageRoutes } from "../routes/published-pages.ts";
import type { Store } from "../store.ts";
import type { PagesConfig } from "./config.ts";
import { createPagesHost } from "./host.ts";
import { createPagePublisher } from "./publisher.ts";
import { PublishedPagesStore } from "./store.ts";

/** Pages bots publish to a link on this server's own pages listener: the bot tools' internal routes, the card's Unpublish,
 * and the chat's page cards, which show a published page and its link. */
export function createPublishedPages(options: {
  dataDir: string;
  pagesHost: Pick<PagesConfig, "publicUrl">;
  patch: (threadId: string, messageId: string, text: string, card: PublishedPageCard) => void;
  apps?: {
    chat: Pick<ChatApps, "publishablePage" | "showPublishedPage">;
    store: Pick<Store, "botByThread" | "groupByThread" | "messagesFor" | "patchMessage">;
  };
}) {
  const store = new PublishedPagesStore(join(options.dataDir, "published-pages.json"));
  const host = createPagesHost({ dataDir: options.dataDir, ...(options.pagesHost.publicUrl ? { publicUrl: options.pagesHost.publicUrl } : {}) });
  const apps = options.apps;
  const pageRow = (threadId: string, messageId: string) => apps?.store.messagesFor(threadId).find((message) => message.id === messageId && message.kind === "app");
  // A page card keeps its own text, the page's: only the card's link changes.
  const patch = (threadId: string, messageId: string, text: string, card: PublishedPageCard) => {
    if (pageRow(threadId, messageId)) apps!.store.patchMessage(threadId, messageId, { publishedPage: card });
    else options.patch(threadId, messageId, text, card);
  };
  const publisher = createPagePublisher({ host, store, patch });
  const appPages = apps ? {
    botOf: (threadId: string) => (apps.store.groupByThread(threadId) ? null : apps.store.botByThread(threadId) ?? null),
    page: (threadId: string, messageId: string, rev?: number) => apps.chat.publishablePage(threadId, messageId, rev),
    published: (threadId: string, messageId: string) => {
      const card = pageRow(threadId, messageId)?.publishedPage;
      return card?.state === "live" && card.pageId ? card.pageId : null;
    },
    show: (threadId: string, messageId: string, publishedPage: PublishedPageCard) =>
      (pageRow(threadId, messageId) && apps.store.patchMessage(threadId, messageId, { publishedPage }) ? messageId : null),
  } : undefined;
  return {
    store, publisher, internal: createPagesInternalRoutes(publisher), routes: createPublishedPageRoutes(publisher, appPages),
    /** publish_page's card as the page itself, inline; null when it can't be shown so (the caller posts the link). */
    show: (args: Parameters<ChatApps["showPublishedPage"]>[0]) => apps?.chat.showPublishedPage(args) ?? null,
  };
}
