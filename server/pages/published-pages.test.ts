import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PAGE_ID, type PublishedPageCard } from "../../shared/published-page.ts";
import { PageBundleError, readPageBundle } from "./bundle.ts";
import { createPagesHost, NO_PUBLIC_URL_MESSAGE, PAGES_LIMIT } from "./host.ts";
import { listenPages, type PagesListener } from "./listener.ts";
import { PublishedPagesStore } from "./store.ts";
import { createPublishedPages } from "./service.ts";
import { createPagesInternalRoutes, createPublishedPageRoutes, type AppPages } from "../routes/published-pages.ts";
import { PASS } from "../routes/table.ts";

const SITE = { "index.html": "<!doctype html><h1>Bake sale</h1>", "style.css": "h1{color:red}" };
const PUBLIC = "https://pages.example.test";
const FULL_MESSAGE = "This server already has 500 published pages. Unpublish some, then try again.";
let dir: string;
let listeners: PagesListener[];

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "omb-pages-")); listeners = []; });
afterEach(() => {
  for (const listener of listeners) listener.close();
  rmSync(dir, { recursive: true, force: true });
});

const dataDir = () => join(dir, "data");
const pagesRoot = () => join(dataDir(), "published-pages");

function writeSite(folder: string, files: Record<string, string> = SITE) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(folder, path, ".."), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  return folder;
}

const livePages = () => (existsSync(pagesRoot()) ? readdirSync(pagesRoot()).filter((name) => PAGE_ID.test(name)).sort() : []);
const leftovers = () => (existsSync(pagesRoot()) ? readdirSync(pagesRoot()).filter((name) => name.startsWith(".")) : []);
/** Every file a page holds on disk, relative to its folder, besides its manifest. */
const siteOf = (pageId: string): Record<string, string> => {
  const folder = join(pagesRoot(), pageId);
  const paths = readdirSync(folder, { recursive: true }).map(String).filter((path) => statSync(join(folder, path)).isFile() && path !== ".manifest.json");
  return Object.fromEntries(paths.sort().map((path) => [path, readFileSync(join(folder, path), "utf8")]));
};
const fillTo = (count: number) => {
  mkdirSync(pagesRoot(), { recursive: true });
  for (let index = 0; index < count; index += 1) mkdirSync(join(pagesRoot(), `filler${String(index).padStart(21, "0")}`));
};

function setup(options: { publicUrl?: string | null } = {}) {
  const publicUrl = options.publicUrl === undefined ? PUBLIC : options.publicUrl;
  const work = join(dir, "work"), data = dataDir();
  mkdirSync(work, { recursive: true });
  const cards: Array<{ threadId: string; id: string; text: string; card: PublishedPageCard }> = [];
  let ids = 0;
  const pages = createPublishedPages({ dataDir: data, pagesHost: publicUrl ? { publicUrl } : {},
    patch: (threadId, messageId, text, card) => { const shown = cards.find((each) => each.id === messageId && each.threadId === threadId); if (shown) Object.assign(shown, { text, card }); } });
  const post = (threadId: string) => (text: string, card: PublishedPageCard) => { const id = `m${++ids}`; cards.push({ threadId, id, text, card }); return id; };
  const publish = (input: { path: string; title?: string; pageId?: string; botId?: string; threadId?: string }) => pages.publisher.publish({
    botId: input.botId ?? "bot-1", threadId: input.threadId ?? "thread-1", path: input.path, title: input.title ?? "Bake sale",
    ...(input.pageId ? { pageId: input.pageId } : {}), roots: [work], post: post(input.threadId ?? "thread-1") });
  return { pages, work, data, cards, publish, publicUrl };
}

describe("publishing a page", () => {
  it("needs a public address for pages: says so for the bot to pass on, and publishes nothing", async () => {
    const f = setup({ publicUrl: null });
    writeSite(join(f.work, "site"));
    const outcome = await f.publish({ path: "site" });
    expect(outcome).toEqual({ status: 503, text: "Publishing pages needs a public address for pages. Set OMB_PAGES_PUBLIC_URL on the server." });
    expect(outcome.text).toBe(NO_PUBLIC_URL_MESSAGE);
    expect(f.cards).toEqual([]);
    expect(livePages()).toEqual([]);
  });

  it("publishes a folder to a new link with a card showing the link and the usage, and remembers it", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    const outcome = await f.publish({ path: "site" });
    expect(outcome.status).toBe(200);
    const [page] = livePages();
    expect(page).toMatch(/^[a-z0-9]{26}$/);
    const url = `${PUBLIC}/p/${page}/`;
    expect(outcome.text).toContain(`Published “Bake sale” at ${url}`);
    expect(outcome.text).toContain(`Page id ${page}. This server has 1 of 500 pages.`);
    expect(outcome.text).not.toContain("MausBot");
    expect(f.cards).toEqual([{ threadId: "thread-1", id: "m1", text: `Published “Bake sale”: ${url} (1 of 500 pages)`,
      card: { state: "live", title: "Bake sale", pageId: page, url, usage: { pages: 1, limit: 500 } } }]);
    expect(siteOf(page!)).toEqual(SITE);
    expect(JSON.parse(readFileSync(join(pagesRoot(), page!, ".manifest.json"), "utf8")).files.sort()).toEqual(Object.keys(SITE).sort());
    expect(new PublishedPagesStore(join(f.data, "published-pages.json")).get(page!)).toMatchObject({ url, title: "Bake sale", botId: "bot-1",
      cards: [{ threadId: "thread-1", messageId: "m1" }] });
    expect(readdirSync(pagesRoot()).filter((name) => name.startsWith("."))).toEqual([]);
  });

  it("serves the published link from the pages listener", async () => {
    const listener = await listenPages({ dataDir: dataDir(), port: 0 });
    listeners.push(listener);
    const f = setup({ publicUrl: `http://127.0.0.1:${listener.port}` });
    writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    const [page] = livePages();
    const response = await fetch(`${f.publicUrl}/p/${page}/`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(SITE["index.html"]);
    expect(await (await fetch(`${f.publicUrl}/p/${page}/style.css`)).text()).toBe(SITE["style.css"]);
  });

  it("republishes the same folder to the same link, replacing the old files, also from a new conversation and with an explicit page id", async () => {
    const f = setup();
    const site = writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    rmSync(join(site, "style.css"));
    writeFileSync(join(site, "index.html"), "<h1>Tomorrow's menu</h1>");
    const again = await f.publish({ path: join(site), threadId: "routine-run-2" });
    const [page] = livePages();
    expect(livePages()).toHaveLength(1);
    expect(again.text).toContain(`Updated “Bake sale” at the same link: ${PUBLIC}/p/${page}/`);
    expect(siteOf(page!)).toEqual({ "index.html": "<h1>Tomorrow's menu</h1>" });
    expect(leftovers()).toEqual([]);
    writeSite(join(f.work, "other"), { "index.html": "<p>Other</p>" });
    f.pages.store.forget(page!);
    await f.publish({ path: "other", pageId: page });
    expect(siteOf(page!)).toEqual({ "index.html": "<p>Other</p>" });
    expect(livePages()).toEqual([page]);
    expect(f.cards.map((card) => card.card.url)).toEqual(Array(3).fill(`${PUBLIC}/p/${page}/`));
  });

  it("gives a folder whose page was deleted a new link instead of failing", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    const [first] = livePages();
    rmSync(join(pagesRoot(), first!), { recursive: true });
    const again = await f.publish({ path: "site" });
    expect(again.status).toBe(200);
    expect(livePages()).toHaveLength(1);
    expect(livePages()[0]).not.toBe(first);
  });

  it("refuses a new page once the server holds 500, says so for the bot to pass on, and still updates one it has", async () => {
    const f = setup();
    writeSite(join(f.work, "one"));
    writeSite(join(f.work, "two"));
    await f.publish({ path: "one" });
    const [first] = livePages();
    fillTo(PAGES_LIMIT - 1);
    expect(livePages()).toHaveLength(PAGES_LIMIT);
    const refused = await f.publish({ path: "two", title: "Second" });
    expect(refused.status).toBe(402);
    expect(refused.text).toBe(`${FULL_MESSAGE} Tell the person this in your reply.`);
    expect(f.cards.at(-1)).toMatchObject({ text: FULL_MESSAGE, card: { state: "limit", title: "Second", usage: { pages: 500, limit: 500 } } });
    expect(livePages()).toHaveLength(PAGES_LIMIT);
    expect((await f.publish({ path: "one" })).status).toBe(200);
    expect(livePages()).toContain(first);
  });

  it("refuses a missing path, a path outside the working folder, a single file that isn't a page, and a folder without index.html", async () => {
    const f = setup();
    expect(await f.publish({ path: "nowhere" })).toMatchObject({ status: 404 });
    const outside = writeSite(join(dir, "outside"));
    expect(await f.publish({ path: outside })).toMatchObject({ status: 403, text: expect.stringContaining("working folder") });
    writeFileSync(join(f.work, "notes.md"), "# hi");
    expect(await f.publish({ path: "notes.md" })).toMatchObject({ status: 400, text: expect.stringContaining(".html") });
    writeSite(join(f.work, "noindex"), { "home.html": "<p>hi</p>" });
    expect(await f.publish({ path: "noindex" })).toMatchObject({ status: 400, text: expect.stringContaining("index.html") });
    expect(await f.publish({ path: "notes.md", title: "  " })).toMatchObject({ status: 400 });
    expect(livePages()).toEqual([]);
  });

  it("publishes a single .html file as the page, and leaves out hidden files, server code and links out of the folder", async () => {
    const f = setup();
    writeFileSync(join(f.work, "card.html"), "<p>Card</p>");
    await f.publish({ path: "card.html", title: "Card" });
    const [single] = livePages();
    expect(siteOf(single!)).toEqual({ "index.html": "<p>Card</p>" });
    const site = writeSite(join(f.work, "site"), { ...SITE, ".env": "SECRET=1", ".git/config": "x", "app.py": "print()", "node_modules/a.js": "x", "img/logo.svg": "<svg/>" });
    writeFileSync(join(dir, "secret.txt"), "outside");
    symlinkSync(join(dir, "secret.txt"), join(site, "linked.txt"));
    const outcome = await f.publish({ path: "site" });
    expect(outcome.text).toContain("Left out 2 files a page can't serve: app.py, node_modules/");
    const published = livePages().find((page) => page !== single)!;
    expect(Object.keys(siteOf(published)).sort()).toEqual(["img/logo.svg", "index.html", "style.css"]);
  });

  it("publishes a dashboard's csv, parquet and arrow data with it, and leaves out a wasm file", async () => {
    const f = setup();
    writeSite(join(f.work, "dash"), { "index.html": "<p>Sales</p>", "data.parquet": "PAR1", "data/backup.csv": "a\n1\n", "data/live.arrow": "ARROW1", "duckdb.wasm": "x" });
    const outcome = await f.publish({ path: "dash" });
    expect(outcome.text).toContain("Left out 1 file a page can't serve: duckdb.wasm");
    expect(Object.keys(siteOf(livePages()[0]!)).sort()).toEqual(["data.parquet", "data/backup.csv", "data/live.arrow", "index.html"]);
  });

  it("refuses a folder over a page's bytes or files before writing anything", async () => {
    const f = setup();
    const site = writeSite(join(f.work, "big"), { "index.html": "x".repeat(2000), "a.css": "a", "b.css": "b" });
    await expect(readPageBundle(site, [f.work], { bytes: 1000, files: 200 })).rejects.toThrow(PageBundleError);
    await expect(readPageBundle(site, [f.work], { bytes: 5000, files: 2 })).rejects.toThrow(/more than 2 files/);
    expect((await readPageBundle(site, [f.work], { bytes: 5000, files: 3 })).files).toHaveLength(3);
    writeFileSync(join(site, "huge.png"), Buffer.alloc(5 * 1024 * 1024 + 1));
    expect(await f.publish({ path: "big" })).toMatchObject({ status: 413 });
    expect(livePages()).toEqual([]);
  });

  it("publishes one page when the same folder is published twice at once", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    const outcomes = await Promise.all([f.publish({ path: "site" }), f.publish({ path: "site", threadId: "thread-2" })]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([200, 200]);
    expect(livePages()).toHaveLength(1);
    expect(f.pages.store.list()).toHaveLength(1);
    expect(f.pages.store.list()[0]!.cards).toHaveLength(2);
  });
});

describe("the page host", () => {
  const BAD_PATHS = ["../evil.html", "a/../b.html", "/abs.html", "a//b.html", "a\\b.html", "a\0b.html", ".hidden.html", "dir/.hidden.html", "", "noext", "run.exe", "..", "a/../../b.html", "a/"];

  it("refuses a file path that climbs out of the page or isn't a plain relative name, and writes nothing", async () => {
    const host = createPagesHost({ dataDir: dataDir(), publicUrl: PUBLIC });
    for (const path of BAD_PATHS) {
      const result = await host.publish([{ path: "index.html", data: Buffer.from("ok") }, { path, data: Buffer.from("x") }]);
      expect(result, JSON.stringify(path)).toMatchObject({ ok: false, reason: "refused" });
    }
    expect(livePages()).toEqual([]);
    expect(leftovers()).toEqual([]);
    expect(existsSync(join(dir, "evil.html"))).toBe(false);
  });

  it("refuses a page with no index.html, two files that differ only by case, and too many files", async () => {
    const host = createPagesHost({ dataDir: dataDir(), publicUrl: PUBLIC });
    expect(await host.publish([{ path: "home.html", data: Buffer.from("x") }])).toMatchObject({ ok: false, reason: "refused" });
    expect(await host.publish([{ path: "index.html", data: Buffer.from("x") }, { path: "A.css", data: Buffer.from("x") }, { path: "a.css", data: Buffer.from("y") }])).toMatchObject({ ok: false, reason: "refused" });
    const many = Array.from({ length: 201 }, (_, index) => ({ path: index === 0 ? "index.html" : `f${index}.css`, data: Buffer.from("x") }));
    expect(await host.publish(many)).toMatchObject({ ok: false, reason: "refused" });
    expect(livePages()).toEqual([]);
  });

  it("writes files 0600 in folders 0700, and updates a page that is gone as gone", async () => {
    const host = createPagesHost({ dataDir: dataDir(), publicUrl: PUBLIC });
    const made = await host.publish([{ path: "index.html", data: Buffer.from("x") }, { path: "img/a.svg", data: Buffer.from("<svg/>") }]);
    if (!made.ok) throw new Error(made.message);
    expect(statSync(join(pagesRoot(), made.pageId)).mode & 0o777).toBe(0o700);
    expect(statSync(join(pagesRoot(), made.pageId, "img")).mode & 0o777).toBe(0o700);
    expect(statSync(join(pagesRoot(), made.pageId, "img", "a.svg")).mode & 0o777).toBe(0o600);
    expect(statSync(join(pagesRoot(), made.pageId, ".manifest.json")).mode & 0o777).toBe(0o600);
    expect(await host.unpublish(made.pageId)).toMatchObject({ ok: true, usage: { pages: 0, limit: 500 } });
    expect(await host.publish([{ path: "index.html", data: Buffer.from("x") }], made.pageId)).toMatchObject({ ok: false, reason: "gone" });
    expect(await host.unpublish(made.pageId)).toMatchObject({ ok: false, reason: "gone" });
    expect(await host.unpublish("../../etc")).toMatchObject({ ok: false, reason: "gone" });
  });

  it("unpublishes with no public address set, though it can't publish", async () => {
    const withUrl = createPagesHost({ dataDir: dataDir(), publicUrl: PUBLIC });
    const made = await withUrl.publish([{ path: "index.html", data: Buffer.from("x") }]);
    if (!made.ok) throw new Error(made.message);
    const bare = createPagesHost({ dataDir: dataDir() });
    expect(await bare.publish([{ path: "index.html", data: Buffer.from("x") }])).toMatchObject({ ok: false, reason: "unavailable", message: NO_PUBLIC_URL_MESSAGE });
    expect(await bare.unpublish(made.pageId)).toMatchObject({ ok: true });
    expect(livePages()).toEqual([]);
  });
});

describe("a page tool call whose turn ends", () => {
  function tool(f: ReturnType<typeof setup>, options: { stopDuringFolders?: boolean; activeChecks?: number; signal?: AbortSignal } = {}) {
    const turn = { active: true, checks: 0 };
    const handler = createPagesInternalRoutes(f.pages.publisher);
    const sent: { status?: number } = {};
    const call = (path: string, body: unknown) => handler({ method: "POST", path, res: {} as never, botId: "bot-1", threadId: "thread-1",
      json: ((_res: unknown, status: number) => { sent.status = status; }) as never,
      readBody: async () => body,
      folders: async () => { if (options.stopDuringFolders) turn.active = false; return { roots: [f.work], vmWorkspace: null }; },
      requireActive: () => {
        turn.checks += 1;
        if (!turn.active || (options.activeChecks !== undefined && turn.checks > options.activeChecks)) throw Object.assign(new Error("the internal turn capability has expired"), { status: 401 });
      },
      signal: options.signal ?? new AbortController().signal,
      post: () => "m1" });
    return { call, sent };
  }

  it("publishes nothing when Stop ends the turn while its folders are resolved", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    const { call, sent } = tool(f, { stopDuringFolders: true });
    await expect(call("/api/internal/pages/publish", { path: "site", title: "Bake sale" })).rejects.toMatchObject({ status: 401 });
    expect(sent.status).toBeUndefined();
    expect(livePages()).toEqual([]);
  });

  it("writes nothing when the turn ends while the page is being written", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    const { call } = tool(f, { activeChecks: 2 });
    await expect(call("/api/internal/pages/publish", { path: "site", title: "Bake sale" })).rejects.toMatchObject({ status: 401 });
    expect(livePages()).toEqual([]);
    expect(leftovers()).toEqual([]);
    expect(f.pages.store.list()).toEqual([]);
  });

  it("leaves a page as it was when the turn ends during its update", async () => {
    const f = setup();
    const site = writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    writeFileSync(join(site, "index.html"), "<h1>New</h1>");
    const { call } = tool(f, { activeChecks: 2 });
    await expect(call("/api/internal/pages/publish", { path: "site", title: "Bake sale" })).rejects.toMatchObject({ status: 401 });
    expect(siteOf(livePages()[0]!)).toEqual(SITE);
    expect(leftovers()).toEqual([]);
  });

  it("takes nothing down when the turn ends before unpublish_page deletes", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    const { call } = tool(f, { stopDuringFolders: true });
    await expect(call("/api/internal/pages/unpublish", { path: "site" })).rejects.toMatchObject({ status: 401 });
    expect(livePages()).toHaveLength(1);
  });

  it("writes nothing once the tool call's request is gone", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    const gone = new AbortController();
    gone.abort();
    const { call, sent } = tool(f, { signal: gone.signal });
    await call("/api/internal/pages/publish", { path: "site", title: "Bake sale" });
    expect(sent.status).toBe(503);
    expect(livePages()).toEqual([]);
    expect(leftovers()).toEqual([]);
  });
});

describe("unpublishing a page", () => {
  it("takes it down by id or by the folder it came from, and marks every card that showed it", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    writeSite(join(f.work, "menu"));
    await f.publish({ path: "site" });
    await f.publish({ path: "site", threadId: "thread-2" });
    await f.publish({ path: "menu", title: "Menu" });
    const [site] = f.pages.store.list().filter((record) => record.title === "Bake sale").map((record) => record.pageId);
    const [menu] = f.pages.store.list().filter((record) => record.title === "Menu").map((record) => record.pageId);
    const outcome = await f.pages.publisher.unpublish({ pageId: site });
    expect(outcome).toMatchObject({ status: 200, text: "Unpublished “Bake sale”. Its link no longer opens.", card: { state: "unpublished", usage: { pages: 1, limit: 500 } } });
    expect(existsSync(join(pagesRoot(), site!))).toBe(false);
    expect(f.cards.filter((card) => card.card.pageId === site).map((card) => [card.threadId, card.card.state, card.text])).toEqual([
      ["thread-1", "unpublished", "Unpublished “Bake sale”. Its link no longer opens."], ["thread-2", "unpublished", "Unpublished “Bake sale”. Its link no longer opens."]]);
    const byPath = await f.pages.publisher.unpublish({ path: "menu", botId: "bot-1", roots: [f.work] });
    expect(byPath.status).toBe(200);
    expect(livePages()).not.toContain(menu);
    expect(await f.pages.publisher.unpublish({ path: "menu", botId: "bot-1", roots: [f.work] })).toMatchObject({ status: 404 });
    expect(await f.pages.publisher.unpublish({ pageId: "NOT-AN-ID" })).toMatchObject({ status: 400 });
    expect(await f.pages.publisher.unpublish({})).toMatchObject({ status: 400 });
  });

  it("forgets a page that is already gone", async () => {
    const f = setup();
    writeSite(join(f.work, "site"));
    await f.publish({ path: "site" });
    const [page] = livePages();
    rmSync(join(pagesRoot(), page!), { recursive: true });
    expect(await f.pages.publisher.unpublish({ pageId: page })).toMatchObject({ status: 200, text: "That page was already taken down.", card: { state: "unpublished" } });
    expect(f.pages.store.get(page!)).toBeNull();
  });

  it("works with no public address set", async () => {
    const withUrl = setup();
    writeSite(join(withUrl.work, "site"));
    await withUrl.publish({ path: "site" });
    const [page] = livePages();
    const bare = setup({ publicUrl: null });
    expect(await bare.pages.publisher.unpublish({ pageId: page })).toMatchObject({ status: 200 });
    expect(livePages()).toEqual([]);
  });
});

describe("sharing a chat page from its card", () => {
  function route(f: ReturnType<typeof setup>, page: AppPages["page"] = () => ({ ok: true, title: "Pricing", files: [{ path: "index.html", data: Buffer.from("<!DOCTYPE html><h1>Pricing</h1>") }], rev: 2 })) {
    const shown: Array<{ threadId: string; messageId: string; card: PublishedPageCard }> = [];
    const handler = createPublishedPageRoutes(f.pages.publisher, {
      botOf: (threadId) => (threadId === "room-1" ? null : { id: "bot-1" }),
      page,
      published: (threadId, messageId) => {
        const last = shown.filter((each) => each.threadId === threadId && each.messageId === messageId).at(-1)?.card;
        return last?.state === "live" ? last.pageId ?? null : null;
      },
      show: (threadId, messageId, card) => { shown.push({ threadId, messageId, card }); return messageId; },
    });
    const call = async (method: string, path: string, body?: unknown) => {
      let answer: { status: number; body: any } | null = null;
      const out = await handler({
        req: {} as never, res: {} as never, url: new URL(`http://x${path}`), path, method, auth: {} as never,
        json: ((_res: unknown, status: number, value: unknown) => { answer = { status, body: value }; }) as never,
        readBody: (async () => body) as never,
      });
      return out === PASS ? PASS : answer!;
    };
    return { call, shown };
  }

  it("publishes the page's files, gives its own card the link, and keeps that link on the next share", async () => {
    const f = setup();
    const { call, shown } = route(f);
    const path = "/api/threads/thread-1/messages/m7/app/publish";
    const first = await call("POST", path, { rev: 2 }) as { status: number; body: any };
    expect(first).toMatchObject({ status: 200, body: { ok: true, card: { state: "live", title: "Pricing" } } });
    const [pageId] = livePages();
    expect(siteOf(pageId!)).toEqual({ "index.html": "<!DOCTYPE html><h1>Pricing</h1>" });
    expect(shown).toEqual([{ threadId: "thread-1", messageId: "m7", card: first.body.card }]);
    expect(f.cards).toEqual([]);
    expect(await call("POST", path, {})).toMatchObject({ status: 200, body: { card: { pageId } } });
    expect(livePages()).toEqual([pageId]);
  });

  it("publishes a folder page's files beside index.html under the folder's own link", async () => {
    const f = setup();
    writeSite(join(f.work, "dash"), { "index.html": "<h1>Dash</h1>", "data.csv": "a\n1" });
    await f.publish({ path: "dash", title: "Dash" });
    const [pageId] = livePages();
    const { call } = route(f, () => ({ ok: true, title: "Dash", rev: 0, folder: join(realpathSync.native(f.work), "dash"),
      files: [{ path: "index.html", data: Buffer.from("<h1>Dash, again</h1>") }, { path: "data.csv", data: Buffer.from("a\n2") }] }));
    expect(await call("POST", "/api/threads/thread-1/messages/m9/app/publish", {})).toMatchObject({ status: 200, body: { card: { pageId } } });
    expect(siteOf(pageId!)).toEqual({ "index.html": "<h1>Dash, again</h1>", "data.csv": "a\n2" });
  });

  it("refuses a room, a bad body and a page that can't be built, and shows no card for a full server", async () => {
    const f = setup();
    fillTo(PAGES_LIMIT);
    const { call, shown } = route(f);
    expect(await call("POST", "/api/threads/thread-1/messages/m7/app/publish", {})).toMatchObject({ status: 402, body: { card: { state: "limit", message: FULL_MESSAGE } } });
    expect(shown).toEqual([]);
    expect(await call("POST", "/api/threads/room-1/messages/m7/app/publish", {})).toMatchObject({ status: 404 });
    expect(await call("POST", "/api/threads/thread-1/messages/m7/app/publish", { rev: "2" })).toMatchObject({ status: 400 });
    const broken = route(f, () => ({ ok: false, status: 422, error: "jsx: line 2: Unexpected token." }));
    expect(await broken.call("POST", "/api/threads/thread-1/messages/m7/app/publish", {})).toEqual({ status: 422, body: { error: "jsx: line 2: Unexpected token." } });
    expect(await call("GET", "/api/threads/thread-1/messages/m7/app/publish")).toBe(PASS);
    expect(await call("POST", "/api/threads/thread-1/messages/m7/app")).toBe(PASS);
  });
});
