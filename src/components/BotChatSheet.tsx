import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight } from "lucide-react";
import { BotAvatar } from "./Avatar";
import { ChatMarkdown } from "./ChatMarkdown";
import { SIMPLE_BOT_BUBBLE } from "./chat-bubble";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { dayLabel } from "@/lib/transcript-derivations";
import { formatTime } from "@/lib/format-time";
import { api, useStore, type Bot, type Message } from "@/state/store";
import { botChatBubbles, type BotChatCluster, type BotChatTarget } from "@/lib/bot-chat";
import { closeBotChat, useBotChatTarget } from "@/state/bot-chat-sheet";
import type { MausColor } from "@/lib/mascot";

export interface BotChatTranscriptProps {
  target: BotChatTarget;
  clusters: BotChatCluster[];
  bots?: readonly Bot[];
  onClose?: () => void;
  loading?: boolean;
  error?: boolean;
}

function resolveBot(id: string, bots?: readonly Bot[]): { id: string; name: string; color: MausColor; avatarUrl?: string | null } {
  const found = bots?.find((b) => b.id === id);
  return { id, name: found?.name ?? id, color: found?.color ?? "green", avatarUrl: found?.avatarUrl };
}

export function BotChatTranscript({ target, clusters, bots = [], onClose, loading = false, error = false }: BotChatTranscriptProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
  }, [clusters]);

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const botA = resolveBot(target.botIds[0], bots);
  const botB = resolveBot(target.botIds[1], bots);
  const isEmpty = !loading && !error && clusters.length === 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("botChat.dialogAriaLabel", { a: botA.name, b: botB.name })}
      className="fixed inset-0 z-50 flex flex-col bg-app text-ink"
    >
      <div className="sticky top-4 z-10 flex justify-center pointer-events-none">
        <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-hairline/60 bg-raised/90 backdrop-blur px-3.5 py-1.5 shadow-sm text-caption font-medium">
          <div className="flex items-center gap-1.5">
            <BotAvatar bot={botA} size={20} animated={false} />
            <span>{botA.name}</span>
          </div>
          <ArrowLeftRight size={14} className="text-ink-secondary" />
          <div className="flex items-center gap-1.5">
            <BotAvatar bot={botB} size={20} animated={false} />
            <span>{botB.name}</span>
          </div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto flex flex-col min-h-full">
          {loading && (
            <div className="flex flex-1 items-center justify-center py-12 text-caption text-ink-secondary">
              {t("botChat.loading")}
            </div>
          )}

          {error && (
            <div className="flex flex-1 items-center justify-center py-12 text-caption text-danger">
              {t("botChat.failed")}
            </div>
          )}

          {isEmpty && (
            <div className="flex flex-1 items-center justify-center py-12 text-caption text-ink-secondary">
              {t("botChat.empty")}
            </div>
          )}

          {!loading && !error && clusters.length > 0 && (
            <div className="flex flex-col gap-4">
              {clusters.map((cluster, clusterIndex) => {
                const senderBot = cluster.sender.botId ? resolveBot(cluster.sender.botId, bots) : null;
                const senderName = cluster.sender.isPerson ? cluster.sender.name || t("chat.you") : senderBot?.name ?? cluster.sender.name ?? "";
                const senderColor = senderBot?.color ?? (cluster.sender.color as MausColor | undefined) ?? "green";

                return (
                  <div key={cluster.messages[0]?.id ?? clusterIndex} className="flex flex-col">
                    {cluster.separatorAt && (
                      <div className="py-3 text-center text-small text-ink-secondary">
                        {dayLabel(cluster.separatorAt)} {formatTime(cluster.separatorAt)}
                      </div>
                    )}
                    <div className="my-1 flex items-end gap-2.5">
                      <div className="mb-0.5 shrink-0">
                        <BotAvatar bot={{ name: senderName, color: senderColor, avatarUrl: senderBot?.avatarUrl }} size={24} animated={false} />
                      </div>
                      <div className="flex max-w-[85%] flex-col items-start gap-1">
                        <span className="bot-identity px-1 text-micro font-medium" data-bot-color={senderColor}>{senderName}</span>
                        {cluster.messages.map((m) => (
                          <div key={m.id} className={cn("chat-text w-fit", SIMPLE_BOT_BUBBLE)}>
                            <ChatMarkdown text={m.text ?? ""} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none pb-2">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="pointer-events-auto rounded-full border border-hairline/60 bg-raised/90 backdrop-blur px-4 py-2 text-caption font-medium shadow-sm hover:bg-raised-hover text-ink"
        >
          {t("botChat.closeChat")}
        </button>
      </div>
    </div>
  );
}

export function BotChatSheet() {
  const target = useBotChatTarget();
  const { state } = useStore();
  const [loadState, setLoadState] = useState<{ status: "loading" | "ready" | "failed"; messages: Message[] }>({
    status: "loading",
    messages: [],
  });

  const threadId = target?.threadId;

  useEffect(() => {
    if (!threadId) return;
    let active = true;
    setLoadState({ status: "loading", messages: [] });
    api<{ messages?: Message[] }>(`/api/threads/${encodeURIComponent(threadId)}/messages?limit=200`)
      .then((res) => {
        if (!active) return;
        setLoadState({ status: "ready", messages: res.messages ?? [] });
      })
      .catch(() => {
        if (!active) return;
        setLoadState({ status: "failed", messages: [] });
      });
    return () => {
      active = false;
    };
  }, [threadId]);

  const ownerBotId = target?.ownerBotId;
  const clusters = useMemo(() => botChatBubbles(loadState.messages, ownerBotId), [loadState.messages, ownerBotId]);

  if (!target) return null;

  return createPortal(
    <BotChatTranscript
      target={target}
      clusters={clusters}
      bots={state.bots}
      onClose={closeBotChat}
      loading={loadState.status === "loading"}
      error={loadState.status === "failed"}
    />,
    document.body,
  );
}
