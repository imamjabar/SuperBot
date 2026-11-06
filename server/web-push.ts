// Web Push per RFC 8030 (delivery), RFC 8291 + RFC 8188 (aes128gcm payload encryption) and RFC 8292 (VAPID).
import { createCipheriv, createECDH, createPrivateKey, hkdfSync, randomBytes, sign, type ECDH } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Notification } from "../shared/notification.ts";

export interface PushSubscriptionRecord {
  endpoint: string;
  p256dh: string;
  auth: string;
  at: number;
}

interface PushState {
  publicKey: string;
  privateKey: string;
  subscriptions: PushSubscriptionRecord[];
}

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  botId: string;
  threadId: string;
  icon?: string;
}

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const unb64 = (text: string) => Buffer.from(text, "base64url");

/** A subscription's endpoint is fetched by the server, so only the browsers' own push services are accepted. */
const PUSH_HOSTS = ["fcm.googleapis.com", "push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
const MAX_SUBSCRIPTIONS = 20;
const RECORD_SIZE = 4096;
const MAX_BODY_CHARS = 600;

export function pushEndpointAllowed(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  return url.protocol === "https:" && !url.port && PUSH_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
}

export function parsePushSubscription(body: unknown): Omit<PushSubscriptionRecord, "at"> | null {
  if (!body || typeof body !== "object") return null;
  const { endpoint, keys } = body as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  if (typeof endpoint !== "string" || endpoint.length > 2048 || !pushEndpointAllowed(endpoint)) return null;
  const p256dh = typeof keys?.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys?.auth === "string" ? keys.auth : "";
  if (unb64(p256dh).length !== 65 || unb64(p256dh)[0] !== 4 || unb64(auth).length !== 16) return null;
  return { endpoint, p256dh, auth };
}

const ephemeralKey = (): ECDH => {
  const key = createECDH("prime256v1");
  key.generateKeys();
  return key;
};

/** RFC 8291 §3.4 with a single aes128gcm record; `salt` and `serverKey` are fixed only by tests. */
export function encryptPushPayload(plaintext: Uint8Array, p256dh: string, auth: string, salt: Buffer = randomBytes(16), serverKey: ECDH = ephemeralKey()): Buffer {
  const serverPublic = serverKey.getPublicKey();
  const clientPublic = unb64(p256dh);
  const shared = serverKey.computeSecret(clientPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), clientPublic, serverPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, unb64(auth), keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const sealed = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header[20] = serverPublic.length;
  return Buffer.concat([header, serverPublic, sealed]);
}

export function vapidAuthorization(endpoint: string, publicKey: string, privateKey: string, now = Date.now()): string {
  const point = unb64(publicKey);
  const key = createPrivateKey({ format: "jwk", key: { kty: "EC", crv: "P-256", d: privateKey, x: b64(point.subarray(1, 33)), y: b64(point.subarray(33, 65)) } });
  const head = b64(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: "mailto:openmausbot@users.noreply.github.com" })));
  const signature = sign("sha256", Buffer.from(`${head}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${claims}.${b64(signature)}, k=${publicKey}`;
}

export function pushPayloadFor(notification: Notification): PushPayload {
  const icon = notification.avatarUrl && !notification.avatarUrl.startsWith("data:") ? notification.avatarUrl : undefined;
  return {
    title: notification.title,
    body: notification.body.length > MAX_BODY_CHARS ? `${notification.body.slice(0, MAX_BODY_CHARS - 1)}…` : notification.body,
    tag: `openmausbot:${notification.botId}`,
    botId: notification.botId,
    threadId: notification.threadId,
    ...(icon ? { icon } : {}),
  };
}

export interface WebPush {
  publicKey(): string;
  subscribe(subscription: Omit<PushSubscriptionRecord, "at">): void;
  unsubscribe(endpoint: string): void;
  subscriptions(): readonly PushSubscriptionRecord[];
  send(notification: Notification): Promise<void>;
  /** Every broadcast frame passes here; a `notify` frame is pushed to each subscribed device. */
  notifyFrame(payload: Record<string, unknown>): void;
}

/** The private VAPID key lives in `web-push.json` (mode 0600) beside the other server state. */
export function createWebPush(dataDir: string, fetchImpl: typeof fetch = fetch): WebPush {
  const file = join(dataDir, "web-push.json");
  const load = (): PushState => {
    if (existsSync(file)) {
      try {
        const saved = JSON.parse(readFileSync(file, "utf8")) as PushState;
        if (saved.publicKey && saved.privateKey && Array.isArray(saved.subscriptions)) return saved;
      } catch { /* a damaged file gets fresh keys; old subscriptions then fail and are dropped */ }
    }
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return { publicKey: b64(ecdh.getPublicKey()), privateKey: b64(ecdh.getPrivateKey()), subscriptions: [] };
  };
  let state = load();
  const save = () => {
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
    renameSync(tmp, file);
  };
  if (!existsSync(file)) save();

  const drop = (endpoint: string) => {
    const kept = state.subscriptions.filter((entry) => entry.endpoint !== endpoint);
    if (kept.length === state.subscriptions.length) return;
    state = { ...state, subscriptions: kept };
    save();
  };

  const deliver = async (subscription: PushSubscriptionRecord, body: Buffer) => {
    try {
      const res = await fetchImpl(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: vapidAuthorization(subscription.endpoint, state.publicKey, state.privateKey),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(24 * 3600),
          urgency: "high",
        },
        body: new Uint8Array(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.status === 404 || res.status === 410) drop(subscription.endpoint);
      else if (!res.ok) console.warn(`[web-push] ${new URL(subscription.endpoint).hostname} answered ${res.status}`);
    } catch (error) {
      console.warn(`[web-push] ${new URL(subscription.endpoint).hostname}: ${(error as Error).message}`);
    }
  };

  const send = async (notification: Notification) => {
    if (!state.subscriptions.length) return;
    const plaintext = Buffer.from(JSON.stringify(pushPayloadFor(notification)));
    await Promise.all(state.subscriptions.map((subscription) => deliver(subscription, encryptPushPayload(plaintext, subscription.p256dh, subscription.auth))));
  };

  return {
    publicKey: () => state.publicKey,
    subscribe(subscription) {
      const others = state.subscriptions.filter((entry) => entry.endpoint !== subscription.endpoint);
      state = { ...state, subscriptions: [...others, { ...subscription, at: Date.now() }].slice(-MAX_SUBSCRIPTIONS) };
      save();
    },
    unsubscribe: drop,
    subscriptions: () => state.subscriptions,
    send,
    notifyFrame(payload) {
      const notification = payload.kind === "notify" ? payload.notification as Notification | undefined : undefined;
      if (notification?.botId && !notification.forPerson) void send(notification);
    },
  };
}
