export function resultDelivery(work, problem) {
    if (work.status === "completed" && !problem)
        return "delivered";
    return work.status === "cancelled" || work.outcome === "stopped" || work.outcome === "interrupted" ? "interrupted" : "failed";
}
