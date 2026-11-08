import { useEffect, useState } from "react";

import { fetchMemoryDoc, MEMORY_INDEX, type MemoryDoc } from "@/lib/memory";
import type { Bot } from "@/state/store";

export interface MemoryNotesState {
  /** MEMORY.md first; on a Team Cloud also the person's topic files. Null until read. */
  docs: MemoryDoc[] | null;
  error: boolean;
  setDoc: (doc: MemoryDoc) => void;
  reload: () => Promise<void>;
}


/** The notes the bot panel shows for a bot whose memory is on. They are read again as a turn starts and ends, so a note
 * the bot just saved shows. */
export function useMemoryDoc(bot: Pick<Bot, "id" | "memoryEnabled" | "busy">): MemoryNotesState {
  const [state, setState] = useState<{ botId: string; docs: MemoryDoc[] | null; error: boolean }>({ botId: bot.id, docs: null, error: false });
  const memoryOn = bot.memoryEnabled !== false;

  const read = async (botId: string, cancelled?: () => boolean) => {
    try {
      const docs = [await fetchMemoryDoc(botId, MEMORY_INDEX)];
      if (!cancelled?.()) setState({ botId, docs, error: false });
    } catch {
      if (!cancelled?.()) setState({ botId, docs: null, error: true });
    }
  };

  const busy = Boolean(bot.busy);
  useEffect(() => {
    if (!memoryOn) return;
    let cancelled = false;
    void read(bot.id, () => cancelled);
    return () => { cancelled = true; };
  }, [bot.id, memoryOn, busy]);

  const own = state.botId === bot.id;
  return {
    docs: own ? state.docs : null,
    error: own && state.error,
    setDoc: (doc) => setState((current) => ({
      botId: bot.id,
      docs: (current.botId === bot.id ? current.docs ?? [] : []).map((existing) => existing.path === doc.path ? doc : existing),
      error: false,
    })),
    reload: () => read(bot.id),
  };
}
