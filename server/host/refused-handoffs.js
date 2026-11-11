// A routine's run that tried to hand work to a bot it may not reach. coordinate_bots refuses while the turn runs, and the
// model may say anything after, so the run keeps who it was refused and ends saying so plainly, instead of "completed":
// nothing arrived. The person who wrote the routine reads it in their inbox, whoever else the bot's failures reach.
import { namesTeammate, reachesInAudience, unreachableTeammate } from "../peer-roster.js";
import { serverLine } from "../server-lines.js";
export function createRefusedHandoffs(deps) {
    const refused = new Map();
    function words(threadId, seen) {
        const language = deps.language(threadId), bot = seen[0].from.name;
        const named = (some) => some.map(({ target }) => target.name).join(", ");
        const apart = seen.filter(({ from, target }) => !reachesInAudience(from, target)), listed = seen.filter(({ from, target }) => reachesInAudience(from, target));
        return [
            ...(apart.length ? [serverLine(language, "server.runs.handoffApart", { bot, target: named(apart) })] : []),
            ...(listed.length ? [serverLine(language, "server.runs.handoffNotListed", { bot, target: named(listed) })] : []),
        ].join(" ");
    }
    return {
        /** A coordinate_bots call in a routine's run came back: remembers the bots it could not reach, and forgets one it has reached since. */
        settled(threadId, from, named, status) {
            if (!deps.runOf(threadId))
                return;
            const seen = refused.get(threadId) ?? new Map();
            for (const raw of named) {
                const target = status >= 400 ? unreachableTeammate(deps.bots(), from, raw) : null;
                if (target)
                    seen.set(target.id, { target, from });
                if (status < 400)
                    for (const [id, was] of seen)
                        if (namesTeammate(was.target, raw))
                            seen.delete(id);
            }
            if (seen.size)
                refused.set(threadId, seen);
            else
                refused.delete(threadId);
        },
        /** The run in this conversation is ending well: what it must say instead, once; null when nothing was refused. */
        take(threadId) {
            const seen = [...refused.get(threadId)?.values() ?? []];
            if (!seen.length)
                return null;
            refused.delete(threadId);
            const said = words(threadId, seen);
            return said;
        },
    };
}
