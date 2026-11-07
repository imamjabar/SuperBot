// What each thread's running turn is doing right now, read from the live runtime frames: the engine's own report of a
// tool call (turn.progress), reasoning or reply text streaming, and the turn's end. Held per thread outside the app
// reducer, so a frame re-renders only the chat that shows that thread, and only when what it shows changes.
import { useSyncExternalStore } from "react";

import type { RuntimeEvent } from "../../shared/runtime-events";
import { progressKey, type TurnProgressActivity, type TurnProgressFields } from "../../shared/turn-progress";

export type LiveStatus =
  | ({ activity: TurnProgressActivity } & Omit<TurnProgressFields, "type" | "activity">)
  | { activity: "thinking" | "reply"; itemId?: undefined };

export interface TurnLive {
  turnId?: string;
  /** The newest turn this thread showed has completed, failed or stopped. */
  ended: boolean;
  status: LiveStatus | null;
  lastStep?: LiveStatus | null;
  waiting?: { resource: string } | null;
}

const UNKNOWN: TurnLive = { ended: false, status: null };
const MAX_THREADS = 500;
const threads = new Map<string, TurnLive>();
const listeners = new Map<string, Set<() => void>>();

function sameStatus(a: LiveStatus | null, b: LiveStatus | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return ("bytes" in a ? a.bytes : undefined) === ("bytes" in b ? b.bytes : undefined) && progressKey(a) === progressKey(b);
}

function sameWaiting(a: { resource: string } | null | undefined, b: { resource: string } | null | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.resource === b.resource;
}

function isNamedStep(status: LiveStatus | null | undefined): boolean {
  if (!status) return false;
  const { activity } = status;
  if (
    activity !== "web" &&
    activity !== "fetch" &&
    activity !== "read" &&
    activity !== "command" &&
    activity !== "write" &&
    activity !== "edit"
  ) {
    return false;
  }
  return Boolean(("target" in status && status.target) || ("file" in status && status.file));
}

function put(threadId: string, next: TurnLive): void {
  const current = threads.get(threadId);
  if (
    current &&
    current.turnId === next.turnId &&
    current.ended === next.ended &&
    sameStatus(current.status, next.status) &&
    sameStatus(current.lastStep ?? null, next.lastStep ?? null) &&
    sameWaiting(current.waiting, next.waiting)
  ) return;
  threads.delete(threadId);
  threads.set(threadId, next);
  if (threads.size > MAX_THREADS) threads.delete(threads.keys().next().value!);
  for (const listener of Array.from(listeners.get(threadId) ?? [])) listener();
}

/** One live runtime frame. A row in the chat supersedes the status it came from, except the row of the very tool call
 * the status describes: "Writing index.html · 14 KB" outlasts the call's own chip until the call finishes. */
export function noteTurnEvent(event: RuntimeEvent): void {
  const { threadId } = event;
  const current = threads.get(threadId);
  const sameTurn = current && (!event.turnId || event.turnId === current.turnId);
  const turnId = event.turnId ?? current?.turnId;
  const live: TurnLive = sameTurn ? current : { turnId, ended: false, status: null };
  switch (event.type) {
    case "turn.started":
      return put(threadId, { turnId, ended: false, status: null });
    case "turn.completed":
    case "cap.exhausted":
    case "session.exited": {
      const { waiting: _, ...rest } = live;
      return put(threadId, { ...rest, turnId, ended: true, status: null });
    }
    case "turn.wait_started":
      return put(threadId, { ...live, ended: false, waiting: { resource: event.resource } });
    case "turn.wait_ended": {
      const { waiting: _, ...rest } = live;
      return put(threadId, { ...rest, ended: false });
    }
    case "turn.progress": {
      const { activity, tool, file, bytes, itemId, target, detail, quiet, tail } = event;
      const status: LiveStatus = {
        activity, ...(tool ? { tool } : {}), ...(file ? { file } : {}), ...(bytes !== undefined ? { bytes } : {}), ...(itemId ? { itemId } : {}),
        ...(target ? { target } : {}), ...(detail ? { detail } : {}), ...(quiet ? { quiet } : {}), ...(tail?.length ? { tail } : {}),
      };
      const named = isNamedStep(status);
      const lastStep = named ? status : live.lastStep;
      return put(threadId, { ...live, ended: false, status, ...(lastStep ? { lastStep } : {}) });
    }
    case "content.delta":
      return put(threadId, { ...live, ended: false, status: { activity: event.streamKind === "reasoning_text" ? "thinking" : "reply" } });
    case "item.started": {
      const stepExists = Boolean(live.status?.itemId && live.status.itemId === event.itemId);
      const status: LiveStatus | null = stepExists
        ? live.status
        : event.itemType === "tool" && event.title
          ? { activity: "tool", tool: bridgedToolName(event.title, event.input), ...(event.itemId ? { itemId: event.itemId } : {}) }
          : null;
      return put(threadId, { ...live, ended: false, status });
    }
    case "item.completed":
    case "request.opened":
      return put(threadId, { ...live, status: null });
    default:
      if (live !== current) put(threadId, live);
  }
}

export function turnLive(threadId: string | null | undefined): TurnLive {
  return (threadId && threads.get(threadId)) || UNKNOWN;
}

function subscribe(threadId: string | null | undefined, listener: () => void): () => void {
  if (!threadId) return () => {};
  let set = listeners.get(threadId);
  if (!set) listeners.set(threadId, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
    if (set.size === 0) listeners.delete(threadId);
  };
}

export function useTurnLive(threadId: string | null | undefined): TurnLive {
  return useSyncExternalStore(
    (listener) => subscribe(threadId, listener),
    () => turnLive(threadId),
    () => turnLive(threadId),
  );
}

/** Tests only. */
export function resetTurnLive(): void {
  threads.clear();
}

/** The agents tool bridge runs a hidden tool through `use_tool`, naming it in the call's input preview. */
function bridgedToolName(title: string, input: string | undefined): string {
  if (!/(?:^|__)use_tool$/.test(title) || !input) return title;
  return /"name":\s*"([^"\\]+)"/.exec(input)?.[1] ?? title;
}
