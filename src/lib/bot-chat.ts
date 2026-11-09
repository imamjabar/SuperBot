import type { Message } from "@/state/store";

export interface BotChatTarget {
  threadId: string;
  botIds: [string, string];
  ownerBotId?: string;
}

export interface BotChatSender {
  botId?: string;
  name?: string;
  color?: string;
  isPerson?: boolean;
}

export interface BotChatCluster {
  sender: BotChatSender;
  messages: Message[];
  separatorAt?: number;
}

export function botChatTarget(
  message: Message,
  chatBotId: string,
  groups: readonly { id: string; threadId: string }[],
): BotChatTarget | null {
  if (message.comm) {
    const group = groups.find((g) => g.id === message.comm!.groupId);
    const threadId = message.comm.threadId ?? group?.threadId;
    if (!threadId) return null;
    const first = message.from?.botId ?? chatBotId;
    const second = message.comm.withBotId;
    const botIds: [string, string] = first === second ? [first, chatBotId] : [first, second];
    return { threadId, botIds };
  }
  if (message.threadRef) {
    const fromBotId = message.from?.botId;
    if (fromBotId && fromBotId !== message.threadRef.botId) {
      return {
        threadId: message.threadRef.threadId,
        botIds: [fromBotId, message.threadRef.botId],
        ownerBotId: message.threadRef.botId,
      };
    }
    return null;
  }
  return null;
}

function senderFor(message: Message, ownerBotId?: string): BotChatSender {
  if (message.from?.botId) {
    return {
      botId: message.from.botId,
      name: message.from.name,
      color: message.from.color,
      isPerson: false,
    };
  }
  if (message.role === "user") {
    return {
      isPerson: true,
      name: message.sender?.name,
    };
  }
  if (ownerBotId) {
    return {
      botId: ownerBotId,
      isPerson: false,
    };
  }
  return {
    botId: "bot",
    isPerson: false,
  };
}

function sameSender(a: BotChatSender, b: BotChatSender): boolean {
  if (a.isPerson || b.isPerson) {
    return Boolean(a.isPerson && b.isPerson);
  }
  return a.botId === b.botId;
}

const GAP_MS = 30 * 60 * 1000;

function dayOf(at: number): number {
  const d = new Date(at);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
}

export function botChatBubbles(messages: Message[], ownerBotId?: string): BotChatCluster[] {
  const textRows = messages.filter(
    (m) => m.kind === "text" && typeof m.text === "string" && m.text.trim().length > 0 && !m.reaction,
  );
  if (textRows.length === 0) return [];

  const clusters: BotChatCluster[] = [];
  let currentCluster: BotChatCluster | null = null;
  let previousRow: Message | null = null;

  for (const row of textRows) {
    const sender = senderFor(row, ownerBotId);
    const needSeparator =
      previousRow !== null &&
      (row.at - previousRow.at > GAP_MS || dayOf(row.at) !== dayOf(previousRow.at));

    if (!currentCluster || !sameSender(currentCluster.sender, sender) || needSeparator) {
      currentCluster = {
        sender,
        messages: [row],
        ...(needSeparator ? { separatorAt: row.at } : {}),
      };
      clusters.push(currentCluster);
    } else {
      currentCluster.messages.push(row);
    }
    previousRow = row;
  }

  return clusters;
}
