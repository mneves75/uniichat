// Recall
// ======
// `bun bench/recall.ts [--check]`: what the memory's retrieval actually does,
// on a synthetic chat big enough to page: recall@5, whether "what is true
// now" is answered by the newest message, the paging case that `newest`
// exists for, the latency, and the gap that a substring search cannot close
// (a question whose words never appear together in the log).
//
//   bun bench/recall.ts            the report
//   bun bench/recall.ts --check    exit 1 if recall, staleness or p95 miss
//
// It calls no vendor: the chat is logged with both sides of the tree held
// (Memory.hold), so nothing is summarised. The numbers are the store's, not
// a model's; a model's contribution is E2's next half.

import * as fs from "node:fs";
import { Memory, type Share } from "../Memory.ts";

const CHECK = process.argv.includes("--check");
const FACTS = 40;
const FILLER = 4000;

const share = (): Share => ({ vendor: "claude-api", model: "sonnet", effort: "medium", speed: "slow", system: "", searches: 0, server: "" });

function say(mem: Memory.Memory, text: string): void {
  Memory.push(mem, [{ kind: "user", text }]);
}

// a store of filler, with one fact and its later correction per project
function store(): { mem: Memory.Memory; dir: string; facts: Array<{ token: string; was: number; now: number }> } {
  const dir = fs.mkdtempSync("/tmp/unii-recall-");
  const mem = Memory.load(dir, share);
  mem.hold = ["bench", "paused"];
  const words = "deploy build review deploy queue latency cache index branch commit release rollback staging bundle render".split(" ");
  let seed = 7;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2147483648) % words.length;
  const facts: Array<{ token: string; was: number; now: number }> = [];
  const fact_at = new Map<number, number>();
  for (let k = 0; k < FACTS; k++) {
    fact_at.set(300 + k * 70, k);
  }
  for (let k = 0; k < FILLER; k++) {
    const fact = fact_at.get(k);
    if (fact !== undefined) {
      const token = "PROJ" + String(fact).padStart(2, "0") + "X";
      facts.push({ token, was: mem.count, now: -1 });
      say(mem, "note: " + token + " deploy port is " + (8000 + fact));
      continue;
    }
    say(mem, "step " + k + ": " + words[next()] + " " + words[next()] + " went fine");
  }
  for (const fact of facts) {
    fact.now = mem.count;
    say(mem, "correction: " + fact.token + " deploy port is " + (9000 + facts.indexOf(fact)) + " now");
  }
  Memory.save(mem);
  return { mem, dir, facts };
}

// the first `n` hits, and how long it took
function search(mem: Memory.Memory, query: string, newest = false, limit = 5): { ids: number[]; ms: number } {
  const at = performance.now();
  const { hits } = Memory.search(mem, query, { newest, limit });
  return { ids: hits.map((hit) => hit.id), ms: performance.now() - at };
}

function p95(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function main(): number {
  const { mem, dir, facts } = store();
  const latencies: number[] = [];

  // 1. recall@5: a question whose token appears only in its own fact and its
  //    correction (a substring search's best case, by construction)
  let found = 0;
  for (const fact of facts) {
    const { ids, ms } = search(mem, fact.token);
    latencies.push(ms);
    if (ids.includes(fact.was) || ids.includes(fact.now)) {
      found += 1;
    }
  }
  const recall = found / facts.length;

  // 2. staleness: the question "what is it now" — newest first must answer
  //    with the correction, oldest first with the value it replaced
  let newest_ok = 0;
  let oldest_ok = 0;
  for (const fact of facts) {
    const newest = search(mem, fact.token, true);
    const oldest = search(mem, fact.token, false);
    latencies.push(newest.ms, oldest.ms);
    if (newest.ids[0] === fact.now) {
      newest_ok += 1;
    }
    if (oldest.ids[0] === fact.was) {
      oldest_ok += 1;
    }
  }
  const staleness = newest_ok / facts.length;

  // 3. paging: a word in thousands of messages. `limit` is capped at 100 with
  //    no cursor, so before `newest` the latest mention was unreachable
  const common = "went fine";
  const latest = search(mem, common, true, 100);
  const earliest = search(mem, common, false, 100);
  latencies.push(latest.ms, earliest.ms);
  const paging = latest.ids[0] > earliest.ids[0];

  // 4. the gap a substring search cannot close: a question in the user's own
  //    words, stored in the tool's words. Reported, never hidden.
  say(mem, "the mongo box is gone: the database is Postgres now");
  Memory.save(mem);
  const paraphrase = search(mem, "kill the mongo box database").ids.length;
  const exact = search(mem, "database is Postgres").ids.length;

  const p95_ms = p95(latencies);
  const line = (name: string, value: string) => console.log(name.padEnd(34) + value);
  console.log("recall harness · " + FILLER + " filler messages, " + FACTS + " facts, each corrected once");
  line("recall@5 (unique token)", (recall * 100).toFixed(1) + "%  (" + found + "/" + facts.length + ")");
  line("newest first answers the latest", (staleness * 100).toFixed(1) + "%  (" + newest_ok + "/" + facts.length + ")");
  line("oldest first answers the old one", (oldest_ok / facts.length) * 100 + "%  (by design: the trap)");
  line("paging: newest reachable", paging ? "yes" : "NO");
  line("search p95", p95_ms.toFixed(1) + " ms");
  line("paraphrase (words never together)", paraphrase + " hits  (the gap a substring search has)");
  line("exact words", exact + " hits");
  fs.rmSync(dir, { recursive: true, force: true });

  if (!CHECK) {
    return 0;
  }
  const bad = recall < 0.95 || staleness < 0.95 || !paging || p95_ms > 300;
  if (bad) {
    console.error("missed: recall, staleness, paging or p95");
  }
  return bad ? 1 : 0;
}

process.exitCode = main();
