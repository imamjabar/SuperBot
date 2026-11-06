import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startControlAutoRelease } from "./computer-control-release.ts";

describe("startControlAutoRelease", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("releases after grace with no viewer", () => {
    const release = vi.fn();
    let held = ["bot-1"];
    release.mockImplementation((key: string) => {
      held = held.filter((k) => k !== key);
    });

    const stop = startControlAutoRelease({
      heldKeys: () => held,
      targetIdFor: (key) => (key === "bot-1" ? "local/bot-1" : null),
      openViewers: () => 0,
      release,
      graceMs: 60_000,
      intervalMs: 5_000,
    });

    vi.advanceTimersByTime(55_000);
    expect(release).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5_000);
    expect(release).toHaveBeenCalledWith("bot-1");
    expect(release).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(60_000);
    expect(release).toHaveBeenCalledTimes(1);

    stop();
  });

  it("does not release while a viewer is open", () => {
    const release = vi.fn();
    const stop = startControlAutoRelease({
      heldKeys: () => ["bot-1"],
      targetIdFor: (key) => (key === "bot-1" ? "local/bot-1" : null),
      openViewers: () => 1,
      release,
      graceMs: 60_000,
      intervalMs: 5_000,
    });

    vi.advanceTimersByTime(120_000);
    expect(release).not.toHaveBeenCalled();

    stop();
  });

  it("timer resets when viewer reappears", () => {
    const release = vi.fn();
    let viewers = 0;
    const stop = startControlAutoRelease({
      heldKeys: () => ["bot-1"],
      targetIdFor: (key) => (key === "bot-1" ? "local/bot-1" : null),
      openViewers: () => viewers,
      release,
      graceMs: 60_000,
      intervalMs: 5_000,
    });

    vi.advanceTimersByTime(40_000);
    expect(release).not.toHaveBeenCalled();

    viewers = 2;
    vi.advanceTimersByTime(10_000);
    expect(release).not.toHaveBeenCalled();

    viewers = 0;
    vi.advanceTimersByTime(40_000);
    expect(release).not.toHaveBeenCalled();

    vi.advanceTimersByTime(25_000);
    expect(release).toHaveBeenCalledWith("bot-1");

    stop();
  });

  it("ignores null targets", () => {
    const release = vi.fn();
    const stop = startControlAutoRelease({
      heldKeys: () => ["team-1", "cloud-bot"],
      targetIdFor: () => null,
      openViewers: () => 0,
      release,
      graceMs: 60_000,
      intervalMs: 5_000,
    });

    vi.advanceTimersByTime(120_000);
    expect(release).not.toHaveBeenCalled();

    stop();
  });

  it("cleans up on stop", () => {
    const release = vi.fn();
    const stop = startControlAutoRelease({
      heldKeys: () => ["bot-1"],
      targetIdFor: (key) => (key === "bot-1" ? "local/bot-1" : null),
      openViewers: () => 0,
      release,
      graceMs: 60_000,
      intervalMs: 5_000,
    });

    vi.advanceTimersByTime(30_000);
    stop();

    vi.advanceTimersByTime(60_000);
    expect(release).not.toHaveBeenCalled();
  });
});
