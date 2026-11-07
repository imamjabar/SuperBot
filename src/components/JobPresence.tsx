import { Square } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { jobNowPhrases } from "@/lib/job-status";
import { useShowThreads } from "@/lib/thread-preferences";
import { useStore, type Bot, type Task } from "@/state/store";
import { openBotThread } from "@/state/thread-navigation";
import { useTurnLive } from "@/state/turn-status";
import { BotAvatar } from "./Avatar";
import { TurnPresence } from "./TurnPresence";
export function ownRunningJobs(bot: Pick<Bot, "id" | "threadId" | "tasks">): Task[] {
  return (bot.tasks ?? []).filter(
    (task) =>
      task.busy &&
      task.openedBy?.reportsBack &&
      task.openedBy.botId === bot.id &&
      task.openedBy.threadId === bot.threadId,
  );
}

export function JobPresence({ bot, className }: { bot: Bot; className?: string }) {
  const jobs = ownRunningJobs(bot);
  if (jobs.length === 0) return null;
  return (
    <div className={cn("flex flex-col gap-1.5", className)} data-job-presence="">
      {jobs.map((job) => (
        <JobLine key={job.threadId} bot={bot} job={job} />
      ))}
    </div>
  );
}

function JobLine({ bot, job }: { bot: Bot; job: Task }) {
  const { dispatch } = useStore();
  const showThreads = useShowThreads();
  const now = jobNowPhrases(useTurnLive(job.threadId));
  const open = () => openBotThread(dispatch, bot, job.threadId, showThreads);

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <div
        role="button"
        tabIndex={0}
        aria-label={t("chat.job.open", { title: job.title })}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          open();
        }}
        className="min-w-0 cursor-pointer"
      >
        <TurnPresence
          avatar={<BotAvatar bot={bot} state="working" size={20} animated={false} />}
          visible
          label={`#${job.title}`}
          phrases={now.phrases}
          phase={now.phase}
          seed={job.threadId}
          since={job.turnStartedAt ?? null}
          size={now.size}
          hover={now.hover}
        />
      </div>
      <button
        type="button"
        onClick={() => dispatch({ type: "interrupt", botId: bot.id, threadId: job.threadId })}
        aria-label={t("chat.job.stop", { title: job.title })}
        title={t("chat.job.stop", { title: job.title })}
        className="flex size-4 shrink-0 items-center justify-center rounded text-ink-tertiary hover:bg-ink/[0.06] hover:text-ink"
      >
        <Square size={10} className="fill-current" />
      </button>
    </div>
  );
}
