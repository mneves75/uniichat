// Chat
// ====
// The two rules a chat's acts and handover had wrong, tested where they can
// fail:
//
// - a goal act with no text is refused, never read as "halt the goal" and
//   never stored as the string "undefined" (it goes in every call's prompt)
// - a chat that moves while its turn has not logged its first message yet
//   bills nothing: reading sent[0] there was a TypeError that could take
//   the worker that had just taken the chat (Chat.billed)

import { expect, test } from "bun:test";
import { Chat } from "./Server.ts";
import type { Memory } from "./Memory.ts";

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

test("a turn that moved before its first message was logged bills nothing", () => {
  const billed: string[] = [];
  const mem = { pay: (_kind: string, what: string) => (billed.push(what), () => Promise.resolve({ max: 0, cut: null, end: () => {} })) } as unknown as Memory;
  expect(Chat.billed(mem, [])).toBeUndefined();
  expect(billed).toEqual([]);
  // and one with a message bills that message, as before
  expect(Chat.billed(mem, [{ kind: "user", text: "hi", id: 7 } as never])).toBeDefined();
  expect(billed).toEqual(["7"]);
});
