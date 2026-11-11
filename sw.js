self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  const { title, body, tag, botId, threadId, icon } = payload;
  if (!title) return;

  // Safari revokes a push subscription whose pushes show no notification, so with the app open (which shows its own)
  // a throwaway one under its own tag is shown and closed at once.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      if (!clients.some((client) => client.visibilityState === "visible")) {
        return self.registration.showNotification(title, { body, tag: tag || (botId ? `openmausbot:${botId}` : undefined), icon, data: { botId, threadId } });
      }
      await self.registration.showNotification(title, { body, tag: "openmausbot:open-app", silent: true });
      for (const shown of await self.registration.getNotifications({ tag: "openmausbot:open-app" })) shown.close();
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const { botId, threadId } = data;

  const targetUrl = botId && threadId
    ? `/?open-bot=${encodeURIComponent(botId)}&open-thread=${encodeURIComponent(threadId)}`
    : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          try {
            await client.focus();
          } catch {
            // Browser security may reject unprompted focus.
          }
          client.postMessage({ type: "open-notification", botId, threadId });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    }),
  );
});
