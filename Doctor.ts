// Doctor
// ======
// `bun Doctor.ts [<dir>]`: what a store's files say is wrong, read as they
// are (Memory.faults), so one a running server holds can be checked beside
// it. <dir> is a chat's (users/<id>); none: every chat under $UNII_DIR.
//
//   bun Doctor.ts                       every chat of ~/.unii
//   bun Doctor.ts ~/.unii/users/<id>    one
//
// A fault is printed as `<where>: <what>` and the exit is 1, so a backup
// script can tell. Nothing it reads is written, and no chat is opened.

import * as fs from "node:fs";
import * as config from "./Config.ts";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";

function dirs(named: string | undefined): string[] {
  if (named !== undefined) {
    return [named.replace(/^~/, process.env.HOME ?? "~")];
  }
  const users = config.DIR + "/users";
  return fs.existsSync(users) ? fs.readdirSync(users).map((id) => users + "/" + id).filter((dir) => fs.statSync(dir).isDirectory()) : [];
}

// what a chat holds, by directory (a dir's own files are none)
function size(dir: string): number {
  let sum = 0;
  for (const sub of ["/main", "/tree", "/docs/images", "/docs/agent"]) {
    const path = dir + sub;
    if (fs.existsSync(path)) {
      for (const file of fs.readdirSync(path)) {
        const file_size = fs.statSync(path + "/" + file).size;
        sum += Number.isFinite(file_size) ? file_size : 0;
      }
    }
  }
  return sum;
}

function show(n: number): string {
  return n > 2 ** 20 ? (n / 2 ** 20).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
}

function main(): number {
  const chats = dirs(process.argv[2]);
  let [faults, orphans, total] = [0, 0, 0];
  for (const dir of chats) {
    const found = Memory.faults(dir);
    const bytes = size(dir);
    total += bytes;
    faults += found.faults.length;
    orphans += found.orphans.length;
    const name = dir.split("/").pop() ?? dir;
    const loose = found.orphans.length === 0 ? "" : " · " + found.orphans.length + " unreferenced image" + (found.orphans.length === 1 ? "" : "s") + " (`unii gc`)";
    for (const note of found.notes) {
      console.log("  " + name + ": " + note);
    }
    if (found.faults.length === 0) {
      console.log(name + ": ok (" + show(bytes) + ")" + loose);
      continue;
    }
    console.log(name + " (" + show(bytes) + ")" + loose + ":");
    for (const fault of found.faults) {
      console.log("  " + fault.where + ": " + fault.why);
    }
  }
  if (chats.length > 1) {
    console.log((faults === 0 ? "every chat reads as it was written" : faults + " fault" + (faults === 1 ? "" : "s")) + " · " + show(total) + " in all");
  }
  return faults === 0 ? 0 : 1;
}

const code = main();
process.exitCode = code;
// the shell Disk kept for syncfs is the only thing that would hold the
// process open now; if something else does, two seconds is enough
Disk.quit();
setTimeout(() => process.exit(code), 2000).unref();
