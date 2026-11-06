import { describe, expect, it } from "vitest";

import { LocalVmLeasePool } from "./local-vm-lease.ts";
import { MAX_SEATS, SeatLeaseTable, localVmSeatKey, localVmSeatKeys, parseSeat, seatCapacity, seatIdentity } from "./local-vm-seats.ts";

describe("seat identities", () => {
  it("keeps seat 1 on the legacy socket and runtime dir and gives other seats their own", () => {
    expect(seatIdentity(1)).toEqual({
      id: "seat:1", seat: 1, display: ":1", xdgRuntimeDir: "/run/user/1000",
      cuaSocket: "/run/user/1000/openmausbot-cua.sock", vncPort: 5901, viewerPort: 6901,
    });
    expect(seatIdentity(3)).toMatchObject({
      id: "seat:3", display: ":3", xdgRuntimeDir: "/run/user/1000/seat-3",
      cuaSocket: "/run/user/1000/openmausbot-cua-3.sock", viewerPort: 6903,
    });
  });

  it("never shares an id, display, socket, runtime dir or port between seats", () => {
    const seats = [1, 2, 3].map(seatIdentity);
    for (const field of ["id", "display", "cuaSocket", "xdgRuntimeDir", "vncPort", "viewerPort"] as const) {
      expect(new Set(seats.map((seat) => seat[field])).size).toBe(seats.length);
    }
    const targetKeys = ["shared", "pool:1", "pool:2", "pool:3"];
    for (const seat of seats) expect(targetKeys).not.toContain(seat.id);
  });

  it("rejects seats outside 1..3", () => {
    expect(() => seatIdentity(0)).toThrow();
    expect(() => seatIdentity(MAX_SEATS + 1)).toThrow();
    expect(() => seatIdentity(1.5)).toThrow();
  });

  it("parses only whole seats 1..3", () => {
    expect(parseSeat(2)).toBe(2);
    expect(parseSeat("3")).toBe(3);
    expect(parseSeat("seat:1")).toBe(1);
    for (const bad of [0, 4, -1, 1.5, NaN, "", " ", "seat:", "seat:0", "seat:4", "01x", "2.0", "pool:1", null, undefined, {}, [1]]) {
      expect(parseSeat(bad)).toBeNull();
    }
  });

  it("caps configured capacity at three and defaults to one", () => {
    expect(seatCapacity(undefined)).toBe(1);
    expect(seatCapacity("")).toBe(1);
    expect(seatCapacity("abc")).toBe(1);
    expect(seatCapacity(0)).toBe(1);
    expect(seatCapacity(2)).toBe(2);
    expect(seatCapacity("3")).toBe(3);
    expect(seatCapacity(9)).toBe(3);
  });
});

describe("SeatLeaseTable", () => {
  const ttl = 1_000;

  it("gives one seat to only one thread when two race for it", () => {
    const table = new SeatLeaseTable(1, ttl);
    expect(table.acquire({ ownerId: "bot-a", threadId: "t1" }, 0)).toMatchObject({ ok: true, lease: { seat: { id: "seat:1" } } });
    expect(table.acquire({ ownerId: "bot-b", threadId: "t2" }, 0)).toEqual({ ok: false, reason: "no-free-seat" });
    expect(table.acquire({ ownerId: "bot-b", threadId: "t2", seat: 1 }, 0)).toEqual({ ok: false, reason: "seat-taken" });
  });

  it("hands out distinct seats up to capacity and never more than three", () => {
    const table = new SeatLeaseTable(5, ttl);
    expect(table.capacity).toBe(3);
    const seats = ["t1", "t2", "t3"].map((threadId) => table.acquire({ ownerId: "bot", threadId }, 0));
    expect(seats.map((result) => result.ok && result.lease.seat.seat)).toEqual([1, 2, 3]);
    expect(table.acquire({ ownerId: "bot", threadId: "t4" }, 0)).toEqual({ ok: false, reason: "no-free-seat" });
  });

  it("refuses explicit seats beyond the configured capacity", () => {
    const table = new SeatLeaseTable(2, ttl);
    expect(table.acquire({ ownerId: "bot", threadId: "t1", seat: 3 }, 0)).toEqual({ ok: false, reason: "seat-out-of-range" });
    expect(table.acquire({ ownerId: "bot", threadId: "t1", seat: 2 }, 0)).toMatchObject({ ok: true, lease: { seat: { seat: 2 } } });
  });

  it("is reentrant for the same thread and owner, and keeps a thread on one seat", () => {
    const table = new SeatLeaseTable(3, ttl);
    table.acquire({ ownerId: "bot", threadId: "t1", seat: 2 }, 0);
    expect(table.acquire({ ownerId: "bot", threadId: "t1" }, 500)).toMatchObject({ ok: true, lease: { seat: { seat: 2 }, expiresAt: 1_500 } });
    expect(table.acquire({ ownerId: "bot", threadId: "t1", seat: 3 }, 500)).toEqual({ ok: false, reason: "thread-holds-other-seat" });
    expect(table.acquire({ ownerId: "other", threadId: "t1" }, 500)).toEqual({ ok: false, reason: "seat-taken" });
  });

  it("expires at the deadline unless the holder heartbeats", () => {
    const table = new SeatLeaseTable(1, ttl);
    table.acquire({ ownerId: "bot", threadId: "t1" }, 0);
    expect(table.heartbeat(1, "bot", "t2", 900)).toBe(false);
    expect(table.heartbeat(1, "bot", "t1", 900)).toBe(true);
    expect(table.acquire({ ownerId: "bot", threadId: "t2" }, 1_899)).toEqual({ ok: false, reason: "no-free-seat" });
    expect(table.acquire({ ownerId: "bot", threadId: "t2" }, 1_900)).toMatchObject({ ok: true, lease: { threadId: "t2" } });
    expect(table.heartbeat(1, "bot", "t1", 1_900)).toBe(false);
  });

  it("releases only for the holding owner and thread", () => {
    const table = new SeatLeaseTable(1, ttl);
    table.acquire({ ownerId: "bot", threadId: "t1" }, 0);
    expect(table.release(1, "other", "t1", 0)).toBe(false);
    expect(table.release(1, "bot", "t2", 0)).toBe(false);
    expect(table.heldBy("t1", 0)).not.toBeNull();
    expect(table.release(1, "bot", "t1", 0)).toBe(true);
    expect(table.heldBy("t1", 0)).toBeNull();
  });

  it("frees a deleted thread's seat without its owner", () => {
    const table = new SeatLeaseTable(1, ttl);
    table.acquire({ ownerId: "bot", threadId: "t1" }, 0);
    table.releaseThread("t1");
    expect(table.acquire({ ownerId: "bot", threadId: "t2" }, 0)).toMatchObject({ ok: true });
  });

  it("rejects requests without an owner or thread", () => {
    const table = new SeatLeaseTable(1, ttl);
    expect(table.acquire({ ownerId: "", threadId: "t1" }, 0)).toEqual({ ok: false, reason: "invalid-request" });
    expect(table.acquire({ ownerId: "bot", threadId: "" }, 0)).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("does not touch the machine lifecycle lock", () => {
    const pool = new LocalVmLeasePool(ttl);
    const table = new SeatLeaseTable(1, ttl);
    expect(pool.forTarget("shared").claim("t1", "bot", () => true, 0)).toBe(true);
    expect(table.acquire({ ownerId: "bot", threadId: "t2" }, 0)).toMatchObject({ ok: true });
    expect(pool.forTarget("shared").claim("t2", "bot", () => true, 0)).toBe(false);
  });

  it("applies a capacity change to the next acquire without dropping held seats", () => {
    let configured = 2;
    const table = new SeatLeaseTable(() => configured, ttl);
    table.acquire({ ownerId: "bot", threadId: "t1" }, 0);
    table.acquire({ ownerId: "bot", threadId: "t2" }, 0);
    configured = 1;
    expect(table.leasedSeats(0)).toEqual([1, 2]);
    expect(table.acquire({ ownerId: "bot", threadId: "t2" }, 0)).toMatchObject({ ok: true, lease: { seat: { seat: 2 } } });
    table.release(1, "bot", "t1", 0);
    expect(table.acquire({ ownerId: "bot", threadId: "t3" }, 0)).toMatchObject({ ok: true, lease: { seat: { seat: 1 } } });
    configured = 3;
    expect(table.acquire({ ownerId: "bot", threadId: "t4" }, 0)).toMatchObject({ ok: true, lease: { seat: { seat: 3 } } });
  });
});

describe("seat lock keys", () => {
  it("keeps seat 1 on the bare target key and gives other seats distinct keys", () => {
    expect(localVmSeatKey({ key: "shared" })).toBe("shared");
    expect(localVmSeatKey({ key: "shared", seat: 1 })).toBe("shared");
    expect(localVmSeatKeys("shared")).toEqual(["shared", "shared#seat:2", "shared#seat:3"]);
  });
});
