import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SeatIdleRegistry } from "./local-vm-seat-idle.ts";

const IDLE = 15 * 60_000;

function registry(inUse: (seat: number) => boolean = () => false, stop?: (seat: number) => Promise<void>) {
  const stopped: number[] = [];
  const seats = new SeatIdleRegistry({
    idleMs: () => IDLE,
    inUse,
    stop: stop ?? (async (seat) => { stopped.push(seat); }),
  });
  return { seats, stopped };
}

describe("SeatIdleRegistry", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("stops an idle seat while another seat stays busy, and never handles seat 1", async () => {
    const { seats, stopped } = registry();
    seats.touch(1);
    seats.touch(2);
    seats.touch(3);
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    seats.touch(3);
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(stopped).toEqual([2]);
    expect(seats.alive()).toEqual([3]);
    await vi.advanceTimersByTimeAsync(IDLE / 2);
    expect(stopped).toEqual([2, 3]);
    expect(seats.alive()).toEqual([]);
  });

  it("keeps a seat that is touched before its window ends", async () => {
    const { seats, stopped } = registry();
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE - 1);
    expect(stopped).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).toEqual([2]);
  });

  it("does not stop a seat in use and gives it a full quiet window once it is free", async () => {
    let busy = true;
    const { seats, stopped } = registry(() => busy);
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE * 2);
    expect(stopped).toEqual([]);
    busy = false;
    await vi.advanceTimersByTimeAsync(IDLE / 10);
    expect(stopped).toEqual([]);
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(stopped).toEqual([2]);
  });

  it("keeps watching a seat that a turn took while its stop was running", async () => {
    let busy = false;
    let finish!: () => void;
    const { seats } = registry(() => busy, () => new Promise<void>((resolve) => { finish = resolve; }));
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE);
    let settled = false;
    void seats.settled(2).then(() => { settled = true; });
    busy = true;
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    expect(seats.alive()).toEqual([2]);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
    expect(seats.alive()).toEqual([2]);
  });

  it("stops each seat once, and forgets every seat when the machine stops", async () => {
    const { seats, stopped } = registry();
    seats.touch(2);
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE * 3);
    expect(stopped).toEqual([2]);
    seats.touch(3);
    seats.forgetAll();
    await vi.advanceTimersByTimeAsync(IDLE * 2);
    expect(stopped).toEqual([2]);
    expect(seats.alive()).toEqual([]);
  });

  it("retries a failed stop and keeps the seat alive meanwhile", async () => {
    let fail = true;
    const stopped: number[] = [];
    const { seats } = registry(() => false, async (seat) => { if (fail) throw new Error("docker exec failed"); stopped.push(seat); });
    seats.touch(2);
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(seats.alive()).toEqual([2]);
    fail = false;
    await vi.advanceTimersByTimeAsync(IDLE);
    expect(stopped).toEqual([2]);
    expect(seats.alive()).toEqual([]);
  });
});
