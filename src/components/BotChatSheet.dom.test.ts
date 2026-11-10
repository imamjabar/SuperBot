// @vitest-environment happy-dom
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { botChatBubbles, type BotChatTarget } from "@/lib/bot-chat";
import type { Message } from "@/state/store";
import { BotChatTranscript } from "./BotChatSheet";

setLocale("en");

const target: BotChatTarget = { threadId: "thread-123", botIds: ["chief", "buyer"], ownerBotId: "buyer" };
const line = (id: string, at: number, botId: string): Message => ({ id, role: "bot", kind: "text", at, text: `line ${id}`, from: { botId, name: botId, color: "blue" } });

describe("the bot-to-bot sheet", () => {
  let root: Root, host: HTMLElement;
  const tops = new WeakMap<Element, number>();
  const saved = { height: Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollHeight"), top: Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop") };
  const draw = (messages: Message[], clusters = botChatBubbles(messages, "buyer")) => {
    flushSync(() => root.render(createElement(BotChatTranscript, { target, clusters })));
    return clusters;
  };
  const scroller = () => host.ownerDocument.querySelector<HTMLElement>("[role=dialog] .overflow-y-auto")!;

  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", { configurable: true, get: () => 900 });
    Object.defineProperty(Element.prototype, "scrollTop", { configurable: true, get() { return tops.get(this) ?? 0; }, set(value: number) { tops.set(this, value); } });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(() => {
    root.unmount();
    host.remove();
    if (saved.height) Object.defineProperty(HTMLElement.prototype, "scrollHeight", saved.height);
    if (saved.top) Object.defineProperty(Element.prototype, "scrollTop", saved.top);
  });

  it("opens at the newest message, keeps a reader's place on a re-render, and follows newly loaded messages", () => {
    const first = draw([line("m1", 1_000, "chief"), line("m2", 2_000, "buyer")]);
    expect(scroller().scrollTop).toBe(900);
    scroller().scrollTop = 120;
    draw([], first);
    expect(scroller().scrollTop).toBe(120);
    draw([line("m1", 1_000, "chief"), line("m2", 2_000, "buyer"), line("m3", 3_000, "chief")]);
    expect(scroller().scrollTop).toBe(900);
  });
});
