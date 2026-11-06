import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import type { Message } from "@/state/store";

export function botFirstName(fullName?: string): string {
  if (!fullName) return "";
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0]!;
}

export function PeerExchangeRow({
  fromName,
  toName,
  messages,
  count,
  forceOpen = false,
  children,
}: {
  fromName: string;
  toName?: string;
  messages?: readonly Message[];
  count?: number;
  forceOpen?: boolean;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(forceOpen);
  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  const effectiveCount = count ?? messages?.length ?? 0;
  const sourceName = fromName || t("chat.assistant");
  const targetName = toName || t("chat.assistant");
  const fromFirst = botFirstName(sourceName) || sourceName;
  const toFirst = botFirstName(targetName) || targetName;
  const label =
    effectiveCount === 1
      ? t("chat.peerExchange.collapsedOne", { from: fromFirst, to: toFirst, count: effectiveCount })
      : t("chat.peerExchange.collapsed", { from: fromFirst, to: toFirst, count: effectiveCount });

  const titleKey = open
    ? effectiveCount === 1
      ? "chat.peerExchange.titleHideOne"
      : "chat.peerExchange.titleHide"
    : effectiveCount === 1
      ? "chat.peerExchange.titleShowOne"
      : "chat.peerExchange.titleShow";
  const buttonTitle = t(titleKey, { from: sourceName, to: targetName, count: effectiveCount });

  return (
    <div className="my-1 flex flex-col gap-1.5" data-testid="peer-exchange-row">
      <div className="flex min-w-0 justify-start">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          title={buttonTitle}
          aria-label={buttonTitle}
          className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-hairline/40 bg-panel/60 px-3 py-1 text-[12px] text-ink-secondary transition-colors hover:bg-control"
          data-testid="peer-exchange-toggle"
        >
          <ChevronRight size={12} className={cn("shrink-0 text-ink-tertiary transition-transform", open && "rotate-90")} />
          <span className="min-w-0 truncate font-medium">{label}</span>
        </button>
      </div>
      {open && children && (
        <div
          className="flex flex-col gap-2 border-l-2 border-hairline/60 pl-3 opacity-90"
          data-testid="peer-exchange-messages"
        >
          {children}
        </div>
      )}
    </div>
  );
}
