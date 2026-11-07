// Usage, from the repository root after `pnpm exec vite build`: node scripts/validate-chatux/phone-check.mjs
// Renders a 5-column, 3-row VPS comparison reply through the app's own ChatMarkdown (Advanced and Simple mode) at
// 390x844 DPR 3 in headless Chrome, then checks dist's PWA manifest and service worker. Prints one compact JSON
// summary; exits 0 only when every check passes. CHROME overrides /usr/bin/google-chrome.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, normalize, resolve, sep } from "node:path";

const ROOT = process.cwd();
const DIST = resolve(ROOT, "dist");
const CHROME = process.env.CHROME ?? "/usr/bin/google-chrome";
const HARNESS = "/scripts/validate-chatux/phone-harness.tsx";
const PHONE = { width: 390, height: 844, deviceScaleFactor: 3, mobile: true };
const MODES = ["advanced", "simple"];
const COLUMNS = 5;
const ROWS = 3;
const MIN_FONT_PX = 12;
const FIXTURE = [
  "Berikut perbandingan paket termurah 2 vCPU / 4 GB:",
  "",
  "| Provider | Paket | vCPU / RAM / Disk | Harga (USD/bulan) | Region Singapura |",
  "|---|---|---|---:|---|",
  "| Hetzner | CX22 (shared Intel) | 2 vCPU / 4 GB / 40 GB NVMe | 4.59 | Tidak (terdekat: Ashburn, Hillsboro) |",
  "| DigitalOcean | Basic Droplet Premium AMD | 2 vCPU / 4 GB / 80 GB SSD | 28.00 | Ya (SGP1) |",
  "| Vultr | Regular Cloud Compute | 2 vCPU / 4 GB / 80 GB SSD | 20.00 | Ya (Singapore) |",
  "",
  "Harga bisa berubah; cek halaman resmi tiap provider.",
].join("\n");

const summary = { ok: false, viewport: PHONE, checks: {}, notes: [] };
const check = (name, pass, detail = {}) => { summary.checks[name] = { pass: Boolean(pass), ...detail }; };
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

async function until(what, fn, ms, every = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webmanifest": "application/manifest+json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function serveDist() {
  const server = createHttpServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (path.startsWith("/api/") || path.startsWith("/.well-known/")) { res.writeHead(404, { "content-type": "application/json" }).end("{}"); return; }
    let file = normalize(join(DIST, path));
    if (!file.startsWith(DIST + sep) && file !== DIST) { res.writeHead(403).end(); return; }
    if (!existsSync(file) || !extname(file)) file = join(DIST, "index.html");
    res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, "127.0.0.1", () => done(server)));
}

async function serveHarness() {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root: ROOT,
    logLevel: "error",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false },
    optimizeDeps: { entries: [HARNESS.slice(1)] },
  });
  const page = `<!doctype html><html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" /></head><body><div id="root"></div><script type="module" src="${HARNESS}"></script></body></html>`;
  const server = createHttpServer(async (req, res) => {
    if (req.url.startsWith("/__phone-check")) {
      res.writeHead(200, { "content-type": "text/html" }).end(await vite.transformIndexHtml(req.url, page));
      return;
    }
    vite.middlewares(req, res, () => res.writeHead(404).end());
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  return { server, vite };
}

async function chrome() {
  const profile = mkdtempSync(join(tmpdir(), "phone-check-chrome-"));
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
    "--hide-scrollbars", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  const port = await until("chrome DevToolsActivePort", async () => {
    const file = join(profile, "DevToolsActivePort");
    return existsSync(file) ? Number(readFileSync(file, "utf8").split("\n")[0]) || undefined : undefined;
  }, 30_000);
  const Socket = globalThis.WebSocket ?? (await import("ws")).default;
  const open = async () => {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
    const ws = new Socket(target.webSocketDebuggerUrl);
    await new Promise((done, fail) => { ws.onopen = done; ws.onerror = fail; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (event) => {
      const msg = JSON.parse(String(event.data));
      const waiter = msg.id && pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      msg.error ? waiter.fail(new Error(msg.error.message)) : waiter.done(msg.result);
    };
    const send = (method, params = {}) => new Promise((done, fail) => {
      const n = ++id;
      pending.set(n, { done, fail });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
    const evaluate = async (expression) => {
      const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description?.slice(0, 300) ?? "evaluate failed");
      return out.result.value;
    };
    await send("Page.enable");
    await send("Emulation.setDeviceMetricsOverride", PHONE);
    await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    return { send, evaluate, close: () => ws.close() };
  };
  return { open, close: () => { proc.kill("SIGKILL"); rmSync(profile, { recursive: true, force: true }); } };
}

const MEASURE = `(() => {
  const slack = 1;
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const scroller = document.querySelector("[data-phone-scroller]");
  const region = document.querySelector(".chat-table [role=region]");
  const table = region?.querySelector("table");
  const headers = table ? [...table.querySelectorAll("thead th")] : [];
  const rows = table ? [...table.querySelectorAll("tbody tr[aria-rowindex]")] : [];
  const cells = [...headers, ...rows.flatMap((row) => [...row.querySelectorAll("td")])];
  const box = region?.getBoundingClientRect();
  const clipped = [];
  let minFont = Infinity;
  for (const cell of cells) {
    const inner = cell.querySelector(":scope > div") ?? cell;
    const text = inner.innerText.replace(/\\s+/g, " ").trim();
    minFont = Math.min(minFont, parseFloat(getComputedStyle(inner).fontSize));
    if (inner.scrollWidth > inner.clientWidth + slack || inner.scrollHeight > inner.clientHeight + slack) clipped.push({ text, why: "overflow" });
    const range = document.createRange();
    range.selectNodeContents(inner);
    for (const rect of range.getClientRects()) {
      if (rect.width === 0) continue;
      if (rect.left < -slack || rect.right > vw + slack) { clipped.push({ text, why: "offscreen", left: Math.round(rect.left), right: Math.round(rect.right) }); break; }
      if (box && (rect.left < box.left - slack || rect.right > box.right + slack)) { clipped.push({ text, why: "outside-table-view", left: Math.round(rect.left), right: Math.round(rect.right) }); break; }
    }
  }
  return {
    innerWidth: vw,
    docScrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    scrollerScrollWidth: scroller?.scrollWidth ?? null,
    scrollerClientWidth: scroller?.clientWidth ?? null,
    tableFound: Boolean(table),
    columns: headers.length,
    rows: rows.length,
    tableFit: region?.dataset.fit === "true",
    regionScrollWidth: region?.scrollWidth ?? null,
    regionClientWidth: region?.clientWidth ?? null,
    tableLeft: box ? Math.round(box.left) : null,
    tableRight: box ? Math.round(box.right) : null,
    minFontPx: Number.isFinite(minFont) ? minFont : null,
    clipped,
  };
})()`;

async function renderMode(browser, base, mode) {
  const tab = await browser.open();
  try {
    const url = `${base}/__phone-check?mode=${mode}&text=${encodeURIComponent(FIXTURE)}`;
    const ready = () => tab.evaluate(`window.__phoneReady === true && document.querySelectorAll(".chat-table tbody tr[aria-rowindex]").length === ${ROWS}`);
    await tab.send("Page.navigate", { url });
    try {
      await until(`${mode} render`, ready, 60_000);
    } catch {
      summary.notes.push(`${mode}: first load not ready, reloaded once`);
      await tab.send("Page.reload", { ignoreCache: true });
      await until(`${mode} render`, ready, 60_000);
    }
    await sleep(300);
    const m = await tab.evaluate(MEASURE);
    check(`${mode}.table5x3`, m.tableFound && m.columns === COLUMNS && m.rows === ROWS, { columns: m.columns, rows: m.rows });
    check(`${mode}.noPageScroll`, m.docScrollWidth <= m.innerWidth && m.bodyScrollWidth <= m.innerWidth, { docScrollWidth: m.docScrollWidth, innerWidth: m.innerWidth });
    check(`${mode}.transcriptNotClipping`, m.scrollerScrollWidth !== null && m.scrollerScrollWidth <= m.scrollerClientWidth, { scrollWidth: m.scrollerScrollWidth, clientWidth: m.scrollerClientWidth });
    check(`${mode}.tableNoForcedScroll`, m.tableFit && m.regionScrollWidth <= m.regionClientWidth, { fit: m.tableFit, scrollWidth: m.regionScrollWidth, clientWidth: m.regionClientWidth });
    check(`${mode}.textNotClipped`, m.tableFound && m.clipped.length === 0, { clipped: m.clipped.slice(0, 5) });
    check(`${mode}.readableFont`, m.minFontPx !== null && m.minFontPx >= MIN_FONT_PX, { minFontPx: m.minFontPx });
  } finally {
    tab.close();
  }
}

function pngSize(file) {
  const bytes = readFileSync(file);
  return bytes.toString("ascii", 12, 16) === "IHDR" ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : null;
}

async function checkPwa(browser, base) {
  const manifest = JSON.parse(readFileSync(join(DIST, "manifest.webmanifest"), "utf8"));
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  const icon = (size) => {
    const entry = icons.find((item) => String(item.sizes ?? "").split(/\s+/).includes(`${size}x${size}`));
    const file = entry && join(DIST, String(entry.src).replace(/^\//, ""));
    const real = file && existsSync(file) ? pngSize(file) : null;
    return { declared: Boolean(entry), file: Boolean(real), matches: real?.width === size && real?.height === size };
  };
  const icon192 = icon(192);
  const icon512 = icon(512);
  check("manifest.name", typeof manifest.name === "string" && manifest.name.trim().length > 0, { name: manifest.name });
  check("manifest.icons", [icon192, icon512].every((i) => i.declared && i.file && i.matches), { icon192, icon512 });
  check("manifest.displayStandalone", manifest.display === "standalone", { display: manifest.display });
  check("manifest.startUrl", typeof manifest.start_url === "string" && manifest.start_url.length > 0, { start_url: manifest.start_url });

  const sw = readFileSync(join(DIST, "sw.js"), "utf8");
  const fetchHandler = /addEventListener\s*\(\s*["'`]fetch["'`]|\bonfetch\s*=/.test(sw);
  check("sw.noFetchHandler", !fetchHandler, { pushHandler: /addEventListener\s*\(\s*["'`]push["'`]/.test(sw) });

  const html = readFileSync(join(DIST, "index.html"), "utf8");
  check("index.linksManifest", /<link[^>]+rel=["']manifest["'][^>]+href=["']\/manifest\.webmanifest["']/.test(html));

  const tab = await browser.open();
  try {
    await tab.send("Page.navigate", { url: `${base}/` });
    await until("dist index", () => tab.evaluate("document.readyState === 'complete'"), 30_000);
    const parsed = await tab.send("Page.getAppManifest");
    check("manifest.chromeParses", parsed.errors.length === 0 && parsed.url.endsWith("/manifest.webmanifest"), { errors: parsed.errors.map((e) => e.message).slice(0, 5) });
    const installability = await tab.send("Page.getInstallabilityErrors").catch(() => null);
    if (installability) summary.installabilityErrors = installability.installabilityErrors.map((e) => e.errorId);
  } finally {
    tab.close();
  }
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) throw new Error("dist/index.html missing: run `pnpm exec vite build` first");
  const dist = await serveDist();
  const harness = await serveHarness();
  const browser = await chrome();
  try {
    await checkPwa(browser, `http://127.0.0.1:${dist.address().port}`);
    for (const mode of MODES) await renderMode(browser, `http://127.0.0.1:${harness.server.address().port}`, mode);
  } finally {
    browser.close();
    dist.close();
    harness.server.close();
    await harness.vite.close();
  }
  const expected = MODES.length * 6 + 7;
  const results = Object.values(summary.checks);
  summary.ok = results.length === expected && results.every((r) => r.pass);
  if (results.length !== expected) summary.notes.push(`expected ${expected} checks, ran ${results.length}`);
}

try {
  await main();
} catch (error) {
  summary.ok = false;
  summary.error = String(error?.stack ?? error).slice(0, 600);
}
console.log(JSON.stringify(summary));
process.exit(summary.ok ? 0 : 1);
