// A turn's memory writes wait here until the turn succeeds; held in this process only, so a restart drops them.
import { join } from "node:path";
import { lineFactIdentity, notebookIdentities, passageMatcher } from "./memory-entries.js";
import { botMemoryUpdate, memoryUpdateOf, preferenceToSave, withoutMentions } from "./memory-forget.js";
import { appendMemoryLog, currentMemoryNotes, planMemoryLog, planMemoryUpdate, readMemoryText, workspaceDir } from "./workspace.js";
class MemoryStage {
    writes = [];
    notesByLayer = new Map();
    /** The layer's MEMORY.md as this turn sees it: what is on disk with this turn's staged changes. */
    notes(layer) {
        let notes = this.notesByLayer.get(layer);
        if (notes === undefined) {
            notes = currentMemoryNotes(layer);
            this.notesByLayer.set(layer, notes);
        }
        return notes;
    }
    add(write, notes) {
        this.writes.push(write);
        if (notes !== undefined)
            this.notesByLayer.set(write.layer, notes);
    }
    /** Drops the staged writes to `layer` that mention the passage and returns their texts. */
    forget(layer, mentions) {
        const dropped = [];
        for (let index = this.writes.length - 1; index >= 0; index -= 1) {
            const write = this.writes[index];
            if (write.layer !== layer || write.text === undefined || !mentions(write.text))
                continue;
            this.writes.splice(index, 1);
            dropped.unshift(write.text);
        }
        const notes = this.notesByLayer.get(layer);
        if (notes !== undefined)
            this.notesByLayer.set(layer, withoutMentions(notes, mentions).text);
        return dropped;
    }
    commit() {
        let committed = 0;
        for (const write of this.writes) {
            try {
                write.commit();
                committed += 1;
            }
            catch (error) {
                console.error(`memory-stage: could not save a staged note for ${write.layer}:`, error instanceof Error ? error.message : error);
            }
        }
        return committed;
    }
}
const stages = new Map();
/** A thread runs one turn at a time: what an earlier turn left unsettled is dropped, never saved by this one. */
export function openMemoryStage(threadId) {
    stages.set(threadId, new MemoryStage());
}
export function memoryStage(threadId) {
    return stages.get(threadId);
}
/** Saves the thread's staged writes when its turn succeeded and drops them otherwise; each stage settles once. */
export function settleMemoryStage(threadId, succeeded) {
    const stage = stages.get(threadId);
    if (!stage)
        return 0;
    stages.delete(threadId);
    return succeeded ? stage.commit() : 0;
}
/** memory_update in a live turn: answered now from the staged view, written when the turn succeeds. forget is not
 * staged: it removes at once and drops the staged notes it names. */
export function stageBotMemoryUpdate(stage, layer, body, opts, write = (change) => change()) {
    if (body.action === "forget") {
        const result = write(() => botMemoryUpdate(layer, body, opts));
        const mentions = passageMatcher(typeof body.oldText === "string" ? body.oldText : "");
        if (!result.ok || !("forgotten" in result) || !mentions)
            return result;
        return { ...result, forgotten: [...result.forgotten, ...stage.forget(layer, mentions)] };
    }
    const staged = { ...opts, now: new Date() };
    const commit = () => {
        const result = write(() => botMemoryUpdate(layer, body, staged));
        if (!result.ok)
            console.warn(`memory-stage: a staged note for ${layer} no longer applies: ${result.error}`);
    };
    if (body.action === "prefer") {
        const preference = preferenceToSave(body, opts.prefer);
        if (!preference.ok)
            return preference;
        stage.add({ layer, text: preference.text, commit });
        return { ok: true, preference: "saved", ...(opts.prefer.person ? { person: opts.prefer.person } : {}) };
    }
    const plan = planMemoryUpdate(memoryUpdateOf(body), () => stage.notes(layer), { source: opts.source, now: staged.now });
    if (!plan.ok)
        return plan;
    const { notes, ...result } = plan;
    const appended = body.action === "append" ? result.entry : undefined;
    stage.add({
        layer,
        text: typeof body.text === "string" ? body.text : undefined,
        // Saved once: a turn run again after a restart finds its note already there.
        commit: () => {
            if (appended && notebookIdentities(currentMemoryNotes(layer)).has(lineFactIdentity(appended)))
                return;
            commit();
        },
    }, notes);
    return result;
}
const LOG_TIME = /^- \d{2}:\d{2} · /;
function loggedToday(layer, file, line) {
    let text;
    try {
        text = readMemoryText(join(workspaceDir(layer), file));
    }
    catch {
        return false;
    }
    const said = line.replace(LOG_TIME, "");
    return text.split("\n").some((logged) => logged.replace(LOG_TIME, "") === said);
}
/** memory_log in a live turn: the line it will add, written when the turn succeeds. */
export function stageMemoryLog(stage, layer, text, opts, write = (change) => change()) {
    const staged = { ...opts, now: new Date() };
    const plan = planMemoryLog(text, staged);
    if (!plan.ok)
        return plan;
    stage.add({
        layer,
        commit: () => {
            if (loggedToday(layer, plan.file, plan.line))
                return;
            write(() => appendMemoryLog(layer, text, staged));
        },
    });
    return plan;
}
