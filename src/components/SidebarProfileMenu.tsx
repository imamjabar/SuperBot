import { useEffect, useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeftRight,
  Check,
  Download,
  Gauge,
  Server,
  Info,
  HelpCircle,
  Keyboard,
  Laptop,
  LifeBuoy,
  Loader2,
  RefreshCw,
  Settings as SettingsIcon,
  Smartphone,
  UserRound,
  UsersRound,
  Zap,
} from "lucide-react";

import { InitialsAvatar } from "./Avatar";
import { DiscordIcon } from "./DiscordIcon";
import { AboutDialog } from "./AboutDialog";
import { PhoneAppDialog } from "./lazy-screens";
import type { WorkspacePlace } from "./DesktopWorkspaceSwitcher";
import { railShown, usePlaces } from "@/lib/places";
import { useAutomationsNeedYou } from "./SidebarFooterNav";
import { SidebarPopoverMenu, type SidebarMenuItem } from "./SidebarPopoverMenu";
import { ShortcutHint } from "./ShortcutHint";
import { useSidebarPhoneStatus } from "./SidebarPhoneButton";
import { api, useStore } from "@/state/store";
import { serverCheckPhase, serverUpdateRow, type ServerUpdateCheck, type ServerUpdatePhase } from "@/lib/server-update";
import { useUpdaterState, type UpdaterState } from "@/lib/updater";
import { productName } from "../lib/brand";
import { cn } from "@/lib/cn";
import { t } from "@/lib/i18n";
import { FEEDBACK_URL, HELP_CENTER_URL, appVersion, openExternalLink } from "@/lib/app-links";
import { useOtherServerName } from "@/lib/other-server";
import { profileForSession, readSessionState, type SessionState } from "@/lib/session";
import { connectPhoneEntry, currentPhonePairingTarget, loadPhonePairingAccess, phoneDestinations, phonePairingSettingsAction, type ConnectPhoneEntry, type PhoneDestination, type PhonePairingAccess } from "@/lib/phone-pairing";

export function profileInitials(profile?: { name?: string; email?: string }): string {
  const name = profile?.name?.trim();
  if (name) {
    const words = name.split(/\s+/);
    return words
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join("");
  }
  const email = profile?.email?.trim();
  return email ? email[0]!.toUpperCase() : "?";
}

export function profileLabel(profile?: { name?: string; email?: string }): string {
  return profile?.name?.trim() || profile?.email?.trim() || t("sidebar.profile.you");
}

export type UpdatePhase =
  | UpdaterState["status"]
  | "up-to-date"
  // only a self-hosted server's check reports a release it cannot install itself
  | "available"
  // or that it already runs a newer version than this page
  | "reload";

export function updatePhase(state: UpdaterState | null, upToDate: boolean): UpdatePhase {
  const status = state?.status ?? "idle";
  if (status !== "idle") return status;
  return upToDate ? "up-to-date" : "idle";
}

export function updateLabel(phase: UpdatePhase, state: UpdaterState | null): string {
  switch (phase) {
    case "downloading":
      return state?.percent == null
        ? t("sidebar.update.startingDownload")
        : t("sidebar.update.downloading", { percent: Math.round(state.percent) });
    case "preparing":
      return t("sidebar.update.preparing");
    case "downloaded":
      return (
        state?.installMode === "handoff"
          ? t("sidebar.update.readyInstall", { app: productName(), version: state?.version ?? "" })
          : t("sidebar.update.ready", { app: productName(), version: state?.version ?? "" })
      ).replace("  ", " ");
    case "installing":
      return (
        state?.message ||
        (state?.installMode === "handoff"
          ? t("sidebar.update.openingTerminal")
          : t("sidebar.update.installing"))
      );
    case "checking":
      return t("sidebar.update.checking");
    case "handed-off":
      return t("sidebar.update.handedOff");
    case "error":
      return state?.message?.trim() || t("sidebar.update.failed");
    case "up-to-date":
      return t("sidebar.update.upToDate");
    default:
      return t("sidebar.update.check");
  }
}

export function updateBusy(phase: UpdatePhase, pending = false): boolean {
  return pending || phase === "checking" || phase === "downloading" || phase === "preparing" || phase === "installing";
}

function UpdateIcon({ phase, pending, size = 18 }: { phase: UpdatePhase; pending: boolean; size?: number }) {
  if (updateBusy(phase, pending)) return <Loader2 size={size} className="animate-spin" />;
  if (phase === "up-to-date") return <Check size={size} />;
  if (phase === "downloaded") return <ArrowDownToLine size={size} />;
  return <RefreshCw size={size} />;
}

export function updateHasButton(phase: UpdatePhase): boolean {
  return phase === "downloading" || phase === "preparing" || phase === "downloaded" || phase === "installing";
}

export function updateNoteworthy(phase: UpdatePhase, pending = false): boolean {
  return pending || (phase !== "idle" && phase !== "up-to-date" && phase !== "checking");
}

interface UpdateEntry {
  item: SidebarMenuItem;
  phase: UpdatePhase;
  pending: boolean;
  label: string;
  source?: "desktop" | "server";
  installMode?: string;
}

/** The update a Simple account menu raises to its top row: one waiting to be installed, or one that failed. */
export function simpleUpdateTop(entry: Pick<UpdateEntry, "phase" | "source" | "installMode"> | null): { label: string; action: string } | null {
  const ready = () => t("sidebar.update.readyShort");
  if (entry?.source === "desktop") {
    if (entry.phase === "downloaded") return { label: ready(), action: t(entry.installMode === "handoff" ? "sidebar.update.installAction" : "sidebar.update.restartAction") };
    if (entry.phase === "error") return { label: t("sidebar.update.failedShort"), action: t("sidebar.update.retryAction") };
  }
  if (entry?.source === "server") {
    if (entry.phase === "available") return { label: ready(), action: t("sidebar.update.installAction") };
    if (entry.phase === "reload") return { label: ready(), action: t("sidebar.update.restartAction") };
  }
  return null;
}

export function useUpdateItem(): UpdateEntry | null {
  const state = useUpdaterState();
  const updater = window.ogb?.updater;
  const [pending, setPending] = useState(false);
  const [checkedAt, setCheckedAt] = useState(0);
  const status = state?.status ?? "idle";

  useEffect(() => setPending(false), [status]);

  const upToDate = Boolean(checkedAt) && (!state || state.status === "idle") && Date.now() - checkedAt < 3000;
  useEffect(() => {
    if (!upToDate) return;
    const timer = setTimeout(() => setCheckedAt(0), 3000);
    return () => clearTimeout(timer);
  }, [upToDate]);

  if (!updater || !state) return null;

  const phase = updatePhase(state, upToDate);
  const label = updateLabel(phase, state);
  return {
    phase,
    pending,
    label,
    source: "desktop",
    installMode: state.installMode,
    item: {
      key: "update",
      label,
      icon: <UpdateIcon phase={phase} pending={pending} />,
      disabled: updateBusy(phase, pending) || state?.retryable === false,
      keepOpen: true,
      attention: phase === "downloaded" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "downloaded") {
          setPending(true);
          return void updater.install();
        }
        setCheckedAt(Date.now());
        void updater.check();
      },
    },
  };
}

/** Without the packaged app's updater the server cannot replace itself, so the row says whether a newer release exists and how to install it. */
export function useServerUpdateItem(enabled: boolean): UpdateEntry | null {
  const [phase, setPhase] = useState<ServerUpdatePhase>("idle");
  const [check, setCheck] = useState<ServerUpdateCheck | null>(null);
  const otherServer = useOtherServerName(enabled);

  useEffect(() => {
    if (phase !== "up-to-date") return;
    const timer = setTimeout(() => setPhase("idle"), 3000);
    return () => clearTimeout(timer);
  }, [phase]);

  if (!enabled) return null;
  const row = serverUpdateRow(phase, check, appVersion(), otherServer);
  return {
    phase,
    pending: false,
    label: row.label,
    source: "server",
    item: {
      key: "update",
      label: row.label,
      subtitle: row.subtitle,
      icon: <UpdateIcon phase={phase} pending={false} />,
      disabled: phase === "checking",
      keepOpen: true,
      attention: phase === "available" || phase === "reload" || phase === "error",
      attentionTone: phase === "error" ? "danger" : "accent",
      onSelect: () => {
        if (phase === "available" && check?.releaseUrl) return void openExternalLink(check.releaseUrl);
        if (phase === "reload") return window.location.reload();
        setPhase("checking");
        void api<ServerUpdateCheck>("/api/updates/check", { timeoutMs: 20_000 })
          .then((next) => {
            setCheck(next);
            setPhase(serverCheckPhase(next));
          })
          .catch(() => setPhase("error"));
      },
    },
  };
}

function useConnectPhoneEntry(): ConnectPhoneEntry | null {
  const target = currentPhonePairingTarget();
  const [access, setAccess] = useState<PhonePairingAccess | null>(null);
  useEffect(() => {
    if (target === "computer") return;
    let alive = true;
    void loadPhonePairingAccess().then((next) => {
      if (alive) setAccess(next);
    });
    return () => {
      alive = false;
    };
  }, [target]);
  return connectPhoneEntry(target, access);
}

export function phoneMenuItems({
  destinations,
  connected,
  onConnect,
  onGetApp,
}: {
  destinations: PhoneDestination[];
  connected: boolean;
  onConnect: (destination: PhoneDestination) => void;
  onGetApp: () => void;
}): SidebarMenuItem[] {
  return [
    ...destinations.map((destination) => ({
      key: "connect-phone",
      label: t("sidebar.menu.connectPhone"),
      subtitle: t(destination.subtitleKey),
      ...(destination.noteKey ? { note: t(destination.noteKey) } : {}),
      icon: <Smartphone size={18} />,
      trailing:
        destination.id === "here" && destination.target === "computer" && connected ? (
          <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" />
        ) : undefined,
      onSelect: () => onConnect(destination),
    } satisfies SidebarMenuItem)),
    {
      key: "phone-app",
      label: t("sidebar.menu.getPhoneApp"),
      icon: <Download size={18} />,
      onSelect: onGetApp,
    },
  ];
}
export function simplePhoneItems({ connected, onGetApp }: { connected: boolean; onGetApp: () => void }): SidebarMenuItem[] {
  return [{
    key: "phone-app",
    label: t("sidebar.menu.getPhoneApp"),
    icon: <Smartphone size={18} />,
    trailing: connected ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-success" /> : undefined,
    onSelect: onGetApp,
  }];
}


export function toolMenuItems({ activeView, automationsNeedYou, onAutomations, onTeamMap, archived }: {
  activeView: string;
  automationsNeedYou: boolean;
  onAutomations: () => void;
  onTeamMap: () => void;
  archived?: ArchivedBots;
}): SidebarMenuItem[] {
  return [
    { key: "automations", label: t("sidebar.nav.automations"), icon: <Zap size={16} />, active: activeView === "routines", attention: automationsNeedYou, onSelect: onAutomations },
    { key: "team-map", label: t("sidebar.nav.teamMap"), icon: <UsersRound size={16} />, active: activeView === "team-map", onSelect: onTeamMap },
    ...(archived?.count ? [{ key: "archived", label: t("sidebar.archived.title"), icon: <Archive size={16} />, value: String(archived.count), onSelect: archived.open }] : []),
  ];
}

export function accountLabel(name: string, { automationsNeedYou, update }: { automationsNeedYou: boolean; update: string | null }): string {
  const needsYou = automationsNeedYou ? t("sidebar.account.automationsNeedYou") : "";
  return [name, needsYou, update ?? ""].filter(Boolean).join(" · ");
}

export type AccountDot = "danger" | "accent";
const DOT_COLOR: Record<AccountDot, string> = { danger: "bg-danger", accent: "bg-accent" };

export function accountDot({ automationsNeedYou, update }: { automationsNeedYou: boolean; update: "failed" | "news" | null }): AccountDot | null {
  if (automationsNeedYou || update === "failed") return "danger";
  return update ? "accent" : null;
}

/** `besideRail`: the window's rail of places stands beside the page and switches places, so Switch to… isn't offered twice. */
export function placeMenuItems(place: Pick<WorkspacePlace, "bridge" | "current" | "openMenu" | "switchable">, { besideRail = false }: { besideRail?: boolean } = {}): SidebarMenuItem[] {
  const here = <Check size={15} aria-hidden="true" className="shrink-0 text-ink-secondary" />;
  if (!place.switchable) return [];
  const current = place.current;
  const icon = current?.local === false ? <Server size={16} /> : <Laptop size={16} />;
  return [
    ...(current ? [{ key: "place", label: current.name, icon, trailing: here, onSelect: place.openMenu }] : []),
    ...(besideRail ? [] : [{ key: "switch-place", label: t("sidebar.menu.switchTo"), icon: <ArrowLeftRight size={16} />, onSelect: place.openMenu }]),
  ];
}

export function profileMenuItems({
  phone,
  usage,
  update,
  updateTop = null,
  simple,
  onUsage,
  onSettings,
  onShortcuts,
  onAbout,
  onHelp,
  onFeedback,
}: {
  phone: SidebarMenuItem[];
  usage: boolean;
  update: SidebarMenuItem | null;
  updateTop?: { label: string; action: string } | null;
  simple?: { tools: SidebarMenuItem[]; places: SidebarMenuItem[] };
  onUsage: () => void;
  onSettings: () => void;
  onShortcuts: () => void;
  onAbout: () => void;
  onHelp: () => void;
  onFeedback: () => void;
}): SidebarMenuItem[] {
  const help: SidebarMenuItem[] = [
    { key: "help", label: t("sidebar.menu.help"), icon: <HelpCircle size={18} />, onSelect: onHelp },
    { key: "feedback", label: t("sidebar.menu.feedback"), icon: <DiscordIcon size={17} />, onSelect: onFeedback },
    {
      key: "shortcuts",
      label: t("sidebar.menu.shortcuts"),
      icon: <Keyboard size={18} />,
      ...(simple ? {} : { trailing: <ShortcutHint id="shortcuts-cheat-sheet" /> }),
      onSelect: onShortcuts,
    },
    { key: "about", label: t("sidebar.menu.about"), icon: <Info size={18} />, separatorBefore: true, onSelect: onAbout },
  ];
  const usageItem: SidebarMenuItem | null = usage ? {
    key: "usage",
    label: t("settings.section.usage"),
    icon: <Gauge size={18} />,
    onSelect: onUsage,
  } : null;
  const support: SidebarMenuItem = { key: "support", label: t("sidebar.menu.support"), icon: <LifeBuoy size={18} />, submenu: help, onSelect: () => {} };
  const settings: SidebarMenuItem = { key: "settings", label: t("sidebar.menu.settings"), icon: <SettingsIcon size={18} />, onSelect: onSettings };
  const present = (...items: Array<SidebarMenuItem | null | false>) => items.filter((item): item is SidebarMenuItem => Boolean(item));
  if (!simple) {
    return [...present(usageItem), ...phone, support, settings, ...present(update)];
  }
  const raised: SidebarMenuItem | null = update && updateTop ? {
    ...update,
    label: updateTop.label,
    subtitle: undefined,
    attention: false,
    trailing: <span className="flex h-6 shrink-0 items-center rounded-full bg-ink px-2.5 text-caption font-medium text-app">{updateTop.action}</span>,
  } : null;
  const groups: SidebarMenuItem[][] = [
    present(raised),
    [...present(usageItem), ...phone, { ...support, submenu: raised ? help : [...help, ...present(update)] }, settings],
    simple.tools,
    simple.places,
  ].filter((group) => group.length > 0);
  return groups.flatMap((group, at) => group.map((item, index) => (at > 0 && index === 0 ? { ...item, separatorBefore: true } : item)));
}

export interface ArchivedBots {
  count: number;
  open: () => void;
}

export interface SimpleAccount {
  place: WorkspacePlace;
  automationsNeedYou: boolean;
  archived?: ArchivedBots;
}

export function useSimpleAccount(place: WorkspacePlace, archived?: ArchivedBots): SimpleAccount {
  return { place, automationsNeedYou: useAutomationsNeedYou(), archived };
}

/** `circle` is the phone's round avatar button at the top of the bot list. */
export function SidebarProfileMenu({ iconOnly = false, rail = false, circle = false, simple: account }: {
  iconOnly?: boolean; rail?: boolean; circle?: boolean; simple?: SimpleAccount;
} = {}) {
  const { state, dispatch } = useStore();
  const simple = account !== undefined;
  const phone = useSidebarPhoneStatus();
  const connectPhone = useConnectPhoneEntry();
  const destinations = phoneDestinations(connectPhone);
  const desktopUpdate = useUpdateItem();
  const serverUpdate = useServerUpdateItem(!window.ogb?.updater);
  const update = desktopUpdate ?? serverUpdate;
  const [aboutOpen, setAboutOpen] = useState(false);
  const [phoneAppOpen, setPhoneAppOpen] = useState(false);
  const [session, setSession] = useState<SessionState | null>(null);
  const triggerRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    let active = true;
    void readSessionState().then((state) => {
      if (active) setSession(state);
    });
    return () => { active = false; };
  }, []);

  const profile = profileForSession(state.config?.profile, session);
  const name = profileLabel(profile);
  const connectTo = () => dispatch(phonePairingSettingsAction());
  const remote = window.ogb?.remoteClient?.active === true;
  const besideRail = railShown(usePlaces());
  
  

  const items = profileMenuItems({
    phone: simple
      ? simplePhoneItems({ connected: phone.kind === "connected", onGetApp: () => setPhoneAppOpen(true) })
      : phoneMenuItems({
        destinations,
        connected: phone.kind === "connected",
        onConnect: connectTo,
        onGetApp: () => setPhoneAppOpen(true),
      }),
    usage: !remote,
    update: update?.item ?? null,
    updateTop: simple ? simpleUpdateTop(update) : null,
    ...(account ? { simple: {
      tools: toolMenuItems({
        activeView: state.activeView,
        automationsNeedYou: account.automationsNeedYou,
        onAutomations: () => dispatch({ type: "showRoutines", view: "list" }),
        onTeamMap: () => dispatch({ type: "showTeamMap" }),
        
        archived: account.archived,
      }),
      places: placeMenuItems(account.place, { besideRail }),
    } } : {}),
    onUsage: () => dispatch({ type: "toggleAppSettings", open: true, section: "usage" }),
    onSettings: () => dispatch({ type: "toggleAppSettings" }),
    onShortcuts: () => {
      triggerRef.current?.closest("button")?.focus();
      dispatch({ type: "toggleShortcuts", open: true });
    },
    onAbout: () => setAboutOpen(true),
    onHelp: () => void openExternalLink(HELP_CENTER_URL),
    onFeedback: () => void openExternalLink(FEEDBACK_URL),
  });
  const noteworthy = update && updateNoteworthy(update.phase, update.pending) && !updateHasButton(update.phase);
  const needsYou = account?.automationsNeedYou === true;
  const initials = profileInitials(profile);
  const nameless = simple && initials === "?" ? <UserRound size={18} strokeWidth={1.75} aria-hidden /> : undefined;
  const label = accountLabel(name, { automationsNeedYou: needsYou, update: simple && noteworthy && update ? update.label : null });
  const dot = accountDot({ automationsNeedYou: needsYou, update: noteworthy ? (update.phase === "error" ? "failed" : "news") : null });

  return (
    <>
      <SidebarPopoverMenu
        items={items}
        ariaLabel={name}
        triggerClassName={iconOnly || simple ? cn("shrink-0", circle || simple ? "rounded-full" : "rounded-xl") : "w-full"}
        triggerTitle={iconOnly || simple ? label : undefined}
        triggerLabel={label}
        triggerTour={account?.place.switchable ? "server-switcher" : undefined}
        renderTrigger={({ open }) => simple ? (
          <span
            ref={triggerRef}
            data-sidebar-account=""
            className={cn("relative flex size-9 items-center justify-center rounded-full ring-2 transition-shadow", open ? "ring-ink/15" : "ring-transparent hover:ring-ink/10")}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={36} fallback={nameless} fontSize={14} className="ring-1 ring-inset ring-ink/[0.04]" />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute -right-0.5 -top-0.5 size-2.5 rounded-full ring-2 ring-panel", DOT_COLOR[dot])} />}
          </span>
        ) : iconOnly ? (
          <span
            ref={triggerRef}
            className={cn(
              "relative flex items-center justify-center rounded-xl transition-colors",
              rail ? "size-10" : "size-[46px]",
              circle && "size-10 rounded-full border border-hairline bg-card",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <InitialsAvatar initials={initials} avatarUrl={profile?.avatarUrl} size={rail ? 30 : circle ? 26 : 28} />
            {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute end-1 top-1 size-2.5 rounded-full ring-2 ring-app", DOT_COLOR[dot])} />}
          </span>
        ) : (
          <span
            ref={triggerRef}
            className={cn(
              "flex min-h-[46px] w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors",
              open ? "bg-raised" : "hover:bg-raised/50",
            )}
          >
            <span className="relative flex shrink-0">
              <InitialsAvatar initials={profileInitials(profile)} avatarUrl={profile?.avatarUrl} size={28} />
              {dot && <span aria-hidden data-account-dot={dot} className={cn("absolute -right-0.5 -top-0.5 size-2 rounded-full ring-2 ring-app", DOT_COLOR[dot])} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-body-sm font-medium leading-5 text-ink">{name}</span>
            </span>
            {noteworthy && (
              <span
                title={update.label}
                aria-label={update.label}
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full",
                  update.phase === "error" ? "bg-danger/15 text-danger" : "bg-accent/15 text-accent",
                )}
              >
                <UpdateIcon phase={update.phase} pending={update.pending} size={14} />
              </span>
            )}
          </span>
        )}
      />
      <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
      {phoneAppOpen && <PhoneAppDialog
        open
        onClose={() => setPhoneAppOpen(false)}
        connect={destinations.map((destination) => ({
          key: destination.id,
          subtitle: t(destination.subtitleKey),
          onSelect: () => connectTo(),
        }))}
      />}
    </>
  );
}
