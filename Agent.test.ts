// Agent.gate
// ==========
// One model's requests in this process, capped: an importing chat runs
// JOBS a side (Memory.starts), so a few imports at once used to open
// hundreds of paid requests and learn it from the vendor's 429.
//
// What these guard: at most CAP run at once; a turn's request is served
// before an import's, however many came first; a request stopped while it
// waits takes no place (and leaks none), so a burst of stops never
// starves the model.

import { expect, test } from "bun:test";
import { Agent } from "./Agent.ts";

// what a waiter did: "ran" once it holds a place, "waits" while it does not
type Probe = { state: "ran" | "waits"; done: () => void };

function ask(model: string, low: boolean, signal = new AbortController().signal): Probe {
  const probe: Probe = { state: "waits", done: () => {} };
  Agent.gate(model, low, signal).then((done) => {
    probe.state = "ran";
    probe.done = done;
  });
  return probe;
}

// one turn of the event loop, which is all a grant needs to land
const settle = () => new Promise((ok) => setTimeout(ok, 5));

test("a model runs CAP requests at once, and the next waits", async () => {
  const probes = Array.from({ length: Agent.CAP }, () => ask("gate-test-1", true));
  const extra = ask("gate-test-1", true);
  await settle();
  expect(probes.every((probe) => probe.state === "ran")).toBe(true);
  expect(extra.state).toBe("waits");
  probes[0].done();
  await settle();
  expect(extra.state).toBe("ran");
  probes.slice(1).forEach((probe) => probe.done());
  extra.done();
});

test("a turn's request goes before an import's, whatever came first", async () => {
  const running = Array.from({ length: Agent.CAP }, () => ask("gate-test-2", true));
  const importing = ask("gate-test-2", true);
  const turn = ask("gate-test-2", false);
  await settle();
  expect(importing.state).toBe("waits");
  expect(turn.state).toBe("waits");
  running[0].done();
  await settle();
  expect(turn.state).toBe("ran");
  expect(importing.state).toBe("waits");
  running.slice(1).forEach((probe) => probe.done());
  turn.done();
  await settle();
  expect(importing.state).toBe("ran");
  importing.done();
});

test("a request stopped while it waits takes no place, and leaks none", async () => {
  const running = Array.from({ length: Agent.CAP }, () => ask("gate-test-3", true));
  const stop = new AbortController();
  const stopped = ask("gate-test-3", false, stop.signal);
  const behind = ask("gate-test-3", false);
  await settle();
  stop.abort();
  await settle();
  running.forEach((probe) => probe.done());
  await settle();
  expect(behind.state).toBe("ran");
  behind.done();
  // every place given back: a fresh burst of CAP all run, a CAP+1 one waits
  const again = Array.from({ length: Agent.CAP }, () => ask("gate-test-3", true));
  const over = ask("gate-test-3", true);
  await settle();
  expect(again.every((probe) => probe.state === "ran")).toBe(true);
  expect(over.state).toBe("waits");
  again.forEach((probe) => probe.done());
  await settle();
  expect(over.state).toBe("ran");
  over.done();
});
