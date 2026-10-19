// Chat
// ====
// The two rules a chat's acts and handover had wrong, tested where they can
// fail:
//
// - a goal act with no text is refused by Chat.apply itself (not just by
//   its helper), leaves the goal and view.json alone, and is never read as
//   "halt the goal" or stored as the string "undefined"
// - a chat that moves while its turn has not logged its first message yet
//   bills nothing: reading sent[0] there was a TypeError that could take
//   the worker that had just taken the chat (Chat.billed)

import { afterAll, expect, test } from "bun:test";
import * as fs from "node:fs";
import { Cloud } from "./Cloud.ts";
import { Memory, type Share } from "./Memory.ts";
import { Chat } from "./Server.ts";

const DIRS: string[] = [];

afterAll(() => DIRS.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

const share = (): Share => ({ vendor: "claude-api", model: "sonnet", effort: "medium", speed: "slow", system: "", searches: 0, server: "" });

// a chat with a real store and a real (empty) account store, held so no
// summary is ever asked for: enough for an act that only sets state
function chat_new() {
  const dir = fs.mkdtempSync("/tmp/unii-chat-test-");
  DIRS.push(dir);
  const cloud = Cloud.open(() => {}, () => {}, async () => null);
  const mem = Memory.load(dir, share);
  mem.hold = ["test", "paused"];
  const chat = { acct: { cloud, user: "u" }, mem, socks: new Set(), held: null, acts: new Map(), posts: 0, busy: false } as unknown as Parameters<typeof Chat.apply>[0];
  return { chat, dir };
}

test("a goal act: its text, a halt, and a refusal to guess", () => {
  expect(Chat.goal_text("ship the plan")).toBe("ship the plan");
  expect(Chat.goal_text(null)).toBeNull();
  // no text at all is a client's bug: refused, not a halt
  expect(Chat.goal_text(undefined)).toMatchObject({ status: 400, error: expect.stringContaining("needs its text") });
  expect(Chat.goal_text(42)).toMatchObject({ status: 400 });
  expect(Chat.goal_text({ text: "no" })).toMatchObject({ status: 400 });
  // too long is refused, never cut: it is in every call's prompt
  expect(Chat.goal_text("x".repeat(4001))).toMatchObject({ status: 413 });
  expect(Chat.goal_text("x".repeat(4000))).toHaveLength(4000);
});

test("an act with no goal text is refused, and the chat's goal is left as it was", async () => {
  const { chat, dir } = chat_new();
  let n = 0;
  const goal = (text: unknown) => Chat.apply(chat, { $: "goal", text, id: String(++n) }, "");
  expect(await goal("ship it")).toEqual({});
  expect(chat.mem.goal).toBe("ship it");
  const before = fs.readFileSync(dir + "/view.json", "utf8");
  expect(await goal(undefined)).toMatchObject({ status: 400 });
  expect(chat.mem.goal).toBe("ship it");
  expect(fs.readFileSync(dir + "/view.json", "utf8")).toBe(before);
  expect(await goal("x".repeat(4001))).toMatchObject({ status: 413 });
  expect(chat.mem.goal).toBe("ship it");
  // null is the halt, and still halts
  expect(await goal(null)).toEqual({});
  expect(chat.mem.goal).toBeNull();
});

test("a turn that moved before its first message was logged bills nothing", () => {
  const billed: string[] = [];
  const mem = { pay: (_kind: string, what: string) => (billed.push(what), () => Promise.resolve({ max: 0, cut: null, end: () => {} })) } as unknown as Memory;
  expect(Chat.billed(mem, [])).toBeUndefined();
  expect(billed).toEqual([]);
  // and one with a message bills that message, as before
  expect(Chat.billed(mem, [{ kind: "user", text: "hi", id: 7 } as never])).toBeDefined();
  expect(billed).toEqual(["7"]);
});

// The guard above is one line at a place a test cannot reach (a chat
// arriving over IPC): so nothing may read a turn's first message but
// Chat.billed, which is tested to answer nothing for none. Restoring
// `turn.sent[0].id` anywhere in the server turns this red.
test("no code bills from a turn's sent[0] but Chat.billed", async () => {
  const source = await Bun.file(import.meta.dir + "/Server.ts").text();
  expect(source.match(/sent\[0\]/g) ?? []).toHaveLength(1);
  expect(source).toContain("sent.length === 0 ? undefined : mem.pay?.(\"chat\", String(sent[0].id))");
});
