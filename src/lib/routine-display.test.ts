import { describe, expect, it } from "vitest";

import type { RoutineRun } from "./routines";
import { routineRunLabel, routineRunTone, routineRunsOn } from "./routine-display";

describe("where a routine runs", () => {
  it("on a desktop, a routine starts while MausBot is open there", () => {
    expect(routineRunsOn({ roomGoal: false })).toEqual({
      label: "This computer", hint: "Starts while SuperBot is open here.",
    });
    expect(routineRunsOn({ roomGoal: false, runOn: "cloud" })).toEqual({
      label: "Cloud desktop", hint: "Runs the whole job on the bot's cloud desktop while SuperBot is open.",
    });
    expect(routineRunsOn({ roomGoal: false, computer: "vm" }).label).toBe("The bot's private desktop");
    expect(routineRunsOn({ roomGoal: true }).label).toBe("This computer, with the whole group");
  });

  it("never names Boat or a cloud runner", () => {
    for (const input of [{ runOn: "cloud" }, { computer: "cloud" }, {}]) {
      const { label, hint } = routineRunsOn({ roomGoal: false, ...input });
      expect(`${label} ${hint}`).not.toMatch(/boat|runner|VM\b/i);
    }
  });
});

describe("a run's status", () => {
  const run = (patch: Partial<RoutineRun>) => ({ id: "r", routineId: "x", routineName: "Brief", botId: "b", status: "failed", manual: false, scheduledFor: 0, createdAt: 0, ...patch }) as RoutineRun;

  it("reads partly done, in the waiting colour, when only a step failed after the reply came back", () => {
    expect(routineRunLabel(run({ partial: true }))).toBe("Partly done");
    expect(routineRunTone(run({ partial: true }))).toBe("text-warning");
    expect(routineRunLabel(run({ partial: true, retried: "failed" }))).toBe("Retried after a failure · Partly done");
  });

  it("still reads failed, in red, for any other failure", () => {
    expect(routineRunLabel(run({}))).toBe("Failed");
    expect(routineRunTone(run({}))).toBe("text-danger");
    expect(routineRunLabel(run({ status: "completed", partial: true }))).toBe("Completed");
  });
});
