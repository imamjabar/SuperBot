import type { ToolScope } from "../shared/tool-scope.ts";
import type { AppConfig } from "./config.ts";
import { DELIVER_REPORTS_REFUSAL } from "./host/self-threads.ts";
import type { Store } from "./store.ts";

/** The person's own chat with a bot (its main thread), unless the deployment turned front desk off. */
export function frontDeskTurn(cfg: AppConfig, mainThreadId: string | undefined, threadId: string): boolean {
  return cfg.features?.frontDesk !== false && threadId === mainThreadId;
}

export interface MainChat { threadId: string; title?: string }

const named = (main: MainChat) => main.title ? `its main chat "${main.title}"` : "its main chat";

export function mainChatOnly(main: MainChat) {
  return { error: `This thread is read-only: this bot takes your messages only in ${named(main)}.`, code: "main_chat_only", mainThreadId: main.threadId } as const;
}

export function newChatRefused(main: MainChat) {
  return { error: `This bot keeps one chat with you: use ${named(main)}.`, code: "main_chat_only", mainThreadId: main.threadId } as const;
}

/** Tools that make a turn slow: the computer, the browser, shells, page reads and web searches. The person's chat never holds
 * them, so it always answers fast and never takes the one desktop or browser seat a job may be using. */
export const FRONT_DESK_DENY: readonly string[] = [
  "mcp:computer:*",
  "mcp:browser:*",
  "mcp:agents:vm_exec",
  "mcp:agents:shared_computer",
  "mcp:agents:select_computer",
  "mcp:agents:web_fetch",
  "mcp:agents:web_search",
];

export function frontDeskScope(scope: ToolScope | undefined): ToolScope {
  return { ...(scope?.allow ? { allow: scope.allow } : {}), deny: [...new Set([...(scope?.deny ?? []), ...FRONT_DESK_DENY])] };
}

/** Prompt sections that only explain the tools above: a front-desk turn never holds them, so it does not pay to read them. */
export const FRONT_DESK_DROPPED_PARTS: ReadonlySet<string> = new Set(["browser", "computer", "shell", "team-computer", "plan"]);

export const FRONT_DESK_PROMPT =
  " This is your chat with the person, and it must always answer within seconds. Here you have no computer, browser, web or shell tools, but your background jobs can read web pages, so never tell the person you cannot look something up. Anything live or long (news, weather, prices, anything on the web, research, comparisons, browsing, files, commands, building) goes to a job: in the same response write one short line saying what you are doing, and call start_thread with report_back true and a complete brief that names the language the person writes in and carries every detail from this chat the job needs (names, numbers, limits, links and choices already made), because the job cannot see or search this chat; then end your turn. Its result resumes you here, and you tell the person in a few lines. Answer directly, without any tool, what you already know, what this chat says, and the current date and time from the note on their message. A question about work in progress gets its own short reply. A change or addition to a running job goes into that job: call start_thread with job set to its thread id (from its row here or list_threads) and the change as message." +
  " News, prices, weather and statuses already in this chat held when they were fetched: asked again, start a fresh job rather than repeating them, never present an earlier result as current, and if you mention one say when it was fetched." +
  " Write every reply, the short line before a job and the job's result alike, in the language of the person's latest message, even when earlier messages or notes about the person use another.";

/** Follows the person's own line in a front-desk turn: the model keeps to the language of what it read last, not of the chat so far. */
export const FRONT_DESK_LANGUAGE_NOTE = "\n\n[Reply in the language this message is written in. That overrides any language your instructions, notes about the person or the chat so far suggest, and the language of any site or topic it names.]";

interface SteerJobDeps {
  store: Pick<Store, "taskByThread" | "appendMessage">;
  canSteer(threadId: string): boolean;
  steer(threadId: string, text: string): Promise<string>;
}

/** A correction or addition for a bot's own running job, read by that job at its next step. `from`: the turn asking. */
export async function steerOwnJob(deps: SteerJobDeps, bot: { id: string; name: string }, jobThreadId: string, message: string, from: { threadId: string; deliversReports?: boolean }): Promise<{ status: number; body: Record<string, unknown> }> {
  if (from.deliversReports) return { status: 409, body: { error: DELIVER_REPORTS_REFUSAL, deliverNow: true } };
  if (jobThreadId === from.threadId) return { status: 400, body: { error: "That thread id is this chat itself, not a job. Answer the person here; list_threads shows your jobs' ids." } };
  const job = deps.store.taskByThread(bot.id, jobThreadId);
  if (!job || job.openedBy?.botId !== bot.id) return { status: 404, body: { error: "No job of yours has that thread id; use list_threads." } };
  if (!deps.canSteer(jobThreadId)) return { status: 409, body: { error: `#${job.title} is not running now, so it cannot take this. Start a new job with the full corrected brief.` } };
  const outcome = await deps.steer(jobThreadId, `[Added by you from the chat with the person while this job runs]\n\n${message}`);
  if (outcome === "refused") return { status: 409, body: { error: `#${job.title} could not take this now. Start a new job with the full corrected brief.` } };
  deps.store.appendMessage(jobThreadId, { role: "user", kind: "text", text: message, peerAsk: { botId: bot.id, name: bot.name }, aside: true, steered: true });
  return { status: 200, body: { threadId: jobThreadId, title: job.title, botId: bot.id, botName: bot.name, self: true, steered: true } };
}
