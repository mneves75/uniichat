// Style
// =====
// `web/style.css` is served as a file, so a mistake in it is not caught by
// a type or a build: it is caught here. A custom property declared twice
// in `:root` silently wins by order, which is how a redesigned measure
// (`--col: 41rem`) can be dead on arrival (the later `--col: 740px` wins),
// and how a colour fix can look applied and not be.

import { expect, test } from "bun:test";

const css = await Bun.file(import.meta.dir + "/web/style.css").text();

// every `:root { ... }` block, with the media query it sits in (null: the
// page's own): the dark palette repeats every name on purpose, but no
// block may repeat one, and two page-level blocks may not collide
function roots(): Array<{ media: string; body: string }> {
  return [...css.matchAll(/:root\s*\{([^}]*)\}/g)].map((match) => {
    const before = css.slice(Math.max(0, (match.index ?? 0) - 240), match.index);
    return { media: /@media[^{]*\{?\s*$/.exec(before)?.[0] ?? "", body: match[1] };
  });
}

test("no custom property is declared twice in one scope", () => {
  const scopes = new Map<string, string[]>();
  for (const { media, body } of roots()) {
    const names = scopes.get(media) ?? [];
    names.push(...[...body.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]));
    scopes.set(media, names);
  }
  for (const [media, names] of scopes) {
    expect({ scope: media, twice: names.filter((name, at) => names.indexOf(name) !== at) }).toEqual({ scope: media, twice: [] });
  }
});

test("no custom property is declared twice in one narrow-screen block", () => {
  for (const [, body] of css.matchAll(/@media[^{]*\{\s*:root\s*\{([^}]*)\}/g)) {
    const names = [...body.matchAll(/(--[a-z-]+)\s*:/g)].map((match) => match[1]);
    expect(new Set(names).size).toBe(names.length);
  }
});

test("the text colours a phone can be read at: --soft is not a hint for real words", () => {
  // #6c6c74 on #ffffff is 5.2:1; the value that carried 11.5 px labels at
  // 3.7:1 was #85858d, and it must not come back
  expect(css).not.toContain("--soft   : #85858d");
  expect(css).toMatch(/--soft\s*: #6c6c74/);
});
