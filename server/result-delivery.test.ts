import { describe, expect, it } from "vitest";
import type { HandoffView } from "./coordinator.ts";
import { resultDelivery } from "./result-delivery.ts";
import type { Outcome } from "./runtime/types.ts";

describe("resultDelivery", () => {
  it("is delivered only for completed work whose result reached the chat", () => {
    expect(resultDelivery({ status: "completed", outcome: "done" }, undefined)).toBe("delivered");
    expect(resultDelivery({ status: "completed", outcome: "done" }, "The addressed agent no longer exists")).toBe("failed");
  });

  it.each<[string, Pick<HandoffView, "status" | "outcome">]>([
    ["the person's Stop", { status: "cancelled", outcome: "stopped" }],
    ["a restart that cut it", { status: "failed", outcome: "interrupted" }],
    ["a cancel without an outcome", { status: "cancelled" }],
  ])("is interrupted after %s, never delivered", (_why, work) => {
    expect(resultDelivery(work, undefined)).toBe("interrupted");
  });

  it.each<Outcome>(["provider_error", "stalled", "budget", "denied", "expired", "refused"])("is failed after %s", (outcome) => {
    expect(resultDelivery({ status: "failed", outcome }, undefined)).toBe("failed");
  });
});
