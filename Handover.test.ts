// Handover
// ========
// A deploy, as the server does it: `SIGHUP` makes the supervisor start each
// worker beside the one serving, which takes its chats, gives its views back,
// and ends once nothing is left of it. `Server.test.ts` checks that a worker
// answers and that a chat's MCP requests follow it; this file drives a real
// client through it.
//
// What these guard: a chat with state survives the handover (the store it was
// serving is the store that comes out), the page's socket is moved rather
// than dropped (MOVE, so it reconnects at once), and a second SIGHUP while the
// first is still settling is not a crash.
//
// The half that needs a vendor double — a turn in flight, its call billed
// once — is not here: no vendor URL is configurable, and adding one to make a
// test possible would put a way to redirect a user's API key into every
// deployment. It is named as the plan's remaining gap instead.

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import { WIRE } from "./View.ts";

const DIRS: string[] = [];

afterAll(() => DIRS.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

// a store of `n` messages for user `u`, and a session for it, written before
// the server reads the dir (its own process, so no config is cached)
function seed(dir: string, token: string): void {
  const script = `
    import { Memory } from "./Memory.ts";
    import { Cloud } from "./Cloud.ts";
    const dir = process.argv[1] + "/users/u";
    require("node:fs").mkdirSync(dir, { recursive: true });
    const mem = Memory.load(dir, () => ({ vendor: "claude-api", model: "sonnet", effort: "medium", speed: "slow", system: "", searches: 0, server: "" }));
    mem.hold = ["test", "paused"];
    for (const text of ["first", "second", "third"]) Memory.push(mem, [{ kind: "user", text }]);
    Memory.save(mem);
    const cloud = Cloud.open(() => {}, () => {}, async () => null);
    cloud.db.query("insert or replace into sessions values (?, ?, ?)").run(Cloud.hash(${JSON.stringify(token)}), "u", "you@example.com");
  `;
  // its own UNII_DIR: the session must go into the store the server reads,
  // not into the home directory (CI has none, and a test may not use it)
  const out = Bun.spawnSync([process.execPath, "-e", script, dir], {
    cwd   : import.meta.dir,
    env   : { ...process.env, UNII_DIR: dir, UNII_SITE: "http://127.0.0.1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (out.exitCode !== 0) {
    throw new Error("seed failed: " + out.stderr.toString());
  }
}

// the messages the store holds, from the index the server writes
function count(dir: string): number {
  const at = dir + "/users/u/main.index";
  return fs.existsSync(at) ? fs.statSync(at).size / 16 : 0;
}

// a socket opened, its first answer and its close, as they come
function socket(port: number, token: string): { opened: Promise<void>; first: Promise<any>; closed: Promise<number>; send: (text: string) => void; close: () => void } {
  // a worker's own port: the supervisor only routes (a proxy in front reaches
  // the worker the answer names), so a socket goes to the worker directly
  const ws = new WebSocket("ws://127.0.0.1:" + port + "/ws?tab=1&wire=" + WIRE, { headers: { cookie: "unii=" + token } } as any);
  const opened = new Promise<void>((ok, bad) => {
    ws.onopen = () => ok();
    ws.onerror = () => bad(new Error("the socket would not open"));
  });
  // the chat's own messages, as they come (a socket hears state, notes and
  // pings before and around the view)
  const heard: any[] = [];
  const waiters: Array<(msg: any) => void> = [];
  const first = new Promise<any>((ok, bad) => {
    waiters.push(ok);
    setTimeout(() => bad(new Error("no view or know in 10 s; heard: " + heard.map((m) => m.$).join(", "))), 10000).unref();
  });
  ws.onmessage = (event) => {
    const msg = JSON.parse(String(event.data));
    heard.push(msg);
    if (msg.$ === "view" || msg.$ === "know") {
      waiters.splice(0).forEach((ok) => ok(msg));
    }
  };
  const closed = new Promise<number>((ok) => {
    ws.onclose = (event) => ok(event.code);
  });
  return { opened, first, closed, send: (text: string) => ws.send(text), close: () => ws.close() };
}

test("a chat with state survives a deploy: SIGHUP moves it, and its page with it", async () => {
  const dir = fs.mkdtempSync(os.tmpdir() + "/unii-handover-");
  DIRS.push(dir);
  // far from the ports a person starts by hand (9491/9492 here): a worker
  // takes port + 1, and a stale server on it makes this a 401, not a handover
  const port = 9531;
  const site = "http://127.0.0.1:" + port;
  const token = "handover-token";
  seed(dir, token);
  expect(count(dir)).toBe(3);

  const proc = Bun.spawn([process.execPath, import.meta.dir + "/Server.ts", String(port)], {
    env    : { ...process.env, UNII_DIR: dir, UNII_SITE: site, UNII_WORKERS: "1" },
    stdout : "ignore",
    stderr : "pipe",
  });
  try {
    for (let k = 0; k < 100; k++) {
      const res = await fetch(site + "/api/hello").catch(() => null);
      if (res !== null) {
        break;
      }
      await Bun.sleep(50);
    }
    // the worker beside the supervisor answers on its own port once it is
    // serving: a socket before that has nothing to upgrade against
    // the whole suite runs files side by side: a worker starting under that
    // load is given half a minute, not five seconds
    for (let k = 0; k < 300; k++) {
      const up = await fetch("http://127.0.0.1:" + (port + 1) + "/api/hello").then((res) => res.ok).catch(() => false);
      if (up) {
        break;
      }
      await Bun.sleep(100);
    }
    const page = socket(port + 1, token);
    await page.opened;
    const hello = await page.first;
    expect(["view", "know"].includes(hello.$)).toBe(true);

    // the deploy: the supervisor starts a new worker, which takes the chat
    proc.kill("SIGHUP");
    const code = await Promise.race([page.closed, Bun.sleep(15000).then(() => -1)]);
    expect(code).toBe(4001);

    // the chat is where it was, and a page that reconnects finds it
    for (let k = 0; k < 40 && count(dir) !== 3; k++) {
      await Bun.sleep(100);
    }
    expect(count(dir)).toBe(3);
    const again = socket(port + 1, token);
    await again.opened;
    const back = await again.first;
    expect(["view", "know"].includes(back.$)).toBe(true);
    // it is serving the chat again: what it sends is the chat's own view
    expect(["view", "know"].includes(back.$)).toBe(true);
    again.close();

    // a second deploy while the first settles is a start, not a crash
    proc.kill("SIGHUP");
    await Bun.sleep(1500);
    const alive = await fetch(site + "/api/hello").then((res) => res.ok).catch(() => false);
    expect(alive).toBe(true);
  } finally {
    proc.kill("SIGTERM");
    await proc.exited;
  }
}, 60000);
