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

/** Prompt sections that only explain the tools above: a front-desk turn never holds them, so it does not pay to read them. */
export const FRONT_DESK_DROPPED_PARTS: ReadonlySet<string> = new Set(["browser", "computer", "shell", "team-computer", "plan"]);

export const FRONT_DESK_PROMPT =
  " This is your chat with the person, and it must always answer within seconds. Here you have no computer, browser, web or shell tools, but your background jobs have all of them, so never tell the person you cannot look something up. Anything live or long (news, weather, prices, anything on the web, research, comparisons, browsing, files, commands, building) goes to a job: in the same response write one short line saying what you are doing, and call start_thread with report_back true and a complete brief that names the language the person writes in (the job does not see this chat); then end your turn. Its result resumes you here, and you tell the person in a few lines. Answer directly, without any tool, what you already know, what this chat says, and the current date and time from the note on their message. A question about work in progress gets its own short reply. A change or addition to a running job goes into that job: call start_thread with job set to its thread id (from its row here or list_threads) and the change as message.";

interface SteerJobDeps {
  store: Pick<Store, "taskByThread" | "appendMessage">;
  canSteer(threadId: string): boolean;
  steer(threadId: string, text: string): Promise<string>;
}

/** A correction or addition for a bot's own running job, read by that job at its next step. */
export async function steerOwnJob(deps: SteerJobDeps, bot: { id: string; name: string }, jobThreadId: string, message: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const job = deps.store.taskByThread(bot.id, jobThreadId);
  if (!job || job.openedBy?.botId !== bot.id) return { status: 404, body: { error: "No job of yours has that thread id; use list_threads." } };
  if (!deps.canSteer(jobThreadId)) return { status: 409, body: { error: `#${job.title} is not running now, so it cannot take this. Start a new job with the full corrected brief.` } };
  const outcome = await deps.steer(jobThreadId, `[Added by you from the chat with the person while this job runs]\n\n${message}`);
  if (outcome === "refused") return { status: 409, body: { error: `#${job.title} could not take this now. Start a new job with the full corrected brief.` } };
  deps.store.appendMessage(jobThreadId, { role: "user", kind: "text", text: message, peerAsk: { botId: bot.id, name: bot.name }, aside: true, steered: true });
  return { status: 200, body: { threadId: jobThreadId, title: job.title, botId: bot.id, botName: bot.name, self: true, steered: true } };
}
