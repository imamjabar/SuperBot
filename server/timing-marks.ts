/** Where a person's request spends its time: the send acknowledged, a background job admitted, one tool call
 * waited on, a job's result back in the chat and the final answer delivered. One log line each, no message text. */
export type TimingMark = "ack" | "job-start" | "tool" | "job-done" | "delivered";

export function timingLine(mark: TimingMark, ms: number, fields: Record<string, string | number | undefined> = {}): string {
  const extra = Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => ` ${key}=${value}`).join("");
  return `[omb-timing] ${mark} ms=${Math.max(0, Math.round(ms))}${extra}`;
}

export function logTiming(mark: TimingMark, ms: number, fields?: Record<string, string | number | undefined>): void {
  console.log(timingLine(mark, ms, fields));
}
