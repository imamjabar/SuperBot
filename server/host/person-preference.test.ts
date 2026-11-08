import { describe, expect, it, vi } from "vitest";

import { createPersonPreference } from "./person-preference.ts";

type Turn = { threadId: string; generation: string; origin: "user" | "outside" };
const scout = { id: "scout", name: "Scout" };

function make() {
  const learn = vi.fn((_from: { botId: string; botName: string }, _texts: readonly string[]) => 1);
  const preference = createPersonPreference<Turn>({
    aboutMe: { learn },
    userStarted: (turn) => turn.origin === "user",
  });
  return { preference, learn };
}

describe("whose About me a preference goes to", () => {
  it("elsewhere, the one person, only when their own message began the work", () => {
    const { preference, learn } = make();
    const target = preference.target({ threadId: "t1", generation: "g1", origin: "user" }, scout)!;
    expect(target.person).toBeUndefined();
    target.save("Replies in German");
    expect(learn).toHaveBeenCalledWith({ botId: "scout", botName: "Scout" }, ["Replies in German"]);
    expect(preference.target({ threadId: "t2", generation: "g2", origin: "outside" }, scout), "a routine, a webhook or an outside app").toBeNull();
  });
});
