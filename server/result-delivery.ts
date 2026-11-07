import type { MainChatDelivery } from "../shared/wire.ts";
import type { HandoffView } from "./coordinator.ts";

export function resultDelivery(work: Pick<HandoffView, "status" | "outcome">, problem: string | undefined): MainChatDelivery {
  if (work.status === "completed" && !problem) return "delivered";
  return work.status === "cancelled" || work.outcome === "stopped" || work.outcome === "interrupted" ? "interrupted" : "failed";
}
