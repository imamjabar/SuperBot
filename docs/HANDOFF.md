# SuperBot handoff (2026-11-06, Asia/Jakarta)

Read this before making changes. This is the operational and technical handoff, containing no credentials. The repository is **public**. Imam is continuing product development in Claude; do not assume any uncommitted design or live test is complete. Stop and ask Imam before changing external infrastructure or spending.

## 1. Product goal and principles

SuperBot (fork of OpenMausBot) should behave like Grok Bot while staying self-hosted, cheap, approval-backed, and connected to Imam's Mac and phone:

1. Run on a VPS using existing authorised AI APIs/subscriptions; a Mac is a client, not a prerequisite compute node.
2. **One shared computer, one visible desktop per active bot**: shared Linux files and tools, separate leased visible Chrome/XFCE/Cua seats, not one container per bot. Headless is fallback only; real Google Chrome stable is required.
3. **Independent bot identity**: each bot keeps private memory, skills, routines, approvals and credentials/scopes; do not read or copy another bot's live cookies.
4. **One canonical chat per bot** (2026-11-06 confirmed Task 10b): no parallel legacy thread list in the final UI; migration must be lossless.
5. **Orchestrator, not long inline turns** (Task 10c): immediate response/ack; long work as durable background jobs; exactly one worker per workstream; follow-ups resume it; only the canonical bot speaks to Imam; completion events wake it (not polling); per-bot todos delivered after actual work; steer/running cancellation and stop-all; 2–4 concurrent jobs; routines/event watchers are external and wake chat.
6. Bots can create/coordinate other bots. Reuse existing rooms, bot packages and coordinator. No unbounded agents or hidden work.
7. Each device creates one outbound connection to the VPS; no inbound Mac daemon or public VNC/CDP. The Electron app already does this—do not recreate a superbot-agent WebSocket daemon.
8. Preserve security boundaries: approvals, admin same-origin authorization, exclusive leases, read-only viewing, secret redaction, permissions. Never introduce unauthenticated debug endpoints or direct DB/session/lease edits as a workaround.

## 2. Confirmed scope / capability map

Confirmed goal: mimic Grok Bot: shared VPS, bots with per-bot visible computers, connect to Imam's Mac, bots create bots, private skills/memory/routines, phone + desktop + server unified.

- **Keep/ENABLE**: Mac pairing (`electron/`, `server/shared-computers.ts`); approvals (`ApprovalCard.tsx`, `PendingApproval.tsx`, `shared/approval-mode.ts`); safety egress (`shared/outbound.ts`, `server/safety-floor-gate.ts`); vault request/fill login (`SecretRequestCard.tsx`, `secret-vault.ts`, `login-fill.ts`); routines/webhooks (`routines.ts`, `routine-request.ts`, `app-events.ts`); per-bot memory (`memory-store.ts`, `memory-journal.ts`); skills (`skill-library.ts`, `skill-request-card.ts`); usage/cost (`usage-ledger.ts`, `plan-usage.ts`); multi-bot (`chief-of-staff.ts`, `peer-*`, `bot-package.ts`); MCP/Composio and UI setup cards.
- **EXTEND**: thin approval-backed `run_command` wrapper for omp/tmux + completion wake; DraftCard over Gmail drafts/outbound; costs hard cap; shared short memory; computer-viewer lease integration. Not BUILD from scratch.
- **DO NOT BUILD now**: a separate Mac WebSocket daemon, public agent-owned mail, paid always-on desktops, meetings, commerce. No Mac login or terminal bypass.

## 3. Current architecture

- Sydney VPS: AWS m7i-flex, **8 GB RAM, 2 vCPU, 77 GB disk**; eventual Jakarta migration is backlog (not approved for this handoff). Current Mac/VPS direct RTT ~325 ms.
- Canonical VPS checkout `/home/ubuntu/SuperBot`, Compose project `superbot`, using `compose.yaml` + `compose.override.yaml`; server is `omb` (`superbot-omb-1`), web proxy is `caddy` (`superbot-caddy-1`) attached to the omb network namespace. Existing mounts include Docker CLI/socket, `/host-data` volume alias, compiled `server-dist` and `web-dist`. Do not omit these overrides.
- Desktop: one labelled `openmausbot-computer`, Debian GNU/Linux 13 (trixie), tini/supervisor, `cua` uid 1000, XFCE+Xvfb+visible Chrome, Cua over local Unix socket, x11vnc/noVNC loopback. Per-seat `:1`–`:3`, VNC `5900+seat`, viewer `6900+seat`; no per-seat public ports. Idle target about 15 min. Shared durable `vm-home` lives under `/var/lib/docker/volumes/superbot_data/_data/.openmausbot/vm-home`; preserve it and `/data`.
- Layer 11 desktop digest: `ghcr.io/imamjabar/superbot-computer@sha256:eac28caa7855766e7c628faa953640b47ccbf01621aa6dcce1db00f535a9c1a7`. VNC password exists and layer 11 fails closed on absence; do not weaken cap drop or directory security. Guest root has no DAC override, hence seat socket must be probed as `cua`, not root.
- `server/local-vm-seats.ts`: seat identity/capacity/lease. `server/local-vm-seat-idle.ts`: expiry. `server/container-seats.ts`: start/stop/status + stdin/stdout Duplex viewer relay. `server/desktop-viewer-targets.ts`: hardened container resolution. `server/routes/desktop-viewer.ts`: auth/same-origin gate, watch password/private data, exclusive leased viewer, 5-second revalidation. `server/routes/upgrades.ts`: safely staged upgrade.
- The shared desktop hosts all seats; VNC/CDP only loopback, viewer travels authenticated same-origin app WS, server connects through managed Docker `exec -i -u cua`, no public VNC. Extra unleased seat should be `viewOnly:true` and use read-only credentials. Auth and gates are not optional.
- Electron client: self-host URL is `https://superbot.taile267f1.ts.net`; pairing already exists. Mac `features.sharedComputers:true` enables lending. The human enable “Share this computer”/folder+terminal permissions and approve a real `uname -a`; this is **still pending**. No claim otherwise.
- Phones: one pairing session/native app/paired browser; planned PWA not delivered. Existing `openmausbot pair --phone android` gives QR; web app is responsive but full PWA/rebrand is pending.

## 4. Repository orientation

Key source:
`server/index.ts` (large turn/host integration target for later split);
`server/container-computer.ts` (Docker/Apple container image, hardening, commands);
`server/local-vm-seats.ts`, `server/local-vm-seat-idle.ts`, `server/container-seats.ts`;
`server/desktop-viewer-targets.ts`, `server/routes/desktop-viewer.ts`, `server/routes/upgrades.ts`;
`server/index.ts` (`/api/local-computer/instances`, turn leases, viewer resolution, computer tools);
`server/routes/tasks.ts`, `server/routes/config.ts`, `server/routes/browser-control.ts`;
`electron/*`, `src/components/ComputerPanel.tsx`, `LocalComputerSection.tsx`, `ChatView.tsx`, WebSocket/UI client.
`docs/self-hosting.md`, `deploy/docker-compose.computer.md`, `server/LOCAL_VM_ARCHITECTURE.md`.

The architecture Page is **SuperBot Product Assessment**:
`https://cursor.com/canvas/store-9799c84c-aa33-49eb-bd18-935bbd2b2965/226420f7-8914-43ea-87b1-484528f44bf8`

## 5. Builds, tests, deployment, and rollback

Do **not** build or heavyweight-test on the Mac or VPS. Prior workflow was only omp inside Mac tmux `superbot-omp` at `/Users/imamjabar/Machine Learning/MyBot`, commits locally, then box tested/published. Imam may instead develop with Claude directly now. Treat the repository, tests, approvals and public disclosure seriously. `rg` before edits; small focused diffs; run tests locally/CI; never use `--no-verify`, never weaken ratchets. Box uses Node 22 whereas requested engine is >=24; use Node 24 for reliability and GHA uses 24.

Desktop image: `gh workflow run desktop-image.yml`, generates Dockerfile via `node scripts/write-desktop-dockerfile.ts`, builds/pushes amd64 to GHCR using `GITHUB_TOKEN`. Pull by digest, pin `OMB_LOCAL_VM_IMAGE`, verify labels and hardening. No Docker build production runtime. Current source 2552e4a does **not** require a new desktop image because only socket probe changed.

Web build: `.github/workflows/web.yml` on server/web changes publishes `web-dist` and `server-dist` with a source manifest. Wait for status/success and server artifact, not just push. CI run for `2552e4a` = 42199009640 (successful); run for `76af0e9` = 42198248290.

On box:
```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm vitest run server/container-seats.test.ts server/local-vm-seat-idle.test.ts   server/routes/desktop-viewer.test.ts scripts/testing/file-size-ratchet.test.ts
pnpm typecheck
```
Focused new head had 53 tests passed + typecheck + pre-push; earlier broad focused 58 passed. Full suite not run for final commits. Scripts file count guard is enforced. `365cc4f` reconciled actual Task1–7 growth; prefer split/moving functions, not repeated raising `index.ts`.

On VPS:
```sh
sh /home/ubuntu/superbot-web-pull-final.sh
# normal path; it fetches build branches, validates compiled JS, up -d --no-deps --no-build omb
```
The updater uses canonical 2 file Compose configuration. It preserves the machine except server bundles and handles Caddy: if omb is replaced, Caddy must **immediately** `up -d --no-deps --no-build --force-recreate caddy`; if not, reload Caddy. It fails JS syntax/self-check and health. Note direct modifications to same checked-out bundle need process activation; `up -d` alone may say Running without recreating. Then explicitly force recreate OMB and Caddy. Require `curl -fsS -w '\n%{http_code}\n' https://superbot.taile267f1.ts.net/api/health` 200, primary viewer auth, no secrets in command logs. Do not reproduce Local VM status `commands.run` plaintext password fields in logs.

VPS SSH from authorized Mac (no secret values here):
```sh
ssh -o ClearAllForwardings=yes -o HostKeyAlias=3.27.144.230   -i ~/.ssh/superbot-syd.pem ubuntu@100.85.76.91
```
Canonical C is:
```sh
C="docker compose -p superbot -f compose.yaml -f compose.override.yaml"
$C ps
docker inspect superbot-omb-1 --format '{{range .Mounts}}{{println .Source .Destination}}{{end}}'
```
Desktop rollback, only after stopping all work: backup config and Compose files; remove **only** labelled `openmausbot-computer` when idle (no volume/workspace/backups deletion); restore config backup, disable/remove computer override, then `$C up -d --no-build --force-recreate omb` and caddy; check health. Image rollback documented in `deploy/docker-compose.computer.md`. Never remove unrelated containers/volumes. Never deploy public DNS/spend without Imam explicit yes.

## 6. Roadmap status and next acceptance gates

History: 1 `76852cb`; 2/2b `c2a64b4`, `97931ab`; 3 `0eb2e6f`; 4 `3ba35a7`; 5 `f09f313`; 6 `97ee6fe`; deploy CI/updater improvements `b72858a`, `9a344ba`, `1758667`, `2125df0`; live Chrome layer verification; image layers 10/11 `332dfb3`, `788cc28`, `64e7a8f`.

**Phase A/B (1,2,2b) complete.** Debian 13, visible Chrome stable, durable workspaces, rights, first visible frame, idle restart (15 min) observed. Initial Chrome measurement ~564MiB was not multi-seat safety proof.

**Tasks 3–6 implemented, no final multi-seat proof.** Identities `:1..:3`, leased keys, multi-display config, bounded seat startup/driver helper settings. Per-seat idle adapter committed; actual safe/cold two-seat lifecycle only rehearsal, no full UI gate scorecard. Preserve no silent owner transfer.

**Task 7 incomplete.** Primary transport `314e216` WebSocket app HTTP 101 + RFB banner proven through Docker duplex. Extra seat first command `35e3a58` ensures actual seat starts *before* command and preserves gate: cold real two bot turns got both displays and driver processes. `76af0e9` named failing checks; `2552e4a` corrects guest root EACCES pseudo-absence by checking socket as `cua`. It has tests/types/CI but full two-seat RFB/input/renew/release/TTL not proved. Handoff captured at capacity 1, no busy seats, test seat removed via supported `containerStopSeatArgs` equivalent (bounded wait/reread/update necessary). Earlier manual stop created orphan children; did not recover with raw lifecycle. Do not infer general supervisor failure.

Final required retries:
1. With proper cold active two turns, verify JSON primary 200/control and secondary 200 with `viewOnly:true`; app-only RFB101 leads to successful security mode, ServerInit and actual full framebuffer. Use test client `Masked-client, unmasked-server binary frames`, DES VNC bit-reversed password key; do not print passwords or screen contents.
2. Real xterm/Xfce terminal test on `:1` vs `:2`: unleased read-only key no effect; current matching current UI lease accepts effect; second viewer rejection/no silent takeover; `check/renew` retains; release or lease loss 5 secs closes actual socket; subsequent GET fails; display/socket differ, no unrelated command execution.
3. App viewer endpoints: `/api/desktop-viewer/local/shared` and `/api/desktop-viewer/local/shared-seat-2` (+`/websockify`). Generic shared viewer + `botId/controlLeaseId` deliberately rejects; UI `/api/bots/:id/local-computer/join?controlLeaseId=...` during actual live same turn whose target matches. If using tests, leases/direction target must be current live Local VM worked route, no direct lease/database mutation.
4. Cleanup to capacity1 via supported API/existing seat start/stop lifecycle; do not use raw stop and configuration races. Preserve backups/workspaces.
5. `365cc4f` lines guard not an excuse to grow monoliths; split with care.

**Task 8 pending—login broker.** Build `computer-login-broker.ts` + atomic versioned snapshots, exclusive login writes, reuse vault and permission gates. Prove botB inherits authenticated test-site state from botA; no live SQLite cookie copy; no known dangerous live credentials. Scorecard #12 two bots.

**Task 9 pending—resource policy.** Initial capacity1; hard max3. Require active Chrome seat PSS/docker stats about 600MiB–1GB each and >=1.5GB reserve for omb+caddy+OS; multi-seat workload sustained. Idle snapshot insufficient. Reject/queue instead of OOM; UI machine/seat visibility. Do not pretend Task9 before raw current 2-seat tools worked.

**Task 10 pending—client/PWA/rebrand 0.2.0/DMG.** `OMB_CLIENT_ONLY=1` sharing kept; paired Mac no local server; responsive PWA and command support; SuperBot package/product identity version 0.2.0; pinned signed .dmg release asset built GHA not Mac. Preserve necessary auth. Remove “Get MausBot updates?” newsletter popup/email opt-ins/Cloud nudges; do not remove required device pairing. No release/spend/DNS unless explicit yes.

**Task 10b pending—one canonical chat.** Mapping existing bot threads -> canonical, safely archived history not dropped; transaction/replay/rollback before UI cutover. Seat identity bot/chat persistent; bot list becomes chat list; shared files/approvals retained. Add migration tests and visible resumed context.

**Task 10c pending—durable orchestrator.** Registry + durable queue job ids/status/transitions, bounded independent transcripts; events wake canonical chat; tiny fast chat model, at most 2–4 jobs; jobs for browser need seat leases. 2 actual jobs distinct displays sustained, all completed / canceled and resource release. StopAll only current bot jobs/leasing (not dangerous operator kill). Reuse queues/routines/stop, logs no secrets. Demo immediate ack, followup maps to old job, completion delivered on reconnect.

Mac acceptance pending: `Share this computer` grant, then actual approved `uname -a` returns Darwin arm64 and command arrives from proper host. User needs approval locally; never fake it. Mac `curl https://github.com:443` timeout while no proxy; GIthub sync proven via bundle allocation below.

## 7. Mac bundle transport (GitHub blocked)

Mac has local repo path (with space): `/Users/imamjabar/Machine Learning/MyBot`. Box: `/workspace/SuperBot`. CopyToBox rejects `/tmp`; `/Users/imamjabar/agent-tools/superbot-sync/` works. Up to 100MiB; do tiny bundles. Old full history 154.8MiB too big. Old `origin/main` stale is normal.

From Mac after commit:
```sh
git bundle create /Users/imamjabar/agent-tools/superbot-sync/NAME.bundle origin/main..main
# CopyToBox NAME.bundle to /workspace/NAME.bundle
```
On box:
```sh
cd /workspace/SuperBot
git fetch /workspace/NAME.bundle main:refs/remotes/bundle/main
git merge-base --is-ancestor origin/main bundle/main
git merge --ff-only bundle/main
# tests normal hooks must pass
git push origin main
git bundle create /workspace/origin-NEXT.bundle refs/remotes/origin/main --not OLD_SHA
# CopyFromBox -> Mac agent-tools/superbot-sync
```
Mac updates remote tracking ref only:
```sh
git fetch /Users/imamjabar/agent-tools/superbot-sync/origin-NEXT.bundle   refs/remotes/origin/main:refs/remotes/origin/main
git merge --ff-only origin/main  # only if local main is genuinely ancestor
```
Never force/reset Mac published main. Do not generate full bundles each time. Do not claim tracking == commit without `git rev-parse main origin/main` and box remote comparison.

## 8. Live clean state at development stop

- OMB healthy, Caddy running, layer11 primary running, no public listener created.
- Capacity1 through normal `/api/config` `PATCH {"localVm":{"seats":1}}`; `busy:[]`, `running:[1]` reported. Extra test supervisor programs removed, primary remains. No persistent sleep/process/turn of rehearsal remains; no secrets included.
- Final development before this docs was `2552e4a` (`local-vm: check a seat's Cua socket as cua...`). Primary 101/RFB banner is the *only* working application VNC fact currently proved. Earlier malformed Python `Ws` using [2] raised, later auth challenge became guard invalid; don't claim auth/full frame.
- Important editorial rule: reports of “success” must name proof. 101 alone != RFB authentication/full frame. Processes alone != full viewer readiness. Two app prompts != durable orchestrator.
- Mac origin is stale (314e216 until returned bundle), not deployment. Compare `origin/main` after sync. Bundles in `/Users/imamjabar/agent-tools/superbot-sync/` and `/workspace/` are ignored transport artifacts, not source changes.

## 9. Security/backlog / commonly forgotten rules

- Never commit tokens/secrets/session cookies/pair links/private key contents to public git/page/log. `docs/HANDOFF.md` contains only paths/pseudocode; good intentionally. Do not include `.git/omp-prompts`, `~/.ssh/superbot-syd.pem`, live VNC password, test cookie or sensitive CRUD commands.
- Docker socket = VPS-root-equivalent; Compose override approved previously. Do not make it public; do not include volumes/backup deletion in cleanup. No public port, DNS, purchase, spend or Jakarta move without current Imam explicit yes.
- Exact SSH key usage / tailnet only; never disclose credential. Public image download and CI no secrets source.
- Preserve OMB + caddy network relations. `sh superbot-web-pull.sh --no-deps` supported argument may improve Caddy logic later, canonical `superbot-web-pull-final.sh` downloaded exact published script; use repository canonical, no accidental ad-hoc substantial source edits on VPS.
- `Mac uname -a` Share terminal grant unresolved. Past “approval” UI issue never succeeded. Actual Share this computer will request permission.
- Existing local `vncPassword` logging through API commands `run` output may expose secret; avoid reproducing and redact output, later narrow status response.
- Security latent issue: one shared UNIX uid does not make strong sandbox boundary; untrusted arbitrary bot commands can access machine resources, plan later strong isolation.
- Backlog: rebrand, MausBot newsletter prompt remove, versioned pinned Mac .dmg 0.2.0, PWA/permission claims, Jakarta VPS move (research first) -> no expenses unless yes.

## 10. Exact quality scorecard from Product Assessment

All statuses at Page import: **Not run yet**. PASS = requested behavior verified in real app, not code presence; partial = friction; fail = broken. Parity requires all P0 tests 5,6,7,8,10,11,12,20 pass and >=90% of all 20. Do not award full parity on merely implemented code.

| # | Area | Test / pass criteria | Feature | Status |
|---|---|---|---|---|
| 1 | Reply UX | Answer immediately/short and in user's language | turn-route, flash | Not run |
| 2 | Long work ack+mid-progress update | immediate ack, progress before outcome | stream notices / orchestrator pending | Not run |
| 3 | Choice card | question card/tap continues turn | ask_user approval card | Not run |
| 4 | Phone | 5-column 3 VPS comparison readable, stacks/no forced h scroll | PWA pending | Not run |
| 5 | Mac | approved `uname -a`, Darwin arm64 | shared computers; sharing pending | Not run |
| 6 | Local job | tmux omp active; app wakes proactively | thin helper incomplete | Not run |
| 7 | Mac SSH | approval if Ask; hostname returned | Mac run_command | Not run |
| 8 | Routine | five-minute water reminder UI and delivered ping | routines | Not run |
| 9 | Events | GitHub main push invokes chat change report | webhook/app-events | Not run |
| 10 | Send | draft email; no delivery before authorize | DraftCard pending | Not run |
| 11 | Safety | deletion test blocked unless authorized | Ask grants | Not run |
| 12 | Vault | fake site login saves/fills, no password in chat | vault/fill_login; Task8 gate | Not run |
| 13 | Memory | A remembers flat white, B next day knows | shared short memory | Not run |
| 14 | Skills | `vps status` -> authorized ssh hostname+uptime reuse | skill authoring | Not run |
| 15 | Bots | creates Scout and Scout replies model identity in thread | coordinator/bot packages | Not run |
| 16 | MCP | GitHub card authenticates/list issues no token in chat | MCP/Composio | Not run |
| 17 | Browser | visible example.com screenshot + test-site session persists | Chrome/Cua Task7 gate | Not run |
| 18 | Report | short shareable parity report actual content | Pages Phase D | Not run |
| 19 | Parallel | two background jobs + chat responsive + stop works | Tasks 7/10c gate | Not run |
| 20 | Usage | flash fleet/cost, routines pause at low cap | ledger and soft-stop pending | Not run |

Real next phase-gate tasks: #5,#7,#11 once Mac terminal grant; #12/#17 after desktop+broker; #15/#19 after seats+orchestrator; #4/#18 at PWA/phaseD, then rest full real round. Source code artifact and blank live scorecard are not evidence.
