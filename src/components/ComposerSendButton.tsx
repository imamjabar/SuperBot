import type { CSSProperties } from "react";
import { ArrowUp, Clock } from "lucide-react";

import { cn } from "@/lib/cn";

export function ComposerSendButton({ compact, waits, label, title, look, disabled, onSend }: {
  compact: boolean;
  /** The message will wait for the running turn: a clock on a quiet button instead of the bot's colour. */
  waits: boolean;
  label: string;
  title: string;
  look: { className: string; style?: CSSProperties };
  disabled: boolean;
  onSend: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSend}
      disabled={disabled}
      aria-label={label}
      title={title}
      style={waits ? undefined : look.style}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full disabled:cursor-default",
        compact ? "size-7 animate-[slot-fade-in_120ms_ease-out]" : "size-8",
        waits ? "bg-raised text-ink-secondary hover:bg-raised-hover" : look.className,
      )}
    >
      {waits ? <Clock size={compact ? 14 : 15} /> : <ArrowUp size={16} strokeWidth={1.75} absoluteStrokeWidth />}
    </button>
  );
}
