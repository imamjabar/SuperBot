import { describe, expect, it } from "vitest";
import { schedulePlace } from "./RoutineScheduleNote";

describe("where a routine runs, said where it is scheduled", () => {
  it("a server runs it while that server runs", () => {
    expect(schedulePlace({ local: false })).toEqual({ kind: "server" });
  });

  it("This computer runs routines when computer is awake", () => {
    expect(schedulePlace({ local: true })).toEqual({ kind: "local" });
  });
});
