// Backup
// ======
// `bun Backup.ts save <chat> <to>`, `bun Backup.ts restore <from> <to>`:
// a chat's store, copied and checked (Memory.faults), so the thing the
// product *is* can be kept and brought back.
//
//   bun Backup.ts save ~/.unii/users/<id> /Volumes/backup/<id>
//   bun Backup.ts restore /Volumes/backup/<id> /tmp/restored
//
// A live chat can be saved: the log is append-only, view.json is written
// whole and renamed into place, and a line a copy caught half-written is
// skipped on load (Memory.scan), so a snapshot is consistent at every line
// boundary. A restore into a directory that already holds a chat is
// refused unless it is empty: restoring over a live store is not a thing
// this command does.
//
// Exit 0 when the copy is there and reads as it was written; 1 otherwise.

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";

function usage(): never {
  console.error("usage: bun Backup.ts save <chat> <to>\n       bun Backup.ts restore <from> <to>");
  process.exit(2);
}

function size(dir: string): string {
  let sum = 0;
  for (const sub of ["/main", "/tree", "/docs"]) {
    const path = dir + sub;
    if (fs.existsSync(path)) {
      for (const file of fs.readdirSync(path, { recursive: true })) {
        const at = path + "/" + file;
        if (fs.statSync(at).isFile()) {
          sum += fs.statSync(at).size;
        }
      }
    }
  }
  return sum > 2 ** 20 ? (sum / 2 ** 20).toFixed(1) + " MB" : Math.round(sum / 1024) + " KB";
}

function check(dir: string): boolean {
  const { faults } = Memory.faults(dir);
  for (const fault of faults) {
    console.error("  " + fault.where + ": " + fault.why);
  }
  return faults.length === 0;
}

function empty(path: string): boolean {
  return !fs.existsSync(path) || fs.readdirSync(path).length === 0;
}

function main(): number {
  const [what, from, to] = [process.argv[2], process.argv[3], process.argv[4]];
  if (from === undefined || to === undefined || (what !== "save" && what !== "restore")) {
    usage();
  }
  if (!fs.existsSync(from)) {
    console.error(from + " isn't there.");
    return 1;
  }
  if (!empty(to)) {
    console.error(to + " already holds something: " + what + " into a new or empty directory.");
    return 1;
  }
  // into an empty directory (or a new one): nothing is there to lose
  fs.mkdirSync(to, { recursive: true });
  fs.cpSync(from, to, { recursive: true, force: true });
  if (!check(to)) {
    console.error("the copy at " + to + " does not read as it was written: keep the original, and run `bun Doctor.ts " + from + "`.");
    return 1;
  }
  const count = fs.existsSync(to + "/main.index") ? fs.statSync(to + "/main.index").size / 16 : 0;
  console.log(what + "d " + count + " message" + (count === 1 ? "" : "s") + ", " + size(to) + " → " + to + " (checked)");
  return 0;
}

const code = main();
process.exitCode = code;
// the shell Disk kept for syncfs is the only thing that would hold the
// process open now; if something else does, two seconds is enough
Disk.quit();
setTimeout(() => process.exit(code), 2000).unref();
