// The agents catalog's message_person tool. The internal route behind it (server/routes/internal-threads.ts) posts into
// the bot's own main chat with the person and refuses in words a bot can repeat.
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const PERSON_TOOL_NAMES: ReadonlySet<string> = new Set(["message_person"]);

export async function callPersonTool(_name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const message = typeof args.message === "string" ? args.message.trim() : "";
  if (!message) return { text: "message_person needs message.", isError: true };
  const { ok, body } = await context.client.apiResponse("/api/internal/people/message", { method: "POST", body: JSON.stringify({ message }) });
  return ok ? { text: String(body.text ?? "Passed on.") } : { text: String(body.error ?? "The message could not be passed on. Try again shortly."), isError: true };
}

export const PERSON_TOOL_DEFINITIONS = [
  {
    name: "message_person",
    description: "Write to the person yourself, in your own main chat with them, and notify them: when you are asked to tell, greet or ping the person, or with news they would miss in this conversation. Only what you write goes, under your name.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string", maxLength: 2000, description: "Complete on its own." },
      },
      required: ["message"],
    },
  },
];
