// The rail at the window's left edge once a person has two places or more: one tile per server, the place on screen
// marked, ⋯ for the rest past eight, ＋ last. Main lists the places and opens one by its id; the rail never names an
// address. A right-click on a tile (or its row past eight) opens that place's menu: its colour, changed here for every
// place whatever its server runs, and Remove from list for a server of the person's own (asked first).
import { useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import { Laptop, MoreHorizontal, Plus, Search, Server } from "lucide-react";
import type { PlaceSwatch } from "../../electron/place-look.mjs";
import type { PlaceColorOutcome } from "../../electron/place-look.mjs";
import { track } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { placeColor, placeColorFill } from "@/lib/place-look";
import { t } from "@/lib/i18n";
import { useAdvancedMode } from "@/lib/interface-mode";
import { useBesideFramed } from "@/lib/chrome-rail";
import { placeInitials, recolorPlace, removePlace, usePlaces, type RailPlace } from "@/lib/places";
import { useDesktopCapabilities, windowFramed } from "./DesktopCapabilities";
import { MENU_ROW, MENU_SHEET } from "./menu-recipe";
import { PlaceAddSheet } from "./PlaceAddSheet";
import { SwatchRadios } from "./SwatchRadios";

/** Tiles before ⋯ opens the searchable list of every place. */
export const RAIL_SHOWN = 8;
/** A place's tile on the rail: a small rounded square, so the rail stays as thin as it can (36px). */
const TILE = 24;
/** A place's mark at any size: a rounded square, its corners in step with its size. */
const tileRadius = (size: number) => Math.round(size * 0.3);

/** A tile's words for its tooltip and a screen reader: the place, and that it needs the person when it does. A server of
 * the person's own says so. */
export function placeLabel(place: RailPlace): string {
  const name = place.kind === "computer" ? t("rail.thisComputer") : place.server ? t("rail.ownServer", { name: place.name }) : place.name;
  return place.attention ? t("rail.attention", { name }) : name;
}

/** The tiles before ⋯: every place up to RAIL_SHOWN; past that the first ones, with the place on screen always among them. */
export function shownPlaces(places: RailPlace[], limit = RAIL_SHOWN): RailPlace[] {
  if (places.length <= limit) return places;
  const first = places.slice(0, limit - 1), active = places.find((place) => place.active);
  return [...first, active && !first.includes(active) ? active : places[limit - 1]!];
}

/** Places whose name has every word typed, in the rail's order. */
export function matchingPlaces(places: RailPlace[], query: string): RailPlace[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return places.filter((place) => {
    const name = (place.kind === "computer" ? t("rail.thisComputer") : place.name).toLocaleLowerCase();
    return words.every((word) => name.includes(word));
  });
}

/** What a place's mark draws: its kind, its name's letters and its colour. */
type MarkedPlace = Pick<RailPlace, "kind" | "name"> & { color?: string | null };

export function PlaceMark({ place, size = TILE }: { place: MarkedPlace; size?: number }) {
  const color = placeColor(place.color);
  return <span aria-hidden="true"
    className={cn("grid shrink-0 place-items-center font-semibold leading-none", color ? "text-white" : "bg-card text-ink")}
    style={{ width: size, height: size, borderRadius: tileRadius(size), fontSize: Math.round(size * 0.4), ...(color ? { background: placeColorFill(color) } : {}) }}>
    {place.kind === "computer" ? <Laptop size={Math.round(size * 0.46)} strokeWidth={1.75} /> : placeInitials(place.name)}
  </span>;
}

/** A place's menu opens where it was asked for: beside its tile, or its row past eight. */
type MenuAt = { place: RailPlace; from: HTMLElement };
/** The right-click (or the keyboard's menu key) on a place with a colour to show, or one to remove from the list, opens its
 * menu; elsewhere, nothing. */
const menuOpener = (place: RailPlace, onMenu: (at: MenuAt) => void) => (event: ReactMouseEvent<HTMLElement>) => {
  event.preventDefault();
  if (place.paint || place.removable) onMenu({ place, from: event.currentTarget });
};

/** How far down the rail an element of it sits, in the rail's own units (offsets, not the screen's: the rail's page
 * takes out the zoom it shares with this app's page). */
export function topWithin(element: HTMLElement, rail: HTMLElement): number {
  let top = 0;
  for (let at: HTMLElement | null = element; at && at !== rail; at = at.offsetParent as HTMLElement | null) top += at.offsetTop;
  for (let up = element.parentElement; up && up !== rail; up = up.parentElement) top -= up.scrollTop;
  return top;
}

/** A place's tile: its mark, with a pill on the rail's edge for the place on screen (a short one on hover), and its dots
 * round it, all inside the rail. */
function PlaceTile({ place, onOpen, onMenu }: { place: RailPlace; onOpen: (place: RailPlace) => void; onMenu: (at: MenuAt) => void }) {
  const label = placeLabel(place), acts = place.opens;
  return <button type="button" aria-label={label} title={label} aria-current={place.active ? "page" : undefined} aria-disabled={acts ? undefined : true}
    data-rail-place={place.id} data-rail-kind={place.kind} onClick={() => { if (acts && !place.active) onOpen(place); }} onContextMenu={menuOpener(place, onMenu)}
    className={cn("group/tile relative shrink-0 rounded-[7px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
      !acts && "cursor-default opacity-75")}>
    <span aria-hidden="true" data-rail-pill={place.active ? "page" : acts ? "hover" : undefined}
      className={cn("pointer-events-none absolute -left-1.5 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-ink transition-[height,opacity] duration-150 motion-reduce:transition-none",
        place.active ? "h-4" : acts ? "h-2 opacity-0 group-hover/tile:opacity-100" : "hidden")} />
    <PlaceMark place={place} />
    {place.attention && <span aria-hidden="true" data-rail-dot className="absolute -right-1 -top-1 size-2.5 rounded-full border-2 border-(--rail-surface) bg-danger" />}
    {place.server && <span aria-hidden="true" data-rail-server className="absolute -bottom-1 -right-1 grid size-3 place-items-center rounded-full border border-hairline bg-(--rail-surface) text-ink-secondary">
      <Server size={7} strokeWidth={2.25} />
    </span>}
  </button>;
}

/** Remove from list in a place's menu: asked first, in plain words; once main took it off the list, the menu closes and the
 * tile goes with main's next list. */
function RemoveRow({ place, onRemoved }: { place: RailPlace; onRemoved: () => void }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<"refused" | "failed" | null>(null);
  const confirm = () => {
    setBusy(true); setSaid(null);
    void removePlace(place.id).then((outcome) => {
      setBusy(false);
      if (outcome === "removed" || outcome === "saved") { onRemoved(); return; }
      setAsking(false); setSaid("failed");
    });
  };
  return <div data-rail-remove className="flex flex-col gap-1.5 border-t border-hairline/50 px-0.5 pt-1.5">
    {asking
      ? <div role="alertdialog" aria-label={t("rail.remove")} className="flex flex-col gap-2 px-1.5 pb-1">
        <p className="text-caption leading-snug text-ink">{t(place.forget ? "rail.removeServerAsk" : "rail.removeAsk", { name: place.name })}</p>
        <div className="flex gap-2">
          <button type="button" data-rail-remove-confirm className="ui-button ui-button-primary" disabled={busy} onClick={confirm}>{t("rail.removeYes")}</button>
          <button type="button" className="ui-button" disabled={busy} onClick={() => setAsking(false)}>{t("rail.removeNo")}</button>
        </div>
      </div>
      : <button type="button" data-rail-remove-ask className={MENU_ROW} onClick={() => { setSaid(null); setAsking(true); }}>{t("rail.remove")}</button>}
    {said && <p role="alert" className="px-1.5 pb-1 text-caption text-danger">{t(said === "refused" ? "rail.removeRefused" : "rail.removeFailed")}</p>}
  </div>;
}


/** A place's own menu on the window's rail: its name and its colour, in the six swatches, saved by main for every place
 * whatever its server runs, and Remove from list for a server the person may take off their list. */
function PlaceMenu({ place, top, onClose }: { place: RailPlace; top: number; onClose: () => void }) {
  const paint = place.paint;
  const [pending, setPending] = useState<PlaceSwatch | null>(null);
  const [outcome, setOutcome] = useState<PlaceColorOutcome | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { (ref.current?.querySelector<HTMLElement>("[role='radio'][tabindex='0']") ?? ref.current?.querySelector<HTMLElement>("[data-rail-remove-ask]"))?.focus(); }, []);
  if (!paint && !place.removable) return null;
  const name = place.kind === "computer" ? t("rail.thisComputer") : place.name;
  const choose = (swatch: PlaceSwatch) => {
    if (!paint || paint.locked || pending || swatch === paint.swatch) return;
    setPending(swatch); setOutcome(null);
    void recolorPlace(place.id, swatch).then((answer) => { setPending(null); setOutcome(answer); if (answer === "saved") onClose(); });
  };
  const note = paint?.locked === "member" || outcome === "refused" ? t("placeLook.member") : paint?.locked === "signed-out" ? t("placeLook.signedOut")
    : outcome === "unsupported" ? t("placeLook.unsupported") : null;
  return <div ref={ref} role="dialog" aria-label={name} data-rail-menu={place.id} className={cn("absolute left-full z-50 ml-2 w-72", MENU_SHEET)} style={{ top }}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <div className="flex items-center gap-2 px-2 pt-1">
      <PlaceMark place={place} size={22} />
      <span className="min-w-0 flex-1 truncate text-small font-semibold text-ink">{name}</span>
    </div>
    {paint && <>
      <p className="px-2 pt-1 text-caption text-ink-secondary">{t("placeLook.title")}</p>
      <div className="px-2 pb-1.5 pt-0.5">
        <SwatchRadios value={pending ?? paint.swatch} onChange={choose} label={t("placeLook.aria", { name })} disabled={Boolean(paint.locked)} offset="menu" none />
      </div>
      {note && <p data-rail-menu-note className="px-2 pb-1 text-caption text-ink-secondary">{note}</p>}
      {outcome === "failed" && <p role="alert" className="px-2 pb-1 text-caption text-danger">{t("placeLook.failed")}</p>}
    </>}
    {place.removable && <RemoveRow place={place} onRemoved={onClose} />}
  </div>;
}

/** Every place, searchable: ⋯ once there are more than RAIL_SHOWN. */
function MorePlaces({ places, onOpen, onMenu, onClose }: { places: RailPlace[]; onOpen: (place: RailPlace) => void; onMenu: (at: MenuAt) => void; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const found = matchingPlaces(places, query);
  return <div role="dialog" aria-label={t("rail.search")} data-rail-more className={cn("absolute bottom-0 left-full z-50 ml-2 w-64", MENU_SHEET)}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <label className="flex h-8 items-center gap-2 rounded-md bg-ink/[0.05] px-2">
      <Search size={14} aria-hidden="true" className="shrink-0 text-ink-secondary" />
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("rail.search")} aria-label={t("rail.search")}
        onKeyDown={(event) => { if (event.key === "Enter" && found[0]?.opens) { onOpen(found[0]); onClose(); } }}
        className="w-full bg-transparent text-small text-ink outline-none placeholder:text-ink-tertiary" />
    </label>
    <ul className="max-h-72 overflow-y-auto">
      {found.map((place) => <li key={place.id}>
        <button type="button" disabled={!place.opens} aria-current={place.active ? "page" : undefined} onClick={() => { onOpen(place); onClose(); }}
          onContextMenu={menuOpener(place, (menu) => { onClose(); onMenu(menu); })} className={cn(MENU_ROW, "h-9")}>
          <PlaceMark place={place} size={22} />
          <span className="min-w-0 flex-1 truncate">{placeLabel(place)}</span>
        </button>
      </li>)}
    </ul>
    {found.length === 0 && <p className="px-2 py-1.5 text-caption text-ink-tertiary">{t("rail.noMatch")}</p>}
  </div>;
}

/** `chrome`: the window's own rail (ChromeRail), drawn whatever the window's width, whose sheets ask main for the whole
 * window while open. Without it, a rail drawn on a page from a list main gave that page: wide windows only. */
export function PlacesRail({ chrome = false }: { chrome?: boolean }) {
  const state = usePlaces();
  const calm = !useAdvancedMode();
  const { capabilities } = useDesktopCapabilities();
  const besideFramed = useBesideFramed();
  const [more, setMore] = useState(false);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<{ place: RailPlace; top: number } | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!more && !menu) return;
    const away = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMore(false);
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null);
    };
    window.addEventListener("mousedown", away);
    return () => window.removeEventListener("mousedown", away);
  }, [more, menu]);
  const covering = more || adding || menu !== null;
  useEffect(() => { if (chrome) void window.ogb?.rail?.expand?.(covering)?.catch(() => {}); }, [chrome, covering]);
  if (!state.places.length) return null;
  const bridge = window.ogb?.workspaces;
  const open = (place: RailPlace) => {
    if (!place.opens) return;
    track("rail_place_opened", { kind: place.kind });
    void bridge?.open?.(place.id);
  };
  const framed = windowFramed(capabilities), draggable = capabilities.windowChrome !== "native";
  // In a framed window the rail is part of the frame: the window's own rail runs the full height, its top in the frame's
  // top bar (the traffic lights' place), so its places start under that bar. With the frame turned off, or beside a page
  // that doesn't draw it (an older release), they start under the traffic lights on macOS.
  const lights = capabilities.windowChrome === "mac-inset" ? "h-[52px]" : "h-3";
  const above = !framed ? lights : !chrome ? "h-[9px]" : besideFramed ? "h-[37px]" : lights;
  // SAFETY: Electron's -webkit-app-region is not in React's CSSProperties type; the renderer accepts it as an inline style.
  const drag = draggable ? ({ WebkitAppRegion: "drag" } as CSSProperties) : undefined;
  const noDrag = draggable ? ({ WebkitAppRegion: "no-drag" } as CSSProperties) : undefined;
  const shown = shownPlaces(state.places);
  const canAdd = state.add.link || state.add.address;
  // The menu opens next to the tile or row it was asked from (measured now, while that row is there), within the rail.
  const openMenu = ({ place, from }: MenuAt) => {
    const nav = navRef.current;
    setMenu({ place, top: nav ? Math.max(8, Math.min(topWithin(from, nav) - 6, nav.clientHeight - 200)) : 8 });
  };
  return <nav ref={navRef} aria-label={t("rail.label")} data-places-rail style={drag}
    className={cn("relative w-9 shrink-0 flex-col items-center", chrome ? "flex h-full" : "hidden md:flex",
      framed ? "bg-frame [--rail-surface:var(--color-frame)]" : cn("border-r bg-panel [--rail-surface:var(--color-panel)]", calm ? "border-r-[0.5px] border-edge" : "border-hairline/50"))}>
    <div aria-hidden="true" className={cn(above, "shrink-0")} />
    {/* As wide as the rail, so nothing round a tile is cut off at the sides: a list that scrolls clips its overflow. */}
    <ul className="flex min-h-0 w-full flex-col items-center gap-2 overflow-y-auto py-1" style={noDrag}>
      {shown.map((place) => <li key={place.id} className="flex flex-col items-center gap-2">
        <PlaceTile place={place} onOpen={open} onMenu={openMenu} />
      </li>)}
    </ul>
    <div className="relative mt-2 flex flex-col items-center gap-2 pb-3" style={noDrag} ref={moreRef}>
      {state.places.length > RAIL_SHOWN && <button type="button" aria-label={t("rail.more", { count: state.places.length })} title={t("rail.more", { count: state.places.length })}
        aria-haspopup="dialog" aria-expanded={more} data-rail-more-button onClick={() => setMore(!more)}
        className="grid size-6 place-items-center rounded-[7px] text-ink-secondary hover:bg-ink/[0.06] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus aria-expanded:bg-ink/[0.06]">
        <MoreHorizontal size={13} aria-hidden="true" />
      </button>}
      {more && <MorePlaces places={state.places} onOpen={open} onMenu={openMenu} onClose={() => setMore(false)} />}
      {canAdd && <button type="button" aria-label={t("rail.add")} title={t("rail.add")} aria-haspopup="dialog" data-rail-add onClick={() => { track("rail_add", { step: "opened" }); setAdding(true); }}
        className="grid size-6 place-items-center rounded-[7px] border border-dashed border-ink/25 text-ink-secondary hover:border-ink/40 hover:bg-ink/[0.04] hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        <Plus size={13} aria-hidden="true" />
      </button>}
    </div>
    {/* The list is read again while it is open: the menu shows the place as main lists it now. */}
    {menu && <div ref={menuRef} style={noDrag}>
      <PlaceMenu key={menu.place.id} place={state.places.find((entry) => entry.id === menu.place.id) ?? menu.place} top={menu.top} onClose={() => setMenu(null)} />
    </div>}
    {adding && <PlaceAddSheet onClose={() => setAdding(false)} />}
  </nav>;
}
