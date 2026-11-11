export const MAX_SEATS = 3;
const RUNTIME_ROOT = "/run/user/1000";
export function parseSeat(input) {
    let value;
    if (typeof input === "number")
        value = input;
    else if (typeof input === "string" && /^(?:seat:)?[1-9]\d*$/.test(input.trim()))
        value = Number(input.trim().replace(/^seat:/, ""));
    else
        return null;
    return Number.isInteger(value) && value >= 1 && value <= MAX_SEATS ? value : null;
}
export function seatCapacity(configured) {
    if (configured === undefined || configured === null || configured === "")
        return 1;
    const value = typeof configured === "string" ? Number(configured.trim()) : configured;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1)
        return 1;
    return Math.min(value, MAX_SEATS);
}
export function seatIdentity(seat) {
    if (parseSeat(seat) !== seat)
        throw new Error(`seat must be 1..${MAX_SEATS}, not ${seat}`);
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
/** The turn lock key for one seat of a target. Seat 1 keeps the bare target key, so single-seat locks are unchanged. */
export function localVmSeatKey(target) {
    return target.seat === undefined || target.seat === 1 ? target.key : `${target.key}#seat:${target.seat}`;
}
export function localVmSeatKeys(targetKey) {
    return Array.from({ length: MAX_SEATS }, (_, index) => localVmSeatKey({ key: targetKey, seat: index + 1 }));
}
/** Synchronous, so two turns never both see a seat as free. Independent of the per-target lifecycle lock in
 * `local-vm-lease.ts`: seat ids are `seat:<n>` and never equal a target key. */
export class SeatLeaseTable {
    leases = new Map();
    ttlMs;
    configured;
    /** `capacity` may be a function, so a config change applies to the next acquire without dropping held leases. */
    constructor(capacity, ttlMs) {
        if (!Number.isFinite(ttlMs) || ttlMs <= 0)
            throw new Error("Seat lease TTL must be positive");
        this.configured = typeof capacity === "function" ? capacity : () => capacity;
        this.ttlMs = ttlMs;
    }
    get capacity() {
        return seatCapacity(this.configured());
    }
    live(seat, now) {
        const lease = this.leases.get(seat);
        if (lease && lease.expiresAt <= now) {
            this.leases.delete(seat);
            return null;
        }
        return lease ?? null;
    }
    leasedSeats(now = Date.now()) {
        const seats = [];
        for (let seat = 1; seat <= MAX_SEATS; seat++)
            if (this.live(seat, now))
                seats.push(seat);
        return seats;
    }
    holderOf(seat, now = Date.now()) {
        const lease = this.live(seat, now);
        return lease ? { ...lease } : null;
    }
    heldBy(threadId, now = Date.now()) {
        for (let seat = 1; seat <= MAX_SEATS; seat++) {
            const lease = this.live(seat, now);
            if (lease?.threadId === threadId)
                return { ...lease };
        }
        return null;
    }
    acquire(request, now = Date.now()) {
        const { ownerId, threadId } = request;
        if (!ownerId || !threadId)
            return { ok: false, reason: "invalid-request" };
        let wanted;
        if (request.seat !== undefined) {
            const parsed = parseSeat(request.seat);
            if (parsed === null || parsed > this.capacity)
                return { ok: false, reason: "seat-out-of-range" };
            wanted = parsed;
        }
        const held = this.heldBy(threadId, now);
        if (held) {
            if (held.ownerId !== ownerId)
                return { ok: false, reason: "seat-taken" };
            if (wanted !== undefined && wanted !== held.seat.seat)
                return { ok: false, reason: "thread-holds-other-seat" };
            return { ok: true, lease: this.grant(held.seat.seat, ownerId, threadId, now) };
        }
        if (wanted !== undefined) {
            if (this.live(wanted, now))
                return { ok: false, reason: "seat-taken" };
            return { ok: true, lease: this.grant(wanted, ownerId, threadId, now) };
        }
        for (let seat = 1; seat <= this.capacity; seat++) {
            if (!this.live(seat, now))
                return { ok: true, lease: this.grant(seat, ownerId, threadId, now) };
        }
        return { ok: false, reason: "no-free-seat" };
    }
    heartbeat(seat, ownerId, threadId, now = Date.now()) {
        const lease = this.live(seat, now);
        if (!lease || lease.ownerId !== ownerId || lease.threadId !== threadId)
            return false;
        lease.expiresAt = now + this.ttlMs;
        return true;
    }
    release(seat, ownerId, threadId, now = Date.now()) {
        const lease = this.live(seat, now);
        if (!lease || lease.ownerId !== ownerId || lease.threadId !== threadId)
            return false;
        this.leases.delete(seat);
        return true;
    }
    /** For a deleted or forked-away thread, whose owner may no longer exist to release it. */
    releaseThread(threadId) {
        for (const [seat, lease] of this.leases)
            if (lease.threadId === threadId)
                this.leases.delete(seat);
    }
    grant(seat, ownerId, threadId, now) {
        const lease = { seat: seatIdentity(seat), ownerId, threadId, expiresAt: now + this.ttlMs };
        this.leases.set(seat, lease);
        return { ...lease };
    }
}
