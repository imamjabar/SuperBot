import { describe, expect, it } from "vitest";
import { steerOwnJob } from "./front-desk.ts";
import { DELIVER_REPORTS_REFUSAL } from "./host/self-threads.ts";

const bot = { id: "bot", name: "Maus" };

function deps() {
  const steered: string[] = [];
  return {
    steered,
    deps: {
      store: {
        taskByThread: (_botId: string, threadId: string) => (threadId === "job" ? { title: "VPS research", openedBy: { botId: "bot", name: "Maus", at: 0, reportsBack: true } } : undefined),
        appendMessage: (threadId: string) => { steered.push(threadId); return {}; },
      } as never,
      canSteer: () => true,
      steer: async () => "steered",
    },
  };
}

describe("steerOwnJob", () => {
  it("steers a running job from the chat it reports to", async () => {
    const { deps: d, steered } = deps();
    const result = await steerOwnJob(d, bot, "job", "Prefer Singapore", { threadId: "chat" });
    expect(result.status).toBe(200);
    expect(steered).toEqual(["job"]);
  });

  it("refuses the chat's own thread as a job, pointing back to answering here", async () => {
    const { deps: d, steered } = deps();
    const result = await steerOwnJob(d, bot, "chat", "Rework Hetzner", { threadId: "chat" });
    expect(result.status).toBe(400);
    expect(String(result.body.error)).toMatch(/this chat itself, not a job/);
    expect(steered).toEqual([]);
  });

  it("refuses any steer on a turn delivering its jobs' reports, telling it to answer now", async () => {
    const { deps: d, steered } = deps();
    const result = await steerOwnJob(d, bot, "job", "Rework Hetzner", { threadId: "chat", deliversReports: true });
    expect(result).toEqual({ status: 409, body: { error: DELIVER_REPORTS_REFUSAL } });
    expect(steered).toEqual([]);
  });
});
