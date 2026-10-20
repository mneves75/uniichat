// Gc
// ==
// `bun Gc.ts <chat> [--apply]`: the images no message names, and what they
// take. Only images: a summary line's id and an agent's log are both
// references a later `zoom` follows, and a log deleted here would make
// zoom("Name") answer nothing, so they are named, never removed.
//
//   bun Gc.ts ~/.unii/users/<id>            what would go
//   bun Gc.ts ~/.unii/users/<id> --apply    remove it
//
// An image is written once, by its hash, and never rewritten: one no
// message names is a crash's leftover or a message logged before its
// image was (Memory.image_add writes the file, then the message), so a
// server still running can be collected safely. Nothing else is touched.

import * as fs from "node:fs";
import { Disk } from "./Disk.ts";
import { Memory } from "./Memory.ts";

const IMAGE = /^[0-9a-f]{16}\.[a-z]+(\.jpg)?$/;

function show(n: number): string {
  return n > 2 ** 20 ? (n / 2 ** 20).toFixed(1) + " MB" : Math.round(n / 1024) + " KB";
}

function main(): number {
  const dir = process.argv[2];
  if (dir === undefined || !fs.existsSync(dir)) {
    console.error("usage: bun Gc.ts <chat> [--apply]");
    return 2;
  }
  const apply = process.argv.includes("--apply");
  const { orphans } = Memory.faults(dir);
  const loose = orphans.filter((name) => IMAGE.test(name)).map((name) => dir + "/docs/images/" + name);
  if (loose.length === 0) {
    console.log("nothing to collect: every image is named by a message");
    return 0;
  }
  let bytes = 0;
  for (const file of loose) {
    bytes += fs.statSync(file).size;
    if (apply) {
      fs.rmSync(file, { force: true });
    }
  }
  console.log((apply ? "removed " : "would remove ") + loose.length + " unreferenced image" + (loose.length === 1 ? "" : "s") + " (" + show(bytes) + ")" + (apply ? "" : ": run with --apply"));
  return 0;
}

const code = main();
process.exitCode = code;
// the shell Disk kept for syncfs is the only thing that would hold the
// process open now; if something else does, two seconds is enough
Disk.quit();
setTimeout(() => process.exit(code), 2000).unref();
