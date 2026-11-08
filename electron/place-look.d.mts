export type PlaceColor = "blue" | "teal" | "purple" | "orange" | "red" | "yellow";
export type PlaceSwatch = "blue" | "green" | "amber" | "rose" | "violet" | "slate";

export interface PlaceLook {
  name: string;
  color: PlaceColor | null;
  swatch: PlaceSwatch | null;
  change: "local" | null;
  reason?: string;
}

export type PlaceColorOutcome = "saved" | "refused" | "unsupported" | "failed";
export declare const CLOUD_SWATCH_COLORS: Readonly<Record<PlaceSwatch, PlaceColor | null>>;
export declare const CLOUD_SWATCHES: readonly PlaceSwatch[];
export declare function swatchColor(swatch: unknown): PlaceColor | null;
export declare function swatchOf(color: unknown): PlaceSwatch | null;
export declare function placeLook(entry: any): PlaceLook | null;
export declare const SIGNED_IN: string;
export declare function railPaint(look: PlaceLook | null, color: unknown): { swatch: PlaceSwatch | null; locked?: string } | null;
export declare function pageLook(look: PlaceLook | null): PlaceLook | null;
export declare function installPlaceLook(deps: {
  ipcMain: { handle(channel: string, handler: (...args: any[]) => unknown): void };
  guard: (handler: (...args: any[]) => unknown) => (...args: any[]) => unknown;
  place: () => any;
  save: (id: string, color: PlaceColor | null) => void;
  rail?: { owns(event: unknown): boolean; places(): Array<{ id: string; paint?: unknown }>; saved(id: string): any };
}): { look(): PlaceLook | null };
