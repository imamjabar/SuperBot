import { useEffect, useState } from "react";
import { ChevronDown, Laptop, Server } from "lucide-react";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { railShown, usePlaces } from "@/lib/places";
import { SIMPLE_RAIL_BUTTON } from "./SidebarSimpleTop";

export function openServerMenu(bridge: { menu: (options?: { from?: "howto" }) => Promise<void> }, { howTo = false, onClosed }: { howTo?: boolean; onClosed?: () => void } = {}): Promise<void> {
  return bridge.menu(howTo ? { from: "howto" } : undefined).finally(() => { if (howTo) onClosed?.(); });
}

export type WorkspacePlace = ReturnType<typeof useWorkspacePlace>;

export function useWorkspacePlace({ onMenuClosed }: { onMenuClosed?: () => void } = {}) {
  const bridge = window.ogb?.workspaces;
  const [current, setCurrent] = useState<{ local: boolean; name: string; origin?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const read = () => void bridge?.state().then((state) => { if (alive) setCurrent(state); }).catch(() => {});
    read();
    const off = bridge?.onChanged?.(read);
    return () => { alive = false; off?.(); };
  }, [bridge]);
  const openMenu = () => {
    if (!bridge || open) return;
    setError(""); setOpen(true);
    void openServerMenu(bridge, { onClosed: onMenuClosed }).catch(() => setError(t("sidebar.switchServerError")))
      .finally(() => setOpen(false));
  };
  return { bridge, current, open, error, openMenu, switchable: Boolean(bridge) };
}

type SwitcherProps = {
  compact?: boolean; inline?: boolean; pill?: boolean; rail?: boolean; onMenuClosed?: () => void;
};

export function DesktopWorkspaceSwitcher(props: SwitcherProps) {
  const places = usePlaces();
  const switcher = <Switcher {...props} />;
  return railShown(places) ? <div data-switcher-beside-rail className={places.beside ? "hidden" : "contents md:hidden"}>{switcher}</div> : switcher;
}

function Switcher({ compact = false, inline = false, pill = false, rail = false, onMenuClosed }: SwitcherProps) {
  const { bridge, current, open, error, openMenu } = useWorkspacePlace({ onMenuClosed });
  if (!bridge) return null;
  const name = current?.name ?? t("sidebar.servers");
  const Icon = current?.local === false ? Server : Laptop;
  const title = current?.origin ? `${name} · ${current.origin}` : name;
  const label = t("sidebar.switchServer", { name });
  if (rail) return <div data-workspace-switcher="rail" className="relative">
    <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-tour="server-switcher" title={title} onClick={openMenu} className={cn(SIMPLE_RAIL_BUTTON, "aria-expanded:bg-raised")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={18} aria-hidden="true" />
    </button>
    {error && <p role="alert" className="absolute bottom-0 left-full z-40 ml-2 w-56 rounded-md bg-menu px-2 py-1 text-[11px] text-danger shadow-lg">{error}</p>}
  </div>;
  if (inline) return <div data-workspace-switcher="inline" className="flex min-w-0">
    <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-tour="server-switcher" title={title} onClick={openMenu}
      className={pill
        ? "flex h-8 min-w-0 max-w-full items-center gap-1 overflow-hidden rounded-full bg-raised/50 pl-2.5 pr-1.5 text-left text-[13px] font-medium text-ink hover:bg-raised aria-expanded:bg-raised focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        : "flex h-7 min-w-0 max-w-full items-center gap-1.5 overflow-hidden rounded-md px-1.5 text-left text-[13px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={pill ? 15 : 14} aria-hidden="true" data-switcher-icon className={pill ? "hidden shrink-0 text-ink-secondary @max-[124px]/sidebar-top:block" : "shrink-0 text-ink-secondary"} />
      <span className={pill ? "min-w-0 truncate @max-[124px]/sidebar-top:hidden" : "min-w-0 truncate @max-[96px]/sidebar-top:hidden"}>{name}</span>
      <ChevronDown size={pill ? 12 : 11} aria-hidden="true" className={pill ? "shrink-0 text-ink-tertiary" : "shrink-0 text-ink-secondary"} />
    </button>
    {error && <p role="alert" className="absolute right-2 top-full z-40 mt-1 w-56 max-w-[calc(100%-1rem)] rounded-md bg-menu px-2 py-1 text-[11px] text-danger shadow-lg">{error}</p>}
  </div>;
  return <div className={cn("py-1.5", compact ? "px-2" : "px-3")}>
    <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={open}
      data-tour="server-switcher" title={title}
      onClick={openMenu}
      className={cn("flex w-full items-center gap-2 rounded-lg py-2 text-left text-[13px] font-medium text-ink hover:bg-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus", compact ? "justify-center px-1" : "px-2")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <Icon size={16} className="shrink-0 text-ink-secondary" />
      {!compact && <><span className="min-w-0 flex-1 truncate">{name}</span><ChevronDown size={13} className="shrink-0 text-ink-secondary" /></>}
    </button>
    {error && <p role="alert" className="mt-1 text-[11px] text-danger">{error}</p>}
  </div>;
}
