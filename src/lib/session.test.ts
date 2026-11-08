import { describe, expect, it, vi } from "vitest";

import {
  isConnected, isOwnerOrAdmin, profileForSession, readSessionState, reasonWorthShowing, SERVICE_TRUST_REASON,
  takeInvitedEmailFromLocation, takePairingCodeFromLocation,
  type SessionState,
} from "./session";

describe("what the pair page says about why it was shown", () => {
  it("stays quiet for the ordinary no-session case and repeats anything else", () => {
    expect(reasonWorthShowing("forbidden: this request came through a proxy (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("forbidden: loopback host required (pair this device to use the server remotely)")).toBeNull();
    expect(reasonWorthShowing("403")).toBeNull();
    expect(reasonWorthShowing(undefined)).toBeNull();
    expect(reasonWorthShowing("unauthorized: this session has expired or was revoked; pair this device again")).toMatch(/expired or was revoked/);
  });
});

describe("the invited address on a pair link", () => {
  it("prefills a valid address, drops it from the address bar, and ignores junk", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("location", { search: "?email=Ada%40Example.test&x=1", pathname: "/pair", hash: "#code=ABCD" });
    vi.stubGlobal("history", { replaceState });
    expect(takeInvitedEmailFromLocation()).toBe("ada@example.test");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair?x=1#code=ABCD");
    vi.stubGlobal("location", { search: "?email=not-an-address", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.stubGlobal("location", { search: "", pathname: "/pair", hash: "" });
    expect(takeInvitedEmailFromLocation()).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("the pairing code on a pair link", () => {
  it("is taken off the address bar and out of history", () => {
    const replaceState = vi.fn();
    vi.stubGlobal("history", { replaceState });
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "#code=ABCD-EFGH-JKLM" });
    expect(takePairingCodeFromLocation()).toBe("ABCD-EFGH-JKLM");
    expect(replaceState).toHaveBeenCalledWith(null, "", "/pair");
    replaceState.mockClear();
    vi.stubGlobal("location", { pathname: "/pair", search: "", hash: "" });
    expect(takePairingCodeFromLocation()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe("who the served UI is on its own machine", () => {
  const answer = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  it("keeps the key a shared workspace gives this session's reactions, and nothing else in its place", async () => {
    const shared = { kind: "session", id: "s", label: "Ada's laptop", scopes: ["client"], expiresAt: 1 };
    expect(await readSessionState(answer({ ...shared, reactor: "p_ada" }))).toEqual({ ...shared, reactor: "p_ada" });
    expect(await readSessionState(answer({ ...shared, reactor: 7 }))).toEqual(shared);
    expect(await readSessionState(answer(shared))).toEqual(shared);
  });
  it("is the owner on loopback unless the server says local requests are only a service", async () => {
    const owner = await readSessionState(answer({ kind: "loopback", scopes: ["admin", "client"] }));
    expect(owner).toEqual({ kind: "loopback" });
    expect(isOwnerOrAdmin(owner)).toBe(true);
    const service = await readSessionState(answer({ kind: "loopback", scopes: ["client"], trust: "service" }));
    expect(service).toEqual({ kind: "loopback", trust: "service" });
    expect(isOwnerOrAdmin(service)).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(false);
    expect(isOwnerOrAdmin({ kind: "session", id: "s", label: "l", scopes: ["admin", "client"], expiresAt: 1 })).toBe(true);
    expect(isOwnerOrAdmin(null)).toBe(false);
  });
});

describe("the profile shown for a signed-in session", () => {
  const owner = { name: "Owner", email: "owner@example.test", avatarUrl: "/owner.png" };
  const ada: Extract<SessionState, { kind: "session" }> = { kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1 };

  it("preserves the verified email and device label", async () => {
    const answer: typeof fetch = async () => new Response(JSON.stringify({
      kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1,
    }), { status: 200 });
    expect(await readSessionState(answer)).toEqual({
      kind: "session", id: "s", label: "Ada's iPad", email: "ada@example.test", scopes: ["client"], expiresAt: 1,
    });
  });

  it("shows only the signed-in email when it differs from the configured owner", () => {
    expect(profileForSession(owner, ada)).toEqual({ email: "ada@example.test" });
    expect(profileForSession({ name: "Owner", avatarUrl: "/owner.png" }, ada)).toEqual({ email: "ada@example.test" });
    expect(profileForSession(undefined, ada)).toEqual({ email: "ada@example.test" });
  });

  it("keeps the configured profile when its email matches after trimming and case folding", () => {
    const matchingOwner = { ...owner, email: "  OWNER@EXAMPLE.TEST  " };
    const ownerSession = { ...ada, email: "owner@example.test" };
    expect(profileForSession(matchingOwner, ownerSession)).toBe(matchingOwner);
  });

  it("does not show the configured owner while the session is still loading", () => {
    expect(profileForSession(owner, null)).toBeUndefined();
  });

  it("does not show the configured owner when the session cannot be verified", () => {
    const sessions: SessionState[] = [
      { kind: "unauthenticated", error: "pair" },
      { kind: "unreachable", error: "offline" },
    ];
    for (const session of sessions) {
      expect(profileForSession(owner, session)).toBeUndefined();
    }
  });

  it("keeps the configured profile for loopback sessions", () => {
    expect(profileForSession(owner, { kind: "loopback" })).toBe(owner);
  });

  it("keeps the configured profile for an admin session, with or without an email", () => {
    expect(profileForSession(owner, { kind: "session", id: "s", label: "Owner's browser", scopes: ["admin", "client"], expiresAt: 1 })).toBe(owner);
    expect(profileForSession(owner, { ...ada, scopes: ["admin", "client"] })).toBe(owner);
  });

  it("does not show the configured owner for email-less paired sessions", () => {
    const sessions: SessionState[] = [
      { kind: "session", id: "s", label: "Ada's iPad", scopes: ["client"], expiresAt: 1 },
      { kind: "session", id: "s", label: "Ada's iPad", email: "  ", scopes: ["client"], expiresAt: 1 },
    ];
    for (const session of sessions) {
      expect(profileForSession(owner, session)).toBeUndefined();
    }
  });
});

describe("an SSH tunnel to a server that treats local requests as a service", () => {
  it("is not connected, so the app sends it to sign in, and says why", () => {
    expect(isConnected({ kind: "loopback" })).toBe(true);
    expect(isConnected({ kind: "loopback", trust: "service" })).toBe(false);
    expect(isConnected({ kind: "session", id: "s", label: "l", scopes: ["client"], expiresAt: 1 })).toBe(true);
    expect(isConnected({ kind: "unauthenticated", error: "pair" })).toBe(false);
    expect(isConnected(null)).toBe(false);
    expect(reasonWorthShowing(SERVICE_TRUST_REASON)).toBe(SERVICE_TRUST_REASON);
  });
});
