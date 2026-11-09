import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import type { Bot, Message } from "@/state/store";
import { botChatBubbles, type BotChatTarget } from "@/lib/bot-chat";
import { BotChatTranscript } from "./BotChatSheet";

setLocale("en");

const target: BotChatTarget = {
  threadId: "thread-123",
  botIds: ["chief", "buyer"],
  ownerBotId: "buyer",
};

const bots = [
  { id: "chief", name: "Chief", color: "blue", threadId: "t-chief", title: "", description: "" },
  { id: "buyer", name: "Buyer", color: "green", threadId: "t-buyer", title: "", description: "" },
] as Bot[];

const messages: Message[] = [
  {
    id: "m1",
    role: "bot",
    kind: "text",
    at: 1_700_000_000_000,
    text: "Can you review these prices?",
    from: { botId: "chief", name: "Chief", color: "blue" },
  },
  {
    id: "m2",
    role: "bot",
    kind: "text",
    at: 1_700_000_060_000,
    text: "On it, checking now.",
    from: { botId: "buyer", name: "Buyer", color: "green" },
  },
];

describe("BotChatTranscript", () => {
  it("shows both bots, each sender's name in its colour, the messages and Close Chat, with nothing to type into", () => {
    const html = renderToStaticMarkup(createElement(BotChatTranscript, { target, clusters: botChatBubbles(messages, target.ownerBotId), bots, onClose: () => {} }));
    expect(html).toContain('aria-label="Conversation between Chief and Buyer"');
    expect(html).toContain('data-bot-color="blue"');
    expect(html).toContain('data-bot-color="green"');
    expect(html).toContain("Can you review these prices?");
    expect(html).toContain("On it, checking now.");
    expect(html).toContain("Close Chat");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("<input");
  });
});
