// Runs inside the disposable omb-chatux-probe container (node 24, no packages): drives the branch server over
// loopback HTTP and a headless Chrome over CDP, then prints one compact JSON summary.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const PORT = Number(process.env.PROBE_PORT);
const BASE = `http://127.0.0.1:${PORT}`;
const RUN_DIR = "/probe-run";
const DEADLINE = Date.now() + Number(process.env.PROBE_TIMEOUT_MS ?? 240_000);
const JOB_CALLS = Number(process.env.PROBE_JOB_CALLS ?? 10);
const MODEL = "deepseek/deepseek-v4.1-flash";
const CHROME = process.env.AGENT_BROWSER_EXECUTABLE_PATH ?? "/opt/openmausbot-browser/chrome";
const VPS_ASK = "Tolong riset harga VPS terkini: bandingkan paket termurah 2 vCPU / 4 GB di Hetzner, DigitalOcean dan Vultr dalam USD per bulan.";
const NEWS_ASK = "berita kompas terkini";
const STEER = "Untuk riset VPS: prioritaskan yang punya region Singapura.";
const SCENARIO = process.env.PROBE_SCENARIO ?? "overlap";
const SINGLE = SCENARIO === "single";
const BROWSER_ASK = "Buka https://example.com di browser (pakai browser, bukan web_fetch), lalu buka https://www.iana.org/help/example-domains di browser juga, dan ringkas isi kedua halaman itu.";
const SEAT_TOOL = /browser|computer|vm_exec|shared_computer|web_fetch|web_search|shell|bash/i;
const GENERIC_STATUS = /^(Starting|Planning the steps|Writing (the )?answer)$/;
const STALE_REPLAY = /\b(earlier|previously|already (shared|sent|answered|reported))\b|sebelumnya|tadi sudah|sudah (saya )?(kirim|sampaikan)/i;
const isProgressNote = (m) => /^(Still working|Masih (bekerja|mengerjakan))/i.test(m.text);
const ID_WORDS = /\b(yang|dan|di|ke|dari|ini|itu|untuk|dengan|tolong|apa|bisa|sudah|saya|kamu|anda|berapa|kali|adalah|hasil|sedang|akan|cek|berita|terkini|ya|tidak|ada|sekarang|jam|hari|nanti|sebentar|baik|oke)\b/gi;
const EN_WORDS = /\b(the|and|is|are|what|please|can|you|to|of|for|with|this|that|how|it|i|will|here|news|latest|times|result|now|be|on|in|time|today|i'll|it's|let|me|check|checking)\b/gi;

/** Which of the two languages the probe sends a reply is written in, by common short words; "unknown" on a tie. */
export function languageOf(text) {
  const id = (text.match(ID_WORDS) ?? []).length, en = (text.match(EN_WORDS) ?? []).length;
  return id > en ? "id" : en > id ? "en" : "unknown";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = { ok: false, checks: {}, timings: {}, counts: {}, notes: [] };
const fail = (name, detail) => { summary.checks[name] = { pass: false, ...detail }; };
const pass = (name, detail = {}) => { summary.checks[name] = { pass: true, ...detail }; };

async function call(method, path, body, token) {
  const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${BASE}${path}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 200) }; }
  return { status: res.status, body: json };
}

async function waitFor(what, fn, ms = 60_000, every = 1_000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > until) throw new Error(`timed out waiting for ${what}`);
    await sleep(every);
  }
}

async function mintPairing(label) {
  const opened = await call("POST", "/api/auth/pairing", { label, scopes: ["admin", "client"] });
  if (opened.status !== 200 || typeof opened.body.code !== "string") throw new Error(`pairing refused: ${opened.status}`);
  return opened.body.code;
}

async function personToken() {
  const code = await mintPairing("chatux probe api");
  const paired = await call("POST", "/api/auth/pair", { code, label: "chatux probe api" });
  if (paired.status !== 200 || typeof paired.body.token !== "string") throw new Error(`pair refused: ${paired.status}`);
  return paired.body.token;
}

const bots = async () => (await call("GET", "/api/bots?messages=0")).body.bots;
const messages = async (threadId) => (await call("GET", `/api/threads/${threadId}/messages?limit=200`)).body.messages ?? [];
const botText = (rows, after) => rows.filter((m) => m.role === "bot" && m.kind === "text" && m.text && m.at >= after);

/** Pairs each finished job, in `done` order, with the first later reply that closes its turn: a reply its own turn
 * goes on from with a tool step is narration. A step from another turn (the next job's hand-back) does not reopen it. */
export function pairFinals(rows, replies, done) {
  const continued = (m) => {
    const next = rows.slice(rows.indexOf(m) + 1).find((n) => n.role === "bot");
    return next?.kind === "activity" && next.turnId !== undefined && next.turnId === m.turnId;
  };
  const closing = replies.filter((m) => !continued(m));
  const finals = [];
  for (const at of done) {
    const next = closing.find((m) => m.at >= at && !finals.includes(m));
    if (next) finals.push(next);
  }
  return finals;
}

function timingMarks() {
  const file = `${RUN_DIR}/server.log`;
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").flatMap((line) => {
    const hit = line.match(/^(\S+)\s.*\[omb-timing\] (\S+) ms=(\d+)(.*)$/);
    if (!hit) return [];
    const at = Date.parse(hit[1].replace(/(\.\d{3})\d*Z$/, "$1Z"));
    const fields = Object.fromEntries([...hit[4].matchAll(/ (\w+)=(\S+)/g)].map((m) => [m[1], m[2]]));
    return [{ at, mark: hit[2], ms: Number(hit[3]), ...fields }];
  });
}

function toolCalls(rows, t0) {
  const calls = rows.filter((m) => m.at >= t0 && m.tool && !m.tool.name.startsWith("notice:"));
  return { tools: calls.map((m) => m.tool.name), ran: calls.filter((m) => m.tool.input || m.tool.ok !== false).length };
}

async function chrome() {
  const proc = spawn(CHROME, ["--headless=new", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--no-first-run",
    "--remote-debugging-port=9333", "--user-data-dir=/tmp/chatux-probe-chrome", "--window-size=1280,900", "about:blank"], { stdio: "ignore" });
  const target = await waitFor("chrome", async () => {
    const res = await fetch("http://127.0.0.1:9333/json/new?about:blank", { method: "PUT" });
    return res.ok ? res.json() : undefined;
  }, 30_000, 500);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(msg.error.message)); else resolve(msg.result);
    }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    pending.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  const evaluate = async (expression) => {
    const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (out.exceptionDetails) throw new Error(out.exceptionDetails.exception?.description?.slice(0, 200) ?? "evaluate failed");
    return out.result.value;
  };
  const go = async (url) => {
    await send("Page.navigate", { url });
    await waitFor(`load ${url}`, () => evaluate("document.readyState === 'complete'"), 30_000, 300);
  };
  await send("Page.enable");
  return { send, evaluate, go, close: () => { try { ws.close(); } catch {} proc.kill("SIGKILL"); } };
}

const UI = {
  mainChat: `(() => ({ composer: !!document.querySelector('[data-tour="composer"]'), jobFooter: !!document.querySelector('[data-testid="job-view-footer"]'), conversationPill: !!document.querySelector('[data-chathead-conversation]') }))()`,
  presence: `(() => [...document.querySelectorAll('[data-job-presence] [role="button"]')].map((row) => row.innerText.replace(/\\s+/g, ' ').trim()))()`,
};

async function main() {
  const free = existsSync("/proc/meminfo") ? Number(readFileSync("/proc/meminfo", "utf8").match(/MemAvailable:\s+(\d+)/)?.[1] ?? 0) / 1024 : 0;
  summary.counts.memAvailMb = Math.round(free);
  await waitFor("server", async () => (await fetch(`${BASE}/api/bots?messages=0`)).ok, 90_000, 1_000);
  let [bot] = await bots();
  if (bot.modelSelection?.model !== MODEL || bot.modelSelection?.instanceId !== "openaiCompat") {
    const patched = await call("PATCH", `/api/bots/${bot.id}`, { modelSelection: { instanceId: "openaiCompat", model: MODEL } });
    if (patched.status >= 300) throw new Error(`model patch refused: ${patched.status}`);
    [bot] = await bots();
  }
  summary.model = bot.modelSelection?.model;
  const main = bot.mainThreadId ?? bot.threadId;
  const person = await personToken();

  const browser = await chrome();
  try {
    await browser.go(`${BASE}/`);
    const code = await mintPairing("chatux probe browser");
    const signed = await browser.evaluate(`fetch('/api/auth/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: ${JSON.stringify(code)}, label: 'chatux probe browser', cookie: true }) }).then((r) => r.status)`);
    if (signed !== 200) throw new Error(`browser sign-in refused: ${signed}`);
    await browser.go(`${BASE}/`);
    const row = await waitFor("sidebar bot row", () => browser.evaluate(`(() => { const el = document.querySelector('[data-sidebar-bot-row=${JSON.stringify(bot.id)}]'); if (!el) return false; el.click(); return true; })()`), 30_000, 500);
    const opened = await waitFor("main chat", async () => { const s = await browser.evaluate(UI.mainChat); return s.composer ? s : undefined; }, 20_000, 500).catch(() => undefined);
    if (opened && !opened.jobFooter && !opened.conversationPill) pass("botRowOpensMainChat"); else fail("botRowOpensMainChat", { row: Boolean(row), state: opened ?? null });
    if (SINGLE) return await singleJob(browser, bot, main, person);
    if (SCENARIO === "language") return await languageScenario(bot, main, person);
    if (SCENARIO === "busyseat") return await busySeat(bot, main, person);
    if (SCENARIO === "restart") return await restartScenario(bot, main, person);

    const t0 = Date.now();
    const sends = [];
    const send = async (label, body) => {
      const at = Date.now();
      const res = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: main, ...body }, person);
      sends.push({ label, at, status: res.status });
      return res;
    };
    await send("vps", { text: VPS_ASK });
    await sleep(800);
    await send("news", { text: NEWS_ASK });
    await sleep(800);
    const steer = await send("steer", { text: STEER, followUp: "steer" });
    if (steer.status === 202) pass("mainChatSteerAccepted"); else fail("mainChatSteerAccepted", { status: steer.status });

    const jobsNow = async () => (await bots()).find((b) => b.id === bot.id).tasks.filter((t) => t.openedBy?.reportsBack && t.openedBy.botId === bot.id && t.createdAt >= t0 - 1_000);
    const firstJob = await waitFor("first job", async () => (await jobsNow())[0], 120_000, 1_000).catch(() => undefined);
    const presence = [];
    if (firstJob) {
      const typed = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: firstJob.threadId, text: "Tambahkan Linode juga." }, person);
      const goal = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: firstJob.threadId, text: "Selesaikan", mode: "goal" }, person);
      const anyRow = (await messages(firstJob.threadId)).find((m) => m.role === "user") ?? { id: "probe-missing" };
      const edit = await call("POST", `/api/bots/${bot.id}/messages/${anyRow.id}/edit`, { threadId: firstJob.threadId, text: "edited" }, person);
      const refused = [typed, goal, edit].every((r) => r.status === 409 && r.body.code === "job_thread_read_only");
      if (refused) pass("apiRefusesPersonInJob", { statuses: [typed.status, goal.status, edit.status] }); else fail("apiRefusesPersonInJob", { statuses: [typed.status, goal.status, edit.status], codes: [typed.body.code, goal.body.code, edit.body.code] });

      await browser.go(`${BASE}/?open-bot=${bot.id}&open-thread=${firstJob.threadId}`);
      const job = await waitFor("job view", async () => { const s = await browser.evaluate(UI.mainChat); return s.jobFooter ? s : undefined; }, 20_000, 500).catch(() => undefined);
      if (job && !job.composer) pass("jobViewReadOnly"); else fail("jobViewReadOnly", { state: job ?? null });
      await browser.go(`${BASE}/?open-bot=${bot.id}&open-thread=${main}`);
    } else {
      fail("apiRefusesPersonInJob", { reason: "no job opened" });
      fail("jobViewReadOnly", { reason: "no job opened" });
    }

    let jobs = [];
    let settled = false;
    const ELAPSED = /^(\d+m\s*)?\d+s$|^\d+\s*min$/;
    const split = (rows) => {
      const replies = botText(rows, t0).filter((m) => !isProgressNote(m));
      const done = timingMarks().filter((m) => m.mark === "job-done" && m.status !== "cancelled").map((m) => m.at).sort((a, b) => a - b);
      const finals = pairFinals(rows, replies, done);
      return { replies, acks: replies.slice(0, 2), finals, done };
    };
    while (Date.now() < DEADLINE) {
      jobs = await jobsNow();
      const lines = await browser.evaluate(UI.presence).catch(() => []);
      for (const line of lines) {
        const phrase = line.split("·").map((part) => part.trim()).filter((part) => part && !part.startsWith("#") && !ELAPSED.test(part)).join(" · ");
        if (phrase && !presence.includes(phrase)) presence.push(phrase);
      }
      const mainBusy = (await bots()).find((b) => b.id === bot.id).tasks.find((t) => t.threadId === main)?.busy;
      const { finals } = split(await messages(main));
      if (jobs.length && jobs.every((j) => !j.busy) && !mainBusy && finals.length >= jobs.length) { settled = true; break; }
      await sleep(1_500);
    }
    summary.counts.jobs = jobs.length;
    summary.presencePhrases = presence.slice(0, 8).map((line) => line.slice(0, 60));
    const contextual = presence.filter((phrase) => !GENERIC_STATUS.test(phrase));
    if (contextual.length) pass("statusLineContextual", { phrases: contextual.length }); else fail("statusLineContextual", { phrases: presence.length });

    const marks = timingMarks();
    const mainRows = await messages(main);
    const { replies, acks, finals, done } = split(mainRows);
    const steered = mainRows.some((m) => m.at >= t0 && m.role === "user" && m.steered);
    summary.counts.mainBotReplies = replies.length;
    summary.counts.steerLanded = steered;
    const doneAt = marks.filter((m) => m.mark === "job-done").map((m) => m.at).sort((a, b) => a - b);
    summary.counts.jobsCompleted = done.length;
    const stale = finals.filter((m) => STALE_REPLAY.test(m.text)).length;
    if (jobs.length >= 1 && jobs.length <= 2) pass("atMostTwoJobs", { jobs: jobs.length }); else fail("atMostTwoJobs", { jobs: jobs.length });
    if (acks.length === 2 && acks.every((m) => m.text.length <= 400)) pass("twoShortAcks", { lens: acks.map((m) => m.text.length) }); else fail("twoShortAcks", { acks: acks.length, lens: acks.map((m) => m.text.length) });
    if (settled) pass("finalsInMainChat", { finals: finals.length }); else fail("finalsInMainChat", { settled, finals: finals.length, jobs: jobs.length, busy: jobs.map((j) => Boolean(j.busy)) });
    if (stale === 0) pass("noStaleReplay"); else fail("noStaleReplay", { hits: stale });
    const jobRows = await Promise.all(jobs.map((j) => messages(j.threadId)));
    const workerRows = jobRows.map((rows) => rows.filter((m) => m.role === "bot").length);
    if (workerRows.every((n) => n > 0) && settled) pass("workerReportBack", { jobBotRows: workerRows }); else fail("workerReportBack", { jobBotRows: workerRows, settled });
    const perJob = jobs.map((j, i) => ({ job: j, ...toolCalls(jobRows[i], t0), lastAt: jobRows[i].at(-1)?.at })).sort((a, b) => a.job.createdAt - b.job.createdAt);
    const ranByJob = perJob.map((j) => j.ran);
    if (ranByJob.every((ran) => ran <= JOB_CALLS)) pass("callsWithinCap", { ran: ranByJob, cap: JOB_CALLS }); else fail("callsWithinCap", { ran: ranByJob, rows: perJob.map((j) => j.tools.length), cap: JOB_CALLS });
    const digest = (rows) => rows.filter((m) => m.at >= t0).slice(-40).map((m) => [Math.round((m.at - t0) / 1000), `${m.role[0]}:${m.kind}${m.steered ? ":steered" : ""}`,
      m.tool ? `${m.tool.name}${m.tool.ok === false ? "!" : ""} ${m.tool.input ?? ""}`.slice(0, 80) : (m.text ?? "").replace(/\s+/g, " ").slice(0, 80)]);
    writeFileSync(`${RUN_DIR}/digest.json`, JSON.stringify({ main: digest(mainRows), jobs: jobs.map((j, i) => ({ title: j.title, busy: Boolean(j.busy), rows: digest(jobRows[i]) })) }));

    const stopTarget = (jobs.find((j) => j.busy) ?? jobs[0])?.threadId;
    if (stopTarget) {
      const live = Boolean(jobs.find((j) => j.threadId === stopTarget)?.busy);
      const stop = await call("POST", `/api/bots/${bot.id}/interrupt`, { threadId: stopTarget }, person);
      const idle = live ? await waitFor("stopped job", async () => !(await jobsNow()).find((j) => j.threadId === stopTarget)?.busy, 20_000, 1_000).catch(() => false) : true;
      if (stop.status === 200 && idle) pass("stopRouteReachesJob", { outcome: stop.body.outcome ?? "stopped", live }); else fail("stopRouteReachesJob", { status: stop.status, live, idle });
    }
    summary.notes.push("card press not exercised live: no card appeared; covered by CI route test");

    const firstSend = sends[0].at;
    const ack = (i) => (acks[i] ? acks[i].at - sends[i].at : null);
    const toolMarks = marks.filter((m) => m.mark === "tool" && jobs.some((j) => j.threadId === m.thread));
    summary.timings = {
      vpsAckMs: ack(0), newsAckMs: ack(1),
      jobStartMs: jobs.map((j) => j.createdAt - firstSend),
      firstToolMs: toolMarks.length ? Math.min(...toolMarks.map((m) => m.at - m.ms)) - firstSend : null,
      jobDoneMs: doneAt.map((at) => at - firstSend),
      finalsMs: finals.map((m) => m.at - firstSend),
      jobs: perJob.map((j, i) => {
        const settledJobs = perJob.filter((p) => !p.job.busy && p.lastAt !== undefined).sort((a, b) => a.lastAt - b.lastAt);
        const final = finals[settledJobs.indexOf(j)];
        return { title: j.job.title, ran: j.ran, ackMs: acks[i] ? acks[i].at - firstSend : null, startMs: j.job.createdAt - firstSend,
          doneMs: settledJobs.includes(j) ? j.lastAt - firstSend : null, finalMs: final ? final.at - firstSend : null };
      }),
      serverAckMs: marks.filter((m) => m.mark === "ack").map((m) => m.ms),
      deliveredMs: marks.filter((m) => m.mark === "delivered").map((m) => m.ms),
    };
    summary.counts.sends = sends.map((s) => `${s.label}:${s.status}`);

    await browser.go(`${BASE}/?open-bot=${bot.id}&open-thread=${main}`).catch(() => undefined);
    await sleep(1_500);
    const shot = await browser.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${RUN_DIR}/final.png`, Buffer.from(shot.data, "base64"));
  } finally {
    browser.close();
  }
  summary.ok = Object.values(summary.checks).every((c) => c.pass);
}

async function singleJob(browser, bot, main, person) {
  const t0 = Date.now();
  const sent = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: main, text: NEWS_ASK }, person);
  const jobsNow = async () => (await bots()).find((b) => b.id === bot.id).tasks.filter((t) => t.openedBy?.reportsBack && t.openedBy.botId === bot.id && t.createdAt >= t0 - 1_000);
  const presence = [];
  let jobs = [], final, doneAt;
  while (Date.now() < DEADLINE) {
    jobs = await jobsNow();
    for (const line of await browser.evaluate(UI.presence).catch(() => [])) {
      const phrase = line.split("·").map((part) => part.trim()).filter((part) => part && !part.startsWith("#") && !/^(\d+m\s*)?\d+s$|^\d+\s*min$/.test(part)).join(" · ");
      if (phrase && !presence.includes(phrase)) presence.push(phrase);
    }
    doneAt = timingMarks().find((m) => m.mark === "job-done")?.at;
    final = doneAt ? botText(await messages(main), t0).find((m) => m.at >= doneAt) : undefined;
    if (final && jobs.every((j) => !j.busy)) break;
    await sleep(1_500);
  }
  const rows = jobs.length ? await messages(jobs[0].threadId) : [];
  const { tools, ran } = toolCalls(rows, t0);
  const cap = JOB_CALLS;
  const web = tools.filter((name) => /web_fetch|web_search|research_/.test(name)).length;
  const ack = botText(await messages(main), t0)[0];
  const marks = timingMarks();
  const toolMark = marks.find((m) => m.mark === "tool");
  if (jobs.length === 1) pass("oneJob"); else fail("oneJob", { jobs: jobs.length });
  if (web > 0) pass("webToolUsed", { web, readText: tools.filter((name) => /data_sql|data_load/.test(name)).length }); else fail("webToolUsed", { tools: [...new Set(tools)].slice(0, 6) });
  if (ran <= cap) pass("callsWithinCap", { ran, rows: tools.length, cap }); else fail("callsWithinCap", { ran, rows: tools.length, cap });
  const contextual = presence.filter((phrase) => /^(Reading|Searching the web for|Running data query|Reviewing) \S/.test(phrase));
  if (contextual.length) pass("statusLineContextual", { phrases: contextual.slice(0, 4).map((p) => p.slice(0, 40)) }); else fail("statusLineContextual", { phrases: presence.slice(0, 4) });
  if (final) pass("finalInMainChat", { len: final.text.length }); else fail("finalInMainChat", { jobs: jobs.length, busy: jobs.map((j) => Boolean(j.busy)) });
  summary.timings = {
    ackMs: ack ? ack.at - t0 : null, jobStartMs: jobs[0] ? jobs[0].createdAt - t0 : null,
    firstToolMs: toolMark ? toolMark.at - toolMark.ms - t0 : null, jobDoneMs: doneAt ? doneAt - t0 : null, finalMs: final ? final.at - t0 : null,
  };
  summary.counts.sends = [`news:${sent.status}`];
  writeFileSync(`${RUN_DIR}/digest.json`, JSON.stringify({ tools, presence: presence.slice(0, 12) }));
  const shot = await browser.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${RUN_DIR}/final.png`, Buffer.from(shot.data, "base64"));
  summary.ok = Object.values(summary.checks).every((c) => c.pass);
}

const sendMain = (bot, main, person, text) => call("POST", `/api/bots/${bot.id}/messages`, { threadId: main, text }, person);
const ownJobs = async (bot, since) => (await bots()).find((b) => b.id === bot.id).tasks.filter((t) => t.openedBy?.reportsBack && t.openedBy.botId === bot.id && t.createdAt >= since - 1_000);
const replyAfter = (main, at, ms = 60_000) => waitFor("a reply", async () => botText(await messages(main), at).find((m) => !isProgressNote(m)), ms, 500).catch(() => undefined);
const finished = () => { summary.ok = Object.values(summary.checks).every((c) => c.pass); };

async function idleJob(bot, since, threadId) {
  return waitFor("job idle", async () => {
    const job = (await ownJobs(bot, since)).find((t) => t.threadId === threadId);
    return job && !job.busy ? job : undefined;
  }, Math.max(10_000, DEADLINE - Date.now() - 60_000), 2_000).catch(() => undefined);
}

async function finalAfterJob(main, jobThreadId) {
  const lastAt = (await messages(jobThreadId)).at(-1)?.at ?? 0;
  return waitFor("job final", async () => botText(await messages(main), lastAt).find((m) => !isProgressNote(m)), 60_000, 1_000).catch(() => undefined);
}

function assignmentOf(threadId) {
  const db = new DatabaseSync(`${process.env.OMB_DATA_DIR ?? "/data/.openmausbot"}/runtime.db`, { readOnly: true });
  try {
    const row = db.prepare("SELECT id, status, json FROM assignments WHERE assignee_thread_id = ? ORDER BY created_at DESC").get(threadId);
    if (!row) return undefined;
    const { restarts, executions, outcome, restart } = JSON.parse(row.json);
    const events = db.prepare("SELECT kind FROM assignment_events WHERE assignment_id = ? ORDER BY id").all(row.id).map((e) => e.kind);
    return { status: row.status, restarts, executions, outcome, restart, events };
  } finally {
    db.close();
  }
}

async function languageScenario(bot, main, person) {
  const asks = [
    { label: "id-quick", text: "Halo Chief, berapa 17 kali 23? Jawab satu kalimat.", want: "id" },
    { label: "en-quick", text: "And what is 45 divided by 9? Answer in one sentence.", want: "en" },
    { label: "en-job", text: "Please check the latest Kompas headlines for me.", want: "en", job: true },
    { label: "id-quick-after", text: "Oke makasih. Sekarang jam berapa di Jakarta?", want: "id" },
  ];
  const rows = [];
  for (const ask of asks) {
    const at = Date.now();
    const sent = await sendMain(bot, main, person, ask.text);
    const reply = await replyAfter(main, at);
    const row = { label: ask.label, status: sent.status, want: ask.want, got: reply ? languageOf(reply.text) : null, ackMs: reply ? reply.at - at : null, reply: reply?.text.replace(/\s+/g, " ").slice(0, 80) ?? null };
    if (ask.job) {
      const job = await waitFor("language job", async () => (await ownJobs(bot, at))[0], 60_000, 1_000).catch(() => undefined);
      const final = job && await idleJob(bot, at, job.threadId) ? await finalAfterJob(main, job.threadId) : undefined;
      Object.assign(row, { job: Boolean(job), finalMs: final ? final.at - at : null, finalLang: final ? languageOf(final.text) : null });
    }
    rows.push(row);
    await sleep(1_000);
  }
  summary.timings.language = rows;
  const wrong = rows.filter((r) => r.got !== r.want || ("finalLang" in r && r.finalLang !== r.want));
  if (wrong.length === 0) pass("replyInUserLanguage"); else fail("replyInUserLanguage", { wrong: wrong.map((r) => r.label) });
  if (rows.every((r) => r.ackMs !== null && r.ackMs <= 20_000)) pass("acksWithinSeconds", { ackMs: rows.map((r) => r.ackMs) }); else fail("acksWithinSeconds", { ackMs: rows.map((r) => r.ackMs) });
  const jobRow = rows.find((r) => "job" in r);
  if (jobRow?.finalMs) pass("jobFinalInMainChat", { finalMs: jobRow.finalMs }); else fail("jobFinalInMainChat", { job: jobRow?.job ?? false });
  finished();
}

async function busySeat(bot, main, person) {
  const t0 = Date.now();
  const sends = [await sendMain(bot, main, person, BROWSER_ASK)];
  await sleep(800);
  sends.push(await sendMain(bot, main, person, VPS_ASK));
  const seat = await waitFor("a job on the browser seat", async () => {
    for (const job of await ownJobs(bot, t0)) {
      const hit = (await messages(job.threadId)).find((m) => m.at >= t0 && m.tool && /browser/i.test(m.tool.name));
      if (hit && job.busy) return { tool: hit.tool.name, atMs: hit.at - t0 };
    }
  }, 180_000, 1_500).catch(() => undefined);
  const quick = [];
  for (const text of ["Berapa 12 kali 12?", "What day of the week is it today?"]) {
    const running = (await ownJobs(bot, t0)).filter((j) => j.busy).length;
    const at = Date.now();
    const sent = await sendMain(bot, main, person, text);
    const reply = await replyAfter(main, at, 45_000);
    quick.push({ ask: text.slice(0, 24), status: sent.status, runningJobs: running, ackMs: reply ? reply.at - at : null, reply: reply?.text.replace(/\s+/g, " ").slice(0, 80) ?? null });
    await sleep(3_000);
  }
  let jobs = [], finals = 0;
  while (Date.now() < DEADLINE) {
    jobs = await ownJobs(bot, t0);
    const mainBusy = (await bots()).find((b) => b.id === bot.id).tasks.find((t) => t.threadId === main)?.busy;
    if (jobs.length && jobs.every((j) => !j.busy) && !mainBusy) {
      const rows = await messages(main);
      const lasts = await Promise.all(jobs.map(async (j) => (await messages(j.threadId)).at(-1)?.at ?? t0));
      finals = lasts.filter((lastAt) => botText(rows, lastAt).some((m) => !isProgressNote(m))).length;
      if (finals >= jobs.length) break;
    }
    await sleep(2_000);
  }
  const seatRows = (await messages(main)).filter((m) => m.at >= t0 && m.tool && !m.threadRef && !m.roomRequest && SEAT_TOOL.test(m.tool.name));
  summary.timings.quick = quick;
  summary.counts = { ...summary.counts, sends: sends.map((s) => s.status), jobs: jobs.length, finals };
  if (seat) pass("seatHeldByJob", seat); else fail("seatHeldByJob", { reason: "no running job called a browser tool" });
  if (quick.every((q) => q.runningJobs === 2)) pass("twoJobsRunningDuringAsks"); else fail("twoJobsRunningDuringAsks", { running: quick.map((q) => q.runningJobs) });
  if (quick.every((q) => q.ackMs !== null && q.ackMs <= 20_000)) pass("chatAnswersWhileBusy", { ackMs: quick.map((q) => q.ackMs) }); else fail("chatAnswersWhileBusy", { ackMs: quick.map((q) => q.ackMs) });
  if (seatRows.length === 0) pass("chatHoldsNoSeatTools"); else fail("chatHoldsNoSeatTools", { tools: seatRows.map((m) => m.tool.name).slice(0, 6) });
  if (jobs.length === 2 && finals === 2) pass("finalsInMainChat"); else fail("finalsInMainChat", { jobs: jobs.length, finals, busy: jobs.map((j) => Boolean(j.busy)) });
  for (const job of jobs.filter((j) => j.busy)) await call("POST", `/api/bots/${bot.id}/interrupt`, { threadId: job.threadId }, person);
  finished();
}

async function restartScenario(bot, main, person) {
  const state = `${RUN_DIR}/restart.json`;
  if (process.env.PROBE_PHASE !== "after") {
    const t0 = Date.now();
    const sent = await sendMain(bot, main, person, VPS_ASK);
    const job = await waitFor("job mid-turn", async () => {
      for (const j of await ownJobs(bot, t0)) {
        const tools = (await messages(j.threadId)).filter((m) => m.tool && !m.tool.name.startsWith("notice:")).length;
        if (j.busy && tools >= 2) return { threadId: j.threadId, tools };
      }
    }, 150_000, 1_000).catch(() => undefined);
    writeFileSync(state, JSON.stringify({ t0, job, cutAt: Date.now() }));
    if (job) pass("jobMidTurnBeforeRestart", { toolRows: job.tools, record: assignmentOf(job.threadId) }); else fail("jobMidTurnBeforeRestart", { status: sent.status });
    return finished();
  }
  const { t0, job, cutAt } = JSON.parse(readFileSync(state, "utf8"));
  if (!job) return fail("jobMidTurnBeforeRestart", { reason: "the first phase opened no job" });
  const back = Date.now();
  await sendMain(bot, main, person, "Masih jalan? Jawab singkat saja.");
  const pong = await replyAfter(main, back, 45_000);
  if (pong) pass("chatAnswersAfterRestart", { ackMs: pong.at - back }); else fail("chatAnswersAfterRestart", {});
  const idle = await idleJob(bot, t0, job.threadId);
  await sleep(20_000);
  const record = assignmentOf(job.threadId);
  const jobLast = (await messages(job.threadId)).at(-1)?.at ?? cutAt;
  const finals = botText(await messages(main), Math.max(cutAt, jobLast)).filter((m) => !isProgressNote(m) && m.id !== pong?.id);
  summary.timings = { finalAfterRestartMs: finals[0] ? finals[0].at - back : null };
  summary.counts.record = record;
  if (record && (record.restarts >= 1 || record.events.filter((k) => k === "started").length >= 2)) pass("jobRanAgainAfterRestart", { restarts: record.restarts, executions: record.executions }); else fail("jobRanAgainAfterRestart", { record: record ?? null });
  if (idle && record?.status === "completed") pass("jobCompleted"); else fail("jobCompleted", { idle: Boolean(idle), status: record?.status ?? null });
  if (finals.length === 1) pass("finalOnceInMainChat", { len: finals[0].text.length }); else fail("finalOnceInMainChat", { finals: finals.length });
  finished();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { summary.error = String(error?.message ?? error).slice(0, 300); })
    .finally(() => { console.log(JSON.stringify(summary)); process.exit(0); });
}
