import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BUILT_IN_BROWSER_SYSTEM_PROMPT, browserEngineStatus, clearBrowserSessionState, closeBrowserSession, runningBrowserSessionNames } from "../browser-engine.ts";
import { CHROME_BROWSER_SYSTEM_PROMPT } from "../browser/prompt.ts";
import { TOOL_LIST } from "../browser/tools.ts";
import { browserEgress } from "../browser/egress/registry.ts";
import { type AppConfig } from "../config.ts";
import type { Store } from "../store.ts";
import type { TurnOwner } from "../turn-resources.ts";
import { createBrowserHost, type BrowserHostDeps } from "./browser.ts";

vi.mock("../browser-engine.ts", async (original) => {
  const actual = await original<typeof import("../browser-engine.ts")>();
  return {
    ...actual,
    browserEngineStatus: vi.fn(actual.browserEngineStatus),
    clearBrowserSessionState: vi.fn(async () => true),
    closeBrowserSession: vi.fn(async () => true),
    runningBrowserSessionNames: vi.fn(async () => []),
  };
});
vi.mock("../browser-processes.ts", async (original) => ({
  ...await original<typeof import("../browser-processes.ts")>(),
  orphanedBrowsers: vi.fn(async () => []),
}));

type Host = ReturnType<typeof createBrowserHost>;
const hosts: Host[] = [];
afterEach(async () => { await Promise.all(hosts.splice(0).map((host) => host.browserRuntime.closeAll())); });

const turn = { threadId: "thread-1", generation: "gen-1" };

function setup(engine: "chrome" | "agent-browser" | undefined, { server = false, holder, bots: botIds = ["scout"], turnResources }: {
  server?: boolean; holder?: (resource: string) => TurnOwner | undefined;
  bots?: string[]; turnResources?: BrowserHostDeps["turnResources"];
} = {}) {
  const cfg = {
    features: { browser: true },
    ...(engine ? { browserEngine: { engine } } : {}),
    browserProfiles: [
      { id: "work", name: "Work", partitionId: "p-work" },
      { id: "mine", name: "Mine", browser: "chrome", partitionId: "p-mine" },
    ],
  } as unknown as AppConfig;
  const bots = botIds.map((id) => ({ id, name: id, browser: true }));
  const minted: unknown[] = [];
  const host = createBrowserHost({
    cfg,
    store: () => ({ bots, bot: (id: string) => bots.find((bot) => bot.id === id), botByThread: () => bots[0] }) as unknown as Pick<Store, "bots" | "bot" | "botByThread">,
    turnResources: turnResources ?? { free: () => true, holder: holder ?? (() => undefined), onClaim: () => () => {} },
    activeInternalGenerationByThread: new Map([[turn.threadId, turn.generation]]),
    mintInternalCapability: (capability) => { minted.push(capability); return "capability-token"; },
    DESKTOP_MANAGED: !server,
    PORT: 4100,
  });
  hosts.push(host);
  return { cfg, host, minted, bots };
}

describe("the bots' browser host and the engine memory guard", () => {
  it("hands the guard the browsers each thread's turn starts or holds", () => {
    const told: unknown[] = [];
    const host = createBrowserHost({
      cfg: { features: { browser: true } } as unknown as AppConfig,
      store: () => ({ bots: [], bot: () => undefined, botByThread: () => undefined }) as unknown as Pick<Store, "bots" | "bot" | "botByThread">,
      turnResources: { free: () => true, holder: () => undefined, onClaim: () => () => {} },
      activeInternalGenerationByThread: new Map(),
      mintInternalCapability: () => "capability-token",
      DESKTOP_MANAGED: false,
      PORT: 4100,
      engineMemory: { useBrowsers: (browsers) => { told.push(browsers); } },
    });
    hosts.push(host);
    expect(told).toEqual([host.engineBrowsers]);
  });
});

describe("the bots' browser host with browserEngine.engine set to chrome", () => {
  it("gives a bot's turn the browser MCP server over its own profile on the new engine", async () => {
    const { host, minted } = setup("chrome");
    const browser = await host.browserIntegration("scout", undefined, turn);
    expect(browser?.spec).toEqual({ command: "omb-cdp", args: ["bot:scout"], env: {} });
    expect(browser?.integration).toMatchObject({ command: process.execPath, env: { OMB_HARNESS_URL: "http://127.0.0.1:4100" } });
    expect(minted).toEqual([expect.objectContaining({ botId: "scout", browserSession: browser?.session, kind: "browser", ...turn })]);
    expect(host.usedBrowserSessions.get(browser!.session)).toEqual(browser?.spec);
  });

  it("puts a shared profile's bots on one profile and a temporary browser on its own", async () => {
    const { host } = setup("chrome");
    expect((await host.browserIntegration("scout", "work"))?.spec.args).toEqual(["shared:p-work"]);
    const guest = await host.browserIntegration("scout", "guest");
    expect(guest?.spec.args).toEqual([`temp:${guest?.session}`]);
  });

  it("lists the new browser's tools without starting Chrome", async () => {
    const { host } = setup("chrome");
    const browser = await host.browserIntegration("scout", undefined, turn);
    const listed = await host.browserRuntime.agentRpc(browser!.session, browser!.spec as never, "tools/list", {}) as { tools: Array<{ name: string }> };
    expect(listed.tools.map((tool) => tool.name)).toEqual(TOOL_LIST.map((tool) => tool.name));
  });

  it("keeps a profile on the person's own Chrome on agent-browser: its prompt, and no sites list from either", () => {
    const { host } = setup("chrome");
    expect(host.browserSystemPrompt(undefined)).toBe(CHROME_BROWSER_SYSTEM_PROMPT);
    expect(host.browserSystemPrompt("work")).toBe(CHROME_BROWSER_SYSTEM_PROMPT);
    expect(host.browserSystemPrompt("mine")).toBe(BUILT_IN_BROWSER_SYSTEM_PROMPT);
    expect(host.signedInSitesRefusal("mine")).toContain("your own Chrome");
    expect(host.signedInSitesRefusal("work")).toContain("does not list signed-in sites yet");
  });

  it("says in the status which engine runs the bots' browsers", () => {
    const { cfg, host } = setup("chrome");
    expect(host.engineSummary({ kind: "unavailable", reason: "agent-browser is not installed", myChrome: true })).toMatchObject({ engine: "chrome", myChrome: true });
    cfg.browserEngine = { engine: "agent-browser" };
    expect(host.engineSummary({ kind: "unavailable", reason: "agent-browser is not installed", myChrome: true })).toEqual({ kind: "unavailable", reason: "agent-browser is not installed", myChrome: true, engine: "agent-browser" });
  });

  it("offers the owner's local-sites switch on a self-hosted server", () => {
    const unavailable = { kind: "unavailable" as const, reason: "agent-browser is not installed", myChrome: false };
    const { cfg, host } = setup("agent-browser", { server: true });
    cfg.browserEngine = { engine: "agent-browser", egress: { localNetwork: true, allow: ["10.0.0.5"] } };
    expect(host.engineSummary(unavailable).serverSites).toBe(true);
    expect(browserEgress.rules().localNetwork).toBe(true);
    expect(browserEgress.rules().allowed("10.0.0.5", 80)).toBe(true);
    const desktop = setup("agent-browser");
    desktop.cfg.browserEngine = { engine: "agent-browser", egress: { allow: ["10.0.0.5"] } };
    expect(desktop.host.engineSummary(unavailable).serverSites).toBeUndefined();
    // The desktop's own default stays: its browsers reach the local network unless egress.localNetwork is false.
    expect(browserEgress.rules().localNetwork).toBe(true);
  });

  it("forgets the new engine's sessions when the engine is switched back", async () => {
    const { cfg, host } = setup("chrome");
    const browser = await host.browserIntegration("scout", undefined, turn);
    cfg.browserEngine = { engine: "agent-browser" };
    host.browserEngineSwitched();
    expect(host.usedBrowserSessions.has(browser!.session)).toBe(false);
    expect(host.browserSystemPrompt(undefined)).toBe(BUILT_IN_BROWSER_SYSTEM_PROMPT);
  });
});

describe("what the memory guard sees of a bot's browser", () => {
  it("counts a browser a bot's turn may start, but not one it can't use or the person's own Chrome", () => {
    const { host, bots } = setup(undefined, { server: true });
    const bot = bots[0] as { browser: boolean; browserProfile?: string };
    expect(host.engineBrowsers.starts("thread-1")).toBe(true);
    bot.browser = false;
    expect(host.engineBrowsers.starts("thread-1")).toBe(false);
    const desktop = setup(undefined);
    (desktop.bots[0] as { browserProfile?: string }).browserProfile = "mine";
    expect(desktop.host.engineBrowsers.starts("thread-1")).toBe(false);
  });

  it("counts a temporary browser before its first call without making its session", () => {
    const { host, bots } = setup(undefined, { server: true });
    (bots[0] as { browserProfile?: string }).browserProfile = "guest";
    expect(host.engineBrowsers.starts("thread-1")).toBe(true);
    expect(host.temporaryBrowserSessions.size).toBe(0);
  });

  it("closes nothing for a stopped turn whose bot's browser is not running", async () => {
    const { host } = setup(undefined, { server: true });
    await host.browserIntegration("scout", undefined, turn);
    vi.mocked(closeBrowserSession).mockClear();
    host.engineBrowsers.stopped("thread-1");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(closeBrowserSession).not.toHaveBeenCalled();
  });
});



describe("how long an unused browser stays open", () => {
  it("is ten minutes unless config.json sets it", () => {
    const desktop = setup(undefined);
    expect(desktop.host.browserIdleMs()).toBe(10 * 60_000);
    desktop.cfg.browserEngine = { idleTimeoutMinutes: 20 };
    expect(desktop.host.browserIdleMs()).toBe(20 * 60_000);
  });
});

describe("the bots' browser host by default", () => {
  it("keeps agent-browser's prompt and status", () => {
    const { host } = setup(undefined);
    expect(host.browserSystemPrompt(undefined)).toBe(BUILT_IN_BROWSER_SYSTEM_PROMPT);
    expect(host.signedInSitesRefusal("work")).toBeNull();
    expect(host.engineSummary({ kind: "engine", version: "0.37.0", myChrome: true })).toEqual({ kind: "engine", version: "0.37.0", myChrome: true, engine: "agent-browser" });
  });
});

describe("a deleted bot's browser", () => {
  const PATH_ENGINE = "/usr/local/bin/agent-browser";
  const MANAGED_ENGINE = "/data/.openmausbot/tools/agent-browser";
  const folders: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
  });
  /** agent-browser on PATH, as the Cloud image installs it; with `managed`, also the one SuperBot installed. */
  function engines({ managed = false }: { managed?: boolean } = {}) {
    vi.mocked(browserEngineStatus).mockImplementation((options) => (options?.managedOnly && !managed
      ? { kind: "unavailable", reason: "not installed", installable: true }
      : { kind: "ready", binaryPath: options?.managedOnly ? MANAGED_ENGINE : PATH_ENGINE, version: "0.37.0", managed: options?.managedOnly === true }));
    vi.mocked(clearBrowserSessionState).mockClear().mockResolvedValue(true);
    vi.mocked(closeBrowserSession).mockClear().mockResolvedValue(true);
  }
  function daemons(sessions: string[]) {
    const folder = mkdtempSync(join(tmpdir(), "omb-host-sweep-"));
    folders.push(folder);
    mkdirSync(join(folder, "agent-browser"));
    for (const session of sessions) writeFileSync(join(folder, "agent-browser", `${session}.pid`), "0");
    vi.stubEnv("XDG_RUNTIME_DIR", folder);
    vi.mocked(runningBrowserSessionNames).mockResolvedValue(sessions);
  }
  const deleted = { type: "openmausbot:browser-bot-deleted" as const, requestId: "00000000-0000-4000-8000-000000000000", botId: "gone" };
  const closed = () => vi.mocked(closeBrowserSession).mock.calls.map(([binary, env]) => `${binary} ${env.AGENT_BROWSER_SESSION}`);


  it("elsewhere, is erased only with the agent-browser SuperBot installed, and otherwise just closed", async () => {
    engines();
    const { host } = setup(undefined);
    expect(await host.eraseDeletedBrowser(deleted)).toBe(true);
    expect(clearBrowserSessionState).not.toHaveBeenCalled();
    expect(closed()).toEqual([`${PATH_ENGINE} bot-gone`]);
    engines({ managed: true });
    expect(await host.eraseDeletedBrowser(deleted)).toBe(true);
    expect(vi.mocked(clearBrowserSessionState).mock.calls.map(([binary, session]) => `${binary} ${session}`)).toEqual([`${MANAGED_ENGINE} bot-gone`]);
  });


  it("off a Cloud home, is left to the deletion, as anything else under the same HOME", async () => {
    engines();
    daemons(["bot-gone", "default"]);
    const { host } = setup(undefined);
    host.browserSweep.start();
    await vi.waitFor(() => expect(runningBrowserSessionNames).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(closed()).toEqual([]);
    await host.browserSweep.closeAll();
  });
});

