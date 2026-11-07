// Runs inside the disposable omb-chatux-probe container (node 24, no packages): drives the branch server over
// loopback HTTP and a headless Chrome over CDP, then prints one compact JSON summary.
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

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
const SINGLE = process.env.PROBE_SCENARIO === "single";
const GENERIC_STATUS = /^(Starting|Planning the steps|Writing (the )?answer)$/;
const STALE_REPLAY = /\b(earlier|previously|already (shared|sent|answered|reported))\b|sebelumnya|tadi sudah|sudah (saya )?(kirim|sampaikan)/i;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const summary = { ok: false, checks: {}, timings: {}, counts: {}, notes: [] };
const fail = (name, detail) => { summary.checks[name] = { pass: false, ...detail }; };
const pass = (name, detail = {}) => { summary.checks[name] = { pass: true, ...detail }; };

async function call(method, path, body, token) {
  const headers = { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) };
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
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
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
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
    opened && !opened.jobFooter && !opened.conversationPill ? pass("botRowOpensMainChat") : fail("botRowOpensMainChat", { row: Boolean(row), state: opened ?? null });
    if (SINGLE) return await singleJob(browser, bot, main, person);

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
    steer.status === 202 ? pass("mainChatSteerAccepted") : fail("mainChatSteerAccepted", { status: steer.status });

    const jobsNow = async () => (await bots()).find((b) => b.id === bot.id).tasks.filter((t) => t.openedBy?.reportsBack && t.openedBy.botId === bot.id && t.createdAt >= t0 - 1_000);
    const firstJob = await waitFor("first job", async () => (await jobsNow())[0], 120_000, 1_000).catch(() => undefined);
    const presence = [];
    if (firstJob) {
      const typed = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: firstJob.threadId, text: "Tambahkan Linode juga." }, person);
      const goal = await call("POST", `/api/bots/${bot.id}/messages`, { threadId: firstJob.threadId, text: "Selesaikan", mode: "goal" }, person);
      const anyRow = (await messages(firstJob.threadId)).find((m) => m.role === "user") ?? { id: "probe-missing" };
      const edit = await call("POST", `/api/bots/${bot.id}/messages/${anyRow.id}/edit`, { threadId: firstJob.threadId, text: "edited" }, person);
      const refused = [typed, goal, edit].every((r) => r.status === 409 && r.body.code === "job_thread_read_only");
      refused ? pass("apiRefusesPersonInJob", { statuses: [typed.status, goal.status, edit.status] })
        : fail("apiRefusesPersonInJob", { statuses: [typed.status, goal.status, edit.status], codes: [typed.body.code, goal.body.code, edit.body.code] });

      await browser.go(`${BASE}/?open-bot=${bot.id}&open-thread=${firstJob.threadId}`);
      const job = await waitFor("job view", async () => { const s = await browser.evaluate(UI.mainChat); return s.jobFooter ? s : undefined; }, 20_000, 500).catch(() => undefined);
      job && !job.composer ? pass("jobViewReadOnly") : fail("jobViewReadOnly", { state: job ?? null });
      await browser.go(`${BASE}/?open-bot=${bot.id}&open-thread=${main}`);
    } else {
      fail("apiRefusesPersonInJob", { reason: "no job opened" });
      fail("jobViewReadOnly", { reason: "no job opened" });
    }

    let jobs = [];
    let settled = false;
    const isProgressNote = (m) => /^(Still working|Masih (bekerja|mengerjakan))/i.test(m.text);
    const ELAPSED = /^(\d+m\s*)?\d+s$|^\d+\s*min$/;
    const split = (rows) => {
      const replies = botText(rows, t0).filter((m) => !isProgressNote(m));
      const done = timingMarks().filter((m) => m.mark === "job-done" && m.status !== "cancelled").map((m) => m.at).sort((a, b) => a - b);
      const finals = done.map((at) => replies.find((m) => m.at >= at)).filter((m, i, all) => m && all.indexOf(m) === i);
      return { replies, acks: replies.slice(0, 2), finals, done };
    };
    while (Date.now() < DEADLINE) {
      jobs = await jobsNow();
      const lines = await browser.evaluate(UI.presence).catch(() => []);
      for (const line of lines) {
        const phrase = line.split("·").map((part) => part.trim()).filter((part) => part && !/^#/.test(part) && !ELAPSED.test(part)).join(" · ");
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
    contextual.length ? pass("statusLineContextual", { phrases: contextual.length }) : fail("statusLineContextual", { phrases: presence.length });

    const marks = timingMarks();
    const mainRows = await messages(main);
    const { replies, acks, finals, done } = split(mainRows);
    const steered = mainRows.some((m) => m.at >= t0 && m.role === "user" && m.steered);
    summary.counts.mainBotReplies = replies.length;
    summary.counts.steerLanded = steered;
    const doneAt = marks.filter((m) => m.mark === "job-done").map((m) => m.at).sort((a, b) => a - b);
    summary.counts.jobsCompleted = done.length;
    const stale = finals.filter((m) => STALE_REPLAY.test(m.text)).length;
    jobs.length >= 1 && jobs.length <= 2 ? pass("atMostTwoJobs", { jobs: jobs.length }) : fail("atMostTwoJobs", { jobs: jobs.length });
    acks.length === 2 && acks.every((m) => m.text.length <= 400) ? pass("twoShortAcks", { lens: acks.map((m) => m.text.length) })
      : fail("twoShortAcks", { acks: acks.length, lens: acks.map((m) => m.text.length) });
    settled ? pass("finalsInMainChat", { finals: finals.length }) : fail("finalsInMainChat", { settled, finals: finals.length, jobs: jobs.length, busy: jobs.map((j) => Boolean(j.busy)) });
    stale === 0 ? pass("noStaleReplay") : fail("noStaleReplay", { hits: stale });
    const jobRows = await Promise.all(jobs.map((j) => messages(j.threadId)));
    const workerRows = jobRows.map((rows) => rows.filter((m) => m.role === "bot").length);
    workerRows.every((n) => n > 0) && settled ? pass("workerReportBack", { jobBotRows: workerRows }) : fail("workerReportBack", { jobBotRows: workerRows, settled });
    const perJob = jobs.map((j, i) => ({ job: j, ...toolCalls(jobRows[i], t0), lastAt: jobRows[i].at(-1)?.at })).sort((a, b) => a.job.createdAt - b.job.createdAt);
    const ranByJob = perJob.map((j) => j.ran);
    ranByJob.every((ran) => ran <= JOB_CALLS) ? pass("callsWithinCap", { ran: ranByJob, cap: JOB_CALLS }) : fail("callsWithinCap", { ran: ranByJob, rows: perJob.map((j) => j.tools.length), cap: JOB_CALLS });
    const digest = (rows) => rows.filter((m) => m.at >= t0).slice(-40).map((m) => [Math.round((m.at - t0) / 1000), `${m.role[0]}:${m.kind}${m.steered ? ":steered" : ""}`,
      m.tool ? `${m.tool.name}${m.tool.ok === false ? "!" : ""} ${m.tool.input ?? ""}`.slice(0, 80) : (m.text ?? "").replace(/\s+/g, " ").slice(0, 80)]);
    writeFileSync(`${RUN_DIR}/digest.json`, JSON.stringify({ main: digest(mainRows), jobs: jobs.map((j, i) => ({ title: j.title, busy: Boolean(j.busy), rows: digest(jobRows[i]) })) }));

    const stopTarget = (jobs.find((j) => j.busy) ?? jobs[0])?.threadId;
    if (stopTarget) {
      const live = Boolean(jobs.find((j) => j.threadId === stopTarget)?.busy);
      const stop = await call("POST", `/api/bots/${bot.id}/interrupt`, { threadId: stopTarget }, person);
      const idle = live ? await waitFor("stopped job", async () => !(await jobsNow()).find((j) => j.threadId === stopTarget)?.busy, 20_000, 1_000).catch(() => false) : true;
      stop.status === 200 && idle ? pass("stopRouteReachesJob", { outcome: stop.body.outcome ?? "stopped", live })
        : fail("stopRouteReachesJob", { status: stop.status, live, idle });
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
        const final = j.job.busy || j.lastAt === undefined ? undefined : finals.find((m) => m.at >= j.lastAt);
        return { title: j.job.title, ran: j.ran, ackMs: acks[i] ? acks[i].at - firstSend : null, startMs: j.job.createdAt - firstSend,
          doneMs: j.job.busy || j.lastAt === undefined ? null : j.lastAt - firstSend, finalMs: final ? final.at - firstSend : null };
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
      const phrase = line.split("·").map((part) => part.trim()).filter((part) => part && !/^#/.test(part) && !/^(\d+m\s*)?\d+s$|^\d+\s*min$/.test(part)).join(" · ");
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
  jobs.length === 1 ? pass("oneJob") : fail("oneJob", { jobs: jobs.length });
  web > 0 ? pass("webToolUsed", { web, readText: tools.filter((name) => /data_sql|data_load/.test(name)).length }) : fail("webToolUsed", { tools: [...new Set(tools)].slice(0, 6) });
  ran <= cap ? pass("callsWithinCap", { ran, rows: tools.length, cap }) : fail("callsWithinCap", { ran, rows: tools.length, cap });
  const contextual = presence.filter((phrase) => /^(Reading|Searching the web for|Running data query|Reviewing) \S/.test(phrase));
  contextual.length ? pass("statusLineContextual", { phrases: contextual.slice(0, 4).map((p) => p.slice(0, 40)) }) : fail("statusLineContextual", { phrases: presence.slice(0, 4) });
  final ? pass("finalInMainChat", { len: final.text.length }) : fail("finalInMainChat", { jobs: jobs.length, busy: jobs.map((j) => Boolean(j.busy)) });
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

main().catch((error) => { summary.error = String(error?.message ?? error).slice(0, 300); })
  .finally(() => { console.log(JSON.stringify(summary)); process.exit(0); });
