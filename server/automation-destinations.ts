// Where an automation's runs report: the chat a routine chose, else the bot's main chat.
import type { Routine, RoutineRun } from "./routines.ts";
import { threadTitleFrom, type Store, type TaskRecord } from "./store.ts";

export interface AutomationDestinationDeps {
  store: Pick<Store, "bot" | "createTask" | "messagesFor" | "taskByThread">;
  mainThread(botId: string): string | undefined;
  runs(): readonly Pick<RoutineRun, "webhookId" | "botId" | "resultsThreadId">[];
}

function legacyResultsThread(routineName: string, task: TaskRecord): boolean {
  return task.title.endsWith(" · Results") || task.title === threadTitleFrom(`${routineName} · Results`);
}

export function createAutomationDestinations(deps: AutomationDestinationDeps) {
  const { store } = deps;
  return {
    eventChat(_run: Pick<RoutineRun, "botId" | "routineName" | "resultsThreadId" | "eventSource">): string | undefined {
      return undefined;
    },
    routine(routine: Routine, forceNew: boolean): { threadId: string; main?: true } | undefined {
      const bot = store.bot(routine.botId);
      const chosen = !forceNew && routine.resultsThreadId && bot && !bot.hidden ? store.taskByThread(bot.id, routine.resultsThreadId) : undefined;
      const main = bot && !bot.hidden ? deps.mainThread(bot.id) : undefined;
      if (chosen && !chosen.routineRunId && !(main && legacyResultsThread(routine.name, chosen))) return { threadId: chosen.threadId };
      if (main) return { threadId: main, main: true };
      return undefined;
    },
    event({ botId }: { webhookId: string; webhookName: string; botId: string }): string | undefined {
      const bot = store.bot(botId);
      if (!bot || bot.hidden) return undefined;
      return deps.mainThread(botId);
    },
  };
}
