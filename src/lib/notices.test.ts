import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EMPTY_ONBOARDING, type OnboardingStatus } from "@/lib/onboarding";
import { withTourReset } from "@/lib/guided-tour";
import { DESKTOP_NOTICES } from "../../electron/desktop-prefs.mjs";
import { CLOUD_NOTICE, CLOUD_TRIAL_NOTICE, dismissNotice, GROK_MOVE_NOTICE, launchNotice, markLaunchNotice, nextNotice, noticeSeen,
  NOTICES, SIMPLE_MODE_NOTICE, TWO_PLACES_NOTICE, UPDATES_CONSENT_NOTICE, type NoticeFacts } from "./notices";

let storage: Map<string, string>, session: Map<string, string>;
beforeEach(() => {
  storage = new Map(); session = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) });
  vi.stubGlobal("sessionStorage", { getItem: (key: string) => session.get(key) ?? null, setItem: (key: string, value: string) => session.set(key, value) });
});
afterEach(() => vi.unstubAllGlobals());

const record = (hintsSeen: string[] = []): OnboardingStatus => ({ ...EMPTY_ONBOARDING, completedAt: "2026-09-01", version: 1, hintsSeen });
const facts = (grok: boolean | null = false, simple: boolean | null = false, consent: boolean | null = false,
  two: boolean | null = false, trial: boolean | null = false, cloud: boolean | null = false): NoticeFacts =>
  ({ [GROK_MOVE_NOTICE]: grok, [SIMPLE_MODE_NOTICE]: simple, [UPDATES_CONSENT_NOTICE]: consent,
    [TWO_PLACES_NOTICE]: two, [CLOUD_TRIAL_NOTICE]: trial, [CLOUD_NOTICE]: cloud });
const none = () => false;

it("the Move from Grok Bot popup goes ahead of everything, and holds the queue while it waits", () => {
  const all = (grok: boolean | null) => facts(grok, true, true, true, true, true);
  expect(nextNotice(all(true), none)).toBe(GROK_MOVE_NOTICE);
  expect(nextNotice(all(null), none)).toBeNull();
  expect(nextNotice(all(false), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(all(true), none, SIMPLE_MODE_NOTICE), "not in a launch another notice took").toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(all(true), none, GROK_MOVE_NOTICE), "a reload of the launch it took").toBe(GROK_MOVE_NOTICE);
  expect(GROK_MOVE_NOTICE).toBe("grok-move-2026-11");
});

it("is one queue: the Simple mode popup first, then the product-updates question, bots in two places, the trial's notice, the My Cloud card", () => {
  expect(NOTICES).toEqual([GROK_MOVE_NOTICE, SIMPLE_MODE_NOTICE, UPDATES_CONSENT_NOTICE, TWO_PLACES_NOTICE, CLOUD_TRIAL_NOTICE, CLOUD_NOTICE]);
  expect(nextNotice(facts(false, true, true, true, true, true), none)).toBe(SIMPLE_MODE_NOTICE);
  expect(nextNotice(facts(false, null, true, true, true, true), none), "nothing shows while the Simple mode popup waits").toBeNull();
  expect(nextNotice(facts(false, true, true, true, true, true), id => id === SIMPLE_MODE_NOTICE)).toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(facts(false, false, false, true, true, true), none), "bots in two places come before any promotion").toBe(TWO_PLACES_NOTICE);
  expect(nextNotice(facts(false, false, true, true, true, true), none), "after the product-updates question").toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(facts(false, false, false, null, true, true), none), "nothing lower shows while main hasn't answered").toBeNull();
  expect(nextNotice(facts(false, false, false, false, true, true), none)).toBe(CLOUD_TRIAL_NOTICE);
  expect(nextNotice(facts(false, false, false, false, false, true), none)).toBe(CLOUD_NOTICE);
  expect(nextNotice(facts(false, false, false, false, true, true), id => id === CLOUD_TRIAL_NOTICE)).toBe(CLOUD_NOTICE);
  expect(nextNotice(facts(false, false, false, false, true, true), () => true)).toBeNull();
  expect(nextNotice(facts(false, false, false, false, false, false), none)).toBeNull();
});

it("Boat's credit offer and the Grok Bot move are ones the desktop keeps for its every page, as What's new is", () => {
  expect(DESKTOP_NOTICES).toEqual(["whats-new-2026-11", "boat-credit-2026-11", GROK_MOVE_NOTICE]);
});

it("one notice a launch: only the product-updates question may follow", () => {
  const both = facts(false, false, false, true, false, true);
  expect(nextNotice(both, none)).toBe(TWO_PLACES_NOTICE);
  expect(NOTICES.indexOf(TWO_PLACES_NOTICE), "two places comes before the cloud card").toBeLessThan(NOTICES.indexOf(CLOUD_NOTICE));
  expect(nextNotice(both, id => id === TWO_PLACES_NOTICE, TWO_PLACES_NOTICE), "two places closed: nothing else this launch").toBeNull();
  expect(nextNotice({ ...both, [UPDATES_CONSENT_NOTICE]: true }, id => id === TWO_PLACES_NOTICE, TWO_PLACES_NOTICE), "but the question may follow")
    .toBe(UPDATES_CONSENT_NOTICE);
  expect(nextNotice(both, none, TWO_PLACES_NOTICE), "a reload while it is up shows it again").toBe(TWO_PLACES_NOTICE);
  expect(nextNotice(both, id => id === TWO_PLACES_NOTICE), "the next launch").toBe(CLOUD_NOTICE);
  expect(nextNotice(facts(false, false, false, false, null, true), none, CLOUD_NOTICE), "a notice this launch didn't take never holds it back")
    .toBe(CLOUD_NOTICE);
  expect(nextNotice(facts(false, false, false, false, true, false), none, CLOUD_NOTICE), "a trial's notice waits for the next launch too").toBeNull();
});

it("a launch keeps the notice it showed first for the window's session; storage that throws keeps it for the page", () => {
  expect(launchNotice()).toBeNull();
  markLaunchNotice(SIMPLE_MODE_NOTICE); markLaunchNotice(CLOUD_NOTICE);
  expect(launchNotice()).toBe(SIMPLE_MODE_NOTICE);
  expect(session.get("omb.launch.notice")).toBe(SIMPLE_MODE_NOTICE);
  session.set("omb.launch.notice", "something-else");
  expect(launchNotice(), "only a notice of the list").toBeNull();
  vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  markLaunchNotice(TWO_PLACES_NOTICE);
  expect(launchNotice()).toBe(TWO_PLACES_NOTICE);
});

it("waits while an earlier notice's answer is unknown, so a later one never shows first", () => {
  expect(nextNotice(facts(false, false, false, null, false, true), none)).toBeNull();
  expect(nextNotice(facts(false, false, false, false, null, true), none)).toBeNull();
  expect(nextNotice(facts(false, false, false, null, false, true), id => id === TWO_PLACES_NOTICE)).toBe(CLOUD_NOTICE);
});

it("a dismissal holds on this device at once and in the workspace record for good", () => {
  const seen = record(["tour.done"]);
  expect(dismissNotice(seen, CLOUD_NOTICE)).toEqual({ onboarding: { hintsSeen: ["tour.done", CLOUD_NOTICE] } });
  expect(storage.get(CLOUD_NOTICE)).toBe("1");
  expect(noticeSeen(record(), CLOUD_NOTICE)).toBe(true);
  storage.clear();
  expect(noticeSeen(record(), CLOUD_NOTICE)).toBe(false);
  expect(noticeSeen(record([CLOUD_NOTICE]), CLOUD_NOTICE)).toBe(true);
  expect(dismissNotice(record([CLOUD_NOTICE]), CLOUD_NOTICE)).toBeNull();
  expect(withTourReset(record([CLOUD_NOTICE, "tour.done"]))).toEqual([CLOUD_NOTICE]);
});

it("browser storage that throws still leaves the workspace record in charge", () => {
  vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
  expect(noticeSeen(record(), CLOUD_NOTICE)).toBe(false);
  expect(noticeSeen(record([CLOUD_NOTICE]), CLOUD_NOTICE)).toBe(true);
  expect(dismissNotice(record(), CLOUD_NOTICE)).toEqual({ onboarding: { hintsSeen: [CLOUD_NOTICE] } });
});
