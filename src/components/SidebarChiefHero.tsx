import { Crown, MoreHorizontal } from "lucide-react";
import { useContext } from "react";
import { t } from "@/lib/i18n";
import { stateForBot } from "@/lib/mascot";
import { StoreContext, type Bot } from "@/state/store";
import { BotAvatar } from "./Avatar";
import { openBotContextMenu, useVisibleMessages, type MenuState } from "./Sidebar";
import { sidebarBotStatus } from "./SidebarBotActivity";
import { useBotUnread } from "./unread-notice";

export function ChiefHero({ bot, selected, onOpen, onMenu }: { bot: Bot; selected: boolean; onOpen: () => void; onMenu: (menu: MenuState) => void }) {
  const ctx = useContext(StoreContext);
  const visible = useVisibleMessages(bot);
  const { working } = sidebarBotStatus(bot, ctx?.state?.pendingQueued ?? {});
  const { unread, noticing } = useBotUnread(bot);

  return (
    <div className="relative mb-2 flex flex-col items-center pb-2 pt-1">
      <button
        type="button"
        data-sidebar-hero={bot.id}
        data-sidebar-bot-row={bot.id}
        aria-current={selected ? "page" : undefined}
        onClick={onOpen}
        onContextMenu={(event) => openBotContextMenu(onMenu, bot.id, event)}
        className="flex flex-col items-center gap-1.5 rounded-2xl px-6 py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
      >
        <span className="relative flex">
          <BotAvatar bot={bot} state={stateForBot({ ...bot, messages: visible })} size={88} motion="none" motionKey={0} animated={working || noticing || Boolean(bot.busy)} />
          <span className="absolute -bottom-0.5 -right-0.5 flex rounded-full border-2 border-app bg-raised p-1">
            <Crown size={13} strokeWidth={2.25} className="text-accent" aria-hidden="true" />
          </span>
          {working && (
            <span
              data-testid="working-dot"
              className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-app bg-success"
            />
          )}
          {unread && !working && (
            <span
              data-testid="unread-dot"
              aria-label={t("task.unread")}
              className="absolute -right-0.5 -top-0.5 size-3 rounded-full border-2 border-app bg-accent"
            />
          )}
        </span>
        <span className="text-[17px] font-semibold leading-6 text-ink">{bot.name}</span>
        <span className="text-small leading-4 text-ink-secondary">{t("sidebar.bot.chiefOfStaff")}</span>
      </button>
      <button type="button" data-bot-actions={bot.id} aria-label={t("sidebar.bot.actions", { name: bot.name })} title={t("sidebar.bot.actions", { name: bot.name })} aria-haspopup="menu"
        onClick={(event) => { const rect = event.currentTarget.getBoundingClientRect(); onMenu({ botId: bot.id, x: rect.left, y: rect.bottom }); }}
        className="absolute right-1 top-1 flex size-8 items-center justify-center rounded-full text-ink-secondary hover:bg-raised hover:text-ink"><MoreHorizontal size={16} /></button>
    </div>
  );
}
