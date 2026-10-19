# UniiChat — review and improvement plan

Reviewed commit: `0500bf6` ("UniiChat", the only commit).
Source: 26 root `.ts` modules + `web/src/{main,Html}.ts` + `Computer.swift` + 3 Swift files
≈ 14.7k hand-written lines, plus a committed 2.4k-line generated bundle (`web/app.js`).

*Measured* = actually run on this machine. *Read* = from the code, with file:line.
An independent adversarial review was run against this document; where it caught me wrong,
the correction is folded in and noted in §8.

---

## 1. Verdict

This is a serious system, not a toy. The design is the interesting part and it holds up: the
memory tree, "every window is a view", cache-shaped blocks, the single-writer store with group
commit, deploy-as-handover, and "an outage delays a summary, never harms it". The per-file
header comments are real design documents, and the existing tests test the *reasoning* core
properly.

The risk is not the ideas. It is that the system is **irreplaceable, unprovable, and installed
from an unverified pipe** at the same time:

1. **Irreplaceable.** A user's whole history lives in a bespoke format with **no version
   marker** (`Memory.ts:94-98`), and a *parse* failure of `view.json` is treated exactly like
   "no view" — the chat silently rebuilds a shallower view and then **overwrites the damaged
   file** (`Memory.ts:221-229`, `Memory.ts:217`). No backup/restore loop, no GC, no integrity
   check. The README's mitigation is "back them up".
2. **Unprovable.** The surfaces users judge — message rendering (`View.ts`→`Html.ts`,
   `Paint.ts`, `Call.ts`) and device tools (`Tools.ts`, `Machine.ts`) — are the **least tested
   code in the repo** (`Call.ts` 0% of functions, `View.ts` 15.7%, `Tools.ts` 23%,
   `Machine.ts` 43%, *measured*). Nothing gates a bad merge: no `tsconfig.json`, no type check,
   no test CI, no lockfile, no pinned Bun, no tags, no release workflow.
3. **Installed from an unverified pipe.** `unii update` is
   `curl -fsSL <url>/install.sh | sh` (`Term.ts:1083`), the repo's own `web/install.sh` is a
   stub that pipes `https://uniichat.com/install.sh | sh`, and no artifact is published,
   checksummed or reproducible from this repository. That is the one remote-code-execution
   path in the product, and it is where the product's users actually enter.

The plan is ordered so cheap, user-visible fixes land before multi-day infrastructure, and
every item has a pass/fail condition that can actually fail.

---

## 2. What I measured

| Check | Result | Notes |
|---|---|---|
| `bun test --isolate` | **37 pass, 0 fail**, 9,654 expects, 13.9 s | Reproducible here |
| `bun test --coverage` | **61.40% lines / 54.61% funcs** | Table below |
| `tsc --noEmit --strict` (correct flags) | **12 errors**; only ~3 are genuine code, the rest are Bun-types / asset-module declarations | No `tsconfig.json` exists, so this gate has never run |
| `bun run web` vs committed `web/app.js` | **differs**, 52 +/52 −, pure identifier renaming | Not reproducible across Bun patch levels; nothing checks it |
| `git tag` | empty | Though `install.sh` installs "the released `unii`" |
| `.github/workflows/` | `ios.yml` only | No test / typecheck / lint / release CI |
| `bun.lock`, `packageManager` | absent | Zero runtime deps (a real strength), Bun itself unpinned |

Lowest-covered modules *(measured)*:

```
Call.ts      0.00% lines   (the tool-call renderer three views depend on)
OpenAI.ts   17.54%         (no wire test; Anthropic 79.7%)
Computer.ts 18.31%         (computer-use actions)
View.ts     29.33% lines / 15.69% funcs  (the shared view model)
Tools.ts    33.05% / 23.08% (MCP surface, subagents, devices)
Machine.ts  36.75%         (shell/read/write/edit — tools that touch a user's files)
Paint.ts    38.43%         (terminal renderer)
Cloud.ts    49.48%         (accounts, sign-in, sessions)
```

Best: `Price.ts` 94%, `Config.ts` 92%, `AskAI.ts` 91.7%, `Agent.ts` 84%, `Screen.ts` 82.7%,
`Anthropic.ts` 79.7%, `Memory.ts` 67.4%. The authors tested what they were thinking about,
not what a user touches.

---

## 3. Findings, by severity

### S1 — A corrupt `view.json` silently shrinks the chat, then destroys the evidence
- `Memory.saved` returns `null` for *both* "no file" and "unparseable file" (`Memory.ts:221-229`).
- `Memory.open(mem, mem.view, null)` then rebuilds the view down to the highest *built* nodes only
  (`Memory.ts:231-237`): the newest unsummarised messages drop out of the view, come back raw,
  blow past `HIGH = 128000`, and trigger a re-compaction bill. `goal`, `work` and `pick` are lost
  with no message.
- `Memory.load` finishes with `Memory.save(mem)` (`Memory.ts:217`), **overwriting the damaged file**.
  A load path that changed nothing should not write at all.
- The format also carries **no version marker** (`Saved` type, `Memory.ts:94-98`), so the first
  format change is a one-way door.
- *(Correction to an earlier draft of this plan: `view.json` **is** flushed — `Memory.save` calls
  `Disk.wrote` at `Memory.ts:243`. Durability is not the defect here; silent degradation is.)*

### S2 — Sign-in code has no attempt limit, and the surrounding limits are weaker than they look
- The code is 6 digits derived from 32 bits of the session hash (`Cloud.ts:220-222`);
  `Cloud.confirm` compares it and re-renders on mismatch with **no attempt counter, no ticket
  burn, no constant-time compare** (`Cloud.ts:437-443`). Ticket TTL 15 min (`Cloud.ts:59`).
  Anyone holding the ticket — mail-scanner prefetch, shared or forwarded mailbox — gets
  unlimited guesses inside that window.
- The adjacent limits are real but **not what a "rate limit" implies**:
  - `/api/login` *is* limited: `WHO_LINKS = 3` open links per address, `IP_LINKS = 100` per
    network per 24 h (`Cloud.ts:66-67`, `Cloud.ts:170-184`). But the per-address cap is a
    **targeted lockout**: three requests to a victim's address lock them out of sign-in for
    15 minutes, repeatedly, without ever mailing them.
  - `/auth` POST has **no** network limit in the default single-process deployment; `NETS`
    (`Server.ts:217`, applied at `Server.ts:2133`) exists only inside `Main.supervise`, i.e.
    only when `workers` is configured (`README.md`).
  - Both key on `Cloud.ip`, which is the **client-supplied leftmost** `x-forwarded-for`
    (`Cloud.ts:137-139`). An attacker rotates one header. A limiter built on this key, as an
    earlier draft of this plan proposed, would pass its own tests and protect nothing.

### S3 — Unbounded intake and no global concurrency ceiling
- `maxRequestBodySize: Infinity`, `idleTimeout: 0` (`Server.ts:1685-1686`); image bodies are
  fully buffered before `Memory.image_add`.
- `Memory.JOBS = 64` is **per side, per chat** (`Memory.ts:143`, loop over both sides at
  `Memory.ts:634-644`) ⇒ up to **128 concurrent paid compactions per chat**; an importing chat
  holds neither side (`Server.ts:781`). Ten such chats = 1,280 simultaneous vendor requests.
- `Agent.ROOMS` (`Agent.ts:130`) serialises *retries after* a vendor says busy
  (`Agent.ts:252-257`); first attempts are uncapped. `FETCHES = 65535` with the comment
  "Bun's fetch: 256" (`Server.ts:219-220`) removes the last brake. Convergence is by 429.

### S4 — The render path has no regression net
`View.ts` is pure (imports verified: only pure modules; no `node:`, `Bun.`, `process.`), and
`Html.ts`/`Paint.ts` are pure functions over rows. Ideal for goldens; there are none. Every
"page looks wrong / terminal mangles a table / diff misaligned" bug is found by eye on three
surfaces that share this model.

### S5 — Types are unverified
No `tsconfig.json`; Bun strips types without checking. With correct flags the check leaves 12
errors, only ~3 genuine (`Clip.ts:78` `TextDecoderStream`; `failsafe.test.ts:202` an `Ask`
shape). The code is nearly strict-clean — one afternoon buys a permanent gate.

### S6 — Handover can take down the worker that just started
`Chat.arrive` does `chat.mem.pay?.("chat", String(turn.sent[0].id))` (`Server.ts:1020`),
and `turn.sent` is `[]` in the window between `chat.sent = []` (`Server.ts:513`) and
`chat.sent = chat.wait.splice(0)` (`Server.ts:544`). `Chat.give` moves a chat as soon as
`posts === 0` (`Server.ts:346-364`), and a WS-started turn has `posts === 0`. `Chat.arrive` runs
synchronously inside `Chat.open` (`Server.ts:322-324`) from the `"chat"` case of `Main.heard`,
which does **not** go through `Main.event`'s try/catch. A `TypeError` there ends the new worker
and the chat is absent from both processes. The elaborate handover deserves a test that fails
today.

### S7 — Act inputs are unvalidated at the one place that reaches the system prompt
`case "goal"` does `msg.text === null ? null : String(msg.text)` (`Server.ts:1227-1231`): an
omitted `text` stores the literal string `"undefined"`, and there is no length cap on a
user-authored field that is appended to the prompt. Any client can post it (`/api/act`).

### S8 — Release engineering and supply chain
No tags, no `CHANGELOG`, no workflow building `unii`, and the installer is an unverified pipe
(§1.3): `web/install.sh` → `curl https://uniichat.com/install.sh | sh`; `unii update` runs the
same against *any* server URL (`Term.ts:1083`), and `/install.sh` is served by each server
(`Server.ts:242`). A self-hoster therefore trusts their own server to install their own client —
which is defensible — but nothing verifies what arrives, and a third party cannot rebuild it.

### S9 — Operations are invisible
31 `console.*` calls in source, no levels, ids or rotation *(measured count; an earlier draft
said 37, which wrongly included test files)*. No health endpoint beyond `/api/hello`, no
compaction-backlog metric (the actual SLO of this product), no per-user cost counter. The
handover is tested only for MCP request forwarding (`Tools.test.ts`).

### S10 — Capability gap that costs recall
Tools are `zoom`, `date`, `shell`, `read`, `write`, `edit`, `spawn`, `tell`, `computer`
(`Tools.ts:195-211`, `Machine.ts:62-67`). **No search over its own memory.** Recall depends on
the model guessing which line id to zoom. Every message is already on disk and indexed by id.

### S11 — Smaller, real
- `web/app.js` is committed and drifts from `web/src` (measured).
- The day file name comes from the local calendar date (`Memory.ts:375`) and `Memory.path`
  formats the same derived day back through UTC (`Memory.ts:349-351`) — **self-consistent in
  every timezone**, verified; not a bug. (An earlier draft listed it as one. It is not.)
- No `SECURITY.md`, `CONTRIBUTING`, `AGENTS.md`, or threat model in a repo whose agent runs
  shells and drives a Mac's screen.

---

## 4. The plan

Order: **A** (hours, user-visible defects) → **B** (guardrails, days) → **C** (store
provability) → **D** (operations) → **E** (capability). Each item: what / done when.

### A — Fix what is already broken (1–2 days)

**A1. `view.json` corruption is loud, recoverable, and never overwritten.**
Distinguish ENOENT from a parse error; on parse error rename to `view.json.bad-<ts>`, log with
the chat id, and rebuild **forward** to the count (not back to the highest built node), so no
message leaves the view. Make `Memory.load` read-only unless something actually changed
(drop the unconditional `Memory.save`, `Memory.ts:217`).
*Done when:* a planted corrupt `view.json` produces a `.bad` file, a log line, a view whose
parts still cover `0..count`, and an untouched `view.json` after a read-only open.

**A2. Sign-in attempt cap.**
Per-ticket counter (5) stored with the ticket, burn on the 6th, `crypto.timingSafeEqual`, and
8 digits (20 → ~26 bits of guess space). Leave `link_ask` semantics alone for now except to
stop the lockout: always mint the newest link and let older ones die instead of refusing.
*Done when:* 6 wrong codes burn the ticket and the 7th refusal is terminal even if correct; a
link consumed by one terminal cannot sign in a second; a test proves the lockout is gone.

**A3. Validate act inputs.**
A `goal` with no `text` is rejected, not stored as `"undefined"`; cap every user-authored field
that reaches the prompt (a documented `MAX_GOAL`, `MAX_RULES`); return a 400 with a message.
*Done when:* posting a `goal` act with no `text` returns 400 and leaves `view.json` unchanged.

**A4. Bound the intake without breaking long-lived routes.**
`idleTimeout` and `maxRequestBodySize` become finite **except** the routes that need them:
`/api/wait` deliberately holds for 5 minutes (`Cloud.ts:59`, `Cloud.ts:357-368`) and
`/export`/`/tree` stream the whole store (`Memory.ts:1073`). Per-route limits, image cap
enforced before buffering.
*Done when:* a 64 MB POST gets 413 and RSS returns to baseline **and** a terminal sign-in still
completes through `/api/wait` and an export still streams a 1 GB store.

**A5. Handover cannot kill a worker.**
Guard `turn.sent[0]` (or carry the empty-`sent` case explicitly), and route `Chat.arrive`
through `Main.event` so one chat's failure fails alone.
*Done when:* a test hands a chat over inside the `sent` window and the new worker survives.

**A6. Installer integrity (the first half of S8).**
`web/install.sh` verifies a published checksum before executing; `unii update` refuses an
installer whose checksum does not match, and prints the URL and hash it is about to trust.
*Done when:* a tampered installer is refused and the refusal says why; a matching one installs.

### B — Guardrails (3–4 days)

**B1. Type gate.** `tsconfig.json` (`strict`, `noEmit`, `allowImportingTsExtensions`,
`types: ["bun-types"]`, asset-module declarations for `.md/.sh/.css/.txt/.js`), `bun-types` as
the first dev dependency, fix the ~12 errors, `bun run check`.
*Done when:* `bun run check` exits 0 and a planted `const x: number = "a"` fails it.

**B2. CI that gates.** Type check, `bun test --isolate`, coverage summary, on push and PR.
*Done when:* a PR breaking a test or a type is red; a clean branch is green in < 5 min.

**B3. Toolchain pin.** `packageManager`, committed `bun.lock`, `.tool-versions`, documented
Bun range.
*Done when:* a fresh clone installs and tests on the pinned version. **Drop** the byte-for-byte
bundle check: the measured drift is minifier identifier renaming, so that gate would be
permanently red. Keep determinism honest by comparing with identifiers normalised, or by
asserting the built bundle parses and the entry exports the same set.

**B4. Non-spoofable network key, then limits.** Derive the limit key from a trusted hop
(`x-real-ip` behind a configured proxy, else the socket address), then apply `NETS` to the
default single-process deployment too.
*Done when:* rotating `x-forwarded-for` does not refresh the quota, and `/auth` POST is limited
with `workers` unset.

### C — Make the memory provable (2 weeks)

**C1. Store version *and* the read contract, together.**
Before freezing `v: 1`, decide the one thing that changes the format's future: is the day log a
**queryable first-class log** (what E1 needs) or merely backing store behind the index? Write
that into the header of `Memory.ts`, then add `v: 1` to `view.json` and a `meta` line per stream,
a refusal for newer versions, and an empty migration chain with one real migration test.
*Done when:* a `v: 2` store is refused with an actionable message and a `v: 0` fixture migrates.

**C2. `unii doctor`.** Index→record consistency for both streams, tree completeness, view
coverage (covers `0..count`, no gaps or overlap), image referential integrity, orphaned images,
stale locks, bytes per stream.
*Done when:* it catches five planted corruptions (torn index slot, missing node, view gap,
orphan image, stale lock) and passes a clean store.

**C3. Backup and restore.** `unii backup <dir>` (consistent snapshot under the store lock) and
`unii restore <dir>`, retention of the last N, documented RPO/RTO.
*Done when:* a chat exported mid-turn restores into a fresh `UNII_DIR` and answers with an
identical view.

**C4. GC — images and agent logs only.**
Delete unreferenced images and orphaned `docs/agent/` logs; report reclaimed bytes.
**Do not** merge or rewrite day files: every index slot is `(offset, day, length)` per line
(`Memory.place` `Memory.ts:294-301`, `Memory.read` `Memory.ts:303-315`), so rewriting a day file
invalidates all slots pointing into it. Day-file compaction is a separate project that must
rewrite both indexes first — file it, do not schedule it.
*Done when:* a store with planted orphans shrinks and reopens identically, and both indexes are
byte-identical before and after.

**C5. Memory semantics tests.** Property tests over `push`/`fit`/`view`/`down`/`zoom` for slot
uniqueness, `≤ NODE` size, view coverage, monotone detail, side assignment; a crash suite that
`SIGKILL`s mid-`log`, mid-`fit` and mid-compaction and reopens; a torn-line fixture.
*Done when:* mutating `slot()` or `fit()` turns the suite red, and each planted fault is caught
by a named assertion.

**C6. Render goldens.** A fixture directory of server events (streamed thinking, an edit diff, a
table, a paste, an image, a subagent report, an error, a 40-line shell result) → `view_hear` →
`view_rows` → `Html.row_html` and `Paint.rows_lines`, snapshot structurally (tokens, not pixels).
*Done when:* `View.ts`/`Call.ts`/`Paint.ts` each exceed 70% of lines **and** changing
`Theme.FILLED` changes exactly the named snapshot set and nothing else.

**C7. Wire replay.** Record real streamed responses once (redacted) and replay through
`Anthropic.ts`/`OpenAI.ts`: tool call in pieces, `pause_turn`, a refusal, a cut stream, a 429
with `retry-after`, cache usage.
*Done when:* `OpenAI.ts` > 70% lines and both wires return a typed failure for a malformed
stream instead of throwing.

**C8. Proactive concurrency ceiling.** A per-vendor/model semaphore with fair queueing, plus a
per-chat queue depth exposed as state; keep `ROOMS` for react-to-busy.
*Done when:* 100 chats each wanting their full 128 compactions issue ≤ N requests; p95 queue wait
≤ 2× mean service time; no chat waits more than 2× the oldest other chat.

### D — Operations (1 week)

**D1. Structured logging + rotation.** Levels, `chat`/`user`/`call` ids, JSON lines, size
rotation, and a test enforcing the existing rule that user-facing text never carries vendor
detail (`Agent.ts` header).
**D2. Health and metrics.** `/health` with open chats, compaction backlog per side, in-flight
calls per model, store bytes, per-day cost.
*Done when:* backlog is observable during an import and a test asserts the numbers move.
**D3. Handover under load** (the real version of A5): a slow fake vendor, `SIGHUP`, assert the
turn finishes, is billed once, and the socket moved with no dropped message.
**D4. Release artifacts.** Tags, `CHANGELOG`, a workflow building `unii` for darwin-arm64/x64 and
linux-x64/arm64 with checksums attached to the release — the manifest A6 verifies.

### E — Capability and product (2–3 weeks)

**E1. `search` over the memory.** `search {query, regex?, since?, until?, limit}` → `#id date
kind first-matching-line` with the node path, so `zoom` works. Then an inverted index built
where messages are already logged; then a "recently touched topics" line in the view.
*Done when:* on a 100k-message synthetic store `p95 < 150 ms`, recall@5 ≥ 90% on a 30-fact
fixture, and results respect `CAP` paging.
**E2. Tuning harness.** `bench/` replays a recorded chat against a fake vendor and reports tokens,
cache-hit ratio, $/100 messages, and view-build latency for a sweep of `NODE` (256–1024), `HIGH`,
`SEEN`, `BLOCK`, `JOBS` **per side**. Publish the report; make the constants configurable.
**E3. Web/terminal a11y and polish.** Focus order and visible focus, `aria-live` for streaming,
reduced motion, keyboard-only path to every act, mobile viewport, search UI on top of E1.
*Done when:* keyboard-only sign-in → send → zoom → export works, and axe is clean on the chat page.
**E4. iOS is a decision, not a work item.** It is a webview wrapper plus StoreKit/push
(`ios/App/Unii.swift`, 243 lines). Choose: add native value (offline view read, richer
notifications) or accept App Store 4.2 risk as a distribution shell. Decide in writing; do not
discover it at review time.

---

## 5. Premise challenges

1. **Do not rewrite the core, and do not split files for line count.** `Server.ts` (2,189) and
   `Memory.ts` (1,194) are large but cohesive and each opens with a design document. The
   compounding problem is unverifiability. `Memory.ts` + `Disk.ts` is the seam to extract if it
   ever must leave Bun — and only after C1/C2/C5 pin the semantics.
2. **Do not add a framework, ORM, DI container or frontend build system.** Zero runtime
   dependencies outside Bun is a feature. The only new dependencies warranted are in the
   verification chain: `bun-types`, and — for A6/D4 — a checksum manifest. A reproducible build
   (container or Nix) is the one place a heavier dependency earns its place.
3. **Rejected: harden only the hosted deployment.** The README sells self-hosting on your own
   keys, so store integrity and installer integrity *are* the product.
4. **Rejected: vector search for memory.** Embeddings are a new dependency, a new cost, a
   re-embed problem, and they answer a different question than "where did we say X". Substring
   and regex over a log already on disk gets most of the recall for ~1% of the complexity.
   Revisit only if E1's recall measurement says otherwise.
5. **Rejected: fix the rate limiting before fixing the key.** A limit keyed on a client-settable
   header is false assurance; B4 exists because an earlier draft of this plan proposed exactly
   that.

**Strongest counterargument to this plan, and my answer.** The plan's centre of gravity is
internal (correctness, testability). The sharpest external risks are adversarial — the unverified
installer (§1.3) and limits keyed on forgeable input (S2) — and a verification-heavy plan does
not touch them. That is why A6 and B4 sit in the first week and not in Phase D, and why A1–A5 are
hours of work ahead of the multi-day gates. The second half of the counterargument is worse if
ignored: **freezing a store version before deciding whether the log is queryable would lock in
the ceiling E1 exists to raise.** C1 answers it by making the version marker carry the read
contract.

---

## 6. The five-year pass

- **The store format will change.** C1 is the cheapest insurance in this document.
- **Someone will lose everything to a disk event or a bad file.** A1 + C2 + C3 is the difference
  between a bad day and the end of the product.
- **Bun will break something.** B3 and C7 keep upgrades boring.
- **The agent will be slower to find things than the models of the day deserve.** That is E1, the
  only item here that raises the ceiling instead of lowering risk.
- **Nobody will remember why the handover exists.** Every change should leave a line in the header
  of the file it touches. That convention is already this repo's best habit; protect it.

---

## 7. What I did not verify

No vendor calls (no API key): nothing exercises a live model, billing, or the cost claims. No
real user store: store statements come from `Memory.ts` and the coverage report. The web UI, the
terminal and the iOS app were not run. `https://uniichat.com` was not audited. The iOS workflow
was not executed.

---

## 8. Corrections made after adversarial review

Kept, because the reviewer was right: `link_ask` **does** limit `/api/login` (an earlier draft
said it did not); `NETS` covers `/auth` in worker mode only; `Cloud.ip` trusts
`x-forwarded-for` (so the earlier "limit by IP" remedy was unimplementable); `JOBS` is per side
(128 per chat, not 64); the day-file merge in the earlier GC item would corrupt the index;
`Chat.arrive`'s `turn.sent[0]` is a real crash; the `"undefined"` goal is real; the installer is
an unverified pipe; the store version must carry the read contract.

Rejected, because the reviewer was wrong: `view.json` **is** flushed (`Disk.wrote`,
`Memory.ts:243`) — the defect is silent degradation, not durability; and the local-date/UTC path
pair is self-consistent, not a timezone bug. Both were cut rather than softened.
