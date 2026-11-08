// A routine's run that tried to hand work to a bot it may not reach. coordinate_bots refuses while the turn runs, and the
// model may say anything after, so the run keeps who it was refused and ends saying so plainly, instead of "completed":
// nothing arrived. The person who wrote the routine reads it in their inbox, whoever else the bot's failures reach.
import { namesTeammate, reachesInAudience, unreachableTeammate, type RosterMember } from "../peer-roster.ts";
import { serverLine } from "../server-lines.ts";
export interface Delivery {
  kind?: string;
  from: { name: string; email?: string; botId?: string };
  text: string;
  notice?: { kind: string; title: string };
  origin?: { botId: string; threadId: string; groupId?: string; messageId?: string };
}

type Refused = { target: RosterMember; from: RosterMember };

export interface RefusedHandoffDeps {
  bots(): readonly RosterMember[];
  /** The run this conversation is, when it is one. */
  runOf(threadId: string): { routineId: string; botId: string } | undefined;
  /** The language of a line in this conversation. */
  language(threadId: string): string | undefined;
}

export function createRefusedHandoffs(deps: RefusedHandoffDeps) {
  const refused = new Map<string, Map<string, Refused>>();

  function words(threadId: string, seen: readonly Refused[]): string {
    const language = deps.language(threadId), bot = seen[0]!.from.name;
    const named = (some: readonly Refused[]) => some.map(({ target }) => target.name).join(", ");
    const apart = seen.filter(({ from, target }) => !reachesInAudience(from, target)), listed = seen.filter(({ from, target }) => reachesInAudience(from, target));
    return [
      ...(apart.length ? [serverLine(language, "server.runs.handoffApart", { bot, target: named(apart) })] : []),
      ...(listed.length ? [serverLine(language, "server.runs.handoffNotListed", { bot, target: named(listed) })] : []),
    ].join(" ");
  }

  return {
    /** A coordinate_bots call in a routine's run came back: remembers the bots it could not reach, and forgets one it has reached since. */
    settled(threadId: string, from: RosterMember, named: readonly string[], status: number): void {
      if (!deps.runOf(threadId)) return;
      const seen = refused.get(threadId) ?? new Map<string, Refused>();
      for (const raw of named) {
        const target = status >= 400 ? unreachableTeammate(deps.bots(), from, raw) : null;
        if (target) seen.set(target.id, { target, from });
        if (status < 400) for (const [id, was] of seen) if (namesTeammate(was.target, raw)) seen.delete(id);
      }
      if (seen.size) refused.set(threadId, seen);
      else refused.delete(threadId);
    },
    /** The run in this conversation is ending well: what it must say instead, once; null when nothing was refused. */
    take(threadId: string): string | null {
      const seen = [...refused.get(threadId)?.values() ?? []];
      if (!seen.length) return null;
      refused.delete(threadId);
      const said = words(threadId, seen);
      return said;
    },
  };
}

export type RefusedHandoffs = ReturnType<typeof createRefusedHandoffs>;
