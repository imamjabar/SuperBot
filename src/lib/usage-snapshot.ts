// Security: the daily snapshot is counts, booleans and allowlisted words. Names, emails, ids, URLs, labels and
// timestamps from the inputs never reach the event; only lengths, flags and allow() results do.
import { engineReady } from "@/components/EngineLibrary";
import { analyticsEnabled, track } from "@/lib/analytics";
import {
  allow, APP, CONNECTORS_MODE, DECIDER, EDITION, engineForDriver, LOCAL_VM_MODE, VOICE,
  type EventProps, type KeyProvider, type PropValue,
} from "@/lib/analytics-allowlist";
import { hasActiveConnection, type ConnectorStatus } from "@/lib/connector-status";
import { addedServers } from "@/lib/openai-compat-endpoints";
import type { Routine } from "@/lib/routines";
import type { AppState, Bot, ConfigStatus, Group, InstanceInfo } from "@/state/store";

export const SNAPSHOT_CHECK_MS = 60 * 60 * 1_000;
const SOURCE_TIMEOUT_MS = 60_000;
const DAY_KEY = "omb-analytics-snapshot-day";


export interface UsageInput {
  config: ConfigStatus;
  instances: readonly InstanceInfo[];
  bots: ReadonlyArray<Pick<Bot, "computer" | "cloudBackend" | "hidden">>;
  groups: ReadonlyArray<Pick<Group, "dm">>;
  sections?: readonly string[];
  /** null while the routine list is not loaded. */
  routines: ReadonlyArray<Pick<Routine, "enabled" | "runOn" | "target" | "schedule">> | null;
  /** null while webhooks are not loaded. */
  webhooks: number | null;
  apps: { services: Record<string, ConnectorStatus>; authoritative: boolean } | null;
  sessions: { sessions: ReadonlyArray<{ id?: unknown; email?: unknown }>; current: unknown } | null;
  companionDevices: number | null;
  computers: { cloudComputers: unknown; teamComputers: unknown } | null;
  platform: "desktop" | "browser";
  remoteClient: boolean;
}

const count = (value: unknown): number | undefined => Number.isInteger(value) && (value as number) >= 0 ? value as number : undefined;
const tally = <T,>(items: readonly T[], test: (item: T) => boolean) => items.filter(test).length;

function keyProviders(config: ConfigStatus): KeyProvider[] {
  const ownVoice = config.tts?.configured === true;
  const ownDecider = config.decider?.configured === true;
  const configured: Array<[boolean | undefined, KeyProvider]> = [
    [config.anthropic?.configured, "anthropic"],
    [config.openai?.configured, "openai"],
    [config.openrouter?.configured, "openrouter"],
    [config.openaiCompat?.configured, "openai_compat"],
    [config.xai?.configured, "xai"],
    [config.mistral?.configured, "mistral"],
    [config.cerebras?.configured, "cerebras"],
    [config.groq?.configured, "groq"],
    [config.greenference?.configured, "greenference"],
    [config.meta?.configured, "meta"],
    [config.box?.configured, "boat"],
    [config.composio?.configured && config.composio.mode === "self-hosted", "composio"],
    [config.opencodeGo?.configured, "opencode_go"],
    [ownVoice && config.tts?.provider === "elevenlabs", "elevenlabs"],
    [ownVoice && config.tts?.provider === "fish", "fish_audio"],
    [ownDecider && config.decider?.provider === "jev", "jev"],
    [ownDecider && config.decider?.provider === "openrouter", "openrouter_decider"],
    [config.imageGen?.openaiConfigured, "openai_image"],
    [config.imageGen?.customKeyConfigured, "custom_image"],
    [config.live?.keySource === "live", "openai_live"],
    [config.treg?.configured, "treg"],
  ];
  return configured.flatMap(([on, provider]) => on === true ? [provider] : []);
}

function routineCounts(routines: UsageInput["routines"]): Record<string, number> {
  if (!routines) return {};
  return {
    routines: routines.length,
    routines_enabled: tally(routines, (routine) => routine.enabled === true),
    routines_cloud: tally(routines, (routine) => routine.runOn === "cloud"),
    routines_room_goal: tally(routines, (routine) => routine.target === "room-goal"),
    routines_once: tally(routines, (routine) => routine.schedule.type === "once"),
    routines_daily: tally(routines, (routine) => routine.schedule.type === "daily"),
    routines_interval: tally(routines, (routine) => routine.schedule.type === "interval"),
    routines_cron: tally(routines, (routine) => routine.schedule.type === "cron"),
  };
}

function appFacts(apps: UsageInput["apps"]): Record<string, PropValue> {
  if (apps?.authoritative !== true) return {};
  const active = Object.entries(apps.services).filter(([, status]) => hasActiveConnection(status));
  return { apps: [...new Set(active.map(([slug]) => allow(slug, APP)))].sort(), apps_connected: active.length };
}

const emailOf = (session: { email?: unknown }) => typeof session.email === "string" && session.email ? session.email.toLowerCase() : null;

function deviceFacts(sessions: UsageInput["sessions"], companionDevices: number | null): Record<string, PropValue | undefined> {
  const phones = count(companionDevices);
  const others = sessions?.sessions.filter((session) => session.id !== sessions.current);
  const mine = emailOf(sessions?.sessions.find((session) => session.id === sessions.current) ?? {});
  const paired = others && tally(others, (session) => emailOf(session) === null);
  return {
    phones_paired: phones,
    paired_devices: paired,
    members: others && new Set(others.map(emailOf).filter((email) => email !== null && email !== mine)).size,
    phone_paired: phones === undefined && paired === undefined ? undefined : (phones ?? 0) + (paired ?? 0) > 0,
  };
}

export function buildUsageSnapshot(input: UsageInput): EventProps {
  const { config, groups, instances } = input;
  const bots = input.bots.filter((bot) => bot.hidden !== true);
  const keys = keyProviders(config);
  const ready = instances.filter(engineReady);
  const place = (computer: Bot["computer"]) => tally(bots, (bot) => bot.computer === computer);
  const props: Record<string, PropValue | undefined> = {
    key_providers: keys,
    key_count: keys.length,
    has_boat_key: keys.includes("boat"),
    cloud_computer_source: config.box?.configured ? "own_key" : "none",
    cloud_computers: count(input.computers?.cloudComputers),
    team_computers: count(input.computers?.teamComputers),
    bots_cloud_boat: tally(bots, (bot) => bot.computer === "cloud" && bot.cloudBackend !== "vps"),
    bots_cloud_vps: tally(bots, (bot) => bot.computer === "cloud" && bot.cloudBackend === "vps"),
    bots: bots.length,
    bots_local_vm: place("vm"),
    bots_this_computer: place("local"),
    bots_browser: place("browser"),
    bots_off: place("off"),
    bots_auto: place(undefined),
    rooms: tally(groups, (group) => group.dm !== true),
    bot_channels: tally(groups, (group) => group.dm === true),
    teams: input.sections?.length ?? 0,
    ...routineCounts(input.routines),
    webhooks: count(input.webhooks),
    engines: [...new Set(ready.map((instance) => engineForDriver(instance.driverKind)))].sort(),
    engine_count: ready.length,
    custom_endpoints: addedServers(instances).length,
    ...appFacts(input.apps),
    connectors_mode: allow(config.composio?.mode?.replace("-", "_"), CONNECTORS_MODE),
    local_vm_mode: allow(config.localVm?.mode?.replace("-", "_"), LOCAL_VM_MODE),
    vps_configured: config.vps?.configured === true,
    voice: config.tts?.configured ? allow(config.tts.provider, VOICE) : "none",
    decider: config.decider?.enabled ? allow(config.decider.provider, DECIDER) : "off",
    live_calls: config.live?.configured === true,
    ...deviceFacts(input.sessions, input.companionDevices),
    edition: allow(config.edition?.edition ?? "oss", EDITION),
    org_managed: Boolean(config.managedPolicy),
    onboarded: Boolean(config.onboarding?.completedAt),
    first_turn: Boolean(config.onboarding?.firstTurnAt),
    platform: input.platform,
    remote_client: input.remoteClient,
  };
  return Object.fromEntries(Object.entries(props).filter((entry): entry is [string, PropValue] => entry[1] !== undefined));
}


export function snapshotReady(
  state: Pick<AppState, "connected" | "hydrated" | "config" | "routinesLoadState" | "instances" | "webhookIngress">,
  loadsWebhooks: boolean,
): boolean {
  return state.connected && state.hydrated === true && state.config !== null && state.routinesLoadState !== "loading"
    && state.instances.length > 0 && (!loadsWebhooks || state.webhookIngress !== null);
}

export interface UsageSources {
  request<T>(path: string): Promise<T>;
  connectedApps(): Promise<{ services: Record<string, ConnectorStatus>; authoritative: boolean }>;
  companion: { state(): Promise<{ devices?: unknown }> } | null;
  platform: "desktop" | "browser";
  remoteClient: boolean;
}

export type SnapshotState = Pick<AppState, "config" | "instances" | "bots" | "groups" | "sections" | "routines" | "routinesLoadState" | "webhooks" | "webhookIngress">;

/** Null when the source fails or does not answer in time. */
function settle<T>(work: () => Promise<T>): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), SOURCE_TIMEOUT_MS);
    new Promise<T>((run) => run(work())).then(resolve, () => resolve(null)).finally(() => clearTimeout(timer));
  });
}

export const utcDay = (now: number) => new Date(now).toISOString().slice(0, 10);

let claimedDay: string | null = null;
let gathering = false;

function claimDay(day: string): boolean {
  if (claimedDay === day) return false;
  try {
    if (localStorage.getItem(DAY_KEY) === day) return false;
  } catch {}
  claimedDay = day;
  try {
    localStorage.setItem(DAY_KEY, day);
  } catch {}
  return true;
}

/** At most one app_snapshot per app origin per UTC day; an opted-out install makes no request at all. */
export async function sendDailySnapshot(state: SnapshotState, sources: UsageSources, now = Date.now()): Promise<boolean> {
  if (!analyticsEnabled() || gathering || !state.config) return false;
  if (!claimDay(utcDay(now))) return false;
  gathering = true;
  try {
    const config = state.config;
    const { companion } = sources;
    const [apps, sessions, companionDevices, computers] = await Promise.all([
      settle(() => sources.connectedApps()),
      settle(() => sources.request<{ sessions?: unknown; current?: unknown }>("/api/auth/sessions")),
      companion ? settle(() => companion.state()) : null,
      config.box?.configured
        ? settle(() => sources.request<{ cloudComputers?: unknown; teamComputers?: unknown }>("/api/computers/usage"))
        : { cloudComputers: 0, teamComputers: 0 },
    ]);
    track("app_snapshot", buildUsageSnapshot({
      config,
      instances: state.instances,
      bots: state.bots,
      groups: state.groups,
      sections: state.sections,
      routines: state.routinesLoadState === "ready" ? state.routines : null,
      webhooks: state.webhookIngress ? state.webhooks.length : null,
      apps,
      sessions: Array.isArray(sessions?.sessions)
        ? { sessions: sessions.sessions.filter((session) => session !== null && typeof session === "object"), current: sessions.current }
        : null,
      companionDevices: Array.isArray(companionDevices?.devices) ? companionDevices.devices.length : null,
      computers: computers ? { cloudComputers: computers.cloudComputers, teamComputers: computers.teamComputers } : null,
      platform: sources.platform,
      remoteClient: sources.remoteClient,
    }));
    return true;
  } finally {
    gathering = false;
  }
}
