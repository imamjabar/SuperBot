// Only the RFB WebSocket crosses the container boundary: container-controlled JavaScript on the app's origin would reach the person's workspace.
import { createHash } from "node:crypto";
import { request, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import type { Duplex } from "node:stream";
import { isSameOrigin, type RequestAuth } from "../request-auth.ts";
import { PASS, type RouteHandler } from "./table.ts";
import { createUpgrades, type Upgrades } from "./upgrades.ts";

const ROUTE = /^\/api\/desktop-viewer\/(local\/(?:shared(?:-seat-[23])?|bot-[a-f0-9]{64}|pool-\d+)|vps\/[\w-]+)(\/websockify)?$/;
const HANDSHAKE_MS = 10_000;
const RECHECK_MS = 5_000;
const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const BOT_ID = /^[\w-]+$/;
const CONTROL_LEASE = /^[A-Za-z0-9_-]{16,120}$/;

/** Providers resolve a managed loopback endpoint, never a browser-supplied URL. */
export interface DesktopConnection {
  /** Loopback port of the viewer's websockify; ignored when `connect` is given. */
  port: number;
  /** A byte stream to the viewer's websockify, for a viewer that has no host port. */
  connect?: () => Duplex;
  password: string | null;
  /** x11vnc's view-only password. When set, an extra seat opened without a control lease gets only this one. */
  viewPassword?: string | null;
  live?: () => boolean;
  touch?: () => void;
  /** Acquired only by WebSockets; release must not close other viewers. */
  retain?: () => () => void;
}
export interface DesktopTarget {
  key: string;
  resolve: () => Promise<DesktopConnection>;
}

export function desktopViewerUrl(target: string, threadId?: string): string {
  const params = new URLSearchParams({ target, ...(threadId ? { threadId } : {}) });
  return `/desktop-viewer#${params}`;
}

interface Viewer { socket: Socket; close: () => void; owner?: string; botId?: string; targetId: string }

export function createDesktopViewer(deps: {
  target: (id: string) => DesktopTarget | undefined;
  live: (auth: RequestAuth) => boolean;
  /** Whether this person may see this desktop at all; asked on open and on every liveness pass. */
  allowed?: (auth: RequestAuth, id: string) => boolean;
  /** True when one thread holds the whole desktop, so a bot's control lease reserves it for the person. Pool desktops and
   * a single-seat shared desktop are never exclusive. */
  exclusive?: (id: string) => boolean;
  /** Binds a viewer to a control lease: answers only while `controlLeaseId` holds `botId`'s computer and the target is
   * that computer. */
  lease?: (id: string, botId: string, controlLeaseId: string, threadId?: string) => (() => boolean) | undefined;
  /** The server's shared upgrade gate; a viewer made without one keeps its own. */
  upgrades?: Upgrades;
}) {
  const upgrades = deps.upgrades ?? createUpgrades();
  const ownGate = deps.upgrades === undefined;
  upgrades.route((path) => Boolean(ROUTE.exec(path)?.[2]));
  const viewers = new Map<IncomingMessage, Viewer>();
  const activeByTarget = new Map<string, Viewer>();
  let stopped = false;

  const route: RouteHandler = async ({ req, res, url, path, method, auth, json }) => {
    const match = ROUTE.exec(path);
    if (!match) return PASS;
    res.setHeader("cache-control", "private, no-store");
    if (method !== "GET") return json(res, 405, { error: "method not allowed" });
    // Also enforced at this boundary: admin and same-origin only.
    if (!auth.scopes.includes("admin") || !isSameOrigin(req)) return json(res, 403, { error: "forbidden" });
    if (deps.allowed && !deps.allowed(auth, match[1])) return json(res, 403, { error: "forbidden" });
    // A lease-bound viewer: both names or neither, holding before anything is inspected, rechecked on every liveness pass.
    const botId = url.searchParams.get("botId");
    const controlLeaseId = url.searchParams.get("controlLeaseId");
    const threadId = url.searchParams.get("threadId") ?? undefined;
    if ((botId === null) !== (controlLeaseId === null)) {
      return json(res, 400, { error: "botId and controlLeaseId go together" });
    }
    if (botId !== null && (!BOT_ID.test(botId) || !CONTROL_LEASE.test(controlLeaseId!) || !deps.lease
      || (threadId !== undefined && !BOT_ID.test(threadId)))) {
      return json(res, 400, { error: "botId, threadId or controlLeaseId is not valid" });
    }
    if (botId === null && threadId !== undefined) return json(res, 400, { error: "threadId needs botId and controlLeaseId" });
    // A saved or constructed socket URL must not bypass the join refusal: a bot's lease does not exclude other users of a shared desktop.
    if (botId !== null && match[1].startsWith("local/") && !match[1].startsWith("local/bot-") && deps.exclusive?.(match[1]) !== true) {
      return json(res, 409, { error: "Phone control requires a per-bot Local VM. Select per-bot mode in Settings → Computers." });
    }
    const bound = botId === null ? undefined : deps.lease!(match[1], botId, controlLeaseId!, threadId);
    if (botId !== null && !bound) return json(res, 409, { error: "Take control of this computer first" });
    const holds = () => bound?.() ?? true;
    const target = deps.target(match[1]);
    if (!target) return json(res, 404, { error: "Desktop not found" });
    const isExclusive = deps.exclusive?.(match[1]) === true;
    if (match[2] && isExclusive) {
      const existing = activeByTarget.get(match[1]);
      if (existing && !existing.socket.destroyed) {
        return json(res, 409, { error: "The desktop is currently in use by another viewer" });
      }
    }
    const pending = upgrades.pending(req);
    if (pending && stopped) { pending.socket.destroy(); return; }
    let upgrade: Viewer | undefined;
    if (pending) {
      const viewer: Viewer = { socket: pending.socket, close: () => pending.socket.destroy(), targetId: match[1] };
      if (auth.kind === "session") viewer.owner = auth.session.id;
      if (botId !== null) viewer.botId = botId;
      viewers.set(req, viewer);
      pending.socket.once("close", () => {
        viewers.delete(req);
        if (activeByTarget.get(match[1]) === viewer) activeByTarget.delete(match[1]);
      });
      upgrade = viewer;
    }
    let connection: DesktopConnection;
    try { connection = await target.resolve(); }
    catch (error) {
      console.warn(`desktop viewer ${match[1]}: ${error instanceof Error ? error.message : String(error)}`);
      const status = error && typeof error === "object" && "status" in error ? error.status : 502;
      return json(res, typeof status === "number" && status >= 400 && status < 600 ? status : 502,
        { error: "The desktop is not available. Open it again from SuperBot." });
    }
    // Inspection may outlive a closed tab or the handshake deadline.
    if (res.destroyed || upgrade?.socket.destroyed) return;
    const live = () => deps.live(auth) && (deps.allowed?.(auth, match[1]) ?? true) && deps.target(match[1])?.key === target.key
      && (connection.live?.() ?? true);
    if (!live()) return json(res, 401, { error: "Viewer access expired" });
    if (!holds()) return json(res, 409, { error: "Take control of this computer first" });
    if (!connection.connect && (!Number.isInteger(connection.port) || connection.port < 1 || connection.port > 65535)) {
      return json(res, 409, { error: "The desktop viewer is not available." });
    }
    if (!match[2]) {
      const watchOnly = botId === null && match[1].startsWith("local/shared-seat-");
      if (!watchOnly) return json(res, 200, { password: connection.password });
      if (!connection.viewPassword) return json(res, 409, { error: "This desktop can only be opened after taking control of it." });
      return json(res, 200, { password: connection.viewPassword, viewOnly: true });
    }
    if (!upgrade || !pending) return json(res, 426, { error: "WebSocket upgrade required" });
    const key = req.headers["sec-websocket-key"];
    if (req.headers.upgrade?.toLowerCase() !== "websocket" || req.headers["sec-websocket-version"] !== "13"
      || typeof key !== "string" || !/^[A-Za-z0-9+/]{22}==$/.test(key)) {
      return json(res, 400, { error: "Invalid WebSocket handshake" });
    }
    // Fixed host and path, port from an inspected managed container. Never forward cookies, bearer tokens, query parameters or forwarded headers.
    const upstream = request({
      ...(connection.connect ? { createConnection: () => connection.connect!() as Socket } : { hostname: "127.0.0.1", port: connection.port }),
      path: "/websockify",
      headers: { Upgrade: "websocket", Connection: "Upgrade", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" },
    });
    const { socket } = upgrade;
    let peer: Duplex | undefined;
    let recheck: ReturnType<typeof setInterval> | undefined;
    const release = connection.retain?.();
    let closed = false;
    const timeout = setTimeout(() => fail(), HANDSHAKE_MS);
    timeout.unref();
    upgrade.close = () => {
      if (closed) return;
      closed = true;
      if (activeByTarget.get(match[1]) === upgrade) activeByTarget.delete(match[1]);
      release?.();
      clearTimeout(timeout);
      clearInterval(recheck);
      upstream.destroy();
      peer?.destroy();
      socket.destroy();
    };
    const fail = () => {
      if (closed) return;
      if (peer || socket.destroyed) { upgrade.close(); return; }
      if (!res.headersSent && !socket.destroyed) json(res, 502, { error: "Could not connect to the desktop viewer" });
      upstream.destroy();
    };
    socket.once("close", upgrade.close);
    upstream.once("error", fail);
    upstream.once("response", (answer) => { answer.resume(); fail(); });
    upstream.once("upgrade", (answer, remote, remoteHead) => {
      const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
      if (!live() || !holds() || socket.destroyed || answer.headers["sec-websocket-accept"] !== accept
        || answer.headers.upgrade?.toLowerCase() !== "websocket") {
        remote.destroy(); fail(); return;
      }
      clearTimeout(timeout);
      peer = remote;
      remote.once("error", upgrade.close);
      remote.once("close", upgrade.close);
      if (isExclusive) activeByTarget.set(match[1], upgrade);
      pending.release();
      res.detachSocket(socket);
      socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      if (remoteHead.length) socket.write(remoteHead);
      if (pending.head.length) remote.write(pending.head);
      pending.head = Buffer.alloc(0);
      socket.pipe(remote).pipe(socket);
      connection.touch?.();
      recheck = setInterval(() => {
        if (!live() || !holds()) upgrade.close();
        else connection.touch?.();
      }, RECHECK_MS);
      recheck.unref();
    });
    upstream.end();
  };

  return {
    route,
    attach: upgrades.attach,
    closeForOwner: (owner: string, botId?: string) => {
      let closed = 0;
      for (const viewer of viewers.values()) {
        if (viewer.owner !== owner || (botId !== undefined && viewer.botId !== botId)) continue;
        // A closed viewer stays listed until its socket's close event, which arrives later on Windows.
        if (viewer.socket.destroyed) continue;
        viewer.close();
        closed++;
      }
      return closed;
    },
    openViewers: (targetId: string): number => {
      let count = 0;
      for (const viewer of viewers.values()) {
        if (viewer.targetId === targetId && !viewer.socket.destroyed) count++;
      }
      return count;
    },
    closeAll: () => {
      stopped = true;
      activeByTarget.clear();
      if (ownGate) upgrades.close();
      for (const viewer of viewers.values()) viewer.close();
    },
  };
}
