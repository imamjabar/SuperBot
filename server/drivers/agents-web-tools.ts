import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";
import type { Json } from "./agents-client.ts";

export const WEB_SEARCH_TOOL = "web_search";
export const WEB_TOOL_NAMES: ReadonlySet<string> = new Set(["web_fetch", WEB_SEARCH_TOOL]);

export async function callWebTool(name: string, args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const search = name === WEB_SEARCH_TOOL;
  const { ok, body } = await context.client.apiResponse(search ? "/api/internal/web/search" : "/api/internal/web/fetch", {
    method: "POST",
    body: JSON.stringify(args),
  });
  return ok
    ? { text: JSON.stringify(body) }
    : { text: String(body.error ?? (search ? "Web search did not answer. Try again shortly." : "The page could not be read. Try again shortly.")), isError: true };
}

export const WEB_TOOL_DEFINITIONS = [
  {
    name: "web_fetch",
    description:
      "Read a public web page, RSS feed or JSON/text address: readable text plus the page's embedded data (structured data such as a job posting's date and salary, or app data), so script-built pages usually read fine. Up to 12,000 characters per call; pass offset to read on, or find to get only the passages around some words in a long page or JSON feed. One call per page; prefer a site's RSS or section page for headlines. Use this before any browser or screen. Public http(s) only, no sign-in: with neither text nor data it returns needsBrowser and next, which says how to open it in the built-in browser.",
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
        find: {
          type: "string",
          minLength: 2,
          maxLength: 200,
          description:
            "Words to look for; returns only the passages around them (up to 20), not the whole page. Separate alternatives with ' | '.",
        },
      },
      required: ["url"],
    },
  },
  {
    name: WEB_SEARCH_TOOL,
    description:
      "Search the web when you do not know the address: returns titles, addresses and snippets. Then read the pages you need with web_fetch. Use a connected app first when one holds the data, and this before any browser or screen. Put the current year in queries about recent events.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string", minLength: 2, maxLength: 400, description: "What to search for." },
        numResults: { type: "integer", minimum: 1, maximum: 10, description: "How many results, 1 to 10. Defaults to 5." },
        allowed_domains: {
          type: "array", maxItems: 20, items: { type: "string" },
          description: "Only results from these domains (subdomains match). Do not combine with blocked_domains.",
        },
        blocked_domains: {
          type: "array", maxItems: 20, items: { type: "string" },
          description: "Never results from these domains. Do not combine with allowed_domains.",
        },
      },
      required: ["query"],
    },
  },
];
