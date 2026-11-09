# The Inbox

`server/host/place-inbox.test.ts` exercises the place inbox:

1. An empty inbox answers with no rows, not 404.
2. A bot's approval and question, in two threads at once, are listed with count 2, each labelled with its thread.
3. An answer through the row's own conversation reaches the bot, its turn goes on and the count clears. A second answer to
   the same card is refused.

```sh
pnpm exec vitest run server/host/place-inbox.test.ts
```

## Inline cards and inbox derivations

`src/components/inbox/inbox-view.test.ts` exercises inbox item derivations and quick actions for approvals, questions, and routine reports that appear as inline cards in chat conversations:

1. Lists items waiting on the person and routine news as one list, newest first, leaving settled lines out.
2. Directs quick actions: approval allow/deny/reply, question choice taps, reply and close, and routine report acknowledgement.
3. Formats choices and response payloads for inline card actions.

```sh
pnpm exec vitest run src/components/inbox/inbox-view.test.ts
```
