import { describe, expect, it } from "vitest";
import { schedulePlace } from "./RoutineScheduleNote";

describe("where a routine runs, said where it is scheduled", () => {
  it("My Cloud runs it 24/7; another server, a browser or companion mode while that server runs", () => {
    expect(schedulePlace({ cloudHome: true, local: false })).toEqual({ kind: "cloud" });
    expect(schedulePlace({ cloudHome: false, local: false })).toEqual({ kind: "server" });
  });

  it("This computer runs routines when computer is awake", () => {
    expect(schedulePlace({ cloudHome: false, local: true })).toEqual({ kind: "local" });
  });
});
