export const SIDE_LANE_TITLE = "Quick replies";

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
  if (task.title === SIDE_LANE_TITLE) return true;
  return Boolean(task.openedBy?.reportsBack && botId && task.openedBy.botId === botId);
}
