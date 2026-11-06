import type { Message, Store } from "./store.ts";

export const SIDE_LANE_TITLE = "Quick replies";
const CONTEXT_MESSAGES = 12;
const CONTEXT_CHARS = 600;

type Sender = Message["sender"];
type Reply = { ok: true; threadId: string; message: Message };

export interface SideReplyInput {
  botId: string;
  threadId: string;
  text: string;
  replyToId?: string;
  sendId?: string;
  sender?: Sender;
  start: (laneId: string, context: string) => Promise<unknown>;
}

function contextFor(messages: readonly Message[], botName: string): string {
  const lines = messages
    .filter((message) => message.kind === "text" && (message.role === "user" || message.role === "bot") && message.text?.trim())
    .slice(-CONTEXT_MESSAGES)
    .map((message) => `${message.role === "user" ? "Person" : botName}: ${message.text!.replace(/\s+/g, " ").trim().slice(0, CONTEXT_CHARS)}`);
  return `[You are still working on an earlier request in your chat with the person; that work goes on by itself and its result is posted there when it is done. This is a side conversation so you can answer the person right away. Answer only their new message below, briefly and in their language. Do not start, restart or redo the earlier work. The chat so far, oldest first:\n${lines.join("\n")}]\n\n`;
}

/** A person's message to a bot that is busy is answered at once from a side lane, and the answer lands in their chat;
 * the running turn is never interrupted or steered. */
export function createSideReplies(store: Store) {
  const mirrors = new Map<string, string>();

  store.onChange((change) => {
    if (change.type === "message") {
      const target = mirrors.get(change.threadId);
      const { message } = change;
      if (!target || message.role !== "bot" || message.kind !== "text" || !message.text?.trim()) return;
      const botId = store.botByThread(change.threadId)?.id;
      store.appendMessage(target, { role: "bot", kind: "text", text: message.text });
      if (botId) store.patchTask(botId, target, { unread: true });
      return;
    }
    if (change.type === "bot") {
      for (const lane of store.tasks(change.botId)) {
        if (lane.unread && mirrors.has(lane.threadId)) store.patchTask(change.botId, lane.threadId, { unread: false });
      }
    }
  });

  const laneFor = (botId: string): string | undefined => {
    const existing = store.tasks(botId).find((task) => task.title === SIDE_LANE_TITLE && task.archivedAt === undefined && !task.routineRunId);
    return (existing ?? store.createTask(botId, SIDE_LANE_TITLE, false))?.threadId;
  };

  return {
    /** Whether a message to this busy thread is answered from the side lane: every thread but the lane itself. */
    takes(botId: string, threadId: string): boolean {
      return store.taskByThread(botId, threadId)?.title !== SIDE_LANE_TITLE;
    },
    async answer(input: SideReplyInput): Promise<Reply> {
      const bot = store.bot(input.botId);
      const laneId = laneFor(input.botId);
      if (!bot || !laneId) throw Object.assign(new Error("no such bot"), { status: 404 });
      const context = contextFor(store.messagesFor(input.threadId), bot.name);
      const message = store.appendMessage(input.threadId, {
        role: "user", kind: "text", text: input.text, replyToId: input.replyToId, sendId: input.sendId, sender: input.sender,
      });
      store.setTaskAskedAt(input.botId, input.threadId, message.at);
      mirrors.set(laneId, input.threadId);
      await input.start(laneId, context);
      store.setTaskAskedAt(input.botId, input.threadId, Date.now());
      return { ok: true, threadId: input.threadId, message };
    },
  };
}
