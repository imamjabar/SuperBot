import { ComputerIdleTimer } from "./computer-idle.js";
/** One idle window per extra seat of the shared desktop. Seat 1 is the container itself and stops with the
 * machine's own idle timer, which must treat every seat listed by `alive()` as busy. */
export class SeatIdleRegistry {
    timers = new Map();
    stopping = new Map();
    options;
    constructor(options) {
        this.options = options;
    }
    touch(seat) {
        if (seat === 1)
            return;
        let timer = this.timers.get(seat);
        if (!timer) {
            timer = new ComputerIdleTimer(this.options.idleMs(), () => this.options.inUse(seat), () => this.stopSeat(seat), (error, retryInMs) => this.options.onFailure?.(seat, error, retryInMs));
            this.timers.set(seat, timer);
        }
        else {
            timer.setIdleMs(this.options.idleMs());
        }
        timer.touch();
    }
    alive() {
        return [...new Set([...this.timers.keys(), ...this.stopping.keys()])].sort((a, b) => a - b);
    }
    /** Resolves once any stop of this seat already in flight has finished, so a new turn never starts a seat mid-stop. */
    async settled(seat) {
        await this.stopping.get(seat)?.catch(() => { });
    }
    forgetAll() {
        for (const timer of this.timers.values())
            timer.cancel();
        this.timers.clear();
    }
    async stopSeat(seat) {
        if (this.options.inUse(seat))
            return "busy";
        const stop = this.options.stop(seat);
        this.stopping.set(seat, stop);
        try {
            await stop;
        }
        finally {
            if (this.stopping.get(seat) === stop)
                this.stopping.delete(seat);
        }
        if (this.options.inUse(seat))
            return "busy";
        this.timers.get(seat)?.cancel();
        this.timers.delete(seat);
    }
}
