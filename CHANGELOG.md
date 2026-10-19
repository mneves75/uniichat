# Changelog

## 1.1.0

### Added

- **`search`**: every message ever logged, by substring or regular
  expression, over a day's range, oldest first — `#id`, date, kind and the
  line that matched. The agent's recall no longer depends on a summary
  having kept the right word. `prompt.txt` now says to search when the view
  no longer says where something was (and still never to grep the store).
- **`bun Doctor.ts [<dir>]`**: reads a chat's files as they are (a running
  server's too) and reports the faults — `view.json` unreadable, lines that
  do not tile the chat, a node the view names that is missing, an image a
  message names that is gone — plus the images nothing names. Exit 1 on a
  fault.
- **`/health`**: open chats, sockets, summaries not built (`backlog`),
  calls running, uptime. Signed out, naming no one.
- **A store version** (`v` in `view.json`): a store from a newer server is
  refused with a message instead of being half-read.
- **A per-model request cap** (`Agent.CAP`, 8): a turn's request goes
  before any import's, whatever order they came in; a request stopped while
  it waits takes no place and leaks none.
- **The type gate**: `tsconfig.json`, `@types/bun`, `typescript`, asset
  module declarations, `bun run check` — clean under `strict`.
- **CI**: types, tests, and a check that `web/app.js` is what `web/src`
  builds (identifiers normalised, since the minifier's own names move).
- **`AGENTS.md`**, this changelog, `Memory.test.ts` and `Agent.test.ts`.

### Fixed

- A `view.json` that will not parse was treated as one that was never
  there: the chat rebuilt a shallower view, lost its pick and its goal
  silently, and then **overwrote the damaged file**. It is now moved aside
  as `view.json.bad-<ms>`, logged, and said in the chat.
- Sign-in had no limit on guesses: a 6-digit code derived from 32 bits of
  the session, unlimited tries inside a 15-minute ticket. It is now 8
  digits, compared in constant time, and the 6th wrong try spends the
  ticket (429, and the right code is then no good).
- A `goal` act with no `text` stored the literal string `"undefined"` in
  the prompt and in `view.json`; a goal over 4000 characters is now
  refused rather than silently cut.
- `Chat.arrive` read `turn.sent[0]` while a turn's `sent` was empty — a
  `TypeError` that could take down the worker that had just taken the chat
  during a deploy. The chat's arrival also runs through `Main.event` now,
  so one chat's failure fails alone.
- `maxRequestBodySize` was `Infinity`; it is 1 GiB.

### Changed

- The site: a visible `:focus-visible` ring on every control,
  `role="log"` on the chat, `role="status"` on the toast and the
  connection line, a name on the message box, `theme-color` for the
  browser's chrome, and `prefers-reduced-motion` for the intro.
- The bundle check tolerates minifier renaming (it was the only
  difference a fresh build made) and fails on a real change.
