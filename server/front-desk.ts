import type { ToolScope } from "../shared/tool-scope.ts";
import type { AppConfig } from "./config.ts";
import { SIDE_LANE_TITLE } from "./side-replies.ts";
import type { Store } from "./store.ts";

/** The person's own chat with a bot (its main thread) and its quick-reply lane, when the deployment turned front desk on. */
export function frontDeskTurn(cfg: AppConfig, store: Pick<Store, "taskByThread">, mainThreadId: string | undefined, botId: string, threadId: string): boolean {
  return cfg.features?.frontDesk === true && (threadId === mainThreadId || store.taskByThread(botId, threadId)?.title === SIDE_LANE_TITLE);
}

/** Tools that make a turn slow: the computer, the browser and shells. The person's chat never holds them, so it always answers fast. */
export const FRONT_DESK_DENY: readonly string[] = [
  "mcp:computer:*",
  "mcp:browser:*",
  "mcp:agents:vm_exec",
  "mcp:agents:shared_computer",
];

export function frontDeskScope(scope: ToolScope | undefined): ToolScope {
  return { ...(scope?.allow ? { allow: scope.allow } : {}), deny: [...new Set([...(scope?.deny ?? []), ...FRONT_DESK_DENY])] };
}

export const FRONT_DESK_PROMPT =
  " This is your chat with the person, and it must always answer within seconds. Here you have no computer, browser or shell tools: anything that needs them (looking something up on the web, research, comparisons, browsing, files, commands, building) runs as a background job. For that, reply first in one short line that you are on it, then call start_thread with report_back true and a complete brief (the job does not see this chat), and end your turn. Its result resumes you here, and you tell the person in a few lines. Answer directly only what you already know or can answer from this chat, your memory or your other tools. A follow-up about work in progress gets its own short reply; for a change to a running job, start a new job with the full corrected brief and say so.";
