# AGENTS.md — UniiChat

One chat that never ends: a Bun/TypeScript agent whose memory is a binary
tree of summaries (see `Memory.ts`'s header), one process per worker, a
store per user under `$UNII_DIR`. `README.md` says how to run it.

## Gates (run them; their exit codes are the answer)

```sh
bun run check    # tsc --noEmit, strict
bun run test     # bun test --isolate
bun Doctor.ts    # a store's files: view tiles, nodes exist, images present
bun Backup.ts save <chat> <to>   # a checked snapshot (restore into an empty dir)
bun bench/recall.ts --check      # retrieval: recall@5, staleness, paging, p95
```

CI (`.github/workflows/ci.yml`) runs the types, the tests, the retrieval
harness, and rebuilds `web/app.js` to check it is what `web/src` builds.

## Where the design lives

Every file opens with a header comment that says what it is for and what
its types mean: read it before changing the file, and update it when the
behaviour changes, because it is the only design document there is. Start
with `Memory.ts` (the tree and the view), `Server.ts` (turns, workers, the
handover), `Agent.ts` (the call loop, retries, the per-model cap).

`prompt.txt` and `Tools.ts`'s specs are product assets: changing a tool
means changing its spec, its `Call.ts` line, its `Theme.ts` glyph, its
`OWN`/`BOSS` list, and `prompt.txt` if the prompt names it.

## Rules that are not style

- **Never edit or delete a store's `chat/` history, `main/` or `tree/`.**
  The log is the memory. Add, never rewrite.
- **A store's format change needs a `STORE` bump** (`Memory.ts`), and a
  refusal for newer stores before an old one half-reads a new chat. A change
  to how lines are written (their size, the view's, the prompt that
  summarises them) is recorded in `view.json`'s `geometry`, not refused:
  `Doctor.ts` reports a store that mixes two.
- **Absence is not corruption.** A file that does not exist and a file that
  will not parse are different facts (`Memory.saved`); the second is moved
  aside and reported, never overwritten.
- **Tests never call a vendor.** A summary is a paid call: a test sets
  `mem.hold` (both sides) so the store is tested without one, or replays a
  fake stream. A test that needs a network is a test that will fail in CI.
- **`bun test --isolate`**: every test file starts processes and opens
  stores of its own, under `mkdtemp`, and removes them. A test may not read
  the home directory: `Chat.test.ts` sets `UNII_DIR` before its first import
  because `Cloud.open` reads `config.DIR` at import, and on a CI runner there
  is no `~/.unii` (the run failed with `SQLITE_CANTOPEN` while passing here).
- **Write to the journal, not the console.** `Server.ts`, `Agent.ts`,
  `Memory.ts`, `Mail.ts`, `Disk.ts` and `Cloud.ts` go through `Journal`
  (`Journal.test.ts` fails on any bare `console.*` there). A message a person
  must read is `Chat.note` or a view row, never a log line — except
  `Journal.person`, which writes stdout for the one thing an operator has to
  see and no file should keep (the sign-in link on a server with no mail key).
- **A one-shot command ends with `Disk.quit()`**: on Linux `Disk` keeps a
  `sh` for `syncfs` and that child keeps the runtime alive, so a CLI that only
  sets `process.exitCode` never returns to the shell.
- **Two renderers, one golden each**: `Render.test.ts` snapshots the site's
  markup and the terminal's text for every message kind. A style change moves
  a snapshot on purpose; that is what the file is for. Re-record with
  `bun test --update-snapshots Render.test.ts` and read the diff.
- **No panic on input.** Acts arrive from any client: a field that is
  missing is refused with a message (`goal`), never `String(undefined)`.
- **`web/style.css` has its own test** (`Style.test.ts`): a custom property
  declared twice in one scope silently wins by order, which is how a
  redesigned measure can be dead on arrival. Keep it passing.
- **Types are checked now.** A cast is allowed only with a comment saying
  why (Bun's `*.html` type, a stream body), never to quiet a real mismatch.

## The site

`web/index.html` is the guest page as served; `web/src/main.ts` builds
`web/app.js` (committed; `bun run web`). Change the source, never the
bundle, and commit both. The page keeps its own look: one palette in
`style.css`, light and dark by the device's setting, no colour of its own
in the terminal (`Theme.ts`).

Accessibility baseline, checked by hand and kept: `:focus-visible` is
always visible, `role="log"` on the chat, `role="status"` on the toast and
the connection, a name on every control, and
`@media (prefers-reduced-motion: reduce)` for the intro.
