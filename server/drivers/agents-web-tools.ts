import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(["web_fetch"]);

export async function callWebTool(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const { ok, body } = await context.client.apiResponse("/api/internal/web/fetch", {
    method: "POST",
    body: JSON.stringify(args),
  });
  return ok
    ? { text: JSON.stringify(body) }
    : { text: String(body.error ?? "The page could not be read. Try again shortly."), isError: true };
}

export const WEB_TOOL_DEFINITIONS = [
  {
    name: "web_fetch",
    description:
      "Read a public web page, RSS feed or JSON/text address and get its readable text (scripts and markup removed), up to 12,000 characters per call; pass offset to read further. For news, prices or any page: one call per page, then answer; prefer a site's RSS or section page for headlines. Use this before any browser or screen for a public page. Only http(s) on the public internet; no sign-in: a page behind a sign-in or one that shows its text only through scripts comes back with needsBrowser and next, which says how to open it in the built-in browser.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        url: { type: "string", minLength: 1, maxLength: 2048, description: "The http(s) address." },
        offset: {
          type: "integer",
          minimum: 0,
          description: "Character offset to continue from (the previous call's offset + text length).",
        },
      },
      required: ["url"],
    },
  },
];
