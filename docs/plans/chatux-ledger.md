# Chat UX ledger (branch `ux/main-chat-progress`)

Evidence: **CI** = scoped specs in `chatux-check.yml` (run 42346753665, 15 specs, `b11b0d3`). **VPS** = disposable `omb-chatux-probe` (`scripts/validate-chatux/`): branch bundle from check run 42347377067 (`82f3ecb`), real gateway, `deepseek/deepseek-v4.1-flash`, `frontDesk` on, `TZ=Asia/Jakarta`, 8-minute cap, container and data deleted afterwards. **none** = code only. PASS needs observed behaviour (`docs/HANDOFF.md` §11).

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

Fixes on the branch, not yet verified:
- **`web_fetch` agents tool** for report-back jobs (`OMB_WEB_FETCH`). It reads the page server-side through `fetchPublicPage`, which accepts public addresses only and re-checks every redirect, and returns readable text or RSS items in 12,000-character pages. The data prompts now point page reads to `web_fetch`.
- **Tool-call budget** for bot-opened jobs: 30 calls by default, overridable with `OMB_JOB_TOOL_CALLS`. Once the budget is spent, the next round runs without tools and writes the answer from what was gathered.
- **Repeat guard** for every API model: an identical failing call is refused after 2 failures on remote models, 3 on local.
- **Status line:** `toolStep` reports a `data_sql` `read_text` or a `data_load` URL as "Reading <site>", and any other `data_sql` as "Running data query".
- **Stop:** a job the person stopped no longer resumes the main chat (`nothingToAnswer`).
- **Checks:** deterministic specs are listed in `scripts/validate-chatux/box-specs.txt`. The live check is `PROBE_SCENARIO=single scripts/validate-chatux/run.sh <run>`.

## Phases (`docs/DIRECTION.md` §7)

| Phase | Done when | Status on this branch | Evidence | Next smallest deliverable |
|---|---|---|---|---|
| 1 Usable | Imam watches a bot open example.com and takes over the mouse | Not touched here; observed by Imam on `main` | Imam, 2026-11-06 | none on this branch |
| 2 Grok-like | #2, #6, #19 pass with 2 jobs | #2 and #19 PASS (overlap probe #3 at `a2849b1`); #6 restart durability has a deterministic test, box run pending | CI + VPS | box run of `box-restart.txt` |
| 3 Phone | #4 passes | Automated check PASS at `742ca2a`; real-phone part deferred to Imam | box | Imam on a real phone |
| 4 Imam's picks | #5, #7, login sharing, rebrand | Not touched | none | out of scope here |

## Parity tests

| # | Test | Status | Evidence | Next smallest deliverable |
|---|---|---|---|---|
| 1 | Reply UX: short, user's language | Acks 8–12 s, ≤154 chars, Indonesian for Indonesian asks | VPS | cut ack latency (front-desk turn still ~8 s) |
| 2 | Long work: ack, progress, outcome | **PASS**: overlap probe #3 at `a2849b1` (artifact 42356543941): acks 9.1 / 10.4 s, both finals in the main chat at 91.0 / 104.0 s, 10/10 tool calls within the cap | VPS | none |
| 3 | Choice card: tap continues | Card press into a job thread allowed by the route; not seen live | CI | a job that asks a card on the probe |
| 4 | Phone | **PASS (automated)** at `742ca2a`: `phone-check.mjs` on the box, Advanced and Simple mode. The app's own `ChatMarkdown` renders a 5-column, 3-row VPS table at 390×844 DPR 3 in headless Chrome with no page or transcript sideways overflow, no table scroll, no clipped cell text and cell font ≥ 12 px; dist's manifest (name, 192/512 PNG icons, `standalone`, `start_url`, parsed by Chrome) and `sw.js` (no fetch handler) are correct. **Deferred to Imam:** install the PWA on a real phone, pair, get a Web Push, read the same table | box | Imam's phone pass |
| 6 | Local job: durable, app wakes | Finished job wakes the main chat with its result (news, 236–371 s, VPS). **Restart durability, deterministic** (`server/runtime/runtime.test.ts`, "a report-back job across process restarts"; one `runtime.db` file closed and reopened, fake turn runner): a job cut mid-turn reruns once with the restart note, reports into the main chat once and wakes it once; a job cut after an outward tool call (`GMAIL_SEND_EMAIL`) is not run again and ends `interrupted`, reported once; a stopped job and a failed job stay so across two more restarts with no run, report or main-chat turn. No runtime defect found reading the code; awaiting the box run of `box-restart.txt` | code + box (pending) | box run of `box-restart.txt` |
| 8 | Routine reminder | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 11 | Safety: deletion blocked | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 17 | Browser: example.com visible | Unverified on branch (passed on `main`, Imam 2026-11-06) | none | rerun after merge |
| 19 | Parallel: 2 jobs, responsive chat, Stop | **PASS**: overlap probe #3 at `a2849b1` (artifact 42356543941): 2 jobs run together, acks 9.1 / 10.4 s while busy, finals 91.0 / 104.0 s, 10/10 calls; Stop ended a live job within 20 s in the earlier runs | VPS | none |
