import { useEffect, useState } from "react";
import type { PlaceColorOutcome, PlaceLook, PlaceSwatch } from "../../electron/place-look.mjs";
import type { LocaleKey } from "@/locales";

export type { PlaceSwatch };
export const PLACE_SWATCH_ORDER: readonly PlaceSwatch[] = ["blue", "green", "amber", "rose", "violet", "slate"];
export const PLACE_SWATCH_LABEL: Record<PlaceSwatch, LocaleKey> = {
  blue: "placeLook.color.blue",
  green: "placeLook.color.teal",
  amber: "placeLook.color.yellow",
  rose: "placeLook.color.red",
  violet: "placeLook.color.purple",
  slate: "placeLook.color.slate",
};
export function swatchFill(swatch: PlaceSwatch): string {
  const color = swatch === "blue" ? "blue" : swatch === "green" ? "teal" : swatch === "amber" ? "yellow" : swatch === "rose" ? "red" : swatch === "violet" ? "purple" : null;
  return color ? placeColorFill(color) : "var(--color-raised)";
}

export type PlaceColor = "blue" | "teal" | "purple" | "orange" | "red" | "yellow";
export const PLACE_COLORS: readonly PlaceColor[] = ["blue", "teal", "purple", "orange", "red", "yellow"];

export function placeColor(value: unknown): PlaceColor | null {
  return PLACE_COLORS.includes(value as PlaceColor) ? (value as PlaceColor) : null;
}

export function placeColorFill(value: unknown): string {
  const color = placeColor(value);
  return color ? `var(--identity-${color})` : "var(--color-control)";
}

let current: PlaceLook | null = null;
let started = false;
const listeners = new Set<(look: PlaceLook | null) => void>();

function bridge() {
  const workspaces = typeof window === "undefined" || window.ogb?.remoteClient?.active ? undefined : window.ogb?.workspaces;
  return workspaces?.look ? workspaces : undefined;
}

function publish(next: PlaceLook | null) {
  current = next;
  for (const listener of listeners) listener(current);
}

export function refreshPlaceLook(): Promise<void> {
  const workspaces = bridge();
  if (!workspaces?.look) return Promise.resolve();
  return workspaces.look().then((next) => publish(next ?? null), () => {});
}

function start() {
  if (started) return;
  started = true;
  bridge()?.onChanged?.(() => void refreshPlaceLook());
  window.addEventListener("focus", () => void refreshPlaceLook());
  void refreshPlaceLook();
}

export function usePlaceLook(): PlaceLook | null {
  const [look, setLook] = useState<PlaceLook | null>(current);
  useEffect(() => {
    if (!bridge()) return;
    listeners.add(setLook);
    start();
    setLook(current);
    return () => { listeners.delete(setLook); };
  }, []);
  return look;
}

export async function choosePlaceColor(swatch: PlaceSwatch | null): Promise<PlaceColorOutcome> {
  const workspaces = bridge();
  if (!workspaces?.color) return "failed";
  const answer = await workspaces.color(swatch).catch(() => null);
  if (!answer) return "failed";
  publish(answer.look ?? current);
  return answer.outcome;
}

export function placeTint(color: unknown): { "--place-tint": string } | null {
  const known = placeColor(color);
  return known ? { "--place-tint": `var(--identity-${known})` } : null;
}
