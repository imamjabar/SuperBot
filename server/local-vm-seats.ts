export const MAX_SEATS = 3;

export type SeatId = `seat:${number}`;

/** Must match the per-seat layout that `openmausbot-seat` in the desktop image creates. */
export interface SeatIdentity {
  id: SeatId;
  seat: number;
  display: string;
  xdgRuntimeDir: string;
  cuaSocket: string;
  vncPort: number;
  viewerPort: number;
}

const RUNTIME_ROOT = "/run/user/1000";

export function parseSeat(input: unknown): number | null {
  let value: number;
  if (typeof input === "number") value = input;
  else if (typeof input === "string" && /^(?:seat:)?[1-9]\d*$/.test(input.trim())) value = Number(input.trim().replace(/^seat:/, ""));
  else return null;
  return Number.isInteger(value) && value >= 1 && value <= MAX_SEATS ? value : null;
}

export function seatCapacity(configured: unknown): number {
  if (configured === undefined || configured === null || configured === "") return 1;
  const value = typeof configured === "string" ? Number(configured.trim()) : configured;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) return 1;
  return Math.min(value, MAX_SEATS);
}

export function seatIdentity(seat: number): SeatIdentity {
  if (parseSeat(seat) !== seat) throw new Error(`seat must be 1..${MAX_SEATS}, not ${seat}`);
  return {
    id: `seat:${seat}`,
    seat,
    display: `:${seat}`,
    xdgRuntimeDir: seat === 1 ? RUNTIME_ROOT : `${RUNTIME_ROOT}/seat-${seat}`,
    cuaSocket: seat === 1 ? `${RUNTIME_ROOT}/openmausbot-cua.sock` : `${RUNTIME_ROOT}/openmausbot-cua-${seat}.sock`,
    vncPort: 5900 + seat,
    viewerPort: 6900 + seat,
  };
}

export interface SeatLease {
  seat: SeatIdentity;
  ownerId: string;
  threadId: string;
  expiresAt: number;
}

export interface SeatLeaseRequest {
  ownerId: string;
  threadId: string;
  seat?: number;
}

export type SeatLeaseResult =
  | { ok: true; lease: SeatLease }
  | { ok: false; reason: "invalid-request" | "seat-out-of-range" | "seat-taken" | "no-free-seat" | "thread-holds-other-seat" };

/** Synchronous, so two turns never both see a seat as free. Independent of the per-target lifecycle lock in
 * `local-vm-lease.ts`: seat ids are `seat:<n>` and never equal a target key. */
export class SeatLeaseTable {
  private readonly leases = new Map<number, SeatLease>();
  private readonly ttlMs: number;
  readonly capacity: number;

  constructor(capacity: number, ttlMs: number) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Seat lease TTL must be positive");
    this.capacity = seatCapacity(capacity);
    this.ttlMs = ttlMs;
  }

  private live(seat: number, now: number): SeatLease | null {
    const lease = this.leases.get(seat);
    if (lease && lease.expiresAt <= now) {
      this.leases.delete(seat);
      return null;
    }
    return lease ?? null;
  }

  heldBy(threadId: string, now = Date.now()): SeatLease | null {
    for (let seat = 1; seat <= MAX_SEATS; seat++) {
      const lease = this.live(seat, now);
      if (lease?.threadId === threadId) return { ...lease };
    }
    return null;
  }

  acquire(request: SeatLeaseRequest, now = Date.now()): SeatLeaseResult {
    const { ownerId, threadId } = request;
    if (!ownerId || !threadId) return { ok: false, reason: "invalid-request" };
    let wanted: number | undefined;
    if (request.seat !== undefined) {
      const parsed = parseSeat(request.seat);
      if (parsed === null || parsed > this.capacity) return { ok: false, reason: "seat-out-of-range" };
      wanted = parsed;
    }
    const held = this.heldBy(threadId, now);
    if (held) {
      if (held.ownerId !== ownerId) return { ok: false, reason: "seat-taken" };
      if (wanted !== undefined && wanted !== held.seat.seat) return { ok: false, reason: "thread-holds-other-seat" };
      return { ok: true, lease: this.grant(held.seat.seat, ownerId, threadId, now) };
    }
    if (wanted !== undefined) {
      if (this.live(wanted, now)) return { ok: false, reason: "seat-taken" };
      return { ok: true, lease: this.grant(wanted, ownerId, threadId, now) };
    }
    for (let seat = 1; seat <= this.capacity; seat++) {
      if (!this.live(seat, now)) return { ok: true, lease: this.grant(seat, ownerId, threadId, now) };
    }
    return { ok: false, reason: "no-free-seat" };
  }

  heartbeat(seat: number, ownerId: string, threadId: string, now = Date.now()): boolean {
    const lease = this.live(seat, now);
    if (!lease || lease.ownerId !== ownerId || lease.threadId !== threadId) return false;
    lease.expiresAt = now + this.ttlMs;
    return true;
  }

  release(seat: number, ownerId: string, threadId: string, now = Date.now()): boolean {
    const lease = this.live(seat, now);
    if (!lease || lease.ownerId !== ownerId || lease.threadId !== threadId) return false;
    this.leases.delete(seat);
    return true;
  }

  /** For a deleted or forked-away thread, whose owner may no longer exist to release it. */
  releaseThread(threadId: string): void {
    for (const [seat, lease] of this.leases) if (lease.threadId === threadId) this.leases.delete(seat);
  }

  private grant(seat: number, ownerId: string, threadId: string, now: number): SeatLease {
    const lease: SeatLease = { seat: seatIdentity(seat), ownerId, threadId, expiresAt: now + this.ttlMs };
    this.leases.set(seat, lease);
    return { ...lease };
  }
}
