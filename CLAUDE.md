# Claude Code instructions

SuperBot is a public fork of OpenMausBot: a self-hosted team of private AI bots on one VPS, with leased visible browser desktops, approval cards, shared computers and per-bot memory/skills/routines. Grok Bot is a product reference design only, not a runtime or development dependency.

Read [`docs/DIRECTION.md`](docs/DIRECTION.md) (scope and priority) and [`docs/HANDOFF.md`](docs/HANDOFF.md) (architecture, roadmap phases, deploy safety, unrun scorecard) before work. Follow [`AGENTS.md`](AGENTS.md) and nested notes too.

## Local commands

Use Node 24 and pnpm 10.33.0 in the existing checkout:

```sh
pnpm install --frozen-lockfile
corepack pnpm vitest run <focused-test-files> scripts/testing/file-size-ratchet.test.ts
```

Run focused checks for changed files; broaden when warranted. Commit/push normally and let git hooks run. Never use `--no-verify`. CI is `.github/workflows/web.yml` (build + publish on `main`), `check.yml` (manual: lint, typecheck, focused tests), `desktop-image.yml`, and `desktop-mac.yml`.

## Fix workflow (learned 2026-11-06)

- **Reproduce from live data before fixing.** Read what the server actually stored (read-only `node:sqlite` on `/host-data/.openmausbot/messages.db` inside `superbot-omb-1`, or loopback `http://127.0.0.1:8799/api/...` with `Host: 127.0.0.1:8799` and no `Origin`). A "choice card" was first a bot-built `widget`, not a `QuestionCard`; fixing the guessed component missed it twice.
- **Bot-authored structure is free-form.** Bots invent action names (`send_message`, `send`, ...) and payload shapes. Key behaviour on meaning (a button whose payload is its own label is an answer), not on a name.
- **Fix both layers:** the UI disables, and the server refuses (409) a second answer.
- **The Mac has 8 GB:** `tsc`/`pnpm typecheck` runs out of memory. Run only focused vitest files locally; typecheck runs in `web.yml`'s `build:server` on push and in `check.yml` on manual dispatch. Save Actions minutes: no branch-push CI.
- **Pushing `main` deploys** (VPS cron pulls `web-dist`/`server-dist` within a minute). Before pushing server changes: back up `/data` + `vm-home`; after the build, force-recreate `omb` then `caddy`, check `https://superbot.taile267f1.ts.net/api/health` = 200 and the `server-dist-manifest.json` sha. For a UI change also check that the `assets/index-*.js` the site serves matches `~/SuperBot/web-dist/index.html` (a stale mount hid every UI change for a day). The UI needs only a hard reload (Cmd+Shift+R); no VPS restart.
- **Bisect a CI failure against `main` first** (`git worktree add /tmp/mainwt main`, symlink `node_modules`). A known pre-existing failure is listed in HANDOFF §6.
- **Size guards bite at the limit:** `shared/widget.ts` sits at the 1,000-line threshold and `server/index.ts` at its pin; keep edits net-zero lines or move code out.
- **Prove live, not just in tests:** the RFB/viewer smoke ran as a loopback client inside `omb` (VNC auth, full frame, `xdotool getmouselocation` read-back); never print passwords or screen contents.

## Hard rules

- Public repo: never commit secrets, credentials, `.pem` contents, VNC passwords, cookies, tokens or pair links. Never print them into logs.
- No public ports/listeners, DNS changes, releases, deployments, infrastructure changes or spending without Imam's explicit current approval.
- Never weaken authentication, same-origin/admin gates, exclusive desktop leases, read-only viewing, approval checks or secret redaction.
- Preserve backups, data volumes and user workspaces. Verify mutations with isolated fixtures, never live app/user data.
- Use `rg` before edits. Small focused diffs; no runtime changes for documentation-only work.
- Do not grow `server/index.ts`; extract/split functions. Respect file-size and route ratchets instead of raising them to accommodate new code.
- Do not bypass hooks, tests, lint rules or protocol/auth failures; fix the cause.
- Report success with observed proof. Implementation, process startup, HTTP 101 or CI presence alone is not full feature validation.
