# The Inbox

`server/place-inbox.e2e.test.ts` boots the server with the synthetic Claude CLI:

1. An empty inbox answers with no rows, not 404.
2. A bot's approval and question, in two threads at once, are listed with count 2, each labelled with its thread.
3. An answer through the row's own conversation reaches the bot, its turn goes on and the count clears. A second answer to
   the same card is refused.

```sh
pnpm exec vitest run server/place-inbox.e2e.test.ts
```

## The panel

`src/components/inbox/InboxReading.dom.test.ts` drives the panel as a tab: its count and close, three-line rows with a
question's choices and the recommended one marked, the search, a line read in full with "n of m" and its steps, the bot's
words before it drawn as the chat's Markdown, and a question answered with its choice cards, a number key and a note through
`/api/threads/<id>/respond`, after which the next line opens, or the list when none is left. A password or a sign-in is keyed
by its own card kind and answered with the chat's own card for it.

```sh
pnpm exec vitest run src/components/inbox/InboxReading.dom.test.ts src/components/inbox/InboxPanel.dom.test.ts src/components/inbox/InboxEverywhere.dom.test.ts
```

