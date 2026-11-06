import type { HandoffView } from "./coordinator.ts";
import type { Store } from "./store.ts";

const CHECK_EVERY_MS = 60_000;
/** Minutes into a job at which the chat gets a one-line "still working" note. */
const NOTE_AT_MINUTES = [2, 5, 10, 20, 30, 45, 60, 90, 120];

interface Coordinator {
  all(): HandoffView[];
  node(id: string): HandoffView | undefined;
}

/** A bot's own background job keeps the person's chat informed while it runs, without a model call. */
export function createJobProgress(coordinator: Coordinator, store: Pick<Store, "appendMessage" | "taskByThread">, now: () => number = Date.now) {
  const noted = new Map<string, number>();
  const check = () => {
    const live = new Set<string>();
    for (const job of coordinator.all()) {
      if (job.status !== "running" || !job.parentId || job.groupId || job.reply !== "resume" || job.startedAt === undefined) continue;
      const parent = coordinator.node(job.parentId);
      if (!parent || parent.botId !== job.botId || parent.groupId || parent.threadId === job.threadId) continue;
      live.add(job.id);
      const minutes = Math.floor((now() - job.startedAt) / 60_000);
      const due = NOTE_AT_MINUTES.filter((mark) => mark <= minutes).at(-1);
      if (due === undefined || (noted.get(job.id) ?? 0) >= due) continue;
      noted.set(job.id, due);
      const title = store.taskByThread(job.botId, job.threadId)?.title ?? "Background job";
      store.appendMessage(parent.threadId, {
        role: "bot", kind: "activity",
        tool: { name: `Still working on #${title} · ${minutes} min`, ok: true },
        threadRef: { botId: job.botId, threadId: job.threadId, title },
      });
    }
    for (const id of noted.keys()) if (!live.has(id)) noted.delete(id);
  };
  const timer = setInterval(check, CHECK_EVERY_MS);
  timer.unref();
  return { check, stop: () => clearInterval(timer) };
}
