export function timingLine(mark, ms, fields = {}) {
    const extra = Object.entries(fields).filter(([, value]) => value !== undefined && value !== "").map(([key, value]) => ` ${key}=${value}`).join("");
    return `[omb-timing] ${mark} ms=${Math.max(0, Math.round(ms))}${extra}`;
}
export function logTiming(mark, ms, fields) {
    console.log(timingLine(mark, ms, fields));
}
