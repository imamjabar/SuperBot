import { addressesEveryone, isStopCommand } from "../room-holds.js";
import { serverLine } from "../server-lines.js";
export function createPersonStop(deps) {
    const { store } = deps;
    async function stopThreadForPerson(botId, threadId) {
        const routines = deps.routines();
        const routine = routines?.activeBotRunForBot(botId);
        if (routine?.threadId === threadId) {
            await routines.cancelRun(routine.id);
            return;
        }
        deps.handoffs().stoppedByPerson(threadId);
        deps.markStopped(threadId);
        deps.stopGoal(threadId);
        await deps.interruptDirectThread(botId, threadId);
    }
    /** Only a message made of stop words, from a person, acts as Stop: it is recorded, and never reaches the turn it ends. With no
     * work to stop it goes to the bot as any line does ("stop" may mean the reminders it just set up), unless it is the Team map's
     * @everyone: that goes to every bot, working or not, and starts no engine. */
    async function stopOnTypedCommand(input) {
        const { botId, threadId, text, trigger, busy } = input;
        if (input.fromApp || (trigger.kind !== "user" && trigger.kind !== "owner") || !isStopCommand(text, store.bot(botId)?.name))
            return null;
        const everyone = addressesEveryone(text);
        if (!busy && !everyone && (input.row.via || deps.asking(threadId) || !deps.working(botId, threadId)))
            return null;
        if (input.personPresent)
            deps.clearUnattended(threadId);
        const message = store.appendMessage(threadId, { role: "user", kind: "text", text, ...input.row });
        const stopping = (everyone ? store.tasks(botId).map((task) => task.threadId) : [threadId]).filter((id) => (id === threadId && busy) || deps.working(botId, id));
        for (const id of stopping)
            await stopThreadForPerson(botId, id);
        if (!stopping.length)
            store.appendMessage(threadId, { role: "bot", kind: "activity", tool: { name: serverLine(deps.language(threadId), "server.stop.nothingRunning"), ok: true } });
        return { ok: true, threadId, message };
    }
    /** "Restart turn": the message already waits in the queue, ahead of all but the person's own earlier messages, and the
     * queue survives Stop, so stopping the running turn starts it over with that message. Like a typed stop, only a
     * person's own send may end the turn. */
    async function restartForPerson(botId, threadId, trigger) {
        if (trigger.kind !== "user" && trigger.kind !== "owner")
            return;
        await stopThreadForPerson(botId, threadId);
    }
    return { stopThreadForPerson, stopOnTypedCommand, restartForPerson };
}
