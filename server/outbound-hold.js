import { DEFAULT_OUTBOUND_POLICY, OUTBOUND_DEFAULT_CAP } from "../shared/outbound.js";
import { HELD_NOTE } from "./auto-approve.js";
import { appendDecision } from "./decision-log.js";
import { buildNotification } from "./notify.js";
import { outboundCard } from "./outbound-requests.js";
import { turnWaitedOnPerson } from "./waiting-on-person.js";
/** How long a "Send on your behalf?" card waits on the person before it times out. */
export const OUTBOUND_HOLD_MS = 9 * 60_000;
/** How many sends a day go out on their own, or null when each waits on the card. At Full access a bot with no sending
 * rule of its own sends without asking, up to the default cap; a stored rule is kept exactly as set. */
function outboundDailyCap(rule, fullAccess, opaque) {
    if (fullAccess && rule === undefined)
        return { cap: OUTBOUND_DEFAULT_CAP, fullAccess: true };
    const policy = rule ?? DEFAULT_OUTBOUND_POLICY;
    return policy.policy === "allow" && !opaque ? { cap: policy.dailyCap, fullAccess: false } : null;
}
export function createOutboundHold(deps) {
    const { store, outboundRequests, outboundCounts, connectorThread, activeGroupTurnForBot, notify } = deps;
    const DATA_DIR = deps.dataDir;
    const { holdMs } = deps;
    return {
        async hold({ bot: currentSender, threadId, tool: outboundTool, calls: outboundCalls, opaque, fullAccess, active }) {
            const refuseOutbound = (text) => ({ ok: false, text });
            const allowance = outboundDailyCap(currentSender.outbound, fullAccess, opaque);
            const { app, calls, summary } = outboundCard(outboundCalls);
            const capNote = (count, full) => `SuperBot did not send this. ${currentSender.name} has reached its daily limit of ${count} outbound action${count === 1 ? "" : "s"}${full ? " at Full access" : ""}. Tell the user it was not sent, and ask them to ${full ? "set a sending rule" : "raise the limit"} under the bot's Permissions before trying again.`;
            if (allowance) {
                let today;
                try {
                    today = outboundCounts.today(currentSender.id);
                }
                catch {
                    return refuseOutbound("SuperBot did not send this: the daily allowance could not be read. Nothing was sent.");
                }
                if (today + outboundCalls.length > allowance.cap) {
                    appendDecision(DATA_DIR, {
                        threadId, botId: currentSender.id, botName: currentSender.name,
                        tool: outboundTool, summary, decision: "auto-denied", source: "outbound", rule: `${allowance.fullAccess ? "full-access-cap" : "daily-cap"}:${allowance.cap}`,
                    });
                    return refuseOutbound(capNote(allowance.cap, allowance.fullAccess));
                }
            }
            else {
                const owner = connectorThread(currentSender.id, threadId);
                const held = outboundRequests.open({ botId: currentSender.id, threadId, tool: outboundTool, timeoutMs: holdMs });
                const card = store.appendMessage(threadId, {
                    role: "bot",
                    kind: "options",
                    ...(owner?.group ? { from: { botId: currentSender.id, name: currentSender.name, color: currentSender.color } } : {}),
                    card: {
                        title: "Send on your behalf?",
                        subtitle: summary,
                        options: ["Allow", "Deny"],
                        requestId: held.requestId,
                        tool: outboundTool,
                        held: HELD_NOTE["approval.held.outbound"],
                        heldCode: "approval.held.outbound",
                        outboundRequest: { tool: outboundTool, app, calls },
                    },
                });
                appendDecision(DATA_DIR, {
                    threadId, requestId: held.requestId, botId: currentSender.id, botName: currentSender.name,
                    tool: outboundTool, summary, decision: "card-shown", source: "outbound",
                });
                if (owner?.group) {
                    if (activeGroupTurnForBot(currentSender.id)?.threadId === threadId)
                        store.setActivity(currentSender.id, "waiting-on-you");
                }
                else if (store.taskByThread(currentSender.id, threadId)?.busy) {
                    store.setTaskActivity(currentSender.id, threadId, "waiting-on-you");
                }
                notify(buildNotification("approval", currentSender, threadId, summary, { avatarUrl: currentSender.avatarUrl }));
                const answer = await held.answer;
                outboundRequests.forget(held.requestId);
                if (active()) {
                    const waiting = store.bot(currentSender.id);
                    if (owner?.group) {
                        if (activeGroupTurnForBot(currentSender.id)?.threadId === threadId && turnWaitedOnPerson(waiting))
                            store.setActivity(waiting.id, "working");
                    }
                    else if (turnWaitedOnPerson(store.taskByThread(currentSender.id, threadId))) {
                        store.setTaskActivity(currentSender.id, threadId, "working");
                    }
                }
                if (answer !== "allow") {
                    if (answer === "timeout") {
                        const stale = store.messagesFor(threadId).find((message) => message.id === card.id);
                        if (stale?.card && !stale.card.answered) {
                            store.patchMessage(threadId, stale.id, { card: { ...stale.card, answered: "unavailable", dismissed: true } });
                        }
                    }
                    return refuseOutbound(answer === "timeout"
                        ? "SuperBot did not send this: nobody answered the approval in time. Ask the user before trying again."
                        : "SuperBot did not send this: the user declined. Do not retry it; ask the user what they would like instead.");
                }
                return { ok: true, approved: true };
            }
            return { ok: true, approved: false };
        },
        reserve({ bot: fresh, threadId, tool: outboundTool, calls: outboundCalls, opaque, fullAccess, approved: outboundApproved }) {
            const refuseDispatch = (text) => {
                throw new Error(text);
            };
            const allowance = outboundDailyCap(fresh.outbound, fullAccess, opaque);
            if (allowance) {
                let reserved;
                try {
                    reserved = outboundCounts.reserve(fresh.id, outboundCalls.length, allowance.cap);
                }
                catch {
                    refuseDispatch("The daily allowance could not be saved. Nothing was sent.");
                }
                if (reserved === null)
                    refuseDispatch("This bot has reached its daily outbound limit. Nothing was sent.");
                appendDecision(DATA_DIR, { threadId, botId: fresh.id, botName: fresh.name,
                    tool: outboundTool, decision: "auto-approved", source: "outbound", rule: `${allowance.fullAccess ? "full-access" : "daily-allowance"}:${reserved}/${allowance.cap}` });
            }
            else if (!outboundApproved) {
                refuseDispatch("The outbound policy changed. Ask for approval again before sending.");
            }
        },
    };
}
