// Journal
// =======
// The server's own words: one line a message, `unii: <level>: <what>`, or
// one JSON object a line when UNII_LOG=json, so a collector can read it and
// an operator can too. What these guard: the two shapes, the three levels,
// and that a message a person should read never sneaks in here (grep).

import { expect, test } from "bun:test";
import * as fs from "node:fs";
import { Journal } from "./Journal.ts";

test("a line is a level and what happened, or one JSON object", () => {
  expect(Journal.format("error", "compactor: node 3/4: timeout", false)).toBe("unii: error: compactor: node 3/4: timeout");
  const json = JSON.parse(Journal.format("warn", "view.json of users/u was unreadable", true));
  expect(json).toMatchObject({ level: "warn", what: "view.json of users/u was unreadable" });
  expect(new Date(json.at).toISOString()).toBe(json.at);
  // a value that is not a string is still one line
  expect(Journal.format("info", undefined as unknown as string, false)).toBe("unii: info: undefined");
});

test("the server logs through the journal, never around it, and never a person's message", () => {
  const server = ["Server.ts", "Agent.ts", "Memory.ts", "Mail.ts", "Disk.ts", "Cloud.ts"];
  for (const name of server) {
    const source = fs.readFileSync(import.meta.dir + "/" + name, "utf8");
    expect({ name, bare: source.match(/\bconsole\.(log|error|warn)\b/g) }).toEqual({ name, bare: null });
    expect({ name, imports: source.includes('from "./Journal.ts"') }).toEqual({ name, imports: true });
  }
});
