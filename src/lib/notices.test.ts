import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, type OnboardingStatus } from "@/lib/onboarding";
import { withTourReset } from "@/lib/guided-tour";
import { DESKTOP_NOTICES } from "../../electron/desktop-prefs.mjs";
import { dismissNotice, GROK_MOVE_NOTICE, launchNotice, markLaunchNotice, nextNotice, noticeSeen,
  NOTICES, SIMPLE_MODE_NOTICE, TWO_PLACES_NOTICE, type NoticeFacts } from "./notices";

let storage: Map<string, string>, session: Map<string, string>;
beforeEach(() => {
  storage = new Map(); session = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

const record = (hintsSeen: string[] = []): OnboardingStatus => ({ ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen });
const facts = (grok: boolean | null = false, simple: boolean | null = false, two: boolean | null = false): NoticeFacts =>
  ({ [GROK_MOVE_NOTICE]: grok, [SIMPLE_MODE_NOTICE]: simple, [TWO_PLACES_NOTICE]: two });
const none = () => false;

it("the Move from Grok Bot popup goes ahead of everything, and holds the queue while it waits", () => {
  const all = (grok: boolean | null) => facts(grok, true, true);
  expect(nextNotice(all(true), none)).toBe(GROK_MOVE_NOTICE);
  expect(nextNotice(all(null), none)).toBeNull();
  expect(nextNotice(all(false), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(all(true), none, SIMPLE_MODE_NOTICE), "not in a launch another notice took").toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(all(true), none, GROK_MOVE_NOTICE), "a reload of the launch it took").toBe(GROK_MOVE_NOTICE);
  expect(GROK_MOVE_NOTICE).toBe("grok-move-2026-11");
});

it("is one queue: the Simple mode popup first, then bots in two places", () => {
  expect(NOTICES).toEqual([GROK_MOVE_NOTICE, SIMPLE_MODE_NOTICE, TWO_PLACES_NOTICE]);
  expect(nextNotice(facts(false, true, true), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(false, null, true), none), "nothing shows while the Simple mode popup waits").toBeNull();
  expect(nextNotice(facts(false, true, true), id => id === SIMPLE_MODE_NOTICE)).toBe(TWO_PLACES_NOTICE);
  expect(nextNotice(facts(false, false, true), none)).toBe(TWO_PLACES_NOTICE);
  expect(nextNotice(facts(false, false, false), none)).toBeNull();
});

it("Boat's credit offer and the Grok Bot move are ones the desktop keeps for its every page, as What's new is", () => {
  expect(DESKTOP_NOTICES).toEqual(["whats-new-2026-11", "boat-credit-2026-11", GROK_MOVE_NOTICE]);
});

it("one notice a launch", () => {
  const both = facts(false, true, true);
  expect(nextNotice(both, none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(both, id => id === SIMPLE_MODE_NOTICE, SIMPLE_MODE_NOTICE), "simple mode closed: nothing else this launch").toBeNull();
  expect(nextNotice(both, none, SIMPLE_MODE_NOTICE), "a reload while it is up shows it again").toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(both, id => id === SIMPLE_MODE_NOTICE), "the next launch").toBe(TWO_PLACES_NOTICE);
});

it("a launch keeps the notice it showed first for the window's session; storage that throws keeps it for the page", () => {
  expect(launchNotice()).toBeNull();
  markLaunchNotice(SIMPLE_MODE_NOTICE); markLaunchNotice(TWO_PLACES_NOTICE);
  expect(launchNotice()).toBe(SIMPLE_MODE_NOTICE);
  expect(session.get("omb.launch.notice")).toBe(SIMPLE_MODE_NOTICE);
  session.set("omb.launch.notice", "something-else");
  expect(launchNotice(), "only a notice of the list").toBeNull();
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  markLaunchNotice(TWO_PLACES_NOTICE);
  expect(launchNotice()).toBe(TWO_PLACES_NOTICE);
});

it("waits while an earlier notice's answer is unknown, so a later one never shows first", () => {
  expect(nextNotice(facts(false, null, true), none)).toBeNull();
});

it("a dismissal holds on this device at once and in the workspace record for good", () => {
  const seen = record(["tour.done"]);
  expect(dismissNotice(seen, GROK_MOVE_NOTICE)).toEqual({ onboarding: { hintsSeen: ["tour.done", GROK_MOVE_NOTICE] } });
  expect(storage.get(GROK_MOVE_NOTICE)).toBe("1");
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(true);
  storage.clear();
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(false);
  expect(noticeSeen(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBe(true);
  expect(dismissNotice(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBeNull();
  expect(withTourReset(record([GROK_MOVE_NOTICE, "tour.done"]))).toEqual([GROK_MOVE_NOTICE]);
});

it("browser storage that throws still leaves the workspace record in charge", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  expect(noticeSeen(record(), GROK_MOVE_NOTICE)).toBe(false);
  expect(noticeSeen(record([GROK_MOVE_NOTICE]), GROK_MOVE_NOTICE)).toBe(true);
  expect(dismissNotice(record(), GROK_MOVE_NOTICE)).toEqual({ onboarding: { hintsSeen: [GROK_MOVE_NOTICE] } });
});
