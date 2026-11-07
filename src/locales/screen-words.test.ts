import { describe, expect, it } from "vitest";

import { FINAL_ACTIONS, SECRET_FIELDS } from "../../server/saved-steps/screen-words";
import { allLocaleChoices } from "./index";

describe("the words saved steps look for on another app's screen", () => {
  it("cover every language the app ships, so a new language never lets a final action or a secret field through", () => {
    const shipped = allLocaleChoices.map(({ code }) => code).sort();
    expect(shipped.length).toBeGreaterThanOrEqual(15);
    expect(Object.keys(FINAL_ACTIONS).sort()).toEqual(shipped);
    expect(Object.keys(SECRET_FIELDS).sort()).toEqual(shipped);
  });
});
