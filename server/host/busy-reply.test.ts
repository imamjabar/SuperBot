import { describe, expect, it } from "vitest";
import type { Message } from "../store.ts";
import { busyReplyFallback, createBusyReplies } from "./busy-reply.ts";

function chat(write: (prompt: string, signal: AbortSignal) => Promise<string> | undefined, timeoutMs?: number) {
  const rows: Array<Partial<Message>> = [
    { id: "m1", role: "user", kind: "text", text: "Compare VPS prices in Singapore" },
    { id: "m2", role: "bot", kind: "text", text: "On it, comparing three providers." },
  ];
  const prompts: string[] = [];
  const replies = createBusyReplies({
    store: {
      messagesFor: () => rows as Message[],
      appendMessage: (_threadId: string, row: Partial<Message>) => { const added = { id: `r${rows.length}`, at: Date.now(), ...row }; rows.push(added); return added as Message; },
    } as never,
    write: (_botId, prompt, signal) => { prompts.push(prompt); return write(prompt, signal); },
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  const ask = (handedTo: "steered" | "queued" = "steered", requestMessageId?: string) =>
    replies.reply({ botId: "maus", botName: "MausBot", threadId: "main", text: "jam berapa sekarang?", handedTo, ...(requestMessageId ? { requestMessageId } : {}) });
  return { rows, prompts, ask };
}

describe("a reply while the main chat is busy", () => {
  it("posts the model's short answer in the main chat, quoting the person's message, with the chat as context", async () => {
    const c = chat(async () => "  Sekarang jam 21:15.  ");
    const reply = await c.ask("steered", "ask-1");
    expect(reply).toMatchObject({ role: "bot", kind: "text", text: "Sekarang jam 21:15.", requestMessageId: "ask-1" });
    expect(c.rows.filter((row) => row.role === "bot")).toHaveLength(2);
    expect(c.prompts[0]).toContain("Person: Compare VPS prices in Singapore");
    expect(c.prompts[0]).toContain("jam berapa sekarang?");
    expect(c.prompts[0]).toContain("it has been passed to the work in progress");
  });

  it("says what happens to a queued message when it acknowledges", async () => {
    const c = chat(async () => "Noted.");
    await c.ask("queued");
    expect(c.prompts[0]).toContain("you will take it up as soon as the current step is done");
    expect(c.rows.at(-1)!.requestMessageId).toBeUndefined();
  });

  type Write = (prompt: string, signal: AbortSignal) => Promise<string> | undefined;
  const failingWrites: Array<[string, Write]> = [
    ["no model can write it", (): Promise<string> | undefined => undefined],
    ["the call fails", async (): Promise<string> => { throw new Error("model down"); }],
    ["the model writes nothing", async (): Promise<string> => "   "],
  ];
  it.each(failingWrites)("still acknowledges in the main chat when %s", async (_case, write) => {
    const c = chat(write);
    expect((await c.ask("queued")).text).toBe(busyReplyFallback("queued"));
  });

  it("acknowledges within its time limit when the model is slow", async () => {
    const c = chat((_prompt, signal) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason))), 50);
    const started = Date.now();
    expect((await c.ask("steered")).text).toBe(busyReplyFallback("steered"));
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});
