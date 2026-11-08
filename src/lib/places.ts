import { useEffect, useState } from "react";
import type { PlaceColorOutcome, PlaceSwatch } from "../../electron/place-look.mjs";
import type { RailPlace, RailState } from "../../electron/rail-places.mjs";
import { t } from "@/lib/i18n";

const NONE: RailState = { places: [], add: { link: false, address: false } };
let current: RailState = NONE;
let started = false;
const listeners = new Set<(state: RailState) => void>();

function bridge() {
  const workspaces = typeof window === "undefined" || window.ogb?.remoteClient?.active ? undefined : window.ogb?.workspaces;
  return workspaces?.places ? workspaces : undefined;
}

export function refreshPlaces(): Promise<void> {
  const workspaces = bridge();
  if (!workspaces?.places) return Promise.resolve();
  return workspaces.places().then((next) => {
    current = next && Array.isArray(next.places) ? next : NONE;
    for (const listener of listeners) listener(current);
  }, () => {});
}

function start() {
  if (started) return;
  started = true;
  bridge()?.onChanged?.(() => void refreshPlaces());
  window.addEventListener("focus", () => void refreshPlaces());
  void refreshPlaces();
}

export function usePlaces(): RailState {
  const [state, setState] = useState<RailState>(current);
  useEffect(() => {
    if (!bridge()) return;
    listeners.add(setState);
    start();
    setState(current);
    return () => { listeners.delete(setState); };
  }, []);
  return state;
}

export async function recolorPlace(id: string, swatch: PlaceSwatch | null): Promise<PlaceColorOutcome> {
  const answer = await bridge()?.recolor?.(id, swatch).catch(() => null);
  if (!answer) return "failed";
  if (answer.outcome === "saved") void refreshPlaces();
  return answer.outcome;
}

export async function removePlace(id: string): Promise<"saved" | "removed" | "failed" | "unsupported"> {
  const remove = bridge()?.remove;
  if (!remove) return "unsupported";
  const answer = await remove(id).catch(() => null);
  if (!answer) return "failed";
  if (answer.outcome === "removed" || answer.outcome === "saved") void refreshPlaces();
  return answer.outcome as "saved" | "removed" | "failed" | "unsupported";
}

export async function makeHome(_id: string): Promise<true | string> {
  return t("rail.makeHomeFailed");
}

export const railShown = (state: RailState): boolean => state.beside === true || state.places.length > 0;

export function placeInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const first = (word: string | undefined) => (word ? Array.from(word)[0] ?? "" : "");
  return (first(words[0]) + (words.length > 1 ? first(words[1]) : "")).toLocaleUpperCase();
}

export type { RailPlace, RailState };
