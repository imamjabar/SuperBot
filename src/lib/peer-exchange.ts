import type { Message } from "@/state/store";
import { groupTranscript, type TranscriptItem } from "./activity-runs";

export interface PeerExchangeGroup {
  kind: "peer-exchange";
  id: string;
  from: { botId: string; name: string; color?: string };
  messages: Message[];
}

export type PeerExchangeItem =
  | { kind: "message"; message: Message }
  | PeerExchangeGroup;

export function isPeerRequestMessage(message: Message): boolean {
  return (
    message.role === "bot" &&
    message.kind === "text" &&
    message.roomRequest?.phase === "request" &&
    Boolean(message.from?.name)
  );
}

export function groupPeerExchanges(messages: readonly Message[]): PeerExchangeItem[] {
  const items: PeerExchangeItem[] = [];
  let i = 0;
  while (i < messages.length) {
    const message = messages[i]!;
    if (!isPeerRequestMessage(message)) {
      items.push({ kind: "message", message });
      i++;
      continue;
    }

    const from = message.from!;
    const exchangeId = message.roomRequest?.id
      ? `peer:${message.roomRequest.id}`
      : `peer:${message.id}`;

    const groupMessages: Message[] = [];
    const inboxMessages: Message[] = [];

    while (i < messages.length) {
      const current = messages[i]!;
      if (current.role === "user") {
        break;
      }
      if (current !== message && isPeerRequestMessage(current)) {
        break;
      }

      if (current.inbox) {
        inboxMessages.push(current);
      } else {
        groupMessages.push(current);
      }

      i++;

      if (current.turnTerminal === true) {
        break;
      }
    }

    if (groupMessages.length > 0) {
      items.push({
        kind: "peer-exchange",
        id: exchangeId,
        from: { botId: from.botId, name: from.name, color: from.color },
        messages: groupMessages,
      });
    }

    for (const inboxMsg of inboxMessages) {
      items.push({ kind: "message", message: inboxMsg });
    }
  }

  return items;
}

export function groupTranscriptWithPeerExchanges(
  messages: readonly Message[],
  groupFn: (msgs: Message[]) => TranscriptItem[] = groupTranscript,
): (TranscriptItem | PeerExchangeGroup)[] {
  const peerItems = groupPeerExchanges(messages);
  const hasGroup = peerItems.some((item) => item.kind === "peer-exchange");
  if (!hasGroup) return groupFn(messages as Message[]);

  const items: (TranscriptItem | PeerExchangeGroup)[] = [];
  let currentSlice: Message[] = [];

  const flush = () => {
    if (currentSlice.length > 0) {
      items.push(...groupFn(currentSlice));
      currentSlice = [];
    }
  };

  for (const item of peerItems) {
    if (item.kind === "peer-exchange") {
      flush();
      items.push(item);
    } else {
      currentSlice.push(item.message);
    }
  }
  flush();

  return items;
}

