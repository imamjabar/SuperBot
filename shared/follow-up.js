// A message sent while a bot works: steer it into the running turn, queue it for after that turn, or
// restart the turn with it. The server's direct-busy admission applies it.
export const FOLLOW_UPS = ["steer", "queue", "restart"];
/** undefined when absent, null when present but not a follow-up. */
export function parseFollowUp(value) {
    if (value === undefined || value === null)
        return undefined;
    return FOLLOW_UPS.find((followUp) => followUp === value) ?? null;
}
