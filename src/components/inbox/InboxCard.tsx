import { useEffect, useState } from "react";
import { Check, CornerUpLeft, Inbox } from "lucide-react";
import type { InboxRow, InboxView } from "../../../shared/inbox";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import type { CardResponse } from "@/lib/card-answer";
import { doneInboxRow, readInboxRow, refreshInbox, useInboxView } from "@/state/inbox";
import { openThread, useStore } from "@/state/store";
import { pendingApprovals, PendingApprovalActions } from "../PendingApproval";
import { ASK_QUIET_ANSWER, AskChoices, AskError } from "../AskCard";
import { ELEVATED_CARD } from "../elevated";
import { InboxRowItem } from "./InboxRow";
import { asMessage } from "./inbox-answer";
import { answerThread, askOf, CARD_ROWS, choiceResponse, choicesOf, closeResponse, rowsIn, tabCounts, type QuickAction } from "./inbox-view";
import { accessRequestWords } from "../bot-access/access-card";

/** Most choices a question shows as buttons on the card; one with more opens in the inbox. */
const CARD_CHOICES = 3;

/** The card goes under one line of the inbox conversation only: the line the inbox says it sits under. */
export function InboxCardSlot({ threadId, messageId }: { threadId: string; messageId: string }) {
  const view = useInboxView();
  if (!view || view.threadId !== threadId || view.anchor !== messageId) return null;
  return <InboxCard view={view} />;
}

function Answers({ row, view, onAnswer, onOpen }: {
  row: InboxRow;
  view: InboxView;
  onAnswer: (row: InboxRow, response: CardResponse, failed?: () => void) => void;
  onOpen: (row: InboxRow) => void;
}) {
  const { state } = useStore();
  const [sending, setSending] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const ask = askOf(row);
  const choices = choicesOf(row);
  const asker = row.from.botId ? state.bots.find((bot) => bot.id === row.from.botId) : undefined;

  if (ask === "approval") {
    const pending = view.threadId ? pendingApprovals([asMessage(row)])[0] : undefined;
    return pending ? (
      <div className="flex flex-wrap items-center justify-end gap-2">
        <PendingApprovalActions part="primary" tag="inbox" pending={pending} threadId={view.threadId!} bot={asker} onCancelTurn={() => {}} />
      </div>
    ) : null;
  }
  const pick = (choice: string) => {
    setFailed(false);
    setSending(choice);
    onAnswer(row, choiceResponse(row, choice), () => { setSending(null); setFailed(true); });
  };
  return (
    <div>
      {choices.length > 0 && choices.length <= CARD_CHOICES && (
        <AskChoices choices={choices.map((label) => ({ label }))} label={accessRequestWords(row.card)?.question ?? row.card?.subtitle ?? row.text} sending={sending} tag="data-inbox-choice" onPick={pick} />
      )}
      <div className="mt-1.5 flex justify-end">
        <button type="button" data-inbox-action="reply" onClick={() => onOpen(row)} className={ASK_QUIET_ANSWER}><CornerUpLeft size={15} aria-hidden="true" />{t("chat.reply")}</button>
      </div>
      {failed && <AskError>{t("ask.error")}</AskError>}
    </div>
  );
}

export function InboxCard({ view }: { view: InboxView }) {
  const { state, dispatch } = useStore();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const openInChat = (row: InboxRow) => {
    readInboxRow(row);
    const target = row.origin ? { botId: row.origin.botId, threadId: row.origin.threadId, messageId: row.origin.messageId }
      : view.threadId && view.botId ? { botId: view.botId, threadId: view.threadId, messageId: row.id } : null;
    if (!target) return;
    openThread(dispatch, { botId: target.botId, threadId: target.threadId }, state);
    if (target.messageId) dispatch({ type: "focusMessage", threadId: target.threadId, messageId: target.messageId });
  };

  const answer = (row: InboxRow, response: CardResponse, failed?: () => void) => {
    const threadId = answerThread(view, row);
    if (!threadId || !row.card?.requestId) return;
    readInboxRow(row);
    dispatch({
      type: "decideRequest",
      threadId,
      requestId: row.card.requestId,
      behavior: response.behavior,
      ...(response.message ? { message: response.message } : {}),
      onError: () => { failed?.(); void refreshInbox(); },
    });
  };

  const run = (row: InboxRow, action: QuickAction) => {
    if (action === "allow" || action === "deny") answer(row, { behavior: action });
    else if (action === "close") answer(row, closeResponse(row));
    else if (action === "done") doneInboxRow(row);
    else openInChat(row);
  };

  const counts = tabCounts(view);
  const rows = rowsIn(view, "needs-you").slice(0, CARD_ROWS);
  const shell = cn("my-1 w-full max-w-[560px] rounded-[24px]", ELEVATED_CARD);
  if (!rows.length) {
    return (
      <section data-inbox-card="caught-up" aria-label={t("inbox.card.caughtUp")} className={cn(shell, "flex items-center gap-2 px-4 py-2 text-small text-ink-secondary")}>
        <Check size={14} aria-hidden="true" className="shrink-0 text-success" />
        <span className="min-w-0 flex-1 truncate">{t("inbox.card.caughtUp")}{counts.info > 0 && ` · ${t("inbox.card.forInfo", { count: counts.info })}`}</span>
      </section>
    );
  }
  return (
    <section data-inbox-card="open" aria-label={t("inbox.card.summary", { needs: counts["needs-you"], info: counts.info })} className={cn(shell, "overflow-hidden")}>
      <header className="flex items-center gap-2 px-4 pb-1 pt-3">
        <Inbox size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />
        <span className="min-w-0 flex-1 truncate text-small font-medium text-ink-secondary">{t("inbox.card.summary", { needs: counts["needs-you"], info: counts.info })}</span>
      </header>
      {rows.map((row) => (
        <div key={row.id} className="border-t border-ink/[0.06] first-of-type:border-t-0">
          <InboxRowItem row={row} now={now} onOpen={openInChat} onAction={run} inCard />
          {row.id !== view.anchor && <div className="px-4 pb-3 ps-[2.625rem]"><Answers row={row} view={view} onAnswer={answer} onOpen={openInChat} /></div>}
        </div>
      ))}
    </section>
  );
}
