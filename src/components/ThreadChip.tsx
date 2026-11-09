import { ChevronRight, MessagesSquare } from "lucide-react";
import { openThread, useStore, type Message } from "@/state/store";
import { botChatTarget } from "@/lib/bot-chat";
import { openBotChat } from "@/state/bot-chat-sheet";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/cn";
import { BotAvatar } from "./Avatar";
import { HandoffReply } from "./HandoffReply";

export function ThreadChip({ message }: { message: Message }) {
  const { state, dispatch } = useStore();
  const ref = message.threadRef;
  const tool = message.tool;
  if (!ref || !tool) return null;
  const target = botChatTarget(message, state.selectedId ?? ref.botId, state.groups);
  const avatarId = ref.botId === state.selectedId && message.from ? message.from.botId : ref.botId;
  const bot = state.bots.find((candidate) => candidate.id === avatarId);
  const direct = message.sentDirectly;
  const label = !direct ? tool.name
    : direct.room ? t("chat.sentDirectlyNotInRoom", { name: direct.name, room: direct.room }) : t("chat.sentDirectly", { name: direct.name });
  return (
    <HandoffReply message={message}>
      <button
        type="button"
        data-thread-chip={ref.threadId}
        onClick={() => target ? openBotChat(target) : openThread(dispatch, ref, state)}
        title={t("chat.openThread", { title: ref.title })}
        className={cn("ui-pill", tool.ok === false && "text-danger")}
      >
        {bot ? <BotAvatar bot={bot} state="happy" size={16} animated={false} /> : <MessagesSquare size={13} aria-hidden="true" />}
        <span className="max-w-[480px] truncate">{label}</span>
        <ChevronRight size={13} />
      </button>
    </HandoffReply>
  );
}
