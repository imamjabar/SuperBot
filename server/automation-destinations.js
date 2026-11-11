import { threadTitleFrom } from "./store.js";
function legacyResultsThread(routineName, task) {
    return task.title.endsWith(" · Results") || task.title === threadTitleFrom(`${routineName} · Results`);
}
export function createAutomationDestinations(deps) {
    const { store } = deps;
    return {
        routine(routine, forceNew) {
            const bot = store.bot(routine.botId);
            const chosen = !forceNew && routine.resultsThreadId && bot && !bot.hidden ? store.taskByThread(bot.id, routine.resultsThreadId) : undefined;
            const main = bot && !bot.hidden ? deps.mainThread(bot.id) : undefined;
            if (chosen && !chosen.routineRunId && !(main && legacyResultsThread(routine.name, chosen)))
                return { threadId: chosen.threadId };
            if (main)
                return { threadId: main, main: true };
            return undefined;
        },
        event({ botId }) {
            const bot = store.bot(botId);
            if (!bot || bot.hidden)
                return undefined;
            return deps.mainThread(botId);
        },
    };
}
