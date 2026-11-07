# Chat UX ledger (branches `ux/main-chat-progress` and `feat/one-main-chat`)

Evidence: **CI** = scoped specs in the branch-only `chatux-check.yml` (run 42346753665, 15 specs, `b11b0d3`; workflow removed before merge). **box** = vitest or headless Chrome on Chief's Linux computer, no Docker. **VPS** = disposable `omb-chatux-probe` (`scripts/validate-chatux/`): branch bundle from a `check.yml` run with `probe_dist=true`, real gateway, `deepseek/deepseek-v4.1-flash`, `frontDesk` on, `TZ=Asia/Jakarta`, container and data deleted afterwards. **none** = code only. PASS needs observed behaviour (`docs/HANDOFF.md` §11).

## Branch `feat/tools-routing` (on `268363d`)

Order for any web task (own design, not Grok's private mechanism): a connected app, then search or a public GET, then the built-in browser, then the one desktop seat. Desktop and browser work run in delegated jobs on that one seat. Mac rule for this package: no tests, builds or installs on the Mac; the specs below are for the box. Box list: `scripts/validate-chatux/box-tools.txt`.

READY: Package 2 (tools) at `232f220` — D1/D4 `web_fetch` everywhere except the front desk; D2 `web_search` via the Command Code gateway with the existing key; D3 connector first; D5 sign-in/script pages go to the built-in browser; D6 one shared seat; C3 one busy-chat policy in the main chat with front desk on by default; C9 logical job id. Test fixtures start with front desk off. Reviews: no blockers. Re-validate: box server tsc at `34b26d3` failed on `server/host/busy-reply.test.ts` TS7024 (implicit circular return in the `it.each` write cases); `232f220` types those cases. Box list: `scripts/validate-chatux/box-tools.txt`.

| Item | Commits | Status | Evidence |
|---|---|---|---|
| D1/D4: a public URL or news is read through `web_fetch`, never the desktop, from a chat or a job. `web_fetch` is mounted in every conversation (the `OMB_WEB_FETCH` gate is gone). The front desk denies it and hands the read to a job, so the main chat stays fast. The surface prompt puts `web_fetch` before any screen | `34127e6` | Box run pending | `server/drivers/agents-usage-tool.test.ts`, `server/front-desk.test.ts` |
| D2: a search tool with no new provider or key. `web_search` (agents tool) runs through the Command Code gateway the API models already use, with the same `OPENAI_COMPAT_API_KEY`: `POST https://api.commandcode.ai/alpha/web-search` (`query`, `numResults` 1–10, `allowedDomains`/`blockedDomains`). It is mounted only while the workspace OpenAI-compatible URL is `https://api.commandcode.ai/...` with a key (`OMB_WEB_SEARCH`); the route sends the key to that origin only, refuses redirects, re-applies the domain filters and caps results. Order: connector → `web_search`/`web_fetch` → built-in browser → the desktop seat. The front desk denies it and delegates search to a job | `e54586f` | Box run pending | `server/routes/web-search.test.ts` (mocked gateway: query, key and filters sent to the gateway alone; blocked and disallowed domains dropped; bad input and no key never call out; a gateway error does not echo its body); `server/agents-turn.test.ts` (listed in a chat, a job and a room only with the key); `server/front-desk.test.ts` |
| D3: connector first. On an API-model turn, once a connected app (`composio`, own apps, `highlevel`, `email`, a remote or app MCP server) has answered, the built-in browser calls of the next model round are not run and the result says why. Browser calls in a later round run, for when the app lacks the data or the action. The skipped calls do not count against the job's budget and do not fail the turn | `d28dbf4`, `2fffd30` | Box run pending | `server/drivers/chat-mcp-tools.test.ts` (connector answered → both browser calls of that round never reach the browser server; a later round runs; a failed connector leaves the browser alone) |
| D5: a sign-in or script-only page falls back to the built-in browser. `web_fetch` answers `needsBrowser: "sign-in"` for 401/403/407, for a redirect to a login/sign-in/auth/sso path, or for a page with a password field and under 1,500 characters of text. It answers `needsBrowser: "script"` for an HTML page with under 200 characters of text that ships scripts and has an empty app mount (`#root`, `#app`, `#__next`, `#__nuxt`) or a `<noscript>` notice. Either answer comes with `next`, which names `browser_navigate`. A small page with an ordinary script is still read; a missing page is still a 502 | `e5667c8` + review fix | Box run pending | `server/routes/web-fetch.test.ts` (fixture: fetch gets a login wall → browser path chosen; an article with a sign-in box and the existing `/html` page with a script are still read); `server/wait-probes.test.ts` |
| D6: desktop and browser work from jobs share the one seat; a second job waits; the chat never takes the seat | existing code; this branch adds `web_fetch` to `FRONT_DESK_DENY` and makes front desk the default | Existing behaviour; front-desk test added | Seats: Local VM capacity defaults to 1 (`seatCapacity` in `server/local-vm-seats.ts`). A second turn on a held computer resource waits in a FIFO queue (`TurnResources.startWaiting`; `bindTurnComputer` parks it after `COMPUTER_WAIT_MAX_MS`). The bot's one browser is one seat: another conversation's call waits, and an idle holder hands over after 60 s (`server/host/browser-seats.ts`, `browser-seats.test.ts` "serves waiters in the order they came"). The chat never takes a seat: a front-desk turn asks for computer `off`, mounts no browser and denies every seat tool (`server/front-desk.test.ts` "keeps the person's chat off the desktop…"). A Local VM configured with `seats` > 1 deliberately gives parallel jobs their own seats |
| C3: one busy-chat policy. Every answer lands in the main chat (decision below) | `c059e92` | Box run pending | `server/host/busy-reply.test.ts`; `server/direct-coordination.e2e.test.ts` "a message sent while the main chat works gets a short reply in the main chat within seconds, and the work's result lands there once" (front desk on and off) |
| C9: each job has a logical job id, separate from the request and turn ids | `4f72994` | Box run pending | `server/direct-coordination.e2e.test.ts`: the job thread's `openedBy.delegationId` equals the coordinator assignment id and is not the id of any request it answers; it is unchanged after a steer, with one assignment on the job thread. A restart rerun keeps the id (`server/runtime/runtime.test.ts` "a job cut mid-turn reruns once…"). A `rework` deliberately mints a new job |

**D2 route (decided 2026-11-07, owner-approved: Command Code only).**
- The provider docs (`commandcode.ai/docs/provider`) list no search route, and `/docs/reference/tools` documents the CLI's `web_search` parameters only. The route a third-party plugin names, `POST /provider/alpha/web-search`, answered **404** "not a registered API" from the VPS.
- The CLI itself (`command-code` 1.88.5 on npm, `dist/cli.mjs`) posts `{query, numResults, allowedDomains?, blockedDomains?}` to `/alpha/web-search` on the API origin with the same bearer key. One bounded probe from the VPS (`superbot-omb-1`'s `provider.env` key, never printed): `POST https://api.commandcode.ai/alpha/web-search`, 3 results, **200 in 2.5 s**, body `{query, results:[{title,url,snippet}], formatted}`.
- Choice: call that route from the server (`server/routes/web-search.ts`), not from the model as a native tool, so the key stays on the server and the front desk can deny it. The `/alpha/` prefix means the vendor may change it: a change shows as a 502 "Web search answered N" and `web_fetch` still works.
- Not done: Claude and Codex keep their native search too; the agents `web_search` is also listed for them when the key is set.

**C3 audit (person-first and the side lane).** The entry points, from the code:
- **No `followUp`:** web, PWA, desktop Talk and Live-call sends never set one (`src/components/send-key.test.ts`). They went to the "Quick replies" lane (`server/side-replies.ts`, `server/index.ts` `acceptDirectSend`). The lane copied only text replies back; its cards and widgets stayed in the lane, and the lane thread showed in the Advanced sidebar.
- **Explicit `followUp` (CLI) or an app:** steered or queued in the same thread, with person-first (`server/host/person-first.ts`) stopping a step after 60 s. Person-first was therefore unreachable from the web.
- **Card answers:** queue in the thread that holds the card (`server/person-replies.ts`).
- **Goals:** wait until the bot is free.
- **Guarded sends and the Bot API:** refused with 409.
- **Rooms:** queue in the room.

Two policies applied to the same person and the same chat: the lane and person-first.

**C3 decision (the owner's direction, 2026-11-07).**
- **The front desk is the immediate responder.** It answers within seconds and hands heavy work to jobs. It is now on by default for every bot (`features.frontDesk` on unless `false`; `frontDeskTurn`).
- **The side lane is removed.** That means `server/side-replies.ts`, its test, `SIDE_LANE_TITLE` in `front-desk.ts`, the capacity exemption, `mainThreadTasks`, and `src/lib/job-threads.ts`.
- **One policy covers a person's plain message to a busy chat, whether front desk is on or off:**
  - The message goes to the running work: steered when the engine can take it, else queued first, with person-first stopping a step after 60 s.
  - Within seconds, a short reply is posted in the same main chat. It is a one-off small-model call (`server/host/busy-reply.ts`, side job `busy-reply`, 8 s cap). It answers a quick question outright, or says the message was passed on (or is next in line) and that the result will come here. A fixed acknowledgement covers a missing or slow model.
  - The work's result then lands in the main chat once.
- **Why:** this is the owner's rule that nothing waits silently and nothing answers in a second thread, while the work still sees every message.
- **Left as they are:**
  - Card answers on a job thread still run in that thread.
  - A queued message's busy reply cannot quote it, because the row only exists once it runs.
  - A quick question can be answered twice: once by the busy reply and again by the queued turn.
  - Old "Quick replies" threads stay as ordinary read-only threads. They are hidden while threads are hidden.

**Front desk off in tests that use the computer from a main chat (decided 2026-11-07).** Front desk on by default would change every main-chat turn in tests written for the old default. Choice: the shared isolated fixtures start with `features.frontDesk: false`, so the hundreds of tests built on them keep the path they were written for, and front-desk tests opt in (they already PATCH `frontDesk` explicitly). Shared fixtures: `scripts/control-omb.ts` `launchVerificationServer`, `server/testing/restartable-server.ts`, `scripts/testing/cloud-send-fixture.ts`, `scripts/testing/own-home-fixture.ts`. The 126 test files that mention a computer, browser or VM and start a server were classified one by one; those that write their own config and run a computer, browser, VM, shared-computer or cloud-computer turn on a bot's main chat now set it: `server/index.test.ts`, `browser-codex-path.integration`, `browser-shutdown.e2e`, `cloud-computer-auto-sleep.e2e`, `cloud-computer-lazy.e2e`, `cloud-computer-slow-start.e2e`, `cloud-home-server`, `cloud-lending-browser.e2e`, `cloud-lending-chrome.e2e`, `cloud-lending.e2e`, `cloud-lent-screen.e2e`, `computer-engine-removal.e2e`, `group-local-vm.e2e`, `host-lazy-claim.e2e`, `lent-folders.e2e`, `openai-compat-vm.e2e`, `parallel-threads.e2e`, `place-view.e2e`, `surface-pins.e2e`, `use-my-mac.e2e`, `vps-routing` (all under `server/`). Residual risk: a test outside that keyword set that pins main-chat prompt parts (`plan`, `shell`) with its own config; the box run names it. A verify-omb smoke of the default must pass `--set features.frontDesk=true`.

## Branch `feat/one-main-chat` (on `764bf83`)

On a server that belongs to one person, a person writes to each bot only in its main chat, front desk on or off; `docs/HANDOFF.md` §"One main chat" has the rule. Box list: `scripts/validate-chatux/box-onechat.txt`.

| Item | Commits | Status | Evidence |
|---|---|---|---|
| Server: send, goal and edit outside the main chat refused (409 `main_chat_only`), no new thread for a person | `67ba2d3`, `352cd4d` | PASS | box: strict one-main-chat set green apart from the 10 known failures below |
| Web: threads hidden, other threads read-only with "Back to your chat" | `0243c37`, `211f60a` | PASS | box: same set (`ChatView.controls`, `store`) |
| Jobs: success, failure, Stop, restart and steer each answer once in the main chat | `2e01905` | PASS | box: `runtime.test.ts`, `direct-coordination.e2e.test.ts` |
| Delivery state on each result row: `delivered`, `failed`, `interrupted` | `952ed50` | PASS | box at `952ed50`: server tsc clean, `result-delivery.test.ts` and `direct-coordination.e2e.test.ts` pass |
| "Quick replies" lane answers mirrored into the main chat with `requestMessageId` | `b698a9f` | PASS | box at `b698a9f`: `side-replies.test.ts` 2/2 |
| Desktop Talk asks in the main chat (`mainThreadId`, else `threadId`), front desk on and off; no "Quick asks" thread | `602e7d9`, `ae6babe` | Box run pending | `server/talk-server.e2e.test.ts`; node tests `electron/talk-server.node-test.mjs`, `electron/talk-main.node-test.mjs` |
| Deploy restart: a new server bundle force-recreates `omb`, then Caddy; fails when `omb` keeps its id or health stays down | `82bca41` (merged) | Mocked test only | `scripts/deploy-web-pull.test.ts` (`box-deploy.txt`); the VPS cron copy needs a one-time install |

Merge readiness, `feat/one-main-chat` → `main`:
- Known failures: 10 in `server/steer-e2e.test.ts` and `server/cloud-send-kinds.e2e.test.ts`, already failing at `2e01905`; not caused by this branch.
- After the merge, copy `deploy/superbot-web-pull.sh` once over the VPS cron's `$HOME/SuperBot/web-pull.sh`; until then the restart fix does not run.
- Still open: the box run of the Talk tests; #4 on a real phone (Imam); #8, #11, #17 rerun after merge.

## VPS probe, 2026-11-07 (three full runs; same scenario)

Scenario: VPS-price research, then "berita kompas terkini" 0.8 s later, then a main-chat steer ("prioritise Singapore") 0.8 s later.

| Measure | Run 2 | Run 3 | Run 4 |
|---|---|---|---|
| send → ack, VPS research (s) | 8.1 | 10.4 | 8.4 |
| send → ack, Kompas news (s) | 9.4 | 12.3 | 8.3 |
| send → job admitted (s) | 7.8 / 8.2 | 7.8 / 13.2 | 8.4 / 9.2 |
| server-side ack (ms) | 64 / 26 / 6 | 45 / 15 / 4 | 63 / 21 / 6 |
| news job done / final in main chat (s) | 301 / 315 | 362 / 371 | 228 / 236 |
| VPS job at the 8-min cap | running (41 tool rows), stopped | running (67), stopped | running (68), stopped |
| jobs opened | 2 | 2 | 2 |
| first tool mark | none (see gap 2) | none | none |

Passed in all three runs: bot row opens the main chat (composer, no job footer); the job view is read-only (footer, no composer); the API refuses a person's send, goal and edit in the job thread (409 `job_thread_read_only` ×3); the main-chat steer is accepted and reaches the running job (`start_thread job=…`); two short acks (≤154 chars); at most 2 jobs; no stale "earlier" replay in finals; Stop from the main chat ends a live job (job-done `status=cancelled` within 20 s, shown as "MausBot — cancelled: Stopped by user" in the main chat); job workers write their rows and the finished news job reports back into the main chat as a table (run 4 screenshot).

Failed: both finals within 8 minutes (the VPS research job never finished). Not exercised live: a card press inside a job (no card appeared; covered by the CI route test).

Gaps found:
1. **Research jobs churn on `data_sql`.** Both jobs read pages through DuckDB `read_text('https://…')` in `data_data_sql`: 34–68 calls per job, many of them failing, where a fetch or search tool would do. The VPS comparison runs past 8 minutes, and the Kompas headlines take 4–6 minutes.
2. **The job line stays generic during `data_sql` reads.** `toolStep` (`server/step-summary.ts`) does not recognise `data_sql`. Most samples read "Planning the steps"; a few read "Writing the answer" or "Waiting for data_data_sql". There is no live step, so no `[omb-timing] tool` mark is logged.
3. **A stopped job wakes the main chat.** After Stop, the main chat starts a resume turn ("Thinking it through"). That is one more model turn for work the person cancelled.

Root cause of gap 1: an API-model job (`openai-chat.ts`) gets only the `agents` and `data` tool servers when the browser is off and no computer is attached. The `browser` server is gated on `features.browser`, there is no engine-native web tool, and the research tools need a treg key. That leaves no page reader, so the model fetches pages through DuckDB. Meanwhile `FRONT_DESK_PROMPT` tells the chat that jobs have web tools. The repeat guard only ran for local models, and the only caps were 64 rounds and 200 calls per turn.

Fixes on the branch, and what verified them:
- **`web_fetch` agents tool** for report-back jobs (`OMB_WEB_FETCH`). It reads the page server-side through `fetchPublicPage`, which accepts public addresses only and re-checks every redirect, and returns readable text or RSS items in 12,000-character pages. The data prompts now point page reads to `web_fetch`. Verified: single-job VPS probe at `5e7f732` (one Kompas job read through `web_fetch`/search, contextual status, final in the main chat); overlap probe #3 at `a2849b1`; `server/routes/web-fetch.test.ts` on the box.
- **Tool-call budget** for bot-opened jobs: 30 calls by default, overridable with `OMB_JOB_TOOL_CALLS`. Once the budget is spent, the next round runs without tools and writes the answer from what was gathered. A parallel batch that crosses the cap is cut at the cap (`02e1008`). Verified: overlap probe #3, 10/10 executed calls per job under a cap of 10, asserted strictly; `server/drivers/openai-chat-tools.test.ts` on the box.
- **Repeat guard** for every API model: an identical failing call is refused after 2 failures on remote models, 3 on local. Verified: `server/drivers/chat-repeat-guard.test.ts` and the 64-step cap fixture (`f6ab90d`) on the box.
- **Status line:** `toolStep` reports a `data_sql` `read_text` or a `data_load` URL as "Reading <site>", and any other `data_sql` as "Running data query". Verified: `server/step-summary.test.ts`; 8 contextual job-line phrases seen in the `5e7f732` overlap probe.
- **Report-back delivery turn:** the main chat delivers a returned result instead of re-delegating it, and never takes the main chat thread as a job target (`a2849b1`). Verified: overlap probe #3 delivered both finals at 91.0 / 104.0 s, against 79 / 133 s before.
- **Stop:** a job the person stopped no longer resumes the main chat (`nothingToAnswer`). Verified: `server/runtime/runtime.test.ts` (box, 60/60 at `3b070ee`), including after restarts; Stop ended a live job within 20 s in the VPS runs.
- **Remaining manual checks:** #4 on a real phone (install the PWA, pair, Web Push, read the table) and #8, #11, #17 rerun after merge, all by Imam.

## Phases (`docs/DIRECTION.md` §7)

| Phase | Done when | Status on this branch | Evidence | Next smallest deliverable |
|---|---|---|---|---|
| 1 Usable | Imam watches a bot open example.com and takes over the mouse | Not touched here; observed by Imam on `main` | Imam, 2026-11-06 | none on this branch |
| 2 Grok-like | #2, #6, #19 pass with 2 jobs | **Complete**: #2 and #19 PASS (overlap probe #3 at `a2849b1`); #6 PASS (deterministic restart test, box 60/60 at `3b070ee`) | CI + VPS + box | none |
| 3 Phone | #4 passes | Automated check PASS at `742ca2a`; real-phone part deferred to Imam | box | Imam on a real phone |
| 4 Imam's picks | #5, #7, login sharing, rebrand | Not touched | none | out of scope here |

## Parity tests

| # | Test | Status | Evidence | Next smallest deliverable |
|---|---|---|---|---|
| 1 | Reply UX: short, user's language | Acks 8–12 s, ≤154 chars, Indonesian for Indonesian asks | VPS | cut ack latency (front-desk turn still ~8 s) |
| 2 | Long work: ack, progress, outcome | **PASS**: overlap probe #3 at `a2849b1` (artifact 42356543941): acks 9.1 / 10.4 s, both finals in the main chat at 91.0 / 104.0 s, 10/10 tool calls within the cap | VPS | none |
| 3 | Choice card: tap continues | Card press into a job thread allowed by the route; not seen live | CI | a job that asks a card on the probe |
| 4 | Phone | **PASS (automated)** at `742ca2a`: `phone-check.mjs` on the box, Advanced and Simple mode. The app's own `ChatMarkdown` renders a 5-column, 3-row VPS table at 390×844 DPR 3 in headless Chrome with no page or transcript sideways overflow, no table scroll, no clipped cell text and cell font ≥ 12 px; dist's manifest (name, 192/512 PNG icons, `standalone`, `start_url`, parsed by Chrome) and `sw.js` (no fetch handler) are correct. **Deferred to Imam:** install the PWA on a real phone, pair, get a Web Push, read the same table | box | Imam's phone pass |
| 6 | Local job: durable, app wakes | **PASS (deterministic)**: box `npx vitest run server/runtime/runtime.test.ts` at `3b070ee`, 60/60. The "report-back job across process restarts" block closes and reopens one `runtime.db` file with a fake turn runner: a job cut mid-turn reruns once with the restart note, reports into the main chat once and wakes it once; a job cut after an outward tool call (`GMAIL_SEND_EMAIL`) is not run again and ends `interrupted`, reported once; a stopped job and a failed job stay so across two more restarts with no run, report or main-chat turn. Live: a finished job wakes the main chat with its result (VPS). Known gap: plain shell writes are not classed as outward, so they rerun once with a note to check first | box + VPS | none |
| 8 | Routine reminder | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 11 | Safety: deletion blocked | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 17 | Browser: example.com visible | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 19 | Parallel: 2 jobs, responsive chat, Stop | **PASS**: overlap probe #3 at `a2849b1` (artifact 42356543941): 2 jobs run together, acks 9.1 / 10.4 s while busy, finals 91.0 / 104.0 s, 10/10 calls; Stop ended a live job within 20 s in the earlier runs | VPS | none |
