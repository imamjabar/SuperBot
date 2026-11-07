import { t } from "./i18n";
import { turnNowPhrases, type LiveActivityPhrases } from "./live-activity";
import { toolService } from "./friendly-activity";
import type { TurnLive } from "@/state/turn-status";

function targetOrFile(status: unknown): string {
  if (!status || typeof status !== "object") return "";
  const s = status as { target?: unknown; file?: unknown; tool?: unknown };
  if (typeof s.target === "string" && s.target) return s.target;
  if (typeof s.file === "string" && s.file) return s.file;
  if (typeof s.tool === "string" && s.tool) return s.tool;
  return "";
}

export function jobNowPhrases(live: TurnLive): LiveActivityPhrases {
  if (!live.turnId) {
    return { phase: "job:starting", phrases: [t("chat.job.starting")] };
  }

  if (live.waiting) {
    return { phase: "job:waitingComputer", phrases: [t("chat.job.waitingComputer")] };
  }

  if (live.status?.activity === "reply") {
    return { phase: "job:writingAnswer", phrases: [t("chat.job.writingAnswer")] };
  }

  const quiet = live.status && "quiet" in live.status ? live.status.quiet : undefined;
  if (quiet && (quiet.kind === "network" || quiet.kind === "idle")) {
    const target = targetOrFile(live.status);
    return { phase: `job:waitingFor:${target}`, phrases: [t("chat.job.waitingFor", { target })] };
  }

  if (live.status && (("target" in live.status && live.status.target) || ("file" in live.status && live.status.file))) {
    const now = turnNowPhrases(live.status);
    if (now) return now;
  }

  if (live.status?.activity === "tool" && "tool" in live.status && live.status.tool) {
    const service = toolService(live.status.tool);
    if (service) {
      return { phase: `friendly:service:${service}`, phrases: [t("chat.friendly.service", { service })] };
    }
    const target = live.status.tool.replace(/^mcp__[^_]+__/, "");
    return { phase: `job:waitingFor:${target}`, phrases: [t("chat.job.waitingFor", { target })] };
  }

  const thinkingOrNull = !live.status || live.status.activity === "thinking";
  if (thinkingOrNull && live.lastStep) {
    const target = targetOrFile(live.lastStep);
    return { phase: `job:reviewing:${target}`, phrases: [t("chat.job.reviewing", { target })] };
  }

  if (thinkingOrNull) {
    return { phase: "job:planning", phrases: [t("chat.job.planning")] };
  }

  const fallback = turnNowPhrases(live.status);
  if (fallback) return fallback;

  return { phase: "job:planning", phrases: [t("chat.job.planning")] };
}
