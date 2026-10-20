// Wire
// ====
// `rg -n "type State" Anthropic.ts OpenAI.ts` for the shapes.
// The two vendors' streams, replayed: the events are the ones each API really
// sends (Anthropic's Messages SSE and OpenAI's Responses events), reduced to
// the fields the readers use. Nothing here calls out: `read` is fed an event
// at a time, exactly as the loop feeds it, and `step` is asked for the call's
// end.
//
// What this guards (both readers were the least-tested code with a vendor in
// it: OpenAI.ts 17%): text in pieces, a tool call whose JSON arrives in
// pieces, the stop reasons that mean "go on", a refusal, a cut stream, an
// error event, and the speed note. A malformed stream must end as a typed
// failure, never a thrown exception.

import { expect, test } from "bun:test";
import { Anthropic } from "./Anthropic.ts";
import { OpenAI } from "./OpenAI.ts";
import type { Ask } from "./AskAI.ts";

const ASK: Ask = { vendor: "claude-api", model: "claude-sonnet-5-5", effort: "medium", speed: "slow", system: "", searches: 0, server: "", blocks: [] };

function anthropic(events: any[]): { texts: string[]; step: ReturnType<typeof Anthropic.step> } {
  const st = Anthropic.wire.start(ASK);
  const texts: string[] = [];
  const on = (kind: string, text: string) => texts.push(kind + ":" + text);
  for (const ev of events) {
    Anthropic.read(st, ev, on);
  }
  return { texts, step: Anthropic.step(st, ASK) };
}

function openai(events: any[]): { texts: string[]; step: ReturnType<typeof OpenAI.step> } {
  const st = OpenAI.wire.start(ASK);
  const texts: string[] = [];
  const on = (kind: string, text: string) => texts.push(kind + ":" + text);
  for (const ev of events) {
    OpenAI.read(st, ev, on);
  }
  return { texts, step: OpenAI.step(st, ASK) };
}

test("anthropic: text arrives in pieces, and the call ends when it stops", () => {
  const { texts, step } = anthropic([
    { type: "message_start", message: { usage: { input_tokens: 12, output_tokens: 0 } } },
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Two things" } },
    { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: ", in order." } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 9 } },
    { type: "message_stop" },
  ]);
  // a vendor's text reaches the view as Unii's own words, in pieces
  expect(texts).toEqual(["unii:Two things", "unii:, in order."]);
  expect(step.stop).toBe("done");
  expect(step.uses).toEqual([]);
  expect((step.out[0] as any).text).toBe("Two things, in order.");
});

test("anthropic: a tool call whose JSON arrives in pieces is one call, and the step asks for tools", () => {
  const { step } = anthropic([
    { type: "message_start", message: { usage: {} } },
    { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "shell", input: {} } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: '{"comm' } },
    { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: 'and":"ls -la"}' } },
    { type: "content_block_stop", index: 0 },
    { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: {} },
    { type: "message_stop" },
  ]);
  expect(step.uses).toEqual([{ id: "toolu_1", name: "shell", input: { command: "ls -la" } }]);
  expect(step.stop).toBe("tools");
});

test("anthropic: pause_turn continues, a refusal fails, an error is busy, a cut stream is not done", () => {
  const paused = anthropic([{ type: "message_delta", delta: { stop_reason: "pause_turn" }, usage: {} }]).step;
  expect(paused.stop).toBe("again");
  const refused = anthropic([{ type: "message_delta", delta: { stop_reason: "refusal" }, usage: {} }]).step;
  expect(refused.stop).toBe("fail");
  const error = anthropic([{ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }]).step;
  expect(error.stop).toBe("busy");
  expect(error.why).toContain("overloaded_error");
  // a stream that ends with no stop reason at all is a failure, not a finish
  const cut = anthropic([{ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }]).step;
  expect(cut.stop).not.toBe("done");
});

test("openai: a message and a function call in one response", () => {
  const { step } = openai([
    { type: "response.created" },
    {
      type: "response.completed",
      response: {
        status: "completed",
        service_tier: "default",
        output: [
          { type: "message", role: "assistant", content: [{ type: "output_text", text: "Checking." }] },
          { type: "function_call", call_id: "call_1", name: "read", arguments: '{"path":"a.ts"}' },
        ],
      },
    },
  ]);
  expect(step.stop).toBe("tools");
  expect(step.uses).toEqual([{ id: "call_1", name: "read", input: { path: "a.ts" } }]);
});

test("openai: a refusal, an incomplete response, a server error, and a cut stream are each typed", () => {
  const refusal = openai([{ type: "response.completed", response: { status: "completed", output: [{ type: "message", content: [{ type: "refusal", refusal: "I can't help with that." }] }] } }]).step;
  expect(refusal.stop).toBe("fail");
  expect(refusal.why).toContain("refused");
  const incomplete = openai([{ type: "response.completed", response: { status: "incomplete", incomplete_details: { reason: "max_output_tokens" }, output: [] } }]).step;
  expect(incomplete.stop).toBe("fail");
  expect(incomplete.why).toContain("max_output_tokens");
  // OpenAI's error event is flat (`code` beside `type`), which is what the
  // reader reads: a nested one is a different event, and fails rather than
  // being retried for ever
  const busy = openai([{ type: "error", code: "server_error", message: "overloaded" }]).step;
  expect(busy.stop).toBe("busy");
  expect(openai([{ type: "error", error: { code: "server_error" } }]).step.stop).toBe("fail");
  // nothing at all: a failure, not a finished turn
  expect(openai([]).step.stop).toBe("fail");
});

test("both readers survive an event neither expects", () => {
  expect(() => anthropic([{ type: "ping" }, { type: "something_new", at: 1 }])).not.toThrow();
  expect(() => openai([{ type: "response.output_item.added", item: { type: "web_search_call" } }])).not.toThrow();
});
