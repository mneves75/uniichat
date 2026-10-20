// Render
// ======
// The two renderers over the view's rows (`View.entry_rows` → `Row[]`):
// `web/src/Html.ts` for the site, and `Paint.ts` for the terminal. Both are
// pure, so both can be held to a golden: the web's markup as it is, and the
// terminal's plain text at a fixed width.
//
// What this guards: every message kind the model or a tool can produce draws
// as something (a call's emoji and line, a diff's marks, a table's headers,
// a report's frame), and a style change moves the snapshots on purpose
// rather than by accident. It is the only gate on `Call.ts`, which no other
// test reaches.

import { expect, test } from "bun:test";
import * as Paint from "./Paint.ts";
import { entry_rows, type Row } from "./View.ts";
import * as Html from "./web/src/Html.ts";

// id, kind, text: a message of each shape the app draws
const FIXTURES: Array<[number, "user" | "work" | "mind" | "unii" | "tool" | "echo" | "note", string]> = [
  // a user's own words are drawn as typed, not read as markdown (Md.md_plain):
  // the asterisks stay, and this golden says so on purpose
  [1, "user", "make the landing page faster: **LCP** under 2.5 s, and keep it readable"],
  [2, "unii", "Three things, in order:\n\n1. defer the blocking script\n2. serve the images as WebP\n3. re-measure\n\n> Lighthouse 62 → 90 on the same build\n\n```js\nconst x = await measure();\n```"],
  [3, "tool", 'shell {"command":"npx lighthouse http://localhost:3000 --quiet"}'],
  [4, "echo", "result: performance 62 · accessibility 91 · 1.2 MB of JPEG\n\n--- a/web/index.html\n+++ b/web/index.html\n@@ -1,2 +1,2 @@\n-<script src=\"/app.js\"></script>\n+<script src=\"/app.js\" defer></script>"],
  [5, "tool", 'edit {"edits":[{"path":"web/index.html","old":"a","new":"b"},{"path":"web/style.css","old":"c","new":"d"}]}'],
  [6, "tool", 'search {"query":"deploy port","newest":true}'],
  [7, "tool", 'zoom {"id":6243,"n":4}'],
  [8, "work", "[FireAnt]\ndone: the image set is WebP, 480 KB → 96 KB"],
  [9, "mind", "the largest file is the hero; it can be resized before conversion"],
  [10, "note", "An import is paused: its credit ran out."],
  [11, "unii", "| step | before | after |\n|---|---|---|\n| LCP | 4.1 s | 1.9 s |\n| size | 1.2 MB | 210 KB |"],
  [12, "unii", ""],
];

function rows(): Array<{ rows: Row[]; name: string }> {
  return FIXTURES.map(([id, kind, text]) => ({ rows: entry_rows(id, kind, text), name: kind + " #" + id }));
}

test("the site's markup: one golden per message kind", () => {
  const drawn = rows().map(({ rows: made, name }) => name + "\n" + made.map((row) => Html.row_html(row)).join("\n"));
  expect(drawn.join("\n\n")).toMatchSnapshot();
});

test("the terminal's text at 80 columns: one golden per message kind", () => {
  const drawn = rows().map(({ rows: made, name }) => {
    const lines = Paint.rows_lines(made, 80).map((line) => line.map((run) => run.x).join(""));
    return name + "\n" + lines.join("\n");
  });
  expect(drawn.join("\n\n")).toMatchSnapshot();
});

test("a terminal line never passes the width, whatever the message holds", () => {
  for (const { rows: made, name } of rows()) {
    for (const line of Paint.rows_lines(made, 40)) {
      const text = line.map((run) => run.x).join("");
      // a link's url is carried in the ink, not printed past the edge
      expect({ name, width: text.length, text }).toEqual({ name, width: text.length, text });
      expect(text.length).toBeLessThanOrEqual(40);
    }
  }
});
