// Whose turn may use the desktop owner's phones, off a Cloud home: the Cloud lending test with
// the desktop's owner in place of the Cloud owner. The owner is whoever works at this machine or holds an admin session;
// a bot's ask counts only as this turn's own request, and only while the work it carries came from the user; a routine's
// run and its reports are the owner's only while the owner wrote it and nobody else has changed it since; a webhook's
// payload and an outside event's run stay someone else's words.
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";
import { writeFileAtomic } from "../atomic.js";
export function ownerOnlyConversation(thread, ownerPerson, cardAnswerer, skipId) {
    for (const line of thread) {
        if (line.id === skipId)
            continue;
        if (line.role === "user") {
            const person = line.sender?.id;
            if (!ownerPerson(person))
                return false;
        }
        if (line.card && (line.card.answered || line.card.answeredText)) {
            const person = cardAnswerer(line.card);
            if (!ownerPerson(person))
                return false;
        }
    }
    return true;
}
export function cloudHomeLendingRefusal(turn) {
    const { request } = turn;
    if (!request?.messageId || request.stopped || !request.generations.has(turn.generation))
        return "unproven";
    const index = turn.thread.findIndex((line) => line.id === request.messageId);
    if (index < 0)
        return "unproven";
    let owner;
    if (request.automation === undefined) {
        owner = turn.ownerPerson(turn.thread[index]?.sender?.id);
    }
    else {
        const run = turn.routineRun();
        owner = request.automation !== "webhook" && request.automation !== "api" && Boolean(run) && run.triggerSource !== "webhook" &&
            run.ownerAuthored === true && (run.triggerSource !== "manual" || run.ownerStarted === true);
    }
    if (!owner)
        return "not-owner";
    if (turn.starters?.some((person) => person !== undefined && !turn.ownerPerson(person)))
        return "someone-else";
    if (turn.botOpened || turn.reportsFromOthers)
        return "someone-else";
    const clean = ownerOnlyConversation(turn.thread, turn.ownerPerson, turn.cardAnswerer, request.automation !== undefined ? request.messageId : undefined);
    return clean ? null : "someone-else";
}
const authorsSchema = z.object({
    version: z.literal(1),
    routines: z.record(z.string(), z.string()).default({}),
    writers: z.record(z.string(), z.string()).default({}),
});
export function createCloudRoutineAuthors(file) {
    let routines = {};
    let writers = {};
    try {
        if (existsSync(file)) {
            const parsed = authorsSchema.parse(JSON.parse(readFileSync(file, "utf8")));
            routines = parsed.routines;
            writers = parsed.writers;
        }
    }
    catch {
        routines = {};
        writers = {};
    }
    const save = () => writeFileAtomic(file, JSON.stringify({ version: 1, routines, writers }), { mode: 0o600 });
    return {
        record(id, routine) {
            routines = { ...routines, [id]: routine.prompt ? createHash("sha256").update(routine.prompt).digest("hex") : "" };
            save();
        },
        forget(id) {
            if (Object.hasOwn(routines, id)) {
                const next = { ...routines };
                delete next[id];
                routines = next;
                save();
            }
        },
        wrote(id, person) {
            if (writers[id] !== person) {
                writers = { ...writers, [id]: person };
                save();
            }
        },
        writer(id) {
            return Object.hasOwn(writers, id) ? writers[id] : undefined;
        },
        remove(id) {
            if (!Object.hasOwn(routines, id) && !Object.hasOwn(writers, id))
                return;
            const nextRoutines = { ...routines };
            delete nextRoutines[id];
            routines = nextRoutines;
            const nextWriters = { ...writers };
            delete nextWriters[id];
            writers = nextWriters;
            save();
        },
        authored(id, routine) {
            return Object.hasOwn(routines, id) && routines[id] === (routine.prompt ? createHash("sha256").update(routine.prompt).digest("hex") : "");
        },
        persist() { save(); },
    };
}
/** A person no owner test accepts: a bot's ask outside the user's work, a relayed line, a worker's answer, or a session
 * answer with no recorded person. Never a session's person key, which is a hash. */
export const NOT_THE_OWNER = "not-the-owner";
/** One desktop owner exists only where one person uses this server: never where sign-in lets several people in (each
 * admin would reach every admin's phones), and never where a request from this machine is a service, not the owner. */
export function desktopPhonesOffered(server) {
    return !server.sharedMembership && server.loopbackTrust !== "service";
}
/** Routines written before this desktop kept authorship records have none, so the owner's own brief or reminder would
 * count as someone else's words in every conversation it reports into. On the first start with records, where one person
 * uses this server and no other person holds a session here, those routines can only be the owner's: record them once.
 * The record is kept even when there is nothing to adopt, so a routine added later is never adopted by a later start. */
export function adoptExistingRoutines(input) {
    if (input.recordsExisted || !input.offered || input.otherPeople)
        return 0;
    for (const routine of input.routines)
        input.record(routine);
    input.persist();
    return input.routines.length;
}
/** The routine a report or run card speaks for; an outside event's run names its trigger, which is no routine. */
const routineOf = (line) => line.automation?.routineId ?? (line.kind === "routine.run" ? line.routineRun?.routineId : undefined);
export function desktopLendingTurn(base, deps) {
    let admins;
    const ownerPerson = (person) => person === undefined || (admins ??= deps.adminPersons()).has(person);
    // A bot's ask names no person, so only the work's origin can vouch for it, and only for this turn's own request: an
    // earlier ask in the conversation may have carried another chain's work, which nothing recorded.
    const vouched = deps.originIsUser() ? base.request?.messageId : undefined;
    // A relayed line names no person either, and nobody here vouches for it.
    const thread = base.thread.map((line) => (line.role === "user" && (line.relayed === true || (line.peerAsk && line.id !== vouched)) ? { ...line, peerAsk: undefined, sender: { id: NOT_THE_OWNER } } : line));
    return {
        ...base,
        thread,
        ownerPerson,
        cardAnswerer: (card) => {
            const by = card?.answeredBy;
            if (!by)
                return base.cardAnswerer?.(card);
            if (by.kind === "loopback")
                return undefined;
            return by.kind === "session" && by.person ? by.person : NOT_THE_OWNER;
        },
        // Off a Cloud the work a conversation was opened with is vouched for by its origin, as a bot's ask is, not by who opened it.
        botOpened: false,
        reportsFromOthers: base.thread.some((line) => {
            if (line.webhookPost === true)
                return true;
            const routine = routineOf(line);
            return routine !== undefined && !deps.ownerWrote(routine);
        }),
        // Written comes from the harness's record of who wrote the routine (server/index.ts). Started: a schedule or a restart
        // starts it on its writer's behalf; by hand, only the owner's own start counts; a webhook never.
        routineRun: () => {
            const run = base.routineRun();
            return run && { ...run, ownerStarted: run.triggerSource === "manual" ? run.ownerStarted : run.triggerSource !== "webhook" };
        },
    };
}
