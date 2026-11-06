// A message sent while a bot works: steer it into the running turn, queue it for after that turn, or
// restart the turn with it. The server's direct-busy admission applies it.

export const FOLLOW_UPS = ["steer", "queue", "restart"] as const;
export type FollowUp = (typeof FOLLOW_UPS)[number];
/** undefined when absent, null when present but not a follow-up. */
export function parseFollowUp(value: unknown): FollowUp | null | undefined {
  if (value === undefined || value === null) return undefined;
  return FOLLOW_UPS.find((followUp) => followUp === value) ?? null;
}

