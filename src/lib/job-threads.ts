export interface JobThreadLike {
  title?: string;
  openedBy?: {
    botId?: string;
    reportsBack?: boolean;
  } | null;
}

export function isOwnJobThread(
  task: JobThreadLike | null | undefined,
  botId: string | null | undefined,
): boolean {
  if (!task) return false;
  return Boolean(task.openedBy?.reportsBack && botId && task.openedBy.botId === botId);
}
