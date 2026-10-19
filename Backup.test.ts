// Backup and Gc
// =============
// `bun Backup.ts` copies a chat's store and checks the copy reads as it was
// written; `bun Gc.ts` names (and with --apply removes) only the images no
// message names. A restore over a live store is refused.
//
// What these guard: a snapshot restores to the same messages; a copy that
// does not read is reported, not reported as saved; images in use are never
// collected, one nothing names is; and the commands refuse to overwrite.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { Memory, type Share } from "./Memory.ts";

const DIRS: string[] = [];

afterAll(() => DIRS.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const share = (): Share => ({ vendor: "claude-api", model: "sonnet", effort: "medium", speed: "slow", system: "", searches: 0, server: "" });

function dir_new(name: string): string {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-" + name + "-");
  DIRS.push(dir);
  return dir;
}

// a chat of `n` messages, in a directory of its own
function chat(n: number): string {
  const dir = dir_new("chat") + "/users/u";
  fs.mkdirSync(dir, { recursive: true });
  const mem = Memory.load(dir, share);
  mem.hold = ["test", "paused"];
  for (let k = 0; k < n; k++) {
    Memory.push(mem, [{ kind: "user", text: "message " + k }]);
  }
  Memory.save(mem);
  return dir;
}

// runs a command file in a child bun, as `bun Backup.ts` would be run
function run(script: string, args: string[]): { code: number; out: string } {
  const proc = Bun.spawnSync([process.execPath, import.meta.dir + "/" + script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? -1, out: proc.stdout.toString() + proc.stderr.toString() };
}

test("a backup of a chat restores to the same messages, and one that has no fault", () => {
  const dir = chat(3);
  const to = dir_new("backup") + "/u";
  const saved = run("Backup.ts", ["save", dir, to]);
  expect(saved.code).toBe(0);
  expect(saved.out).toContain("3 messages");
  expect(Memory.faults(to).faults).toEqual([]);
  const restored = dir_new("restored") + "/u";
  const back = run("Backup.ts", ["restore", to, restored]);
  expect(back.code).toBe(0);
  const mem = Memory.load(restored, share);
  expect(mem.count).toBe(3);
  expect(Memory.message(mem, 2)?.text).toBe("message 2");
});

test("a restore into a directory that already holds a chat is refused", () => {
  const dir = chat(1);
  const to = dir_new("backup") + "/u";
  expect(run("Backup.ts", ["save", dir, to]).code).toBe(0);
  const busy = chat(2);
  const refused = run("Backup.ts", ["restore", to, busy]);
  expect(refused.code).toBe(1);
  expect(refused.out).toContain("already holds something");
  // and the store it refused to touch is still the chat it was
  expect(Memory.load(busy, share).count).toBe(2);
});

test("gc names the images nothing references, and keeps the ones a message names", () => {
  const dir = chat(1);
  fs.mkdirSync(dir + "/docs/images", { recursive: true });
  const loose = dir + "/docs/images/0123456789abcdef.png";
  fs.writeFileSync(loose, "would be collected");
  // an image a message names, whose file is there: never collected
  const mem = Memory.load(dir, share);
  const kept = "fedcba9876543210.png";
  fs.writeFileSync(dir + "/docs/images/" + kept, "in use");
  Memory.push(mem, [{ kind: "user", text: "see this", images: [kept] }]);
  Memory.save(mem);
  const dry = run("Gc.ts", [dir]);
  expect(dry.code).toBe(0);
  expect(dry.out).toContain("would remove 1");
  expect(fs.existsSync(loose)).toBe(true);
  const applied = run("Gc.ts", [dir, "--apply"]);
  expect(applied.code).toBe(0);
  expect(fs.existsSync(loose)).toBe(false);
  expect(fs.existsSync(dir + "/docs/images/" + kept)).toBe(true);
  // nothing left to collect
  expect(run("Gc.ts", [dir]).out).toContain("nothing to collect");
});
