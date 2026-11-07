/** A turn the person stopped loses the voice notes it recorded; every other turn, a failed one included, keeps all its
 * files. A note's words stay on it as its transcript, redacted. */
export function settleParkedFiles(parked, stopped, redact) {
    const land = [];
    const discard = [];
    for (const file of parked) {
        if (file.kind !== "audio")
            land.push(file);
        else if (stopped)
            discard.push(file);
        else
            land.push({ kind: "audio", path: file.path, mime: file.mime, ...(file.text?.trim() ? { text: redact(file.text.trim()) } : {}) });
    }
    return { land, discard };
}
