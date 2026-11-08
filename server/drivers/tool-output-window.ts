import { DEFAULT_CONTEXT_WINDOW } from "../context-budget.ts";
import type { OpenAIChatMessage } from "./openai-chat.ts";

export const DROPPED_TOOL_OUTPUT =
  "[earlier tool output dropped to keep this turn within the model's memory; in a job, keep what matters in job_notes]";
const DROPPED_CONTENT = JSON.stringify({ ok: true, result: DROPPED_TOOL_OUTPUT });
const DROP_ABOVE = 0.55;
const DROP_DOWN_TO = 0.35;
const KEPT_ROUNDS = 3;

const bytesOf = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

/** Replaces the oldest tool outputs, in place and in one batch, once `messages` pass 55% of the model's window, down to
 * 35%, so the provider's cached prefix changes rarely. The outputs of the last three tool rounds stay. Returns how many
 * it dropped. */
export function fitToolOutputs(messages: OpenAIChatMessage[], windowTokens: number | undefined): number {
  const window = windowTokens && windowTokens > 0 ? windowTokens : DEFAULT_CONTEXT_WINDOW;
  let tokens = Math.ceil(bytesOf(messages) / 4);
  if (tokens <= window * DROP_ABOVE) return 0;
  const kept = new Set(messages.filter((m) => m.role === "assistant" && m.tool_calls?.length).slice(-KEPT_ROUNDS)
    .flatMap((m) => m.tool_calls!.map((call) => call.id)));
  let dropped = 0;
  for (const message of messages) {
    if (tokens <= window * DROP_DOWN_TO) break;
    if (message.role !== "tool" || kept.has(message.tool_call_id ?? "") || message.content === DROPPED_CONTENT) continue;
    tokens -= Math.ceil((bytesOf(message.content) - bytesOf(DROPPED_CONTENT)) / 4);
    message.content = DROPPED_CONTENT;
    dropped++;
  }
  return dropped;
}
