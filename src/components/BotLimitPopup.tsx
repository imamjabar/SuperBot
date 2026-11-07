import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { botRoom, closeBotLimit, useBotLimitOpen } from "@/lib/bot-limit";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { useStore } from "@/state/store";
import { MausAvatar } from "./Avatar";
import { PRIMARY_BUTTON } from "./NoticeCard";

const POPUP = "[data-bot-limit-popup]";
const TITLE = "bot-limit-title";
const BODY = "bot-limit-body";
const LAYER = "z-[80]";

export function BotLimitPopup() {
  return useBotLimitOpen() ? <BotLimitDialog onClose={closeBotLimit} /> : null;
}

function BotLimitDialog({ onClose }: { onClose: () => void }) {
  const { state } = useStore();
  const limit = state.config?.botLimit;
  const noRoom = limit !== undefined && botRoom(state) === 0;

  useEffect(() => {
    document.querySelector<HTMLElement>(`${POPUP} button`)?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(document.querySelectorAll<HTMLElement>(`${POPUP} button:not([disabled])`));
      if (!controls.length) return;
      const at = controls.indexOf(document.activeElement as HTMLElement);
      if (at === -1) {
        event.preventDefault();
        controls[0]?.focus();
        return;
      }
      if (event.shiftKey && at === 0) {
        event.preventDefault();
        controls[controls.length - 1]?.focus();
      } else if (!event.shiftKey && at === controls.length - 1) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const title = noRoom ? t("botLimit.title", { count: limit }) : t("botLimit.titleTooMany");

  return createPortal(
    <div className={cn("ui-scrim fixed inset-0 flex items-center justify-center p-4 motion-reduce:animate-none", LAYER)}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={TITLE}
        aria-describedby={BODY}
        data-bot-limit-popup=""
        className="ui-modal animate-pop-in relative flex w-[min(380px,calc(100vw-32px))] flex-col items-center border-0 px-6 pb-3 pt-8 text-center text-ink motion-reduce:animate-none"
      >
        <div aria-hidden="true"><MausAvatar color="chrome" size={52} state="idle" animated={false} /></div>
        <h2 id={TITLE} className="mt-5 text-[19px] font-semibold leading-6 tracking-[-0.012em] [text-wrap:balance]">{title}</h2>
        <p id={BODY} className="mt-1.5 text-[14px] leading-5 text-ink-secondary [text-wrap:pretty]">{t("botLimit.body")}</p>
        <button type="button" onClick={onClose} className={cn(PRIMARY_BUTTON, "mt-5 w-full justify-center")}>{t("roomCard.gotIt")}</button>
        <button type="button" onClick={onClose} aria-label={t("common.close")} className="ui-icon-button absolute end-3 top-3"><X size={16} /></button>
      </div>
    </div>,
    document.body,
  );
}
