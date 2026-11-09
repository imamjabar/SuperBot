# Verifying SuperBot

SuperBot has one development control surface: `pnpm control:omb`. It runs
the published `openmausbot` verbs (docs/headless-cli.md), which call the MCP
tools in `scripts/mcp-server.ts`, so verification uses the same URL
validation, task pinning, bounded transcripts, wait states, and redaction as
external MCP clients and scripts.

## Launch

Start a fixture in one terminal:

```sh
node --experimental-strip-types scripts/control-omb.ts launch
```

Run the foreground launcher directly rather than through `pnpm`; this ensures
it receives Ctrl-C and can stop its child before removing the temporary data.

It gives the child a temporary data directory and home, chooses a free
harness/webhook port pair, installs only the repository's fake engine, prints
the URL, PID, data directory, and persistent log path, then stays attached to
that exact child. The parent shell and the user's SuperBot data are
untouched. Only `FAKE_CLAUDE_*` variables cross from the launcher's
environment into that child, so a recipe can script the fake engine's mode,
replies and tool calls without writing a wrapper CLI. Live calls add one
exception: `OMB_OPENAI_LIVE_URL` crosses when it is a loopback
`http://127.0.0.1:PORT` (the fake GPT-Live that
`node --experimental-strip-types server/testing/fake-openai-live.ts` prints),
and `OMB_OPENAI_LIVE_KEY` crosses only with it, so that key can only ever
reach the fake.

Pass the printed URL explicitly from a second terminal:

```sh
pnpm control:omb doctor --url http://127.0.0.1:PORT
```

Mutating commands refuse silent port discovery. This prevents a verification
recipe from sending messages to the user's running app by accident.

## Drive

Use only mapped, tested commands:

- [Chat turns](chat-turns.md)
- [OpenAI-compatible structured tools](openai-tools.md)
- [Full Access without duplicate approvals](full-access.md)
- [Gmail draft creation, send approval and revision](gmail-drafts.md)
- [Chat UI, driven headlessly](chat-ui.md)
- [Chat widgets](widgets.md)
- [The Inbox](inbox.md)
- [Reactions](reactions.md)
- [Chat widgets: prompts to try with a real bot](widget-prompts.md)
- [The organization library](org-library.md)
- [Preset bots](presets.md)
- [Fleet: many workspaces on one server](fleet.md)
- [Hosted workspace sign-in and revocation](hosted-workspaces.md)
- [Shared-workspace trust: loopback, card answerers, decision log](shared-workspace-trust.md)

`control-omb ui` ([Chat UI, driven headlessly](chat-ui.md)) drives the real
renderer in a headless Chrome by accessible name, so composer sends, transcript
rows, tool chips and server feature flags are provable from the command line.
Other renderer-only behavior—Settings, sidebar drag-and-drop, the VM modal, the
built-in browser panel, and updater UI—is still not proven by the harness. Use
the relevant Electron/package smoke test and state that limitation. Add a map
entry only after the shared control surface can really drive it.

The [external runtimes recipe](external-runtime.md) proves a bot's standing
comms capability from `external-runtimes.json` against a disposable server and
the fake engine: scope, on-demand token reads, `coordinate_bots` roots polled
through `assignment_status`, and immediate dispatch to a free teammate.

The [live browser fixture](browser-live.md) mounts the real Browser panel with
an explicitly selected native engine and Chrome in a disposable home, covering
watching, takeover, input, and profile switching.

The [remote desktop viewer fixture](desktop-viewer.md) checks the bundled
noVNC page, authenticated WebSocket proxy, desktop input, reconnect and logout
against an isolated server, synthetic desktop and VPS SSH forward.

The [independent threads fixture](threads.md) checks channel thread navigation,
per-thread models, activity controls, and thread-scoped Stop.

The [guarded external messages fixture](guarded-messages.md) checks atomic
branch and approval preconditions, retry receipts, and refusal to queue or
steer messages from external interfaces. It also verifies bounded request
lineage snapshots, Chief continuations and exact-execution Stop without
interrupting a newer request.

## Evidence

The optional [Podman full-stack acceptance recipe](podman-self-hosting.md)
checks the Compose deployment with a fresh home, fake engine, and two desktops.
It includes workspace ownership, persistence, and proxy authentication checks.

Keep the JSON from `wait` and `messages`, the exact command sequence, and the
fixture's printed log path. Evidence must show both the action and the resulting
state. A green unit test alone does not prove a user workflow.

## Cleanup

Interrupt the `launch` process with Ctrl-C. It stops the exact child it owns and
removes only its temporary data directory. The server log remains at the
printed path. Never kill processes by name and never delete a broad temp root.
