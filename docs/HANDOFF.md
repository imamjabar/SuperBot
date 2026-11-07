# SuperBot handoff — Claude Code on Imam's Mac (2026-11-06, Asia/Jakarta)

Read this before making changes. This document has no credentials. The repository is **public**. Imam is continuing development with **Claude Code on his local MacBook**; Grok Bot, its remote development box, omp-via-Grok prompting, and Grok routines/watchers are not part of the workflow. Do not assume a design or test is complete without the proof named below. Stop and ask Imam before changing external infrastructure, releasing, exposing services, or spending.

## 1. Product goal and principles

SuperBot (fork of OpenMausBot) should behave like Grok Bot while staying self-hosted, cheap, approval-backed, and connected to Imam's Mac and phone:

1. Run on a VPS using existing authorised AI APIs/subscriptions; a Mac is a client, not prerequisite compute.
2. **One shared computer, one visible desktop seat** (capacity 1 until a VPS upgrade): shared Linux files/tools and a leased visible Chrome/XFCE/Cua seat, not a container per bot. Headless is fallback only; Chrome stable is required.
3. **Independent bot identity**: private memory, skills, routines, approvals and credentials/scopes. Do not read or copy another bot's live cookies.
4. **One canonical chat per bot** (Task 10b): no parallel legacy thread list in the final UI; migration must be lossless.
5. **Orchestrator, not long inline turns** (Task 10c): immediate reply/ack; durable background jobs; one worker per workstream; follow-ups resume it; only the canonical bot speaks to Imam; completion events wake chat rather than polling; per-bot visible todos after actual work; steering and stop-all; at most 2 concurrent jobs; routines/event watchers wake chat.
6. Bots can create/coordinate bots by reusing rooms, bot packages and coordinator. No unbounded agents or hidden work.
7. Each device creates one outbound connection to the VPS: no inbound Mac daemon or public VNC/CDP. Electron already does this; do not recreate a `superbot-agent` WebSocket daemon.
8. Preserve approvals, admin same-origin authorization, exclusive leases, read-only viewing, secret redaction and permissions. Never add unauthenticated debug endpoints or direct DB/session/lease edits as a workaround.

Grok Bot is a **reference design for product behavior only**, not a required service or development dependency.

## 2. Confirmed scope / capability map

- **Keep/enable**: Mac pairing (`electron/`, `server/shared-computers.ts`); approvals (`ApprovalCard.tsx`, `PendingApproval.tsx`, `shared/approval-mode.ts`); safe egress (`shared/outbound.ts`, `server/safety-floor-gate.ts`); vault request/fill (`SecretRequestCard.tsx`, `secret-vault.ts`, `login-fill.ts`); routines/webhooks (`routines.ts`, `routine-request.ts`, `app-events.ts`); per-bot memory (`memory-store.ts`, `memory-journal.ts`); skills (`skill-library.ts`, `skill-request-card.ts`); usage/cost (`usage-ledger.ts`, `plan-usage.ts`); multi-bot (`chief-of-staff.ts`, `peer-*`, `bot-package.ts`); MCP/Composio and setup cards.
- **Extend, do not rebuild**: approval-backed command execution + completion wake; DraftCard over Gmail drafts/outbound; hard cost cap; shared short memory; computer-viewer lease integration.
- **Do not build now**: separate Mac WebSocket daemon, public agent-owned mail, paid always-on desktops, meetings, commerce. No Mac login or terminal bypass.

## 3. Current architecture

- Sydney VPS: AWS m7i-flex, **8 GB RAM, 2 vCPU, 77 GB disk**. Jakarta migration is backlog. Mac/VPS direct RTT observed ~325 ms.
- Canonical VPS checkout `/home/ubuntu/SuperBot`, Compose project `superbot`, `compose.yaml` + `compose.override.yaml`; server `omb` (`superbot-omb-1`), proxy `caddy` (`superbot-caddy-1`) attached to the omb network namespace. Mounts include Docker CLI/socket, `/host-data`, compiled `server-dist` and `web-dist`. Preserve both Compose files and mounts.
- Desktop: labelled `openmausbot-computer`, Debian 13 (trixie), tini/supervisor, `cua` uid 1000, XFCE+Xvfb+visible Chrome, Cua local Unix socket, x11vnc/noVNC loopback. Per seat `:1`–`:3`, VNC `5900+seat`, viewer `6900+seat`; no public per-seat ports. Idle target ~15 minutes. Shared `vm-home` is `/var/lib/docker/volumes/superbot_data/_data/.openmausbot/vm-home`; preserve it and `/data`.
- Desktop layer 13: `ghcr.io/imamjabar/superbot-computer@sha256:0fb64eef735b1299cb17d29e6a6bbbe6567e434c0014ddb5b6ce039e0ccf55d1` (2026-11-07; layer 11 `eac28caa…`, layer 12 `96f7367f…`; old containers kept stopped as `openmausbot-computer.layer11-pre12` / `.layer12-pre13`). Layer 12 starts Cua with `--grant existing-profile`; layer 13 runs the XFCE session on a fixed bus (`/run/user/1000/openmausbot-bus-$seat`) that Cua also uses, so `browser_prepare` `existing_profile` attaches to the desktop's own Chrome (proven in a throwaway container: `status: ok`, `binding_route: native_cdp_window`). A VNC password is required; the image fails closed without it. Preserve cap drop/directory security. Guest root has no DAC override, so probe the seat socket as `cua`, not root. Rolling out a layer: build with `desktop-image.yml` on a branch, `docker pull` the digest, set `OMB_LOCAL_VM_IMAGE` in `compose.override.yaml`, push `main`, recreate `omb`; the updater then replaces the shared desktop when idle (it used to fail with EACCES on the workspace; fixed in `184004a`).
- Seat code: `server/local-vm-seats.ts`, `server/local-vm-seat-idle.ts`, `server/container-seats.ts`, `server/desktop-viewer-targets.ts`, `server/routes/desktop-viewer.ts`, `server/routes/upgrades.ts`.
- The shared desktop hosts all seats. VNC/CDP are loopback only; the viewer uses authenticated same-origin app WS, and Docker `exec -i -u cua`. An extra unleased seat must be `viewOnly:true` with read-only credentials.
- Electron self-host URL: `https://superbot.taile267f1.ts.net`; pairing exists. Mac `features.sharedComputers:true` enables lending. Imam still needs to enable **Share this computer**, grant folder/terminal permissions and approve a real `uname -a`.
- Phones: existing `openmausbot pair --phone android` provides QR. Full PWA/rebrand is pending.

## 4. Repository orientation

Key source:
- `server/index.ts`: large turn/host integration target for later splitting.
- `server/container-computer.ts`: Docker/Apple container image, hardening and commands.
- `server/local-vm-seats.ts`, `server/local-vm-seat-idle.ts`, `server/container-seats.ts`.
- `server/desktop-viewer-targets.ts`, `server/routes/desktop-viewer.ts`, `server/routes/upgrades.ts`.
- `server/routes/tasks.ts`, `server/routes/config.ts`, `server/routes/browser-control.ts`.
- `electron/*`, `src/components/ComputerPanel.tsx`, `LocalComputerSection.tsx`, `ChatView.tsx`, WebSocket/UI client.
- `docs/self-hosting.md`, `deploy/docker-compose.computer.md`, `server/LOCAL_VM_ARCHITECTURE.md`.

The earlier private Product Assessment is archived in Imam's migration Drive folder. It is reference material, not required to edit or run the repo.

## 5. Local development on the Mac

Repository path (note the space):

```sh
cd "/Users/imamjabar/Machine Learning/MyBot"
```

Use **Node 24** (`engines.node >=24`) and pnpm 10.33.0. Install dependencies normally so `prepare` installs the repository git hooks:

```sh
node --version                 # v24.x
corepack enable
pnpm install --frozen-lockfile
git status --short --branch
```

For focused server/seat work:

```sh
pnpm vitest run \
  server/container-seats.test.ts \
  server/local-vm-seat-idle.test.ts \
  server/routes/desktop-viewer.test.ts \
  scripts/testing/file-size-ratchet.test.ts
pnpm typecheck
```

Run narrower tests for the files actually touched, then the relevant ratchets and typecheck. The full suite is substantially heavier; local builds/tests are **Imam's call**. Prefer focused checks unless a release or broad refactor warrants more. The old “no builds/tests on Mac” rule existed only to protect the Mac when omp was operated remotely; it does not prohibit Claude Code local development.

Commit and push normally from the Mac:


```sh
git add -p
git commit
git push origin main
```

**Never use `--no-verify`**; fix hook/test failures. `rg` before edits, keep diffs focused, never weaken ratchets/auth/leases/approvals. `365cc4f` reconciled earlier growth: split functions rather than repeatedly raising limits on `server/index.ts`.

## 6. CI, deployment and rollback

GitHub Actions is authoritative for published builds:

- `.github/workflows/web.yml`: server/web changes publish `web-dist` and `server-dist` with source manifest.
- `.github/workflows/desktop-image.yml`: manually dispatch to generate the Dockerfile with `node scripts/write-desktop-dockerfile.ts` and build/push amd64 to GHCR using `GITHUB_TOKEN`. Pull by digest, pin `OMB_LOCAL_VM_IMAGE`, verify labels/hardening. Never Docker-build on the production runtime.
- `.github/workflows/desktop-mac.yml`: signed Mac installer workflow. Required for Task 10; do not produce the release DMG on the Mac.

Wait for the relevant run to succeed and confirm its source commit/artifact. `2552e4a` does not require a new desktop image because only the socket probe changed.

**Pushing `main` deploys.** A per-minute cron on the VPS runs `$HOME/SuperBot/web-pull.sh` (log `/tmp/web-pull.log`), which pulls the `web-dist`/`server-dist` branches that `web.yml` publishes for every server/web change on `main`. Land unproven server changes on a branch first; `check.yml` (manual dispatch only, to save Actions minutes: `gh workflow run check.yml --ref <branch>`) runs lint, typecheck and the focused seat/viewer tests. Known pre-existing failure on `main` since at least `20c6763`: `server/index.test.ts` "dispatches the conversation's pinned computer on the bot's own engine…" (cloud pin gets no `computer` MCP server). After the cron pulls, `superbot-web-pull-final.sh` cannot fetch (`.git/FETCH_HEAD: Permission denied`) and misreports that as "branch not found"; confirm with `docker exec superbot-omb-1 cat /app/dist-server/server-dist-manifest.json`, then force-recreate `omb` and Caddy.

**The web build is `~/SuperBot/web-dist`, mounted as `/app/dist`.** Until 2026-11-07 `compose.override.yaml` mounted `./web-dist/dist`, a nested copy left from a manual build on 2026-11-06 06:11, so no UI change after that reached the browser (server changes did). Check after a UI deploy: the `assets/index-*.js` named in `curl -s https://superbot.taile267f1.ts.net/` must match `~/SuperBot/web-dist/index.html`. The stale copy is in `~/backups/web-dist-stale-dist-20261107`; the old mount line in `compose.override.yaml.bak-before-webdist`. `web-pull.sh` on the VPS is now the repo's `deploy/superbot-web-pull.sh` (it recreates Caddy only when `omb` was replaced; old copy `web-pull.sh.bak-20261107`).

Deploy only when Imam asks, from the authorised Mac via SSH over Tailscale, using the existing updater installed on the VPS:

```sh
ssh -o ClearAllForwardings=yes -o HostKeyAlias=3.27.144.230 \
  -i ~/.ssh/superbot-syd.pem ubuntu@100.85.76.91
cd /home/ubuntu/SuperBot
sh /home/ubuntu/superbot-web-pull-final.sh
```

The updater fetches build branches and validates compiled JS. A web-only or unchanged update restarts nothing. A new `server-dist` commit force-recreates `omb` with `--no-build` (plain `up -d` with an unchanged compose config prints "Running" and keeps the old Node process on the old bundle, seen on the VPS 2026-11-07), then always force-recreates Caddy, which lives in `omb`'s network namespace. It fails, without printing "omb and caddy are up", when `omb` keeps its container id or health does not answer within 20 tries 3 s apart. Mocked test: `scripts/deploy-web-pull.test.ts`.

On the VPS:

```sh
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml"
$C ps
docker inspect superbot-omb-1 --format '{{range .Mounts}}{{println .Source .Destination}}{{end}}'
curl -fsS -w '\n%{http_code}\n' https://superbot.taile267f1.ts.net/api/health
```

Require health HTTP 200, primary viewer auth, and no secrets in logs. Do not print Local VM `commands.run` password fields. Use the repository canonical updater (`deploy/superbot-web-pull.sh`) for future changes; do not make substantial ad-hoc source edits on the VPS.

Desktop rollback, after stopping all work: back up config/Compose, remove only idle labelled `openmausbot-computer` (never volumes/workspaces/backups), restore config backup, disable/remove the computer override, `$C up -d --no-build --force-recreate omb`, recreate Caddy and verify health. Image rollback is in `deploy/docker-compose.computer.md`. No unrelated containers/volumes.

## 7. Roadmap status and next acceptance gates

Scope and priority follow [`docs/DIRECTION.md`](DIRECTION.md) (2026-11-06): personal, single-user; one desktop seat; at most 2 background jobs. New scope is frozen until the phases below are proven in order. Multi-seat code stays at capacity 1; do not extend or delete it.

History: Task 1 `76852cb`; 2/2b `c2a64b4`, `97931ab`; 3 `0eb2e6f`; 4 `3ba35a7`; 5 `f09f313`; 6 `97ee6fe`; CI/updater improvements `b72858a`, `9a344ba`, `1758667`, `2125df0`; image layers 10/11 `332dfb3`, `788cc28`, `64e7a8f`.

**Tasks 1/2/2b complete.** Debian 13, visible Chrome stable, durable workspaces, permissions, first frame, idle restart (~15 min) observed. Initial Chrome ~564 MiB was not multi-seat proof.

**Tasks 3–6 implemented, no multi-seat proof; frozen at capacity 1.** Identities `:1..:3`, leased keys, multi-display config, bounded seat startup/driver helpers, per-seat idle adapter. Two-seat lifecycle only rehearsed. Keep the code; do not extend it. Preserve no silent owner transfer.

### Phase 1 — make it usable (now)

**Task 7 minimal (single seat), incomplete.** Proven: `314e216` primary WebSocket HTTP 101 + RFB banner through Docker duplex. `35e3a58` starts a real seat before commands; `76af0e9` names failing checks; `2552e4a` probes the socket as `cua`. Proven live 2026-11-06 on deployed `2552e4a` (loopback client inside `omb`, unleased `/api/desktop-viewer/local/shared/websockify`): VNC auth `SecurityResult OK`, `ServerInit` 1280×800, a full 1,024,000-pixel framebuffer, and a pointer event read back at the sent position by `xdotool` on `:1`. Branch `phase1-single-seat-viewer`: at capacity 1 the shared desktop is exclusive only while a turn is active on it, a lease-bound join is accepted only for that turn's thread, and an exclusive target holds one established viewer until it closes (fixture-tested). Not yet proven live: lease-bound takeover during a real turn, second-viewer refusal, release closing the socket. Do not infer general supervisor failure from an earlier manual-stop orphan.

Single-seat acceptance (two-seat, read-only-key and lease-handover proofs move to Phase 4):
1. During a live bot turn on seat `:1`, the app viewer (`/api/bots/:id/local-computer/join?controlLeaseId=...`, `/api/desktop-viewer/local/shared` + `/websockify`) completes RFB security negotiation, ServerInit and a real full framebuffer. Test client uses masked-client/unmasked-server binary frames and DES VNC bit-reversed key; never print passwords/screen contents.
2. Mouse and keyboard from the leased viewer reach the desktop (e.g. typing in an Xfce terminal); a second viewer is rejected, no silent takeover.
3. Release or lease loss closes the socket within 5 seconds; a subsequent GET fails.
4. Leases come from the live route only; no direct lease/DB mutation. Stay at capacity 1 via supported start/stop/API lifecycle. Preserve workspaces/backups.
5. `365cc4f` line guard is not permission to grow monoliths; split carefully.

Scorecard to run manually and fix: #1 Reply UX, #3 Choice card, #8 Routine, #11 Safety, #17 Browser. **Imam reported all five good on 2026-11-06**, then found and confirmed fixed (deployed `73fcb90`): a choice can no longer be tapped twice (question cards and bot-built widget choices settle; the server refuses a second answer), a person's Local VM control is released 60 s after the last viewer closes, and Local VM turns answer news/weather/facts by web search or shell fetch instead of driving the desktop browser. Cua `browser_prepare` in the desktop works since layer 13.
**Phase 1 done when:** Imam watches a bot open example.com in Chrome from the app and takes over the mouse. (Observed by Imam in #17.)

### Phase 2 — feel like Grok Bot

**Task 10c simplified, implemented (awaiting Imam's scorecard).** No new framework: a bot hands long work to itself with `start_thread` `report_back: true`. That routes through the existing coordinator (`coordinateBots` → `RuntimeCoordinator.enqueue` → `server/runtime/runtime.ts` admit), which already gives a durable job (`runtime.db`, re-run after a restart), an auto-resume of the chat when the job settles (no polling), queueing at the bot's thread limit, and Stop that cancels the chat's open jobs (`stopAwaitingDirect`). The only rule changes: a person's root turn may open a job on its own bot in another thread (`ownJob`); a job cannot open another (ancestor refusal still applies below the root). The chat stays free while jobs run; follow-ups steer or queue as before. The VPS sets `threads.maxConcurrentPerBot: 2` in `config.json` for the 2-job cap. Proof: `server/direct-coordination.e2e.test.ts` "runs a report-back job on the bot itself…" and "runs two of its own jobs at once, keeps the chat answering, and Stop in the chat ends both"; `server/runtime/runtime.test.ts` own-job admit/refusal.

**Always answers, in the main chat (busy reply).** A person's plain message to a busy chat goes to the running work as before: steered into the turn when the engine can take it, else queued first in line, with person-first stopping a step that keeps it unread past 60 s. At once, a one-off small-model call (`server/host/busy-reply.ts`, side job `busy-reply`, 8 s cap) writes a one-to-three-sentence reply in that same chat: it answers a quick question outright, otherwise it says the message was passed to the work in progress (or is next in line) and that the result will come here; without a model, or past 8 s, a fixed acknowledgement is posted instead. A steered message's reply quotes it (`requestMessageId`), so desktop Talk ends on it. There is no second thread: the "Quick replies" lane (`server/side-replies.ts`) is gone. The API still honours an explicit `followUp` (`steer`, `queue`, `restart`) without the extra reply. Proof: `server/host/busy-reply.test.ts`; `server/direct-coordination.e2e.test.ts` "a message sent while the main chat works gets a short reply in the main chat within seconds…".

**Speed (measured 2026-11-06 on the VPS).** Floor through the `api.commandcode.ai` gateway is ~2 s per model call. `deepseek/deepseek-v4.1-flash` spends up to 600 reasoning tokens before any text (9.3 s for a short comparison). `deepseek/deepseek-v4-flash-fast` had no reasoning (first token ~1 s) but the gateway began refusing it (HTTP 403 `upstream_refused`) the same evening, so all three bots use `deepseek/deepseek-v4.1-flash-fast` (short answers ~2.2 s; reasoning cannot be switched off through this gateway; backup `bots.json.bak-before-fast-model`). The gateway's prefix cache works across tool rounds (24,097-token prompt → 23,936 cached on the next round). The ledger's 0% cache rate was a reporting bug: the openai-compat driver dropped `prompt_tokens_details.cached_tokens` from turn usage (fixed in `b62b532`). A 62k-token prompt adds only ~1.2 s uncached. The 5.6 s before a turn's first model call was the Local VM desktop cold-starting after its 15-minute idle stop; `localVm.idleTimeoutMinutes` is now 1440 (the idle desktop uses ~180 MB). Spawning the MCP proxies costs ~35 ms. Bot-to-bot exchanges fold into one short row (`Chief → Designer · 2`) on both sides (`src/lib/peer-exchange.ts`); the person no longer chooses steer/queue/restart.

**Front desk (`features.frontDesk`, on unless false).** Every bot's main chat is the front desk: it answers within seconds and runs without computer, browser, shell, page-read and search tools (`server/front-desk.ts` denies `mcp:computer:*`, `mcp:browser:*`, `agents vm_exec`, `agents shared_computer`, `agents web_fetch`, `agents web_search`), so it never takes the desktop or browser seat; such work goes to a `start_thread` `report_back` job, which has the tools and resumes the chat. A correction for a running job is `start_thread` with `job=<thread id>`: it steers that job (`steerOwnJob`), whose one result still comes back. While a job runs past 2, 5, 10… minutes the chat gets a "Still working on #Title · N min" line (`server/job-progress.ts`, no model call). With `frontDesk: false` the main chat does the work itself and the busy reply above keeps it answering. Test fixtures start with `features.frontDesk: false` (`launchVerificationServer`, `launchRestartableServer`, the cloud-send and own-home fixtures, and suites that write their own config and use the computer from a main chat); a front-desk test turns it on explicitly.

**One main chat (front desk on or off; branch `feat/one-main-chat`).** On a server that belongs to one person (`oneMainChatHere` in `server/index.ts`: no Cloud home, no hosted workspace, no `signIn` members and at most one admin), a person writes to a bot only in its main thread (`botMainThread`: the chosen one, else the open thread they last wrote in, else the oldest; never a report-back job). A session or desktop send, goal or edit to any other thread gets 409 `main_chat_only` with `mainThreadId` and the main chat's title in the error (`mainChatOnly` in `server/front-desk.ts`), and `POST /api/bots/:id/tasks` refuses a person any new thread (`newChatRefused`). History stays readable; card presses, a bot's own shell and internal `start_thread` still work. Desktop Talk (`electron/talk-server.mjs`) asks in MausBot's main chat (`mainThreadId`, else `threadId`), so its words and answers stay in that chat's history; while the chat is busy Talk ends on the busy reply whose `requestMessageId` is its own line. The config frame carries `oneMainChat: true` where the rule holds; the web app then hides threads, "New thread" and "New conversation" (`src/lib/one-main-chat.ts`), turns any `newTask` into opening the main chat, and opens every other thread read-only with "Back to your chat". A report-back result and its answer land once in the main chat, never in the job. Tests: `scripts/validate-chatux/box-onechat.txt`.

**Main-chat delivery state.** Each result row a job or teammate posts into the chat that asked carries `roomRequest.delivery` (`MainChatDelivery` in `shared/wire.ts`, set by `resultDelivery` in `server/result-delivery.ts`): `delivered` only for completed work with no hand-off problem, `interrupted` for a Stop or a restart cut, `failed` otherwise. A report that throws leaves `reportedAt` unset, so the runtime posts it after the next start and never earlier.

**`feat/one-main-chat` → `main` readiness.** The branch carries the one-main-chat rule (front desk on and off, desktop Talk, the "Quick replies" lane), the delivery states and the merged `fix/deploy-restart` (`82bca41`). Ledger and box evidence: `docs/plans/chatux-ledger.md`. Known failures, not caused by it: 10 in `server/steer-e2e.test.ts` and `server/cloud-send-kinds.e2e.test.ts`, already failing at `2e01905`. After the merge, the VPS cron still runs its own copy of the updater: install it once with `cp deploy/superbot-web-pull.sh $HOME/SuperBot/web-pull.sh` from the repo checkout, or the restart fix never runs.

**Front desk prompt trim (2026-11-07).** A front-desk turn drops the prompt sections that only explain tools it never holds (`FRONT_DESK_DROPPED_PARTS` in `server/front-desk.ts`: `browser`, `computer`, `shell`, `team-computer`, `plan`) and does not open the built-in browser session at all. The Chief bot's browser section alone was 4,160 bytes of a 32 KB prompt. Guarded by the front-desk test in `server/direct-coordination.e2e.test.ts` (the job keeps "Long-running shell commands"; the chat does not).

**Measured end to end with the real model (2026-11-07, disposable server on the VPS).** A throwaway `omb-probe` container (same image and server build, its own temporary data dir, real gateway, `frontDesk` on, `TZ=Asia/Jakarta`, deleted afterwards) ran one scripted chat with `deepseek/deepseek-v4.1-flash-fast`. Times are from send to the stored reply. Greeting 3.3 s; "remember I prefer short answers" 4.0 s (`memory_update`); "what time is it?" 2.8 s with no tool call (answered from the turn's clock line); a VPS research request 7.8 s to "Researching live VPS prices now…" plus `start_thread`; "what time is it now?" while the job ran 2.3 s; "also add Vultr" 4.0 s, steered into the running job (`[steered]` row in the job thread). The job ran 386 s (48 model steps, 93 browser tool calls), the chat got "Still working… · 2 min" and "· 5 min", then exactly one result (a 3-row table with Vultr included) 5 s after the job settled. Prompt cache: 2,887,340 input tokens, 2,758,016 cached = **95.5%** (job 97%; chat turns 86–99% once warm; the first turn and the turn after a memory change are cold because memory sits in the system prompt). Fixed from this run: the research and steer turns each wrote a second acknowledgement after the tool result, so the tool results now say to end without more text, and the openai-compat driver ends a turn cleanly when its final round is empty after it already spoke (it used to fail "empty response" or show reasoning as the reply).

**Model: `deepseek/deepseek-v4.1-flash` (Imam's decision, 2026-11-07). Never use `deepseek-v4.1-flash-ultrafast`: it costs too much.** Command Code list prices per 1M tokens (input / output / cache read): v4.1-flash $0.15 / $0.60 / $0.003, v4.1-flash-fast $0.16 / $0.58 / $0.016, v4-flash-fast $0.28 / $0.56 / $0.07, glm-5.3-flash $0.15 / $0.50 / $0.03, minimax-m3.1-flash $0.15 / $0.60 / $0.01, v4.1-flash-ultrafast $2.40 / $9.60 / $0.048 (about 10× flash-fast per research job). Command Code has no `deepseek-v4.1-flash-1017` model ID (400 "not supported"); `deepseek/deepseek-v4.1-flash` ("latest") is its plain V4.1 Flash. Gateway time to first text (two short calls each): v4.1-flash-ultrafast 0.78–0.83 s, v4-flash-fast 0.63–1.08 s, v4.1-flash-fast 1.10–1.96 s, glm-5.3-flash 1.08–1.30 s, GLM-5.2-Fast 1.16–1.36 s, minimax-m3.1-flash 1.37–1.51 s, glm-5.3-flashx 3.0–3.4 s. Most of the chat speed-up does not depend on the model: a response with text whose only calls are `start_thread` ends the turn without another model round (`HANDOFF_TOOL` in `server/drivers/openai-chat.ts`), which took the research acknowledgement from 7.8 s to about 2.5 s.

**Task 10b — one chat per bot, implemented as a display default.** Threads are hidden unless the device stored "Show threads" on (`src/lib/thread-preferences.ts`); a bot row opens its main thread (`botOpensTo` → `mainThreadId`). Nothing is migrated or deleted, so history is lossless; Settings → Show threads brings every thread back. Job threads stay rows under the bot when threads are shown.

**Main chat and jobs (branch `ux/main-chat-progress`, 2026-11-07, CI-only proof).** With threads hidden a bot row always opens the main chat; Simple mode has no "New thread"; the main chat is never a report-back job (`mainThreadTasks`). A job thread opens read-only (no composer, edit, retry or regenerate; `src/lib/job-threads.ts`). In simple mode the main chat drops the bot's own job rows ("Chief → Chief · 3", sent/back-with-results, still-working notes) unless one failed; the job line under the bubble (`JobPresence`, `src/lib/job-status.ts`) names the live step from runtime frames ("Reading kompas.com", "Waiting for web_fetch", "Reviewing kompas.com", "Writing the answer") and has open and stop controls. An answer quotes its request only when it arrives after a newer message, once. Speed: front-desk turns no longer claim a computer or VM seat, and front-desk turns hold no job slot (with `features.frontDesk`); the runtime's dispatch gate now passes the thread like `startTurn`, so a main chat's resume never waits behind jobs. Earlier news/prices are snapshots (front-desk and recent-work prompts). The server logs `[omb-timing] ack|job-start|tool|job-done|delivered ms=…` lines (`server/timing-marks.ts`). The resume turn that relays a job's result is kept: removing it would change the runtime's report/wake model.

**Tool routing (Package 2, on `main` since `e9cddd6`, box GREEN at `ca1bd96`).** Order for web work: a connected app, then `web_search` (unknown address) or `web_fetch` (a public page, news or a feed), then the built-in browser, then the one desktop seat. Both are in every conversation and denied only to the front desk, which hands them to a job. `web_search` runs through the Command Code gateway with the existing `OPENAI_COMPAT_API_KEY` (`POST https://api.commandcode.ai/alpha/web-search`, an undocumented `/alpha/` route the Command Code CLI uses; `server/routes/web-search.ts`) and is mounted only while the workspace OpenAI-compatible URL is Command Code with a key. `web_fetch` answers `needsBrowser` (`sign-in` or `script`) with the browser as the next step for a 401/403/407, a redirect to a sign-in path, a short page with a password field, or a script-only page (`browserNeed` in `server/routes/web-fetch.ts`). On an API-model turn, once a connected app answered, the built-in browser calls of the next round are not run and say why; a later round runs them (`redundantBrowserCall` in `server/drivers/chat-mcp-tools.ts`). A report-back job's thread records its logical job id (`openedBy.delegationId`, the coordinator assignment id), kept across steers and restarts and separate from `requestMessageId`. Known pre-existing failures: `server/parallel-threads.e2e.test.ts` fixture flakes; `server/cloud-send-move.e2e.test.ts` skips without the composio-broker harness. Ledger: `docs/plans/chatux-ledger.md`; box list `scripts/validate-chatux/box-tools.txt`.

**Package 3 (branch `feat/package-3`, on `e9cddd6`): blocked, no code yet.** Items B7, B8, C1, C2, C4–C8, C11, G1 and S1 are named in the brief without their content; see the ledger.

**Phase 2 done when:** scorecard #2 Long work, #6 Local job and #19 Parallel (2 jobs) pass.

### Phase 3 — phone

**Task 10 reduced to PWA.** Installable responsive web app over Tailscale; keep auth and device pairing. Skip DMG signing unless the Electron app needs it. **Done when:** scorecard #4 Phone passes.

**Push notifications (implemented 2026-11-07).** `public/sw.js` is a service worker with no fetch handler and no cache (every load stays fresh after a deploy). It shows notifications for the page where the `Notification` constructor is missing (Android Chrome, iOS home-screen apps) and receives Web Push. The server (`server/web-push.ts`, RFC 8291 aes128gcm + RFC 8292 VAPID, no dependency; test against the RFC 8291 example) keeps its VAPID key and the subscribed devices in `web-push.json` (mode 0600) and pushes every `notify` frame (`broadcast` → `webPush.notifyFrame`) to each device; a 404/410 from the push service drops that device. Endpoints are accepted only on the browsers' push services over https (`pushEndpointAllowed`). Routes: `GET /api/push/key`, `POST|DELETE /api/push/subscriptions` (admin scope). The client subscribes when notifications are allowed and switched on in Settings (`src/lib/web-push.ts`); a tap opens the bot's thread (`?open-bot=&open-thread=`, `src/hooks/use-notification-open.ts`). On iPhone, push works only from the home-screen app (Safari → Share → Add to Home Screen, iOS 16.4+), after allowing notifications there. Off on Team Clouds.

**Time zone.** The VPS `compose.override.yaml` sets `TZ: Asia/Jakarta` for `omb` (backup `compose.override.yaml.bak-before-tz`), so the turn clock line, routine schedules and run titles use Imam's time; before, they were UTC.

### Phase 4 — Imam's picks (2026-11-07)

Wanted:
- **Task 8 login sharing: done (2026-11-07)** as a shared browser profile rather than a snapshot broker: bots on the same named `browserProfile` share cookies, and a login saved from one bot's sign-in card fills for every bot on that profile (`loginBotsFor` in `server/bot-logins.ts`; `server/saved-login.e2e.test.ts`). Live: all three bots use profile `shared`. Scorecard #12 and #13 pass.
- **Rebrand 0.2.0: done (2026-11-07).** SuperBot name and icon across the app, installer and prompts; MausBot Cloud upsells and the updates opt-in removed; the language picker offers English and Bahasa Indonesia (`src/locales/id.json`, 7,494 keys, full). The ad-hoc signed (free, unnotarized) `SuperBot-0.2.0-arm64.dmg` is on the GitHub release `v0.2.0` from `desktop-mac.yml`; first open needs right-click → Open. Not yet installed and run on the Mac. `web.yml` does not type-check test files, so a test-file type error deploys fine: after type-touching changes run `gh workflow run check.yml --ref main` (Ubuntu, `pnpm typecheck` covers tests). `desktop-mac.yml` is for a new DMG only: it stops after checkout when the version in `package.json` already has a release.
- Mac sharing tests #5/#7: Share this computer + approved `uname -a` returning Darwin arm64 from the proper host. Never fake it.

Not wanted: a second desktop seat (needs a 4 vCPU / 16 GB VPS) and the Jakarta VPS move. Imam also dropped the EC2 IAM role / IMDSv2 check.

## 8. GitHub connectivity on the Mac

GitHub over HTTPS worked from the Mac on 2026-11-06 (`gh` authenticated, `git fetch origin` succeeded). If it fails again, first try:

```sh
cd "/Users/imamjabar/Machine Learning/MyBot"
git fetch origin
git status --short --branch
git pull --ff-only origin main
```

If GitHub is unreachable, check the Wi-Fi/router/firewall and local DNS, disable/reconfigure a VPN or Tailscale exit node only with Imam's approval, test another trusted network/hotspot, and try `ssh -T git@github.com` if SSH remotes/keys are already configured. Do not bypass credentials or install an unknown proxy. Compare commits, not assumptions: `git rev-parse main origin/main`.

Fallback via USB/another trusted machine: create a small incremental bundle on the source machine at current published main:

```sh
# On the machine that has the desired published main:
git fetch origin main
git bundle create superbot-update.bundle origin/main --not 551db4e
```

Then on the Mac (adjust USB path):

```sh
git fetch /Volumes/USB/superbot-update.bundle \
  refs/remotes/origin/main:refs/remotes/origin/main
git merge --ff-only origin/main   # only when local main is an ancestor
```

Never force/reset published main. Full-history bundles are unnecessary.

## 9. Live clean state at development stop

- OMB healthy, Caddy running, layer 11 primary running, no new public listener.
- Capacity 1 through normal `/api/config` `PATCH {"localVm":{"seats":1}}`; `busy:[]`, `running:[1]`. Primary remains; rehearsal processes/turns stopped.
- Final runtime development commit before this documentation was `2552e4a`. Primary 101/RFB banner is the only proved application VNC fact; no claim of RFB authentication/full frame.
- Reports of success must name proof. Processes alone are not viewer readiness; two prompts are not a durable orchestrator.
- Any remaining Grok Bot routines/watchers may still exist only as migration leftovers; they are not required for development, CI or deployment. Claude should use normal Git/GitHub status and explicit checks instead.

## 10. Security / backlog / commonly forgotten rules

- Never commit tokens/secrets/cookies/pair links/private keys to this public repo or logs. Do not add `.git/omp-prompts`, `~/.ssh/superbot-syd.pem`, live VNC passwords or test cookies.
- Docker socket is VPS-root-equivalent. Do not expose it or delete volumes/backups during cleanup. No public ports, DNS, purchase/spend or Jakarta move without Imam's explicit yes.
- Use the exact SSH key over Tailscale only; never disclose it. Public CI/image artifacts carry no source secrets.
- Preserve omb+Caddy network relation. No broad ad-hoc VPS source edits.
- Mac terminal grant remains unresolved until an actual successful approval.
- Avoid reproducing `vncPassword` through API `commands.run` output; redact and later narrow the status response.
- Accepted risk (single user): one shared Unix uid and the Docker socket in `omb` are not a sandbox. No gVisor/Kata, egress proxy or per-bot sandbox. Cheap safeguards: keep "Ask" approvals for shell/deletes; no main email/banking login in bot Chrome; back up `/data` and `vm-home` before every deploy.
- Backlog: see §7 Phase 4. No expense without yes.

## 11. Exact quality scorecard


All statuses at the original assessment: **Not run yet**. PASS requires observed app behavior, not code presence. **Parity (revised 2026-11-06, `docs/DIRECTION.md`):** the five behaviours work (instant reply, background work that posts on completion, one chat per bot, watch/take over the browser desktop, works from phone) **and** tests #1, #2, #3, #4, #6, #8, #11, #17, #19 pass on observed behaviour. The rest are backlog.

| # | Area | Test / pass criteria | Feature | Status |
|---|---|---|---|---|
| 1 | Reply UX | Answer immediately/short and in user's language | turn route, flash | Not run |
| 2 | Long work | immediate ack + progress before outcome | stream notices/orchestrator | Not run |
| 3 | Choice card | tap continues turn | ask-user approval card | Not run |
| 4 | Phone | 5-column 3-VPS comparison readable, no forced horizontal scroll | PWA pending | Not run |
| 5 | Mac | approved `uname -a`, Darwin arm64 | shared computers | Not run |
| 6 | Local job | durable active job; app wakes proactively | orchestrator pending | Not run |
| 7 | Mac SSH | approval if Ask; hostname returned | Mac run_command | Not run |
| 8 | Routine | 5-minute water reminder delivered in UI | routines | Not run |
| 9 | Events | GitHub main push invokes chat report | webhooks/routine check | **Code ready & tested (2026-11-07)**: routine check `github` reads repo commits without AI turn until head changes, then triggers report (`routine-checks.test.ts` passes); live test awaits GitHub connection in Apps. |
| 10 | Send | draft email; no delivery before authorisation | DraftCard / read-and-draft | **Code ready & tested (2026-11-07)**: `gmail-draft-policy.test.ts` & `read-and-draft.test.ts` pass; drafts email to draft folder, outbound guard blocks send without approval; live test awaits Gmail connection in Apps. |
| 11 | Safety | deletion blocked unless authorised | Ask grants | Not run |
| 12 | Vault | fake-site login saves/fills, password never in chat | vault/fill + Task 8 | **PASS (2026-11-07)**: saved from Bot A sign-in card, filled by Bot B via shared browser profile `shared`, origin check passes, password never in chat (`server/saved-login.e2e.test.ts` passes; live shared profile configured on VPS) |
| 13 | Memory | A remembers flat white, B knows next day | shared short memory | **PASS (2026-11-07)**: Bot A ("every morning I drink a flat white with oat milk") writes to About me (`prefer` action); Bot B answers "Flat white with oat milk" immediately without waiting a day (proven in isolated real-model probe on VPS) |
| 14 | Skills | `vps status` returns authorised hostname/uptime | skill authoring | Not run |
| 15 | Bots | creates Scout; Scout replies with model identity | coordinator/packages | Not run |
| 16 | MCP | GitHub card auth + issue listing, no token in chat | MCP/Composio | Not run |
| 17 | Browser | visible example.com screenshot; test session persists | Chrome/Cua Task 7 | Not run |
| 18 | Report | short shareable actual-content parity report | Phase D | Not run |
| 19 | Parallel | two jobs + responsive chat + stop works | Tasks 7/10c | Not run |
| 20 | Usage | flash fleet/cost; routines pause at low cap | ledger/soft-stop | Not run |

Gate order: Phase 1 → #1, #3, #8, #11, #17; Phase 2 → #2, #6, #19; Phase 3 → #4; Phase 4/backlog → #5, #7, #9, #10, #12–#16, #18, #20. Source artifacts and a blank scorecard are not evidence.
