import { beforeEach, expect, it } from "vitest";
import { setLocale } from "@/lib/i18n";
import { homeScreenText } from "./HomeScreen";

beforeEach(() => setLocale("en"));

it("names the screen for offline or opening", () => {
  expect(homeScreenText({ screen: "offline", name: "Server" }).title).toBe("Can't reach Server right now.");
  expect(homeScreenText({ screen: "offline" }).title).toBe("Can't reach My Cloud right now.");
  expect(homeScreenText({ screen: "opening", name: "Server" }).title).toBe("Opening Server…");
  expect(homeScreenText(null).title).toBe("Opening My Cloud…");
});
