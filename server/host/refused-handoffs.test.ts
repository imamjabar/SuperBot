import { describe, expect, it } from "vitest";

import type { RosterMember } from "../peer-roster.ts";
import { createRefusedHandoffs } from "./refused-handoffs.ts";

const B = { people: ["mara@acme.test"] };
const rooms: RosterMember = { id: "rooms", name: "Rooms", visibility: B };
const hours: RosterMember = { id: "hours", name: "Staff Hours", visibility: B };
const books: RosterMember = { id: "books", name: "Bookkeeping", visibility: "admins" };
const listed: RosterMember = { ...rooms, id: "listed", name: "Listed", peers: ["hours"] };
const mausbot: RosterMember = { id: "maus", name: "MausBot", visibility: { people: ["olive@acme.test"] }, defaultBot: { person: "olive@acme.test" } };
const bots = [rooms, hours, books, listed, mausbot];

function fixture(over: { run?: boolean } = {}) {
  const refused = createRefusedHandoffs({
    bots: () => bots,
    runOf: () => (over.run === false ? undefined : { routineId: "r1", botId: "rooms" }),
    language: () => undefined,
  });
  return { refused };
}

describe("a routine's refused hand-off", () => {
  it("makes the run say so, once, whether the bot was named by id or by name", () => {
    for (const named of ["books", "Bookkeeping", "@bookkeeping"]) {
      const { refused } = fixture();
      refused.settled("t", rooms, [named], 403);
      expect(refused.take("t")).toBe("Rooms couldn't hand this to Bookkeeping, because they're shared with different people. Nothing was sent.");
      expect(refused.take("t")).toBeNull();
    }
  });

  it("says why when the bot's own list of peers is what refused it", () => {
    const { refused } = fixture();
    refused.settled("t", listed, ["Rooms"], 403);
    expect(refused.take("t")).toBe("Listed couldn't hand this to Rooms, because it isn't set to talk to it. Nothing was sent.");
  });

  it("stays quiet about anything that wasn't the refusal: a hand-off that went through, a typo, the bot itself, someone's own MausBot", () => {
    for (const [named, status] of [["Staff Hours", 202], ["Staff Hours", 403], ["Bookkeeper", 403], ["Rooms", 403], ["MausBot", 403], ["books", 202]] as const) {
      const { refused } = fixture();
      refused.settled("t", rooms, [named], status);
      expect(refused.take("t"), named).toBeNull();
    }
  });

  it("forgets a refusal once the same bot was reached after all", () => {
    const { refused } = fixture();
    refused.settled("t", rooms, ["Bookkeeping"], 403);
    refused.settled("t", rooms, ["books"], 202);
    expect(refused.take("t")).toBeNull();
  });

  it("keeps nothing for a conversation that isn't a routine's run", () => {
    const { refused } = fixture({ run: false });
    refused.settled("t", rooms, ["Bookkeeping"], 403);
    expect(refused.take("t")).toBeNull();
  });

});
