// Whose About me a preference saved in a turn goes to (memory-forget.ts `prefer`): the person whose own words began this
// work, so one line there, which every bot reads in their work, replaces telling each bot. On a Team Cloud that is the
// person the turn acts for (acting-person.ts): their own message, or work handed on from it, and nobody's once another
// person's words joined. Elsewhere it is the one person, when their own message began the work. A routine, a webhook, an
// outside app and a bot's own work save no one's preference.
import type { AboutMe } from "../about-me.ts";
import type { PreferenceTarget } from "../memory-forget.ts";

type Turn = { threadId: string; generation: string };

export interface PersonPreferenceDeps<T extends Turn> {
  aboutMe: Pick<AboutMe, "learn">;
  /** Whether a person's own message began this turn's work, directly or handed on. */
  userStarted(turn: T): boolean;
}

export function createPersonPreference<T extends Turn>(deps: PersonPreferenceDeps<T>) {
  return {
    /** Where `bot`'s turn may save a preference; null when no one person's own words began its work. */
    target(turn: T, bot: { id: string; name: string }): PreferenceTarget | null {
      return deps.userStarted(turn) ? { save: (text) => deps.aboutMe.learn({ botId: bot.id, botName: bot.name }, [text]) } : null;
    },
  };
}

export type PersonPreference<T extends Turn> = ReturnType<typeof createPersonPreference<T>>;
