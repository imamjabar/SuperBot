# SuperBot handoff — Claude Code on Imam's Mac (2026-11-06, Asia/Jakarta)

Read this before making changes. This document has no credentials. The repository is **public**. Imam is continuing development with **Claude Code on his local MacBook**; Grok Bot, its remote development box, omp-via-Grok prompting, and Grok routines/watchers are not part of the workflow. Do not assume a design or test is complete without the proof named below. Stop and ask Imam before changing external infrastructure, releasing, exposing services, or spending.

## 1. Product goal and principles

SuperBot (fork of OpenMausBot) should behave like Grok Bot while staying self-hosted, cheap, approval-backed, and connected to Imam's Mac and phone:

1. Run on a VPS using existing authorised AI APIs/subscriptions; a Mac is a client, not prerequisite compute.
2. **One shared computer, one visible desktop per active bot**: shared Linux files/tools and separate leased visible Chrome/XFCE/Cua seats, not a container per bot. Headless is fallback only; Chrome stable is required.
3. **Independent bot identity**: private memory, skills, routines, approvals and credentials/scopes. Do not read or copy another bot's live cookies.
4. **One canonical chat per bot** (Task 10b): no parallel legacy thread list in the final UI; migration must be lossless.
5. **Orchestrator, not long inline turns** (Task 10c): immediate reply/ack; durable background jobs; one worker per workstream; follow-ups resume it; only the canonical bot speaks to Imam; completion events wake chat rather than polling; per-bot visible todos after actual work; steering and stop-all; 2–4 concurrent jobs; routines/event watchers wake chat.
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
- Desktop layer 11: `ghcr.io/imamjabar/superbot-computer@sha256:eac28caa7855766e7c628faa953640b47ccbf01621aa6dcce1db00f535a9c1a7`. A VNC password is required; layer 11 fails closed without it. Preserve cap drop/directory security. Guest root has no DAC override, so probe the seat socket as `cua`, not root.
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

Deploy only when Imam asks, from the authorised Mac via SSH over Tailscale, using the existing updater installed on the VPS:

```sh
ssh -o ClearAllForwardings=yes -o HostKeyAlias=3.27.144.230 \
  -i ~/.ssh/superbot-syd.pem ubuntu@100.85.76.91
cd /home/ubuntu/SuperBot
sh /home/ubuntu/superbot-web-pull-final.sh
```

The updater fetches build branches, validates compiled JS and recreates `omb` with `--no-build`. It preserves the machine and handles Caddy. If `omb` is replaced, Caddy must immediately be recreated with `up -d --no-deps --no-build --force-recreate caddy`; otherwise reload Caddy. Explicit recreation matters: `up -d` alone may report Running without activating a modified mount.

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

History: Task 1 `76852cb`; 2/2b `c2a64b4`, `97931ab`; 3 `0eb2e6f`; 4 `3ba35a7`; 5 `f09f313`; 6 `97ee6fe`; CI/updater improvements `b72858a`, `9a344ba`, `1758667`, `2125df0`; image layers 10/11 `332dfb3`, `788cc28`, `64e7a8f`.

**Tasks 1/2/2b complete.** Debian 13, visible Chrome stable, durable workspaces, permissions, first frame, idle restart (~15 min) observed. Initial Chrome ~564 MiB was not multi-seat proof.

**Tasks 3–6 implemented, final multi-seat proof missing.** Identities `:1..:3`, leased keys, multi-display config, bounded seat startup/driver helpers, per-seat idle adapter. Safe/cold two-seat lifecycle only rehearsed; no full UI gate. Preserve no silent owner transfer.

**Task 7 incomplete.** `314e216` proved primary WebSocket HTTP 101 + RFB banner through Docker duplex. `35e3a58` starts a real seat before commands. `76af0e9` names failing checks; `2552e4a` probes the socket as `cua`. Full two-seat RFB/input/renew/release/TTL remains unproved. At stop: capacity 1, no busy seats, test seat removed through supported lifecycle. Do not infer general supervisor failure from an earlier manual-stop orphan.

Required completion:
1. Start two real bots cold. Primary: JSON 200/control; secondary: 200 + `viewOnly:true`. App-only RFB 101 must lead through security negotiation and ServerInit to a real full framebuffer. Test client uses masked-client/unmasked-server binary frames and DES VNC bit-reversed key; never print passwords/screen contents.
2. Real xterm/Xfce terminal on `:1` and `:2`: read-only key has no effect; current matching UI lease works; second viewer rejected/no takeover; check/renew keeps control; release/lease loss closes socket within 5 seconds and subsequent GET fails; displays/sockets differ; no unrelated execution.
3. Verify `/api/desktop-viewer/local/shared`, `/api/desktop-viewer/local/shared-seat-2` and `/websockify`. Generic viewer + `botId/controlLeaseId` deliberately rejects. UI `/api/bots/:id/local-computer/join?controlLeaseId=...` must match a current live turn target. No direct lease/DB mutation.
4. Clean up to capacity 1 using supported start/stop/API lifecycle only. Preserve workspaces/backups.
5. `365cc4f` line guard is not permission to grow monoliths; split carefully.

**Task 8 — login broker, pending.** `computer-login-broker.ts` + atomic versioned snapshots, exclusive login writes, vault/permission gates. Prove bot B inherits bot A's authenticated state on a safe test site; no live SQLite cookie copy, no real dangerous credentials.

**Task 9 — resource policy, pending.** Initial capacity 1, hard max 3. Measure active Chrome PSS/docker stats (~600 MiB–1 GB each) under sustained multi-seat load and preserve >=1.5 GB for omb+caddy+OS. Reject/queue before OOM; show machine/seat usage in UI.

**Task 10 — client/PWA/rebrand 0.2.0/DMG, pending.** `OMB_CLIENT_ONLY=1` with sharing kept and no paired-Mac local server; responsive installable PWA/commands; SuperBot identity/version 0.2.0; signed `.dmg` built by GHA, not Mac. Remove “Get MausBot updates?”, newsletter opt-ins and Cloud nudges, not device pairing. No release/spend/DNS without explicit yes.

**Task 10b — one canonical chat, pending.** Map existing threads to a canonical bot chat with safely archived history; transaction/replay/rollback before UI cutover. Persistent bot/chat-to-seat binding; bot list becomes chat list; retain files/approvals. Migration tests and visible resumed context.

**Task 10c — durable orchestrator, pending.** Registry + durable queue, job ids/status/transitions, bounded independent transcripts/logs. Events wake canonical chat. Small fast chat model, at most 2–4 jobs; browser jobs require seat leases. StopAll stops only current bot jobs/leases, not the operator or other bots. Prove immediate ack, follow-up resumes a running job, completion delivered after reconnect, two real jobs on distinct displays, cancellation/resource release. Reuse existing queues/routines/stop controls; logs contain no secrets.

Mac acceptance pending: Share this computer + approved `uname -a` returning Darwin arm64 from the proper host. Never fake it.

## 8. GitHub connectivity on the Mac

Known issue: the Mac previously timed out on `curl https://github.com:443` with no proxy configured. First try:

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
- One shared Unix uid is not a strong sandbox boundary. Untrusted bot commands can reach shared resources; stronger isolation is a later design task.
- Backlog: rebrand/newsletter removal, signed 0.2.0 DMG, PWA/permission claims, Jakarta migration research. No expense without yes.

## 11. Exact quality scorecard


All statuses at the original assessment: **Not run yet**. PASS requires observed app behavior, not code presence. Parity requires all P0 tests 5,6,7,8,10,11,12,20 and >=90% of all 20.

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
| 9 | Events | GitHub main push invokes chat report | webhooks/app-events | Not run |
| 10 | Send | draft email; no delivery before authorisation | DraftCard pending | Not run |
| 11 | Safety | deletion blocked unless authorised | Ask grants | Not run |
| 12 | Vault | fake-site login saves/fills, password never in chat | vault/fill + Task 8 | Not run |
| 13 | Memory | A remembers flat white, B knows next day | shared short memory | Not run |
| 14 | Skills | `vps status` returns authorised hostname/uptime | skill authoring | Not run |
| 15 | Bots | creates Scout; Scout replies with model identity | coordinator/packages | Not run |
| 16 | MCP | GitHub card auth + issue listing, no token in chat | MCP/Composio | Not run |
| 17 | Browser | visible example.com screenshot; test session persists | Chrome/Cua Task 7 | Not run |
| 18 | Report | short shareable actual-content parity report | Phase D | Not run |
| 19 | Parallel | two jobs + responsive chat + stop works | Tasks 7/10c | Not run |
| 20 | Usage | flash fleet/cost; routines pause at low cap | ledger/soft-stop | Not run |

Real gates: #5/#7/#11 after Mac grant; #12/#17 after desktop+broker; #15/#19 after seats+orchestrator; #4/#18 after PWA/Phase D, then run the full round. Source artifacts and a blank scorecard are not evidence.
