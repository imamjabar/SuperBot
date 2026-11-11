// Who may open a job on itself with start_thread: work a person, or their routine, asked for in this conversation. A
// teammate's hand-off, or a job the bot opened on itself, finishes its own work: a new thread is a new request, outside
// the depth, budget and stop of the one it would serve, so a chain could grow there without end. This was the rule until
// every hand-off moved onto the runtime (Oct 12), and the tool's description still says it.
export const SELF_THREAD_REFUSAL = "Only a person's own request can open separate threads on yourself, and this turn works on a teammate's hand-off or on a thread you opened yourself. Do the work here, and end with what is still left, so whoever asked can decide. Do not retry.";
export const DELIVER_REPORTS_REFUSAL = "Your jobs have reported back, so this turn delivers: answer the person now in this chat from the reports above, one answer for each request, and say plainly what is still unverified or missing. Opening, steering or reworking your own jobs is refused on this turn. Do not retry; the person can ask for more.";
/** `deliversReports`: this turn hands the reports of the bot's own jobs back to the chat that asked. `handoff`: this turn
 * runs a teammate's hand-off. `requestLine`: the latest line from the user role in this conversation, which a bot's own
 * opening or a teammate's ask marks with `peerAsk`; a person's or a routine's line has none. */
export function selfThreadRefusal(input) {
    if (input.deliversReports)
        return DELIVER_REPORTS_REFUSAL;
    return input.handoff || input.requestLine?.peerAsk ? SELF_THREAD_REFUSAL : undefined;
}
