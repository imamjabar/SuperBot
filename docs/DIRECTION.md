# SuperBot direction — decisions from the 2026-11-06 review

> For Claude Code on Imam's Mac. Read this together with `docs/HANDOFF.md` and `CLAUDE.md`.
> Where this file and HANDOFF §7/§11 disagree about **scope or priority**, this file wins:
> it is Imam's newer decision. All HANDOFF **safety rules** (no secrets, no deploys,
> spend or public ports without Imam's explicit yes, never `--no-verify`, never weaken
> auth, leases or approvals) still apply unchanged.
> This repo is public: do not add credentials, IPs or pair links to this file.

## 1. Core decision

SuperBot is a **personal, single-user** system, not an enterprise multi-tenant product.

**Copy Grok Bot's experience, not its infrastructure.**

"Like Grok Bot" means these five user-visible behaviours, and nothing more is required:

1. The bot replies **instantly**, even while work is running.
2. Long work runs **in the background**, and the bot posts in chat when it finishes.
3. **One chat per bot.**
4. Imam can **watch and take over** the bot's browser desktop.
5. It works from **his phone**.

Anything that serves none of these five is optional and goes to the backlog.

## 2. Reference: what Grok Bot's computer actually is (measured by Imam 2026-11-06)

Measured from a terminal on the Grok Bot computer (`cat /etc/os-release`, `lscpu`, `free -h`, `df -h`, `lsblk`, `/proc/cmdline`, `/proc/1/cgroup`, fastfetch):

| Layer | Finding |
|---|---|
| Hardware | Intel Xeon 5th gen (Emerald Rapids), AVX-512 + AMX |
| VM | KVM microVM (Firecracker-style boot args), custom kernel 6.12.x |
| Container | "pod" container inside that VM; `tini` as PID 1, no systemd |
| OS | Debian 13 (trixie), XFCE (Xfwm4), Chrome, 1920×1200 |
| Resources | 8 vCPU, ~15 GB RAM, no swap, 128 GB persistent disk |
| Network | All outbound traffic goes through an allowlist proxy; Debian apt mirrors are blocked, GitHub is allowed |
| Brain vs hands | The bot (chat, memory, skills, routines) runs **outside** the computer; the computer sleeps when idle and keeps its files |

SuperBot's desktop already matches the important parts (Debian 13, XFCE, Chrome, tini, a shared computer, idle sleep). **The VM/microVM layer and the egress allowlist exist because Grok serves many untrusted users. SuperBot does not need them.**

## 3. Facts about SuperBot found in the code (2026-11-06)

- VPS: **2 vCPU / 8 GB / 77 GB**, which runs `omb`, Caddy, the OS **and** every desktop.
- Desktop container (`server/container-computer.ts`, `containerRunArgs`) is already hardened: `--cap-drop ALL` (+SETUID/SETGID), `--memory 4g --memory-swap 4g`, `--cpus 2`, `--pids-limit`, private IPC and cgroup namespaces, loopback-only ports. **This is enough for personal use.**
- `omb` has the Docker socket mounted (`deploy/docker-compose.computer.yml`), and the agent CLIs (Claude/Codex) run in `omb`. The agent's shell is therefore effectively root on the VPS. HANDOFF §10 already notes this. **Accepted risk for a single user**, given the cheap safeguards in §6.
- `shared/outbound.ts` controls outbound *actions* (sending email or messages), not network traffic. There is no network egress filter. **Accepted; not needed.**
- The scorecard in HANDOFF §11 is entirely **"Not run"**. Nothing is proven end to end yet.

## 4. What is right (keep)

- VPS + Tailscale only, no public ports.
- One shared computer for all bots.
- The existing Docker hardening.
- Approval cards, backups, CI-built pinned images, ~15-minute idle shutdown.
- Claude/Codex as engines. Model quality is not the gap; orchestration is.

## 5. What is wrong (stop or shrink)

| Problem | Decision |
|---|---|
| Roadmap too wide (Tasks 7–10c) with zero end-to-end proof | **Freeze new scope.** Finish and prove the basics first |
| Designing for 3 desktops and 2–4 parallel jobs on 2 vCPU | **Design for 1 desktop.** At most 2 jobs |
| Task 7 acceptance is enterprise-grade (two-seat proof, read-only viewer keys, lease handover) | **Shrink** to the single-seat acceptance in Phase 1 |
| Task 8 login broker (atomic versioned snapshots between bots) | **Defer.** One shared Chrome profile is fine for one user |
| Rebrand 0.2.0, signed DMG, newsletter removal | **Last, or never** |
| gVisor/Kata, an egress proxy, per-bot sandboxing | **Do not build** |

Do not delete existing multi-seat code. Leave it in place with capacity 1, and stop extending it.

## 6. Cheap safety (replaces enterprise isolation)

Each step is small. **Check with Imam before changing anything on the VPS or in AWS.**

1. Keep the **"Ask" approval level** for shell commands and deletes.
2. Imam must **not log the bot's Chrome into his main email or banking**. Use separate accounts.
3. Confirm the EC2 instance has **no IAM role attached**, or that instance metadata uses IMDSv2 with hop limit 1. Then a prompt-injected bot cannot read AWS credentials. (This is an AWS setting, so it needs Imam's approval.)
4. Keep backups of `/data` and `vm-home` before every deploy.

## 7. The new roadmap (follow in order)

### Phase 1: make it usable (now)
- **Task 7, minimal:** with **one** desktop seat, the app viewer shows the live desktop, mouse and keyboard control works, and the connection closes after release. The two-seat and read-only-key proofs are **out of scope** for now.
- Run these scorecard tests manually and fix failures: **#1 Reply UX, #3 Choice card, #8 Routine, #11 Safety, #17 Browser.**
- **Done when:** Imam watches a bot open example.com in Chrome from the app and takes over the mouse.

### Phase 2: make it feel like Grok Bot (the real gap)
- **Task 10c, simplified:** an instant acknowledgement, the work runs as a durable background job, and on completion a message **wakes the chat** (no polling). Allow at most 2 concurrent jobs. A follow-up message steers or resumes the running job, and Stop works. Reuse the existing queues, routines and stop controls; don't build a new framework.
- **Task 10b:** one canonical chat per bot, with a lossless migration of existing threads.
- **Done when:** scorecard **#2 Long work, #6 Local job, #19 Parallel** pass (with 2 jobs, not 4).

### Phase 3: phone
- An installable, responsive web app (PWA) over Tailscale. Skip DMG signing unless the Electron app actually needs it.
- **Done when:** scorecard **#4 Phone** passes.

### Phase 4: only when Imam feels the need
- A second desktop seat, which first needs a VPS upgrade to at least **4 vCPU / 16 GB**. That's spending, so it needs Imam's yes.
- Moving the VPS closer to Jakarta. The current Mac↔VPS round trip of ~325 ms makes the viewer laggy, and AWS has a Jakarta region. Infra change, so it needs Imam's yes.
- Task 8 login sharing, if per-bot logins become annoying.
- Rebrand / DMG / Mac-sharing tests (#5, #7).

### Parity target (revised)
The original "all P0 + ≥90% of 20 tests" is replaced by: **the five behaviours in §1 work, and scorecard tests #1, #2, #3, #4, #6, #8, #11, #17 and #19 pass on observed behaviour.**

## 8. First actions for Claude Code

1. Read `CLAUDE.md`, `docs/HANDOFF.md` and this file.
2. Propose (don't apply yet) an edit to HANDOFF §7 and §11 that reflects this roadmap. Show Imam the diff and wait for his yes.
3. Once approved, commit this file as `docs/DIRECTION.md`, plus the HANDOFF edit, with focused checks and normal hooks.
4. Then start Phase 1 / Task 7 minimal: list the exact remaining gap between the current code (`2552e4a` and later) and the single-seat acceptance, before writing code.
