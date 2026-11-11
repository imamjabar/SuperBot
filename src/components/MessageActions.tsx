import { createContext, use, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { Check, Copy, Ellipsis, Reply, TextCursor, X } from "lucide-react";
import { popoverClosesOnKey, usePopoverDismiss } from "@/hooks/use-popover-dismiss";
import { cn } from "@/lib/cn";
import { copyText, useCopyFeedback } from "@/lib/copy-text";
import { t } from "@/lib/i18n";
import { MENU_ITEM, MENU_SHEET } from "./menu-recipe";

export const ACTION_ICON = { size: 17, strokeWidth: 1.5 } as const;

export const messageActionClass =
  "inline-flex size-7 items-center justify-center rounded-full text-ink-tertiary transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent";

export type MessageMenuItem = {
  key: string;
  icon: ReactNode;
  label: string;
  onSelect: () => void;
  title?: string;
  disabled?: boolean;
  /** Offered only while the chat's turn is not running. */
  idleOnly?: boolean;
};

/** Whether the chat's turn is running, apart from the row values every message reads: a turn starting or ending
 * re-renders only the few rows that show it, not every message. */
export const ChatBusyContext = createContext(false);

export const MESSAGE_ROW = "data-message-row";

const INTERACTIVE = "a, button, input, textarea, select, summary, label, [role=button], [contenteditable=true]";
const OWN_LONG_PRESS = `${INTERACTIVE}, img, video, audio, canvas, pre, [data-reply-table]`;
const LONG_PRESS_MS = 450;
/** On a row carrying it, a touch long-press opens the message menu: styles.css stops the browser's word selection there. */
export const PRESS_MENU = "data-press-menu";
/** Set while "Select text" has the row's bubbles selected; styles.css lets the text be selected again. */
const SELECTING = "data-selecting";

/** The long-press menu of a message: Reply, Copy and Select text first, then the rest of its "…" menu. */
export type MessagePress = { onReply: () => void; copy: string };

function selectBubbles(row: HTMLElement): (() => void) | null {
  const bubbles = row.querySelectorAll("[data-chat-bubble]");
  const selection = window.getSelection();
  if (!bubbles.length || !selection) return null;
  row.setAttribute(SELECTING, "");
  const range = document.createRange();
  range.setStartBefore(bubbles[0]!);
  range.setEndAfter(bubbles[bubbles.length - 1]!);
  selection.removeAllRanges();
  selection.addRange(range);
  const stop = () => {
    row.removeAttribute(SELECTING);
    document.removeEventListener("selectionchange", ended);
    window.removeEventListener("pointerdown", away, true);
  };
  const ended = () => { if (selection.isCollapsed) stop(); };
  const away = (event: PointerEvent) => {
    if (event.target instanceof Node && row.contains(event.target)) return;
    selection.removeAllRanges();
    stop();
  };
  document.addEventListener("selectionchange", ended);
  window.addEventListener("pointerdown", away, true);
  return stop;
}

function focusVisible(target: EventTarget | null): boolean {
  try {
    return target instanceof Element && target.matches(":focus-visible");
  } catch {
    return false;
  }
}

export function MessageActions({
  side,
  forceOpen = false,
  className,
  menu: items = [],
  press: pressActions,
  children,
}: {
  side: "user" | "bot";
  forceOpen?: boolean;
  className?: string;
  menu?: MessageMenuItem[];
  press?: MessagePress;
  children?: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState<false | "more" | "press">(false);
  const stopSelecting = useRef<(() => void) | null>(null);
  const pressItems = (): MessageMenuItem[] => !pressActions ? items : [
    { key: "reply", icon: <Reply {...ACTION_ICON} />, label: t("chat.reply"), onSelect: pressActions.onReply },
    ...(pressActions.copy.trim() ? [{ key: "copy", icon: <Copy {...ACTION_ICON} />, label: t("chat.copyMessage"), onSelect: () => { void copyText(pressActions.copy); } }] : []),
    { key: "select", icon: <TextCursor {...ACTION_ICON} />, label: t("chat.selectText"), onSelect: () => {
      stopSelecting.current?.();
      setTapped(false);
      stopSelecting.current = rowRef.current ? selectBubbles(rowRef.current) : null;
    } },
    ...items.filter((item) => item.key !== "reply" && item.key !== "copy"),
  ];
  const offered = menuOpen === "press" ? pressItems() : items;
  const pressMenu = Boolean(pressActions);
  // use() may run conditionally: a closed menu has no reason to follow the turn.
  const busy = menuOpen && offered.some((item) => item.idleOnly) ? use(ChatBusyContext) : false;
  const menu = busy ? offered.filter((item) => !item.idleOnly) : offered;
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [menuAbove, setMenuAbove] = useState(false);
  const [menuFlipped, setMenuFlipped] = useState(false);
  const mirrored = side === "user";
  const shown = forceOpen || menuOpen || hovered || keyboardFocus || tapped;

  useEffect(() => {
    const row = rootRef.current?.closest<HTMLElement>(`[${MESSAGE_ROW}]`) ?? rootRef.current;
    rowRef.current = row;
    if (!row) return;
    if (pressMenu) row.setAttribute(PRESS_MENU, "");
    let press: { x: number; y: number; at: number; timer: ReturnType<typeof setTimeout> } | null = null;
    let menuFromPress = false;
    const enter = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(true); };
    const leave = (event: PointerEvent) => { if (event.pointerType !== "touch") setHovered(false); };
    const focusIn = (event: FocusEvent) => setKeyboardFocus(focusVisible(event.target));
    const focusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && row.contains(event.relatedTarget)) return;
      setKeyboardFocus(false);
    };
    const inside = (target: EventTarget | null) => target instanceof Element && Boolean(rootRef.current?.contains(target));
    const down = (event: PointerEvent) => {
      if (event.pointerType !== "touch" || inside(event.target)) return;
      if (press) clearTimeout(press.timer);
      const ownPress = event.target instanceof Element && event.target.closest(OWN_LONG_PRESS);
      const held = () => {
        setTapped(true);
        if (pressMenu && !ownPress && !row.hasAttribute(SELECTING)) {
          menuFromPress = true;
          setMenuOpen("press");
        }
      };
      press = { x: event.clientX, y: event.clientY, at: Date.now(), timer: setTimeout(held, LONG_PRESS_MS) };
    };
    const lift = (event: TouchEvent) => {
      if (!menuFromPress) return;
      menuFromPress = false;
      // The click a browser makes from this touch would land on the menu that just opened under the finger.
      event.preventDefault();
    };
    const nativeMenu = (event: Event) => {
      if (pressMenu && !row.hasAttribute(SELECTING) && !(event.target instanceof Element && event.target.closest(OWN_LONG_PRESS))
        && (event as PointerEvent).pointerType === "touch") event.preventDefault();
    };
    const move = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10) {
        clearTimeout(press.timer);
        press = null;
      }
    };
    const cancel = () => {
      if (press) clearTimeout(press.timer);
      press = null;
      menuFromPress = false;
    };
    const up = (event: PointerEvent) => {
      if (!press || event.pointerType !== "touch") return;
      clearTimeout(press.timer);
      const quick = Date.now() - press.at < LONG_PRESS_MS;
      press = null;
      if (!quick || (event.target instanceof Element && event.target.closest(INTERACTIVE))) return;
      if (window.getSelection()?.toString()) return;
      setTapped((value) => !value);
    };
    row.addEventListener("pointerenter", enter);
    row.addEventListener("pointerleave", leave);
    row.addEventListener("focusin", focusIn);
    row.addEventListener("focusout", focusOut);
    row.addEventListener("pointerdown", down);
    row.addEventListener("pointermove", move);
    row.addEventListener("pointerup", up);
    row.addEventListener("pointercancel", cancel);
    row.addEventListener("contextmenu", nativeMenu);
    row.addEventListener("touchend", lift, { passive: false });
    return () => {
      if (press) clearTimeout(press.timer);
      stopSelecting.current?.();
      row.removeAttribute(PRESS_MENU);
      row.removeEventListener("contextmenu", nativeMenu);
      row.removeEventListener("touchend", lift);
      row.removeEventListener("pointerenter", enter);
      row.removeEventListener("pointerleave", leave);
      row.removeEventListener("focusin", focusIn);
      row.removeEventListener("focusout", focusOut);
      row.removeEventListener("pointerdown", down);
      row.removeEventListener("pointermove", move);
      row.removeEventListener("pointerup", up);
      row.removeEventListener("pointercancel", cancel);
    };
  }, [pressMenu]);

  usePopoverDismiss(tapped && !menuOpen, rowRef, () => setTapped(false));
  usePopoverDismiss(menuOpen !== false, rootRef, () => {
    setMenuOpen(false);
    if (rootRef.current?.contains(document.activeElement)) moreRef.current?.focus();
  });

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const menuBox = menuRef.current?.getBoundingClientRect();
    const more = (moreRef.current ?? rootRef.current)?.getBoundingClientRect();
    if (menuBox && more) setMenuAbove(more.bottom + 4 + menuBox.height > window.innerHeight - 8 && more.top - 4 - menuBox.height > 8);
    const rowBox = rootRef.current?.getBoundingClientRect();
    if (menuBox && rowBox) {
      const rtl = getComputedStyle(rootRef.current!).direction === "rtl";
      const fitsRight = rowBox.left + menuBox.width <= window.innerWidth - 8;
      const fitsLeft = rowBox.right - menuBox.width >= 8;
      const fitsStart = rtl ? fitsLeft : fitsRight;
      const fitsEnd = rtl ? fitsRight : fitsLeft;
      setMenuFlipped(mirrored ? !fitsEnd && fitsStart : !fitsStart && fitsEnd);
    }
    menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)")?.focus();
  }, [menuOpen]);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
    if (next === null || !items.length) {
      if (event.key === "Tab") setMenuOpen(false);
      return;
    }
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative flex items-center gap-0.5 self-end pb-0.5 transition-opacity duration-150",
        "max-sm:absolute max-sm:top-full max-sm:z-10 max-sm:-mt-1 max-sm:rounded-full max-sm:bg-menu max-sm:p-0.5 max-sm:shadow-lg",
        mirrored ? "flex-row-reverse max-sm:end-0" : "max-sm:start-0",
        shown ? "opacity-100" : "pointer-events-none opacity-0",
        className,
      )}
      data-testid="message-actions"
      data-shown={shown ? "true" : undefined}
      onKeyDown={(event) => {
        if (menuOpen || forceOpen || !popoverClosesOnKey(event.nativeEvent) || !keyboardFocus) return;
        event.preventDefault();
        (document.activeElement as HTMLElement | null)?.blur();
      }}
    >
      {children}
      {menu.length > 0 && (
        <button
          ref={moreRef}
          type="button"
          onClick={() => setMenuOpen((value) => value ? false : "more")}
          aria-label={t("chat.messageActions")}
          title={t("chat.messageActions")}
          aria-haspopup="menu"
          aria-expanded={menuOpen === "more"}
          aria-controls={menuOpen === "more" ? menuId : undefined}
          className={cn(messageActionClass, menuOpen === "more" && "bg-ink/10 text-ink")}
        >
          <Ellipsis {...ACTION_ICON} aria-hidden="true" />
        </button>
      )}
      {menuOpen && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t("chat.messageActions")}
          onKeyDown={moveFocus}
          className={cn(
            "absolute z-40 min-w-52 max-w-[calc(100vw-2rem)] overflow-hidden", MENU_SHEET,
            menuAbove ? "bottom-full mb-1" : "top-full mt-1",
            mirrored !== menuFlipped ? "end-0" : "start-0",
          )}
        >
          {menu.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              title={item.title}
              onClick={() => {
                const from = menuOpen;
                setMenuOpen(false);
                item.onSelect();
                if (from === "more") moreRef.current?.focus();
              }}
              className={cn(MENU_ITEM, "text-start text-ink hover:bg-menu-hover focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60")}
            >
              <span className="flex size-4 shrink-0 items-center justify-center text-ink-secondary [&>svg]:size-4" aria-hidden="true">{item.icon}</span>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function ReplyAction({ onReply }: { onReply: () => void }) {
  return (
    <button type="button" onClick={onReply} aria-label={t("chat.replyToMessage")} title={t("chat.reply")} className={messageActionClass}>
      <Reply {...ACTION_ICON} aria-hidden="true" />
    </button>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const { state, copy } = useCopyFeedback(text);
  const label = t(state === "copied" ? "chat.copyMessageDone" : state === "failed" ? "chat.copyMessageFailed" : "chat.copyMessage");
  return (
    <button
      onClick={copy}
      aria-label={label}
      title={label}
      className={cn(
        "rounded-md p-1.5 text-ink-secondary opacity-0 transition-opacity hover:bg-raised hover:text-ink focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 touch:opacity-100",
        state !== "idle" && "opacity-100",
        className,
      )}
    >
      {state === "copied" ? <Check {...ACTION_ICON} className="text-success" /> : state === "failed" ? <X {...ACTION_ICON} className="text-danger" /> : <Copy {...ACTION_ICON} />}
    </button>
  );
}
