# Claude Code instructions

SuperBot is a public fork of OpenMausBot: a self-hosted team of private AI bots on one VPS, with leased visible browser desktops, approval cards, shared computers and per-bot memory/skills/routines. Grok Bot is a product reference design only, not a runtime or development dependency.

Read [`docs/HANDOFF.md`](docs/HANDOFF.md) before work. It records architecture, exact remaining Tasks 7/8/9/10/10b/10c, deploy safety and the unrun quality scorecard. Follow [`AGENTS.md`](AGENTS.md) and nested notes too.

## Local commands

Use Node 24 and pnpm 10.33.0 in the existing checkout:

```sh
pnpm install --frozen-lockfile
pnpm vitest run <focused-test-files> scripts/testing/file-size-ratchet.test.ts
pnpm typecheck
```

Run focused checks for changed files; broaden when warranted. Commit/push normally and let git hooks run. Never use `--no-verify`. CI is `.github/workflows/web.yml`, `desktop-image.yml`, and `desktop-mac.yml`.

## Hard rules

- Public repo: never commit secrets, credentials, `.pem` contents, VNC passwords, cookies, tokens or pair links. Never print them into logs.
- No public ports/listeners, DNS changes, releases, deployments, infrastructure changes or spending without Imam's explicit current approval.
- Never weaken authentication, same-origin/admin gates, exclusive desktop leases, read-only viewing, approval checks or secret redaction.
- Preserve backups, data volumes and user workspaces. Verify mutations with isolated fixtures, never live app/user data.
- Use `rg` before edits. Small focused diffs; no runtime changes for documentation-only work.
- Do not grow `server/index.ts`; extract/split functions. Respect file-size and route ratchets instead of raising them to accommodate new code.
- Do not bypass hooks, tests, lint rules or protocol/auth failures; fix the cause.
- Report success with observed proof. Implementation, process startup, HTTP 101 or CI presence alone is not full feature validation.
