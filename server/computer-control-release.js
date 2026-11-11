export function startControlAutoRelease(deps) {
    const now = deps.now ?? Date.now;
    const graceMs = deps.graceMs ?? 60_000;
    const intervalMs = deps.intervalMs ?? 5_000;
    const zeroViewersSince = new Map();
    const tick = () => {
        const held = new Set(deps.heldKeys());
        for (const key of zeroViewersSince.keys()) {
            if (!held.has(key))
                zeroViewersSince.delete(key);
        }
        const currentTime = now();
        for (const key of held) {
            const targetId = deps.targetIdFor(key);
            if (targetId === null) {
                zeroViewersSince.delete(key);
                continue;
            }
            const count = deps.openViewers(targetId);
            if (count > 0) {
                zeroViewersSince.delete(key);
                continue;
            }
            const since = zeroViewersSince.get(key);
            if (since === undefined) {
                zeroViewersSince.set(key, currentTime);
                if (graceMs <= 0) {
                    zeroViewersSince.delete(key);
                    try {
                        deps.release(key);
                    }
                    catch (error) {
                        console.warn(`control auto-release ${key}:`, error);
                    }
                }
            }
            else if (currentTime - since >= graceMs) {
                zeroViewersSince.delete(key);
                try {
                    deps.release(key);
                }
                catch (error) {
                    console.warn(`control auto-release ${key}:`, error);
                }
            }
        }
    };
    tick();
    const timer = setInterval(tick, intervalMs);
    timer.unref?.();
    return () => {
        clearInterval(timer);
        zeroViewersSince.clear();
    };
}
