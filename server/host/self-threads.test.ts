import { describe, expect, it } from "vitest";
import { DELIVER_REPORTS_REFUSAL, SELF_THREAD_REFUSAL, selfThreadRefusal } from "./self-threads.ts";

describe("selfThreadRefusal", () => {
  it("lets a person's own request, or a routine's, open threads on the bot", () => {
    expect(selfThreadRefusal({ handoff: false, requestLine: {} })).toBeUndefined();
    expect(selfThreadRefusal({ handoff: false, requestLine: undefined })).toBeUndefined();
  });

  it("refuses a teammate's hand-off, and a thread the bot opened on itself", () => {
    expect(selfThreadRefusal({ handoff: true, requestLine: {} })).toBe(SELF_THREAD_REFUSAL);
    expect(selfThreadRefusal({ handoff: false, requestLine: { peerAsk: { botId: "post" } } })).toBe(SELF_THREAD_REFUSAL);
  });

  it("tells a turn delivering its jobs' reports to answer now, even after a person's request", () => {
    expect(selfThreadRefusal({ deliversReports: true, handoff: true, requestLine: {} })).toBe(DELIVER_REPORTS_REFUSAL);
    expect(selfThreadRefusal({ deliversReports: true, handoff: false, requestLine: {} })).toBe(DELIVER_REPORTS_REFUSAL);
  });
});
