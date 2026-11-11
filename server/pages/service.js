import { join } from "node:path";
import { createPagesInternalRoutes, createPublishedPageRoutes } from "../routes/published-pages.js";
import { createPagesHost } from "./host.js";
import { createPagePublisher } from "./publisher.js";
import { PublishedPagesStore } from "./store.js";
/** Pages bots publish to a link on this server's own pages listener: the bot tools' internal routes, the card's Unpublish,
 * and the chat's page cards, which show a published page and its link. */
export function createPublishedPages(options) {
    const store = new PublishedPagesStore(join(options.dataDir, "published-pages.json"));
    const host = createPagesHost({ dataDir: options.dataDir, ...(options.pagesHost.publicUrl ? { publicUrl: options.pagesHost.publicUrl } : {}) });
    const apps = options.apps;
    const pageRow = (threadId, messageId) => apps?.store.messagesFor(threadId).find((message) => message.id === messageId && message.kind === "app");
    // A page card keeps its own text, the page's: only the card's link changes.
    const patch = (threadId, messageId, text, card) => {
        if (pageRow(threadId, messageId))
            apps.store.patchMessage(threadId, messageId, { publishedPage: card });
        else
            options.patch(threadId, messageId, text, card);
    };
    const publisher = createPagePublisher({ host, store, patch });
    const appPages = apps ? {
        botOf: (threadId) => (apps.store.groupByThread(threadId) ? null : apps.store.botByThread(threadId) ?? null),
        page: (threadId, messageId, rev) => apps.chat.publishablePage(threadId, messageId, rev),
        published: (threadId, messageId) => {
            const card = pageRow(threadId, messageId)?.publishedPage;
            return card?.state === "live" && card.pageId ? card.pageId : null;
        },
        show: (threadId, messageId, publishedPage) => (pageRow(threadId, messageId) && apps.store.patchMessage(threadId, messageId, { publishedPage }) ? messageId : null),
    } : undefined;
    return {
        store, publisher, internal: createPagesInternalRoutes(publisher), routes: createPublishedPageRoutes(publisher, appPages),
        /** publish_page's card as the page itself, inline; null when it can't be shown so (the caller posts the link). */
        show: (args) => apps?.chat.showPublishedPage(args) ?? null,
    };
}
