# Merge readiness: `ux/main-chat-progress` → `main`

Not merged. Imam approves the merge; nobody pushes to `main` before that.

## Shape

- 36 commits on top of `main` at `9e5e81b`. `main` has not moved since the branch started, so the merge is a fast-forward.
- 73 files, about +2,640 / −140 lines before the scaffolding cleanup in this commit.
- Phase 2 (Grok-like) is complete in `chatux-ledger.md`: #2, #6 and #19 PASS. Phase 3 (phone) passes the automated part of #4.

## Runtime files changed

Server: `agents-turn.ts`, `contracts.ts`, `data/instructions.ts`, `data/tools.ts`, `drivers/agents-call.ts`, `drivers/agents-catalog-profile.ts`, `drivers/agents-catalog.ts`, `drivers/agents-web-tools.ts` (new), `drivers/chat-repeat-guard.ts`, `drivers/openai-chat.ts`, `front-desk.ts`, `harness/live-steps.ts`, `host/self-threads.ts`, `index.ts`, `recent-work.ts`, `routes/bot-messages.ts`, `routes/internal-tools.ts`, `routes/web-fetch.ts` (new), `runtime/runtime.ts`, `step-summary.ts`, `timing-marks.ts` (new), `turn-settings.ts`.

Web: `ChatMoreMenu.tsx`, `ChatView.tsx`, `JobPresence.tsx`, `JobViewFooter.tsx` (new), `RichTable.tsx`, `SidebarBotMenu.tsx`, `lib/job-status.ts` (new), `lib/job-threads.ts` (new), `lib/peer-exchange.ts`, `lib/transcript-derivations.ts`, `state/thread-navigation.ts`, `state/turn-status.ts`, `locales/en.json`, `locales/id.json`.

Workflow: `check.yml` gains one opt-in dispatch input, `probe_dist`, which builds the web and server bundles as a 3-day artifact for `scripts/validate-chatux/run.sh`. With the input off, the `check` job is unchanged from `main`.

## Verified

| What | Evidence |
|---|---|
| Overlap: 2 jobs, acks while busy, both finals in the main chat, tool budget | VPS overlap probe #3 at `a2849b1` (artifact run 42356543941): acks 9.1 / 10.4 s, finals 91.0 / 104.0 s, 10/10 calls per job |
| Stop ends a live job and does not wake the main chat | VPS runs (job cancelled within 20 s); `runtime.test.ts` |
| Single research job uses `web_fetch`/search, names its step, reports back | VPS single-job probe at `5e7f732` |
| Restart durability (#6) | box `server/runtime/runtime.test.ts` at `3b070ee`: 60/60 |
| Phone table and PWA (#4, automated) | box `phone-check.mjs` at `742ca2a`, Advanced and Simple mode |
| Job views, navigation, status line | CI scoped run 42346753665 at `b11b0d3`, 15 specs |
| Server specs touched by the branch | box run at `20413a9`: 20/21 files. The one failure, the 64-step cap fixture, was fixed in `f6ab90d` |

## Known `main` baseline failures

`server/index.test.ts`: 4 failures that also fail on `main` (box baseline). On the branch, any failure there whose name is not one of those 4 is a regression.

## Before Imam approves

On the box, at the head of the branch:

1. `pnpm typecheck` and `pnpm exec oxlint --deny-warnings server shared`.
2. `pnpm vitest run $(git diff --name-only origin/main...HEAD | grep '\.test\.') server/wait-probes.test.ts server/agents-turn.test.ts server/data/tools.test.ts server/drivers/openai-chat.test.ts server/drivers/openai-chat-protocol.test.ts server/drivers/openai-chat-local-model.test.ts server/drivers/openai-chat-announcement.test.ts server/drivers/openai-chat-safety-floor.test.ts server/drivers/openai-compat.test.ts server/drivers/agents-call.test.ts server/drivers/agents-catalog-wire.test.ts server/drivers/agents-bridge-wire.test.ts`. That is every spec the branch changed plus the unchanged specs of the server files it changed. The last full run of this set was at `20413a9`.
3. `pnpm vitest run server/index.test.ts`: exactly the 4 baseline failures.
4. `pnpm exec vite build && pnpm build:server`.

## Risks

- **`server/index.ts`** carries most of the server diff (report-back delivery turn, read-only job threads, front desk). Only the deterministic specs and two VPS scenarios cover it.
- **`web_fetch`** adds outbound fetches from the server for report-back jobs only (`OMB_WEB_FETCH=1` when `reportsBack`). It accepts public addresses only and re-checks every redirect.
- **Tool budget:** bot-opened jobs stop calling tools after 30 calls (`OMB_JOB_TOOL_CALLS`, 1–200) and answer from what they have, so a long comparison can come back thinner than before.
- **Repeat guard** now runs for remote API models as well: an identical failing call is refused after 2 failures.
- **Restart:** plain shell writes are not classed as outward. A job cut mid-write reruns once, with a note telling the model to check first.
- **Not verified on the branch:** #8 (routine reminder), #11 (deletion blocked), #17 (example.com visible) passed on `main` on 2026-11-06; #3 (card press inside a job) is covered by a route test only; #4 has not been tried on a real phone.

## Approval needed from Imam

"Merge `ux/main-chat-progress` at `<head sha>` into `main` as a fast-forward." Give it once the four box checks above pass, and accept that these come after the merge, run by Imam: #4 on a real phone (install the PWA, pair, get a Web Push, read the table), then rerun #8, #11 and #17 on `main`.
