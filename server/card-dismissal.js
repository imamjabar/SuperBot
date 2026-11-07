import { isPersistentQuestionCard, QUESTION_DISMISS_MESSAGE } from "../shared/ask-question.js";
/** Null when the respond does not close a question card. */
export function dismissQuestionCard(store, threadId, pending, body) {
    if (!isPersistentQuestionCard(pending?.card) || !(body.dismiss === true || body.message === QUESTION_DISMISS_MESSAGE))
        return null;
    if (!pending?.card)
        return { status: 404, body: { error: "this question is no longer available" } };
    if (pending.card.answered !== "answer" || pending.card.dismissed) {
        return { status: 409, body: { error: "answer this question before dismissing it" } };
    }
    store.patchMessage(threadId, pending.id, { card: { ...pending.card, dismissed: true } });
    return { status: 200, body: { ok: true, dismissed: true } };
}
export function settledCardResponse(card, behavior, message) {
    if (!card)
        return null;
    if (card.answered) {
        if (behavior === "answer") {
            const incoming = typeof message === "string" ? message.trim() : "";
            const existing = card.answeredText?.trim() || (card.answered === "answer" ? "" : card.answered.trim());
            if (incoming && existing && incoming === existing) {
                return { status: 200, body: { ok: true, outcome: "answered", alreadySettled: true } };
            }
            return { status: 409, body: { error: "this question has already been answered" } };
        }
        if (behavior === card.answered) {
            return { status: 200, body: { ok: true, outcome: behavior === "allow" ? "allowed-once" : "rejected", alreadySettled: true } };
        }
        return { status: 409, body: { error: "this request has already been answered" } };
    }
    if (card.expired) {
        return { status: 409, body: { error: "this question has expired" } };
    }
    if (card.stopped) {
        return { status: 409, body: { error: "this question is no longer open" } };
    }
    return null;
}
