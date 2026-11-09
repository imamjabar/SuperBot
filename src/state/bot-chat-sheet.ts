import { useSyncExternalStore } from "react";
import type { BotChatTarget } from "@/lib/bot-chat";

let currentTarget: BotChatTarget | null = null;
const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

export function openBotChat(target: BotChatTarget): void {
  currentTarget = target;
  notify();
}

export function closeBotChat(): void {
  if (!currentTarget) return;
  currentTarget = null;
  notify();
}

export function useBotChatTarget(): BotChatTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => currentTarget,
    () => null,
  );
}
