// End-to-end on the fakes: a scripted bot shows a dashboard folder (index.html, a script and a Parquet file) inline,
// its frame's files load through the token route with no sign-in, another bot can't show that folder, and publishing the
// folder gives the same card its link, served by the server's own pages listener on a loopback port; no model is called.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, expect, it } from "vitest";
import { launchVerificationServer, runControlOmb } from "../scripts/control-omb.ts";
import { freePortBlock } from "./testing/ports.ts";

const owner = randomBytes(32).toString("base64url");
const realFetch = globalThis.fetch;
let pagesUrl: string;
let fixture: Awaited<ReturnType<typeof launchVerificationServer>>;
const PARQUET = Buffer.concat([Buffer.from("PAR1"), randomBytes(2_048), Buffer.from("PAR1")]);

beforeAll(async () => {
  const pagesPort = await freePortBlock([0]);
  pagesUrl = `http://127.0.0.1:${pagesPort}`;
  globalThis.fetch = (input, init = {}) => realFetch(input, { ...init, headers: { ...Object.fromEntries(new Headers(init.headers)), "x-superbot-desktop-owner": owner } });
  fixture = await launchVerificationServer({ ...process.env, OMB_TEST_DESKTOP_OWNER_TOKEN: owner, OMB_PAGES_PORT: String(pagesPort), OMB_PAGES_PUBLIC_URL: pagesUrl },
    undefined, undefined, undefined, undefined, { scripted: true });
}, 90_000);
afterAll(async () => {
  globalThis.fetch = realFetch;
  await fixture?.close();
});

it("shows a dashboard folder inline, serves its Parquet to the frame by token only, keeps other bots out, and gives the card its link on publish", async () => {
  const cli = (...args: string[]) => runControlOmb(args, { env: { SUPERBOT_URL: fixture.info.url } }) as Promise<any>;
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${fixture.info.url}${path}`, { ...init, headers: { "content-type": "application/json" } });
    return { status: response.status, body: await response.json() as any };
  };
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const evidence = (botId: string) => (existsSync(`${planPath}.evidence.jsonl`) ? readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").filter(Boolean) : [])
    .map((line) => JSON.parse(line)).filter((entry: any) => entry.botId === botId);
  const turn = async (bot: any, steps: unknown[]) => {
    writeFileSync(planPath, JSON.stringify({ [bot.id]: { steps, reply: "Done." } }));
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Show me the sales dashboard.");
    expect((await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
    return evidence(bot.id).at(-1).evidence.filter((entry: any) => entry.step).map((entry: any) => entry.response.result.content[0].text as string);
  };
  const analyst = (await cli("new-bot", "--name", "Analyst")).bot;
  const dash = join(fixture.info.dataDir, "workspaces", analyst.id, "dash");
  mkdirSync(dash, { recursive: true });
  writeFileSync(join(dash, "index.html"), "<!doctype html><h1>Sales</h1><script src=\"app.js\"></script>");
  writeFileSync(join(dash, "app.js"), "fetch(new URL(\"data.parquet\", document.baseURI));");
  writeFileSync(join(dash, "data.parquet"), PARQUET);

  const [shown] = await turn(analyst, [{ tool: "show_html", arguments: { path: "dash", title: "Sales dashboard" } }]);
  const appId = /^Shown as app ([\w-]+)\./.exec(shown!)?.[1];
  expect(appId, shown).toBeTruthy();
  const doc = await api(`/api/threads/${analyst.activeTaskId}/messages/${appId}/app?origin=${encodeURIComponent(fixture.info.url)}`);
  const base = /<base href="([^"]+)">/.exec(doc.body.srcdoc)?.[1] ?? "";
  expect(base).toMatch(new RegExp(`^${fixture.info.url}/api/page-files/[A-Za-z0-9_-]{43}/$`));
  expect(doc.body.csp).toContain(`connect-src https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com ${base} https://extensions.duckdb.org;`);
  expect(doc.body.srcdoc).toContain("<h1>Sales</h1><script src=\"app.js\"></script>");

  // The frame's own requests: no sign-in, only the token, from an opaque origin.
  const ranged = await realFetch(`${base}data.parquet`, { headers: { range: "bytes=0-3" } });
  expect(ranged.status).toBe(206);
  expect(ranged.headers.get("access-control-allow-origin")).toBe("*");
  expect(Buffer.from(await ranged.arrayBuffer()).toString()).toBe("PAR1");
  const whole = await realFetch(`${base}data.parquet`);
  expect(Buffer.from(await whole.arrayBuffer()).equals(PARQUET)).toBe(true);
  // A dot segment, even percent-encoded, is folded away by the URL itself and lands outside the token's folder.
  expect((await realFetch(`${base}%2e%2e/index.html`)).status).toBe(404);
  expect((await realFetch(`${base}..%2Fapp.js`)).status).toBe(400);
  expect((await realFetch(`${base.replace(/\/api\/page-files\/[^/]+\//, `/api/page-files/${"A".repeat(43)}/`)}data.parquet`)).status).toBe(404);

  const other = (await cli("new-bot", "--name", "Other")).bot;
  writeFileSync(planPath, JSON.stringify({ [other.id]: { steps: [{ tool: "show_html", arguments: { path: dash, title: "Not mine" }, expectError: true }], reply: "No." } }));
  await cli("send", "--bot", other.id, "--task", other.activeTaskId, "--text", "Show me their dashboard.");
  expect((await cli("wait", "--bot", other.id, "--task", other.activeTaskId, "--timeout", "30")).status).toBe("settled");
  expect(evidence(other.id).at(-1).evidence.find((entry: any) => entry.step).response.result.content[0].text).toMatch(/^path: Only files in your working folder/);

  const [published] = await turn(analyst, [{ tool: "publish_page", arguments: { path: "dash", title: "Sales dashboard" } }]);
  const pagesDir = join(fixture.info.dataDir, "published-pages");
  const [pageId] = readdirSync(pagesDir).filter((name) => /^[a-z0-9]{26}$/.test(name));
  expect(published).toContain(`Published “Sales dashboard” at ${pagesUrl}/p/${pageId}/`);
  const servedParquet = await realFetch(`${pagesUrl}/p/${pageId}/data.parquet`);
  expect(servedParquet.status).toBe(200);
  expect(Buffer.from(await servedParquet.arrayBuffer()).equals(PARQUET)).toBe(true);
  const rows = (await api(`/api/threads/${analyst.activeTaskId}/messages?limit=50`)).body.messages as any[];
  expect(rows.filter((message) => message.kind === "app").map((message) => [message.id, message.publishedPage?.state, message.publishedPage?.url]))
    .toEqual([[appId, "live", `${pagesUrl}/p/${pageId}/`]]);
  expect(rows.filter((message) => message.publishedPage && message.kind !== "app")).toEqual([]);
}, 120_000);

it("streams a folder's video to the card by byte range, leaves it out of a publish, and refuses it once the file is replaced", async () => {
  const cli = (...args: string[]) => runControlOmb(args, { env: { SUPERBOT_URL: fixture.info.url } }) as Promise<any>;
  const api = async (path: string) => (await fetch(`${fixture.info.url}${path}`, { headers: { "content-type": "application/json" } })).json() as Promise<any>;
  const planPath = join(fixture.info.dataDir, "room-plan.json");
  const reply = (botId: string) => readFileSync(`${planPath}.evidence.jsonl`, "utf8").trim().split("\n").map((line) => JSON.parse(line)).filter((entry: any) => entry.botId === botId)
    .at(-1).evidence.find((entry: any) => entry.step).response.result.content[0].text as string;
  const turn = async (bot: any, step: unknown) => {
    writeFileSync(planPath, JSON.stringify({ [bot.id]: { steps: [step], reply: "Done." } }));
    await cli("send", "--bot", bot.id, "--task", bot.activeTaskId, "--text", "Show the film.");
    expect((await cli("wait", "--bot", bot.id, "--task", bot.activeTaskId, "--timeout", "30")).status).toBe("settled");
    return reply(bot.id);
  };
  const bot = (await cli("new-bot", "--name", "Film")).bot;
  const folder = join(fixture.info.dataDir, "workspaces", bot.id, "film");
  const movie = randomBytes(3 * 1024 * 1024);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "index.html"), "<!doctype html><video src=\"clip.webm\" controls></video>");
  writeFileSync(join(folder, "clip.webm"), movie);

  const appId = /^Shown as app ([\w-]+)\./.exec(await turn(bot, { tool: "show_html", arguments: { path: "film", title: "Film" } }))?.[1];
  expect(appId).toBeTruthy();
  const base = async () => /<base href="([^"]+)">/.exec((await api(`/api/threads/${bot.activeTaskId}/messages/${appId}/app?origin=${encodeURIComponent(fixture.info.url)}`)).srcdoc)?.[1] ?? "";
  const seek = await realFetch(`${await base()}clip.webm`, { headers: { range: "bytes=2000000-2000099" } });
  expect(seek.status).toBe(206);
  expect(seek.headers.get("content-type")).toBe("video/webm");
  expect(Buffer.from(await seek.arrayBuffer()).equals(movie.subarray(2_000_000, 2_000_100))).toBe(true);

  const published = await turn(bot, { tool: "publish_page", arguments: { path: "film", title: "Film" } });
  expect(published).toContain("Left out 1 file a page can't serve: clip.webm");
  const filmPage = /\/p\/([a-z0-9]{26})\//.exec(published)![1]!;
  expect(existsSync(join(fixture.info.dataDir, "published-pages", filmPage, "clip.webm"))).toBe(false);
  expect((await realFetch(`${pagesUrl}/p/${filmPage}/clip.webm`)).status).toBe(404);
  const kept = await realFetch(`${await base()}clip.webm`, { headers: { range: "bytes=0-9" } });
  expect(kept.status).toBe(206);
  expect(Buffer.from(await kept.arrayBuffer()).equals(movie.subarray(0, 10))).toBe(true);

  rmSync(join(folder, "clip.webm"));
  writeFileSync(join(folder, "clip.webm"), movie);
  expect((await realFetch(`${await base()}clip.webm`)).status).toBe(404);
}, 120_000);
