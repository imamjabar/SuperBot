import { useSyncExternalStore } from "react";

import type { ConfigStatus } from "@/state/config-status";

/** Each bot keeps one chat with the person, and every other thread is the bot's own work, read-only. The server decides where it holds and enforces it. */
export function oneMainChatEnabled(config: Pick<ConfigStatus, "oneMainChat"> | null | undefined): boolean {
  return config?.oneMainChat === true;
}

let enabled = false;
const listeners = new Set<() => void>();

export function setOneMainChat(on: boolean): void {
  if (on === enabled) return;
  enabled = on;
  for (const listener of listeners) listener();
}

export function oneMainChat(): boolean {
  return enabled;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useOneMainChat(): boolean {
  return useSyncExternalStore(subscribe, oneMainChat, oneMainChat);
}

/** The person may write here: always, unless one main chat is on and this is not the bot's main thread. */
export function personWritesHere(bot: { threadId: string; mainThreadId?: string }, oneChat: boolean): boolean {
  return !oneChat || !bot.mainThreadId || bot.threadId === bot.mainThreadId;
}
