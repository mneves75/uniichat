// The store (Memory.ts): a chat's log, its tree, and view.json, opened
// again as they were written. These tests hold both sides of the tree's
// build (mem.hold), so no compaction ever asks a vendor: they test the
// store, not the summaries.
//
// What they guard: a message logged is a message read back; the view tiles
// the chat with no gap and no overlap; a slot is one node's; a newer store
// is refused rather than half-read; a view.json a crash cut short is kept
// beside the chat it was rebuilt for, never overwritten as if it were
// never there; a line a crash cut short is skipped, not fatal.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { Memory, type Share } from "./Memory.ts";

// what Memory.load gives back
type Mem = ReturnType<typeof Memory.load>;

const DIRS: string[] = [];

afterAll(() => DIRS.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// what every call of the chat shares with its summaries (none runs here)
const share = (): Share => ({ vendor: "claude-api", model: "sonnet", effort: "medium", speed: "slow", system: "", searches: 0, server: "" });

function dir_new(): string {
  const dir = fs.mkdtempSync("/tmp/unii-memory-test-");
  DIRS.push(dir);
  return dir;
}

// a chat in `dir`, both sides held: nothing builds, so nothing calls out
function mem_new(dir: string): Mem {
  const mem = Memory.load(dir, share);
  mem.hold = ["test", "paused"];
  return mem;
}

function say(mem: Mem, text: string, kind: "user" | "unii" = "user"): void {
  Memory.push(mem, [{ kind, text }]);
}

// the messages a view covers, as [from, to) spans, oldest first (Memory's
// span's end is its last message, not one past it)
function spans(mem: Mem): Array<[number, number]> {
  return mem.view.parts.map((part) => {
    const [a, z] = Memory.span(part);
    return [a, z + 1];
  });
}

test("a message logged is a message read back, and the chat opens again whole", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "first");
  say(mem, "second");
  expect(mem.count).toBe(2);
  expect(Memory.message(mem, 0)?.text).toBe("first");
  expect(Memory.message(mem, 1)?.text).toBe("second");
  const again = mem_new(dir);
  expect(again.count).toBe(2);
  expect(Memory.message(again, 1)?.text).toBe("second");
  expect(Memory.message(again, 2)).toBeNull();
});

test("the view tiles the chat: no gap, no overlap, from the first message to the last", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  for (const text of ["a", "b", "c", "d", "e"]) {
    say(mem, text);
  }
  const tiles = spans(mem);
  expect(tiles[0][0]).toBe(0);
  for (let k = 1; k < tiles.length; k++) {
    expect(tiles[k][0]).toBe(tiles[k - 1][1]);
    expect(tiles[k][0]).toBeGreaterThan(tiles[k - 1][0]);
  }
  expect(tiles[tiles.length - 1][1]).toBe(mem.count);
});

test("a slot is one node's, and never its sibling's or its parent's", () => {
  const slots = new Set<number>();
  for (let l = 0; l < 8; l++) {
    for (let i = 0; i < 16; i++) {
      const slot = Memory.slot(l, i);
      expect(slots.has(slot)).toBe(false);
      slots.add(slot);
    }
  }
});

test("a store written by a newer unii is refused, not half-read", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "kept");
  Memory.save(mem);
  const file = dir + "/view.json";
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, "utf8")), v: 99 }));
  expect(() => Memory.load(dir, share)).toThrow(/newer unii/);
});

test("a view.json a crash cut short is kept beside the chat, which opens whole without it", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "kept");
  mem.goal = "ship it";
  mem.pick = { vendor: "claude-api", model: "opus", effort: "high", speed: "slow" };
  Memory.save(mem);
  fs.writeFileSync(dir + "/view.json", `{"parts": [[0, 0]], "batch":false`);
  const again = Memory.load(dir, share);
  expect(fs.readdirSync(dir).some((name) => name.startsWith("view.json.bad-"))).toBe(true);
  expect(again.count).toBe(1);
  expect(Memory.message(again, 0)?.text).toBe("kept");
  const tiles = spans(again);
  expect(tiles[0][0]).toBe(0);
  expect(tiles[tiles.length - 1][1]).toBe(again.count);
  expect(again.warn).toContain("unreadable");
  expect(again.goal).toBeNull();
  expect(fs.readFileSync(dir + "/view.json", "utf8")).toContain('"v":1');
});

test("the goal and the pick are the chat's: they come back on the next open", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "hello");
  mem.goal = "finish the plan";
  mem.pick = { vendor: "claude-api", model: "opus", effort: "high", speed: "slow" };
  Memory.save(mem);
  const again = mem_new(dir);
  expect(again.goal).toBe("finish the plan");
  expect(again.pick).toEqual({ vendor: "claude-api", model: "opus", effort: "high", speed: "slow" });
  expect(again.warn).toBeUndefined();
});

test("a line a crash cut short is skipped, not fatal, and the chat goes on", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "before");
  const day = Date.parse(new Date().toLocaleDateString("sv-SE")) / 864e5;
  const file = Memory.path(mem, "main", day);
  const before = fs.statSync(file).size;
  fs.appendFileSync(file, '{"kind":"user","text":"cut');
  const again = mem_new(dir);
  expect(again.count).toBe(1);
  expect(Memory.message(again, 0)?.text).toBe("before");
  // the cut line is answered with a newline, so nothing after it is lost
  expect(fs.statSync(file).size).toBeGreaterThan(before);
  say(again, "after");
  expect(mem_new(dir).count).toBe(2);
});

test("search reads the log itself: an old message is found by a word in it", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "the deploy broke because of the redis password");
  say(mem, "unrelated chatter");
  say(mem, "later: check the Redis Password again", "unii");
  const all = Memory.search(mem, "redis password");
  expect(all.hits.map((hit) => hit.id)).toEqual([0, 2]);
  expect(all.hits[0].kind).toBe("user");
  expect(all.hits[1].kind).toBe("unii");
  expect(all.more).toBe(false);
  // a regular expression, and a limit that says when more matched
  expect(Memory.search(mem, "^later:", { regex: true }).hits.map((hit) => hit.id)).toEqual([2]);
  const few = Memory.search(mem, "e", { limit: 1 });
  expect(few.hits.length).toBe(1);
  expect(few.more).toBe(true);
  // a bad pattern is the caller's to report, never a crash
  expect(() => Memory.search(mem, "(", { regex: true })).toThrow();
});

test("search takes a day's range, and nothing matches nothing", () => {
  const dir = dir_new();
  const mem = mem_new(dir);
  say(mem, "kept");
  const today = new Date().toISOString().slice(0, 10);
  expect(Memory.search(mem, "kept", { since: today, until: today }).hits.length).toBe(1);
  expect(Memory.search(mem, "kept", { since: "2999-01-01" }).hits.length).toBe(0);
  expect(Memory.search(mem, "nothere").hits.length).toBe(0);
});
