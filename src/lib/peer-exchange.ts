import type { Message } from "@/state/store";
import { groupTranscript, type TranscriptItem } from "./activity-runs";

export interface PeerExchangeGroup {
  kind: "peer-exchange";
  id: string;
  from: { botId: string; name: string; color?: string };
  toName?: string;
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

export function extractPeerNameFromSentTool(toolName?: string): string | undefined {
  if (!toolName) return undefined;
  const match = toolName.match(/^Sent (?:directly )?to ([^·:\n]+?)(?:\s*(?:·|directly|in|:|$))/i);
  return match?.[1]?.trim() || undefined;
}

export function extractPeerNameFromResultTool(toolName?: string): string | undefined {
  if (!toolName) return undefined;
  const match = toolName.match(/^(.+?)(?:\s+(?:replied|— failed|— cancelled))/i);
  return match?.[1]?.trim() || undefined;
}

export function isOutboundPeerRequestActivity(message: Message): boolean {
  if (message.role !== "bot" || message.kind !== "activity") return false;
  if (message.roomRequest?.phase === "result") return false;
  if (message.roomRequest?.phase === "request") return true;

  const toolName = message.tool?.name ?? "";
  if (/^Resumed with /i.test(toolName) || /^Back with /i.test(toolName)) return false;
  if (/replied|— failed|— cancelled/i.test(toolName)) return false;

  const hasPeerTarget = Boolean(message.threadRef?.botId || message.comm?.withBotId || message.sentDirectly?.name);
  if (hasPeerTarget) {
    if (/^Sent (?:directly )?to /i.test(toolName)) return true;
    if (message.threadRef?.title && /^Teammate work/i.test(message.threadRef.title)) return true;
    if (message.comm?.withName) return true;
  }
  return false;
}

export function isMatchingPeerResultActivity(
  msg: Message,
  target: { requestId?: string; peerBotId?: string; peerName?: string },
): boolean {
  if (msg.role !== "bot" || msg.kind !== "activity") return false;

  if (target.requestId && msg.roomRequest?.id) {
    return msg.roomRequest.id === target.requestId && msg.roomRequest.phase === "result";
  }

  if (msg.roomRequest?.phase === "result") {
    if (target.peerBotId && (msg.from?.botId === target.peerBotId || msg.threadRef?.botId === target.peerBotId || msg.comm?.withBotId === target.peerBotId)) {
      return true;
    }
    if (target.peerName) {
      const lower = target.peerName.toLowerCase();
      if (msg.from?.name?.toLowerCase() === lower || msg.comm?.withName?.toLowerCase() === lower) {
        return true;
      }
      if (msg.tool?.name?.toLowerCase().includes(lower)) {
        return true;
      }
    }
    return true;
  }

  const toolName = msg.tool?.name ?? "";
  if (target.peerName) {
    const lower = target.peerName.toLowerCase();
    if (toolName.toLowerCase().includes(lower) && /replied|— failed|— cancelled|resultWithheld/i.test(toolName)) {
      return true;
    }
  }
  if (target.peerBotId && (msg.from?.botId === target.peerBotId || msg.threadRef?.botId === target.peerBotId)) {
    if (/replied|— failed|— cancelled/i.test(toolName)) {
      return true;
    }
  }

  return false;
}

export function isMatchingResumedActivity(
  msg: Message,
  target: { peerBotId?: string; peerName?: string },
): boolean {
  if (msg.role !== "bot" || msg.kind !== "activity") return false;
  const toolName = msg.tool?.name ?? "";
  if (/^Resumed with /i.test(toolName) || /^Back with /i.test(toolName)) return true;
  if (target.peerName && toolName.toLowerCase().includes(target.peerName.toLowerCase()) && /resumed/i.test(toolName)) {
    return true;
  }
  return false;
}

export function groupPeerExchanges(messages: readonly Message[]): PeerExchangeItem[] {
  const items: PeerExchangeItem[] = [];
  const consumedIndices = new Set<number>();
  let i = 0;

  while (i < messages.length) {
    if (consumedIndices.has(i)) {
      i++;
      continue;
    }

    const message = messages[i]!;

    if (isPeerRequestMessage(message)) {
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
      continue;
    }

    if (isOutboundPeerRequestActivity(message)) {
      const targetRequestId = message.roomRequest?.id;
      let targetPeerBotId = message.threadRef?.botId ?? message.comm?.withBotId;
      let targetPeerName = message.comm?.withName ?? message.sentDirectly?.name ?? extractPeerNameFromSentTool(message.tool?.name);

      let resultIdx: number | undefined;
      for (let j = i + 1; j < messages.length; j++) {
        if (consumedIndices.has(j)) continue;
        const candidate = messages[j]!;
        if (isMatchingPeerResultActivity(candidate, { requestId: targetRequestId, peerBotId: targetPeerBotId, peerName: targetPeerName })) {
          resultIdx = j;
          break;
        }
      }

      if (resultIdx !== undefined) {
        const resultMsg = messages[resultIdx]!;
        if (!targetPeerName) {
          targetPeerName = resultMsg.from?.name || resultMsg.comm?.withName || extractPeerNameFromResultTool(resultMsg.tool?.name);
        }
        if (!targetPeerBotId) {
          targetPeerBotId = resultMsg.from?.botId || resultMsg.threadRef?.botId || resultMsg.comm?.withBotId;
        }

        let resumedIdx: number | undefined;
        for (let k = resultIdx + 1; k < messages.length; k++) {
          if (consumedIndices.has(k)) continue;
          const candidate = messages[k]!;
          if (candidate.role === "user" || (candidate.role === "bot" && candidate.kind === "text")) {
            break;
          }
          if (isMatchingResumedActivity(candidate, { peerBotId: targetPeerBotId, peerName: targetPeerName })) {
            resumedIdx = k;
            break;
          }
        }

        const intermediateMessages: Message[] = [];
        for (let m = i + 1; m < resultIdx; m++) {
          if (consumedIndices.has(m)) continue;
          const intermediate = messages[m]!;
          if (targetRequestId && intermediate.roomRequest?.id === targetRequestId) {
            intermediateMessages.push(intermediate);
            consumedIndices.add(m);
          } else if (targetPeerBotId && intermediate.threadRef?.botId === targetPeerBotId && intermediate.role === "bot" && intermediate.kind === "activity") {
            if (!isOutboundPeerRequestActivity(intermediate)) {
              intermediateMessages.push(intermediate);
              consumedIndices.add(m);
            }
          }
        }

        const groupMessages: Message[] = [
          message,
          ...intermediateMessages,
          resultMsg,
          ...(resumedIdx !== undefined ? [messages[resumedIdx]!] : []),
        ];

        consumedIndices.add(resultIdx);
        if (resumedIdx !== undefined) {
          consumedIndices.add(resumedIdx);
        }

        const from = message.from ?? { botId: "", name: "", color: "blue" as const };
        const exchangeId = targetRequestId
          ? `peer:${targetRequestId}`
          : resultMsg.roomRequest?.id
            ? `peer:${resultMsg.roomRequest.id}`
            : `peer:${message.id}`;

        items.push({
          kind: "peer-exchange",
          id: exchangeId,
          from: { botId: from.botId, name: from.name, ...(from.color ? { color: from.color } : {}) },
          ...(targetPeerName ? { toName: targetPeerName } : {}),
          messages: groupMessages,
        });
        i++;
        continue;
      }
    }

    items.push({ kind: "message", message });
    i++;
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

