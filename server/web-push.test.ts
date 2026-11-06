import { createECDH, createPublicKey, verify } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Notification } from "../shared/notification.ts";
import { createWebPush, encryptPushPayload, parsePushSubscription, pushEndpointAllowed, vapidAuthorization } from "./web-push.ts";

const unb64 = (text: string) => Buffer.from(text, "base64url");

describe("payload encryption", () => {
  it("matches the RFC 8291 §5 example", () => {
    const server = createECDH("prime256v1");
    server.setPrivateKey(unb64("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"));
    const body = encryptPushPayload(
      Buffer.from("When I grow up, I want to be a watermelon"),
      "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      "BTBZMqHH6r4Tts7J_aSIgg",
      unb64("DGv6ra1nlYgDCS1FRnbzlw"),
      server,
    );
    expect(body.toString("base64url")).toBe(
      "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
    );
  });
});

describe("VAPID", () => {
  it("signs a token for the endpoint's origin that the public key verifies", () => {
    const key = createECDH("prime256v1");
    key.generateKeys();
    const publicKey = key.getPublicKey().toString("base64url");
    const header = vapidAuthorization("https://web.push.apple.com/QGuQ", publicKey, key.getPrivateKey().toString("base64url"), 1_800_000_000_000);
    const [, token, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
    expect(k).toBe(publicKey);
    const [head, claims, signature] = token!.split(".");
    expect(JSON.parse(unb64(claims!).toString())).toMatchObject({ aud: "https://web.push.apple.com", exp: 1_800_000_000 + 12 * 3600 });
    const point = key.getPublicKey();
    const jwk = createPublicKey({ format: "jwk", key: { kty: "EC", crv: "P-256", x: point.subarray(1, 33).toString("base64url"), y: point.subarray(33).toString("base64url") } });
    expect(verify("sha256", Buffer.from(`${head}.${claims}`), { key: jwk, dsaEncoding: "ieee-p1363" }, unb64(signature!))).toBe(true);
  });
});

describe("subscriptions", () => {
  it("accepts only the browsers' push services over https", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://web.push.apple.com/QGuQ", "https://updates.push.services.mozilla.com/wpush/v2/x", "https://wns2-par02p.notify.windows.com/w/?token=x"]) {
      expect(pushEndpointAllowed(ok), ok).toBe(true);
    }
    for (const bad of ["http://fcm.googleapis.com/fcm/send/abc", "https://fcm.googleapis.com.evil.test/x", "https://127.0.0.1/x", "https://evilfcm.googleapis.com.test/x", "https://fcm.googleapis.com:8443/x", "not a url"]) {
      expect(pushEndpointAllowed(bad), bad).toBe(false);
    }
  });

  it("refuses keys of the wrong shape", () => {
    const p256dh = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(parsePushSubscription({ endpoint, keys: { p256dh, auth: "BTBZMqHH6r4Tts7J_aSIgg" } })).toEqual({ endpoint, p256dh, auth: "BTBZMqHH6r4Tts7J_aSIgg" });
    expect(parsePushSubscription({ endpoint, keys: { p256dh: p256dh.slice(4), auth: "BTBZMqHH6r4Tts7J_aSIgg" } })).toBeNull();
    expect(parsePushSubscription({ endpoint, keys: { p256dh, auth: "short" } })).toBeNull();
  });
});

describe("delivery", () => {
  let dir = "";
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const notification: Notification = { kind: "done", botId: "bot-1", botName: "Chief", threadId: "thread-1", title: "Chief", body: "Research is ready" };
  const device = () => {
    const key = createECDH("prime256v1");
    key.generateKeys();
    return { endpoint: "https://fcm.googleapis.com/fcm/send/device", p256dh: key.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 7).toString("base64url") };
  };

  it("posts an encrypted, VAPID-signed message, keeps its key across restarts, and forgets a device the service says is gone", async () => {
    dir = mkdtempSync(join(tmpdir(), "web-push-"));
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 201;
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status });
    }) as unknown as typeof fetch;
    const push = createWebPush(dir, fetchImpl);
    expect(statSync(join(dir, "web-push.json")).mode & 0o777).toBe(0o600);
    push.subscribe(device());
    push.notifyFrame({ kind: "notify", notification });
    push.notifyFrame({ kind: "message", notification });
    await expect.poll(() => calls.length).toBe(1);
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(calls[0]!.url).toBe("https://fcm.googleapis.com/fcm/send/device");
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.authorization).toMatch(new RegExp(`^vapid t=.+, k=${push.publicKey()}$`));
    expect(Buffer.from(calls[0]!.init.body as Uint8Array).toString()).not.toContain("Research is ready");

    const again = createWebPush(dir, fetchImpl);
    expect(again.publicKey()).toBe(push.publicKey());
    expect(again.subscriptions()).toHaveLength(1);
    status = 410;
    await again.send(notification);
    expect(again.subscriptions()).toEqual([]);
    expect(createWebPush(dir, fetchImpl).subscriptions()).toEqual([]);
  });
});
