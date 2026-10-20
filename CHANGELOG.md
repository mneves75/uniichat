# Changelog

## 1.4.0

### Added

- **A journal**: the server's own words as `unii: <level>: <what>` on stderr,
  or one JSON object a line with `UNII_LOG=json` (`{ at, level, what }`).
  `Server.ts`, `Agent.ts`, `Memory.ts`, `Mail.ts`, `Disk.ts` and `Cloud.ts` all
  go through it, and `Journal.test.ts` fails on a bare `console.*` in any of
  them. Rotation stays with whatever starts the process — a process cannot
  safely rename its own open stderr.
- **A handover test** (`Handover.test.ts`): a real client, a seeded chat, a
  worker under a supervisor, `SIGHUP`. It asserts the page is *moved*
  (`MOVE`, 4001) rather than dropped, that the store still holds its three
  messages, that a second socket is served the chat again, and that a second
  `SIGHUP` while the first settles is not a crash. Removing the supervisor's
  `SIGHUP` handler makes it fail.

### Fixed

- Three tests (`failsafe.test.ts`) captured raw `console.error` and compared
  bare messages; the journal's prefix broke them. The capture strips the
  prefix, so each still asserts what was said rather than how a line is
  shaped — `Journal.test.ts` owns the shape.
- `Handover.test.ts` seeded its session without `UNII_DIR`, so the session
  went to the home directory while the server read the temp store (the same
  isolation bug CI caught in `Chat.test.ts`, caught here by the test failing
  with a 401).

### Not done

- **A turn in flight during a handover** is still not tested: no vendor URL is
  configurable, and adding one to make a test possible would put a way to
  redirect a user's API key into every deployment. Named in `PLAN.md` as the
  remaining gap rather than papered over.

## 1.3.0

### Added

- **A recall harness** (`bun bench/recall.ts [--check]`, run by CI): a
  4,000-message synthetic chat with 40 facts, each later corrected. Measured
  here: recall@5 **100%**, newest-first answers the correction **100%**, the
  newest mention of a common word is reachable **yes**, search p95 **1.4 ms**,
  and the honest gap — a question whose words never appear together gets
  **0 hits**. `--check` fails below 95% recall/staleness or above 300 ms.
- **Render goldens** (`Render.test.ts`, `__snapshots__/`): the site's markup
  and the terminal's text for every message kind: a gate on `Call.ts` (0% of
  functions before) and on the markup's structure and class names, which fails
  on purpose when either moves. `Style.test.ts` is the CSS gate, and only for
  a custom property declared twice in one scope.
- **Wire replay** (`Wire.test.ts`): both vendors' streams, event by event —
  text in pieces, a tool call whose JSON arrives in pieces, `pause_turn`,
  refusals, incomplete responses, error events, and a cut stream. A malformed
  stream ends as a typed failure, never a throw.
- **ADR 0001**: the iOS app stays a shell (push, StoreKit, share, mic), what
  that saves, and the App Store 4.2 risk it accepts.
- CI runs the retrieval harness; a `-beta` tag publishes a **prerelease**.

### Fixed

- **A one-shot command never exited on Linux.** `Disk` keeps a `sh` alive for
  `syncfs` (Bun has no `syncfs`), and nothing ended it, so `Doctor`, `Backup`,
  `Gc` and the bench hung after printing. `Disk.quit()` ends it, and each
  command lets the runtime drain (with a two-second unref'd guard). Found by CI
  hanging on the new retrieval step — on macOS the shell is never started.
- **`Chat.test.ts` depended on the runner's home directory**: `Cloud.open`
  reads `UNII_DIR` at import, so on a machine with no `~/.unii` the suite
  failed with `SQLITE_CANTOPEN` while passing locally. `UNII_DIR` is now set
  before the first import, and AGENTS.md says why. (Caught by CI on the fork —
  the first time the gate ran in an environment that is not this laptop.)

## 1.2.0

### Added

- **`bun Backup.ts save|restore`**: a chat's store copied and checked
  (`Memory.faults`), and a restore that refuses a directory already holding a
  chat. A live store can be saved: the log is append-only and `view.json` is
  renamed into place.
- **`bun Gc.ts <chat> [--apply]`**: the images no message names. Only images:
  a summary line's id and an agent's log are references a later `zoom`
  follows.
- **Release artifacts** (`.github/workflows/release.yml`): a `v*` tag builds
  `unii` for darwin-arm64/x64 and linux-x64/arm64, publishes each with its
  sha256, and publishes `install.sh` with `install.sh.sha256`.
- **`unii update` verifies before running**: it reads the installer, compares
  its sha256 with the one the server publishes at `/install.sh.sha256`, and
  refuses a mismatch (or a missing checksum, unless
  `UNII_TRUST_UNVERIFIED=1`). A server started here publishes that checksum.
- **`search` newest first**: `newest: true` reads from the latest message
  back, which is the way to answer "what is it now". The tool description says
  so, and `Call.ts` shows which end a past search read.
- **The store records its geometry** (`node`, `high`, `seen`, and the prompt
  revision that summarised the lines). A re-tune is recorded, never refused;
  `Doctor.ts` notes a store whose lines come from two geometries.
- **A supersession clause in the compaction prompt**: a correction is written
  as the current value with the old one named as superseded, so "now" is
  unambiguous years later without forgetting anything.
- `docs/research/memory.md`: what the 2026 long-term-memory literature
  measures, and which part of it applies here (and which part is not built).
- `Chat.test.ts`, `Agent.test.ts`, `Style.test.ts`, `Backup.test.ts`,
  `Memory.test.ts` extended: 68 tests.

### Changed

- **A rate-limit key that cannot be forged**: `Cloud.ip` believes
  `x-forwarded-for` only when the peer *is* this machine's proxy (README's
  deployment); from anywhere else the socket's peer address is used.
- **The site**, as design rather than polish: one cool-neutral palette with no
  decorative hue (the brand name is ink), `--soft` raised to 5.2:1 because it
  carries real labels, a ~68-character measure (`--col: 41rem`, where it was
  740px), the memory's face at the message's size, `text-wrap: balance` only
  where a line or two is all there is, a writing-surface composer with a soft
  focus state, and 44px targets on a touch screen. `Style.test.ts` fails on a
  custom property declared twice in one scope: this change's own first attempt
  at `--col` was dead that way, overridden by the `:root` that set it first.

### Fixed

- `Memory.load` wrote `view.json` on every open: a corrupt one was moved aside
  and at once replaced. It now writes only when nothing was saved.
- `Memory.file` appended a newline to a torn last line, and `search` calls it:
  a read never writes the log now.
- A goal act with no text was read as a halt. It is refused (400), and one
  over 4000 characters (413) rather than cut.

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
