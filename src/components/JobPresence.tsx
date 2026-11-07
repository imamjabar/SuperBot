import { cn } from "@/lib/cn";
import { friendlyNowPhrases } from "@/lib/friendly-activity";
import type { Bot, Task } from "@/state/store";
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
  const now = friendlyNowPhrases(useTurnLive(job.threadId).status);
  return (
    <TurnPresence
      avatar={<BotAvatar bot={bot} state="working" size={20} animated={false} />}
      visible
      label={`#${job.title}`}
      phrases={now.phrases}
      phase={now.phase}
      seed={job.threadId}
      since={job.turnStartedAt ?? null}
    />
  );
}
