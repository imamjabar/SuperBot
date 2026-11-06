import { describe, expect, it } from "vitest";

import { parseFollowUp } from "./follow-up.ts";

describe("a message sent while a bot works", () => {

  it("reads the wire value: absent, one of the three, or refused", () => {
    expect(parseFollowUp(undefined)).toBeUndefined();
    expect(parseFollowUp(null)).toBeUndefined();
    for (const value of ["steer", "queue", "restart"]) expect(parseFollowUp(value)).toBe(value);
    for (const value of ["auto", "", true, 1, "Queue"]) expect(parseFollowUp(value)).toBeNull();
  });
});
