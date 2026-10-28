import { assertEquals, assertThrows } from "@std/assert";
import {
  charOf,
  className,
  codePoint,
  countBySet,
  cssContent,
  type Glyph,
  htmlEntity,
  inSet,
  isGlyphData,
  jsEscape,
  parseGlyphnames,
  remember,
  searchGlyphs,
  shortTitle,
} from "./lib.ts";
import fallback from "./fallback.json" with { type: "json" };

// A sample of the official glyphnames.json (the real file is ~550 KB).
const SAMPLE: Record<string, unknown> = {
  METADATA: { website: "https://www.nerdfonts.com", version: "3.5.1", date: "2026-08-21 13:56:47+00:00" },
  "cod-folder_opened": { char: "", code: "eaf7" },
  "custom-folder_open": { char: "", code: "e5fe" },
  "dev-git": { char: "", code: "e702" },
  "dev-archlinux": { char: "", code: "e732" },
  "fa-folder_open": { char: "", code: "f07c" },
  "fa-folder_open_o": { char: "", code: "f115" },
  "fa-git": { char: "", code: "f1d3" },
  "linux-archlinux": { char: "", code: "f303" },
  "md-arch": { char: "\u{f08c7}", code: "f08c7" },
  "md-folder_open": { char: "\u{f0770}", code: "f0770" },
  "md-folder_lock_open": { char: "\u{f0250}", code: "f0250" },
  "md-source_branch": { char: "\u{f062c}", code: "f062c" },
  "oct-git_branch": { char: "", code: "f418" },
  "pl-branch": { char: "", code: "e0a0" },
  "weather-day_sunny": { char: "", code: "e30d" },
};
for (let i = 0; i < 100; i++) SAMPLE[`md-filler_${i}`] = { char: "x", code: (0xf1000 + i).toString(16) };
SAMPLE["broken"] = { char: "?" };

const DATA = parseGlyphnames(JSON.stringify(SAMPLE), 1000);
const G = DATA.glyphs;
const names = (gs: Glyph[]) => gs.map((g) => g[0]);

Deno.test("glyphnames.json becomes a compact list", () => {
  assertEquals(DATA.version, "3.5.1");
  assertEquals(DATA.fetched, 1000);
  assertEquals(G.length, 115);
  assertEquals(G.find((g) => g[0] === "md-folder_open"), ["md-folder_open", "f0770"]);
  assertEquals(isGlyphData(DATA), true);
  assertEquals(isGlyphData({ glyphs: [] }), false);
  assertEquals(isGlyphData(undefined), false);
  assertThrows(() => parseGlyphnames('{"METADATA":{}}'), Error, "incomplete");
});

Deno.test("search by words, best matches first", () => {
  assertEquals(names(searchGlyphs(G, "folder open")), [
    "fa-folder_open",
    "md-folder_open",
    "custom-folder_open",
    "fa-folder_open_o",
    "cod-folder_opened",
    "md-folder_lock_open",
  ]);
  assertEquals(names(searchGlyphs(G, "nf-md-folder_open"))[0], "md-folder_open");
  assertEquals(names(searchGlyphs(G, "branch")).slice(0, 3), ["pl-branch", "oct-git_branch", "md-source_branch"]);
  assertEquals(names(searchGlyphs(G, "arch")).slice(0, 3), ["md-arch", "dev-archlinux", "linux-archlinux"]);
  assertEquals(searchGlyphs(G, "nothing-like-this"), []);
});

Deno.test("search by code point or glyph", () => {
  for (const q of ["f07c", "U+F07C", "\\uf07c", "0xf07c", "&#xf07c;"]) {
    assertEquals(names(searchGlyphs(G, q)), ["fa-folder_open"], q);
  }
  assertEquals(names(searchGlyphs(G, "\\u{f0770}")), ["md-folder_open"]);
  assertEquals(names(searchGlyphs(G, "")), ["fa-git"]);
});

Deno.test("sets", () => {
  assertEquals(names(searchGlyphs(G, "folder open", "md")), ["md-folder_open", "md-folder_lock_open"]);
  assertEquals(names(searchGlyphs(G, "", "linux")), ["linux-archlinux"]);
  assertEquals(searchGlyphs(G, "", "all", 3).length, 3);
  assertEquals(inSet("fae-tooth", "fa"), true);
  assertEquals(inSet("ple-flame_thick", "pl"), true);
  assertEquals(inSet("md-x", undefined), true);
  const c = countBySet(G);
  assertEquals([c.all, c.md, c.fa, c.dev], [115, 104, 3, 2]);
});

Deno.test("text forms of a glyph", () => {
  assertEquals(charOf("f07c"), "");
  assertEquals(charOf("f0770"), "\u{f0770}");
  assertEquals(className("md-folder_open"), "nf-md-folder_open");
  assertEquals(codePoint("f0770"), "U+F0770");
  assertEquals(htmlEntity("f07c"), "&#xf07c;");
  assertEquals(cssContent("f07c"), "\\f07c");
  assertEquals(jsEscape("f07c"), "\\uf07c");
  assertEquals(jsEscape("f0770"), "\\u{f0770}");
  assertEquals(shortTitle("md-folder_open"), "folder open");
});

Deno.test("recently copied", () => {
  assertEquals(remember(["a", "b", "c"], "b"), ["b", "a", "c"]);
  assertEquals(remember(["a", "b"], "c", 2), ["c", "a"]);
});

Deno.test("the shipped fallback is valid", () => {
  const list = fallback as Glyph[];
  assertEquals(list.length > 200, true);
  for (const [name, code] of list) {
    assertEquals(/^[a-z]+-[\w]+$/.test(name), true, name);
    assertEquals(/^[0-9a-f]{4,5}$/.test(code), true, code);
  }
  assertEquals(new Set(list.map((g) => g[0])).size, list.length);
});
