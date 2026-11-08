import type { PlaceSwatch } from "./place-look.mjs";

export interface RailPlace {
  id: string;
  name: string;
  color?: string | null;
  kind: "computer" | "server";
  opens: boolean;
  paint?: { swatch: PlaceSwatch | null; locked?: string } | null;
  active?: boolean;
  attention?: boolean;
  removable?: boolean;
  forget?: boolean;
  server?: boolean;
}

export interface RailAddChoices {
  link: boolean;
  address: boolean;
  organization?: boolean;
  account?: boolean;
  cloud?: boolean;
}

export interface RailState {
  places: RailPlace[];
  add: RailAddChoices;
  beside?: boolean;
}

export declare const RAIL_MIN_PLACES: number;

export declare function railPlaces(input: {
  saved: { environments: any[]; activeId: string; localColor?: string | null };
  waiting?: (id: string) => boolean;
}): RailPlace[];

export declare function installRail(deps: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  guard: (handler: (...args: any[]) => unknown) => (...args: any[]) => unknown;
  trusted: (event: any) => boolean;
  lists?: (event: any) => boolean;
  beside?: () => boolean;
  places: () => RailPlace[];
  open: (id: string) => Promise<unknown> | unknown;
  add: { choices: () => RailAddChoices; run: (choice: string, link?: string) => Promise<unknown> | unknown };
  targets: () => Array<{ send(channel: string): void; isDestroyed?(): boolean } | null>;
  forget?: ((id: string) => Promise<unknown> | unknown) | null;
}): {
  sheetOpen: () => boolean;
  changed(): void;
};
