import { ComputerIdleTimer } from "./computer-idle.ts";

export interface SeatIdleOptions {
  idleMs: () => number;
  inUse: (seat: number) => boolean;
  stop: (seat: number) => Promise<void>;
  onFailure?: (seat: number, error: unknown, retryInMs: number) => void;
}

/** One idle window per extra seat of the shared desktop. Seat 1 is the container itself and stops with the
 * machine's own idle timer, which must treat every seat listed by `alive()` as busy. */
export class SeatIdleRegistry {
  private readonly timers = new Map<number, ComputerIdleTimer>();
  private readonly stopping = new Map<number, Promise<void>>();
  private readonly options: SeatIdleOptions;

  constructor(options: SeatIdleOptions) {
    this.options = options;
  }

  touch(seat: number): void {
    if (seat === 1) return;
    let timer = this.timers.get(seat);
    if (!timer) {
      timer = new ComputerIdleTimer(
        this.options.idleMs(),
        () => this.options.inUse(seat),
        () => this.stopSeat(seat),
        (error, retryInMs) => this.options.onFailure?.(seat, error, retryInMs),
      );
      this.timers.set(seat, timer);
    } else {
      timer.setIdleMs(this.options.idleMs());
    }
    timer.touch();
  }

  alive(): number[] {
    return [...new Set([...this.timers.keys(), ...this.stopping.keys()])].sort((a, b) => a - b);
  }

  /** Resolves once any stop of this seat already in flight has finished, so a new turn never starts a seat mid-stop. */
  async settled(seat: number): Promise<void> {
    await this.stopping.get(seat)?.catch(() => {});
  }

  forgetAll(): void {
    for (const timer of this.timers.values()) timer.cancel();
    this.timers.clear();
  }

  private async stopSeat(seat: number): Promise<void | "busy"> {
    if (this.options.inUse(seat)) return "busy";
    const stop = this.options.stop(seat);
    this.stopping.set(seat, stop);
    try {
      await stop;
    } finally {
      if (this.stopping.get(seat) === stop) this.stopping.delete(seat);
    }
    if (this.options.inUse(seat)) return "busy";
    this.timers.get(seat)?.cancel();
    this.timers.delete(seat);
  }
}
