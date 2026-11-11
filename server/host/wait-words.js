import { serverLine } from "../server-lines.js";
/** Long enough that a hand-off held by a turn about to finish says nothing. */
export const QUEUED_NOTE_AFTER_MS = 30_000;
export function createWaitWords(deps) {
    return {
        text(threadId, { first, running, ahead }) {
            const language = deps.language(threadId);
            if (!first)
                return serverLine(language, "server.memory.still", { running, ahead });
            const wait = serverLine(language, "server.memory.wait", { running, ahead });
            return wait;
        },
        began(threadId, { running, ahead }) {
            deps.held(threadId, `memory: ${running} running, ${ahead} ahead`);
        },
        changed: deps.changed,
        queued(threadId, reason) {
            if (!reason)
                return undefined;
            return serverLine(deps.language(threadId), reason === "group-turn" ? "server.queued.groupTurn" : "server.queued.capacity");
        },
    };
}
/** One line in the requester's chat once a hand-off has been held a while, naming the limit. A computer's wait and a person's
 * open card say so themselves. */
export function createQueuedNotes(deps) {
    const noted = new Set();
    return (node) => {
        if (noted.has(node.id) || node.groupId || deps.now() - (node.lastProgressAt ?? node.createdAt) < QUEUED_NOTE_AFTER_MS)
            return;
        if (deps.waitsForComputer(node) || deps.behindPerson(node))
            return;
        const parent = deps.parent(node);
        if (!parent)
            return;
        const language = deps.language(parent.threadId), bot = deps.botName(node.botId) ?? "?";
        const { busy, limit } = deps.slots(node.botId);
        const line = deps.threadBusy(node.botId, node.threadId) ? serverLine(language, "server.teammates.queued.thread", { bot })
            : busy.length >= limit ? serverLine(language, "server.teammates.queued.slots", { bot, busy: busy.length, limit })
                : deps.groupTurn(node.botId) ? serverLine(language, "server.teammates.queued.room", { bot }) : undefined;
        if (!line)
            return;
        for (const id of noted)
            if (!deps.live(id))
                noted.delete(id);
        noted.add(node.id);
        deps.post(parent, node, line);
    };
}
