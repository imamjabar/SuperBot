import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLocale, t } from "@/lib/i18n";
import type { SessionState } from "./session";
import {
  connectPhoneEntry,
  currentPhonePairingTarget,
  loadPhonePairingAccess,
  pairedDestination,
  phoneDestinations,
  phonePairingSettingsAction,
  phonePairingTarget,
  resetPhonePairingAccess,
  revealPhonePairing,
  takePhonePairingRequest,
  type PhonePairingAccess,
} from "./phone-pairing";

const owner: SessionState = { kind: "loopback" };
const admin: SessionState = { kind: "session", id: "s", label: "Mac", scopes: ["admin", "client"], expiresAt: 1 };
const chatOnly: SessionState = { kind: "session", id: "s", label: "Staff phone", scopes: ["client"], expiresAt: 1 };
const access = (session: SessionState | null, pairingCodes = true): PhonePairingAccess => ({ session, pairingCodes });
const subtitle = (entry: ReturnType<typeof connectPhoneEntry>) => (entry ? t(entry.subtitleKey) : null);

beforeEach(() => setLocale("en"));
afterEach(() => {
  vi.unstubAllGlobals();
  resetPhonePairingAccess();
});

describe("where Connect your phone pairs", () => {
  it("pairs with this computer only in the desktop app's own window", () => {
    expect(phonePairingTarget({ companion: true, remoteClient: false })).toBe("computer");
    expect(phonePairingTarget({ companion: false, remoteClient: false })).toBe("server");
    expect(phonePairingTarget({ companion: true, remoteClient: true })).toBe("server");
  });


  it("reads the window's bridges", () => {
    vi.stubGlobal("window", { ogb: { companion: {} } });
    expect(currentPhonePairingTarget(false)).toBe("computer");
    vi.stubGlobal("window", { ogb: { companion: {}, remoteClient: { active: true } } });
    expect(currentPhonePairingTarget()).toBe("server");
    vi.stubGlobal("window", { ogb: { companion: {} } });
    expect(currentPhonePairingTarget()).toBe("computer");
    vi.stubGlobal("window", {});
    expect(currentPhonePairingTarget()).toBe("server");
  });
});

describe("Connect your phone in the account menu", () => {
  it("on this computer: always there, to this computer, without asking the server", () => {
    expect(subtitle(connectPhoneEntry("computer", null))).toBe("to this computer");
    expect(connectPhoneEntry("computer", access(chatOnly, false))?.target).toBe("computer");
  });

  it("on a Team Cloud: to the team, for every member, whatever their role", () => {
    const member = { kind: "session" as const, id: "s", label: "Desktop", scopes: ["client"], expiresAt: 1, team: { id: "team-acme-1", name: "Acme", role: "member" } };
    const entry = connectPhoneEntry("cloud", access(member, false));
    expect(entry).toMatchObject({ target: "cloud", team: "Acme" });
    expect(t("sidebar.menu.connectPhone.team", { team: entry!.team! })).toBe("to Acme");
    expect(phoneDestinations(entry, null)).toEqual([{ ...entry, id: "here" }]);
  });

  it("on another server: to the bots here, only for a session that may make a pairing code", () => {
    expect(subtitle(connectPhoneEntry("server", access(admin)))).toBe("to the bots here");
    expect(subtitle(connectPhoneEntry("server", access(owner)))).toBe("to the bots here");
    expect(connectPhoneEntry("server", access(chatOnly))).toBeNull();
    expect(connectPhoneEntry("server", access({ kind: "loopback", trust: "service" }))).toBeNull();
    expect(connectPhoneEntry("server", access({ kind: "unauthenticated", error: "pair" }))).toBeNull();
    expect(connectPhoneEntry("server", access(admin, false))).toBeNull();
  });

  it("offers nothing while it does not know yet", () => {
    expect(connectPhoneEntry("server", null)).toBeNull();
  });
});

describe("asking the server", () => {
  const respond = (routes: Record<string, unknown>) =>
    vi.fn(async (path: string) => {
      const body = routes[path];
      if (body instanceof Error) throw body;
      return new Response(JSON.stringify(body ?? {}), { status: body === undefined ? 404 : 200 });
    }) as unknown as typeof fetch;

  it("reads the session, then whether pairing codes are on", async () => {
    const fetchImpl = respond({ "/api/auth/session": { kind: "session", id: "s", label: "Mac", scopes: ["admin"], expiresAt: 1 }, "/api/config": { membership: { authority: "portal", pairingCodes: false } } });
    expect(await loadPhonePairingAccess(fetchImpl)).toMatchObject({ session: { kind: "session" }, pairingCodes: false });
  });

  it("does not ask for the config of a session that cannot pair anyway", async () => {
    const fetchImpl = respond({ "/api/auth/session": { kind: "session", id: "s", label: "Phone", scopes: ["client"], expiresAt: 1 } });
    expect(await loadPhonePairingAccess(fetchImpl)).toMatchObject({ pairingCodes: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("a config it cannot read means codes on, as an older server's does; asked once per page", async () => {
    const fetchImpl = respond({ "/api/auth/session": {}, "/api/config": new Error("offline") });
    expect(await loadPhonePairingAccess(fetchImpl)).toEqual({ session: { kind: "loopback" }, pairingCodes: true });
    await loadPhonePairingAccess(fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("opening Settings on the phone pairing", () => {
  it("is Remote access, asking for the pairing to be revealed", () => {
    expect(phonePairingSettingsAction()).toEqual({ type: "toggleAppSettings", open: true, section: "companion", phonePairing: true });
  });

  type Focusable = { focus: (options?: FocusOptions) => void };
  const focusable = () => ({ focus: vi.fn<(options?: FocusOptions) => void>() });
  const element = (action: Focusable | null) => ({
    scrollIntoView: vi.fn<(options: ScrollIntoViewOptions) => void>(),
    focus: vi.fn<(options?: FocusOptions) => void>(),
    querySelector: vi.fn((_selector: string) => action),
  });
  const now = (callback: () => void) => callback();

  it("scrolls the card into view and focuses the button that shows the code", () => {
    const action = focusable();
    const root = element(action);
    expect(revealPhonePairing(root, now)).toBe(true);
    expect(root.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
    expect(root.querySelector).toHaveBeenCalledWith("[data-phone-pairing-action]:not([disabled])");
    expect(action.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(root.focus).not.toHaveBeenCalled();
  });

  it("focuses the card itself when there is no button to press yet", () => {
    const root = element(null);
    revealPhonePairing(root, now);
    expect(root.focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("waits a frame, and reports a card that is not drawn yet", () => {
    const root = element(focusable());
    const frames: Array<() => void> = [];
    revealPhonePairing(root, (callback) => frames.push(callback));
    expect(root.scrollIntoView).not.toHaveBeenCalled();
    frames[0]!();
    expect(root.scrollIntoView).toHaveBeenCalled();
    expect(revealPhonePairing(null, now)).toBe(false);
  });
});

describe("the ?desktop-settings=phone request", () => {
  it("is taken off the address, keeping everything else", () => {
    expect(takePhonePairingRequest("https://home.fly.dev/?desktop-settings=phone")).toBe("/");
    expect(takePhonePairingRequest("https://home.fly.dev/?a=1&desktop-settings=phone#x")).toBe("/?a=1#x");
    expect(takePhonePairingRequest("https://home.fly.dev/?desktop-settings=workspaces")).toBeNull();
    expect(takePhonePairingRequest("https://home.fly.dev/")).toBeNull();
  });

  it("survives pairing, and nothing else does", () => {
    expect(pairedDestination("?desktop-settings=phone")).toBe("/?desktop-settings=phone");
    expect(pairedDestination("?desktop-settings=phone&next=https://evil.example")).toBe("/?desktop-settings=phone");
    expect(pairedDestination("?desktop-settings=workspaces")).toBe("/");
    expect(pairedDestination("?next=//evil.example")).toBe("/");
    expect(pairedDestination("")).toBe("/");
  });
});

