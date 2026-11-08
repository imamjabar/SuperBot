import type { HTMLAttributes, ReactNode } from "react";
import { Check, ChevronLeft } from "lucide-react";
import { cn } from "@/lib/cn";

export const SHEET = "rounded-2xl border-[0.5px] border-ink/10 bg-app text-ink";
export const SCREEN = "flex flex-col gap-5 px-6 pb-6 pt-5";
export const CLOSE = "flex size-8 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink motion-reduce:transition-none";
export const PRIMARY = "ui-button ui-button-primary ui-button-pill";
export const QUIET = "ui-button ui-button-pill";
export const PRIMARY_WIDE = `${PRIMARY} ui-button-lg w-full`;
export const QUIET_WIDE = `${QUIET} ui-button-lg w-full`;
export const ACTIONS = "flex flex-wrap items-center justify-end gap-2";
export const LINK = "rounded-sm text-small font-medium text-ink underline decoration-ink/30 underline-offset-[3px] hover:decoration-ink disabled:opacity-50";
export const FIELD = "h-9 w-full rounded-[10px] border border-ink/15 bg-transparent px-3 text-body-sm text-ink outline-none transition-[border-color] duration-150 placeholder:text-ink-tertiary disabled:opacity-60 motion-reduce:transition-none";
const TAG = "inline-flex min-h-5 items-center gap-1 rounded-full bg-ink/[0.06] px-2 text-caption font-medium leading-4 text-ink-secondary";

export function Heading({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 pe-10">
      <h2 id="cloud-add-title" tabIndex={-1} className="text-[17px] font-medium leading-6 tracking-[-0.008em] text-ink outline-none! [text-wrap:balance]">{title}</h2>
      {sub && <p className="text-body-sm leading-5 text-ink-secondary [text-wrap:pretty]">{sub}</p>}
    </div>
  );
}

export function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-ms-1.5 inline-flex items-center gap-0.5 self-start rounded-full py-1 pe-2.5 ps-1 text-small leading-[18px] text-ink-secondary transition-colors hover:bg-ink/[0.06] hover:text-ink motion-reduce:transition-none"
    >
      <ChevronLeft size={16} strokeWidth={1.5} aria-hidden="true" className="rtl:-scale-x-100" />{label}
    </button>
  );
}

export function Tag({ children, className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return <span {...props} className={cn(TAG, className)}>{children}</span>;
}

export function StepMark({ state, size = 20 }: { state: "done" | "now" | "next"; size?: number }) {
  if (state === "done") {
    return (
      <span aria-hidden="true" style={{ width: size, height: size }} className="grid shrink-0 place-items-center rounded-full bg-ink text-app">
        <Check size={Math.round(size * 0.6)} strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size }}
      className={cn("block shrink-0 rounded-full border-[1.5px]", state === "now" ? "animate-spin border-ink/15 border-t-ink motion-reduce:animate-none" : "border-ink/20")}
    />
  );
}

export function Checklist({ items, label }: { label?: string; items: Array<{ key: string; state: "done" | "now" | "next"; title: string; detail?: string | null }> }) {
  return (
    <ol aria-label={label} className="flex flex-col gap-0.5">
      {items.map(item => (
        <li
          key={item.key}
          aria-current={item.state === "now" ? "step" : undefined}
          className={cn("grid grid-cols-[20px_minmax(0,1fr)] items-start gap-3 rounded-[12px] px-3 py-2.5", item.state === "now" && "bg-ink/[0.04]")}
        >
          <StepMark state={item.state} />
          <span className="min-w-0">
            <span className={cn("block text-body-sm leading-5", item.state === "next" ? "text-ink-secondary" : "text-ink")}>{item.title}</span>
            {item.detail && <span className="block break-words text-small leading-[18px] text-ink-secondary">{item.detail}</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const percent = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1 overflow-hidden rounded-full bg-ink/10">
      <div className="h-full rounded-full bg-ink transition-[width] duration-500 ease-out motion-reduce:transition-none" style={{ width: `${percent}%` }} />
    </div>
  );
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className={cn(TAG, "min-h-6 self-start px-2.5")}>
      <Check size={13} strokeWidth={2.2} aria-hidden="true" />{children}
    </span>
  );
}

