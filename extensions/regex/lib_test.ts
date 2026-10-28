import { assertEquals, assertThrows } from "@std/assert";
import {
  closingSlash,
  compile,
  constructor,
  context,
  explainTokens,
  findMatches,
  groupNames,
  highlight,
  LIBRARY,
  literal,
  parseQuery,
  replacePreview,
} from "./lib.ts";

Deno.test("queries: literal, sed-style and bare patterns", () => {
  assertEquals(parseQuery("/(\\d+)px/g width: 12px"), {
    pattern: "(\\d+)px",
    flags: "g",
    text: "width: 12px",
    literal: true,
  });
  // Escaped slashes and slashes inside a class don't close the pattern.
  assertEquals(parseQuery("/a\\/b[/]c/gi x")?.pattern, "a\\/b[/]c");
  assertEquals(parseQuery("/abc/")?.text, undefined);
  assertEquals(parseQuery("/abc"), { pattern: "abc", flags: "g", literal: true });
  assertEquals(parseQuery("s/(\\w+)@/$1 at /g ada@x.com"), {
    pattern: "(\\w+)@",
    replacement: "$1 at ",
    flags: "g",
    text: "ada@x.com",
    literal: true,
  });
  assertEquals(parseQuery("\\d+ "), { pattern: "\\d+", flags: "g", literal: false });
  assertEquals(parseQuery("/a/g multi\nline"), { pattern: "a", flags: "g", text: "multi\nline", literal: true });
  assertEquals(parseQuery("   "), undefined);
  assertThrows(() => parseQuery("/a/g,x"), Error, "Flags go right after");
  assertEquals([closingSlash("a/b", 0), closingSlash("a\\/b", 0), closingSlash("[/]", 0)], [1, -1, -1]);
});

Deno.test("compile reports clean errors", () => {
  assertThrows(() => compile("(", "g"), Error, "Unterminated group");
  assertThrows(() => compile("a", "gq"), Error, "Unknown flag “q”");
  assertThrows(() => compile("a", "gg"), Error, "Invalid flags");
  assertEquals(compile("a", "gi").flags, "dgi");
});

Deno.test("matches with numbered and named groups", () => {
  const re = compile("(?<year>\\d{4})-(\\d{2})(-(\\d{2}))?", "g");
  const { matches, truncated } = findMatches(re, "From 2026-10-28 to 2027-01.");
  assertEquals(truncated, false);
  assertEquals(matches.map((m) => [m.index, m.end, m.text]), [[5, 15, "2026-10-28"], [19, 26, "2027-01"]]);
  assertEquals(matches[0].groups, [
    { number: 1, name: "year", value: "2026", start: 5, end: 9 },
    { number: 2, name: undefined, value: "10", start: 10, end: 12 },
    { number: 3, name: undefined, value: "-28", start: 12, end: 15 },
    { number: 4, name: undefined, value: "28", start: 13, end: 15 },
  ]);
  assertEquals(matches[1].groups[3], {
    number: 4,
    name: undefined,
    value: undefined,
    start: undefined,
    end: undefined,
  });
  // Without g: the first match only.
  assertEquals(findMatches(compile("\\d", ""), "a1b2").matches.length, 1);
  // Empty matches advance instead of looping.
  assertEquals(findMatches(compile("x*", "g"), "axxb").matches.map((m) => m.text), ["", "xx", "", ""]);
  assertEquals(findMatches(compile("", "gu"), "😀a").matches.map((m) => m.index), [0, 2, 3]);
  const many = findMatches(compile(".", "g"), "abcdef", 3);
  assertEquals([many.matches.length, many.truncated], [3, true]);
});

Deno.test("group names ignore escapes, classes and lookarounds", () => {
  assertEquals(groupNames("(a)(?:b)(?<n>c)\\((?=d)[(](?<!e)(f)"), [undefined, "n", undefined]);
});

Deno.test("highlighting, context and replacement", () => {
  const text = "cat bat rat";
  const { matches } = findMatches(compile("[cr]at", "g"), text);
  assertEquals(highlight(text, matches), "⟦cat⟧ bat ⟦rat⟧");
  assertEquals(context("x".repeat(50) + "MATCH" + "y".repeat(50), { index: 50, end: 55 }, 5), "…xxxxx⟦MATCH⟧yyyyy…");
  assertEquals(replacePreview(compile("(\\w+)@(\\w+)", "g"), "ada@home bob@work", "$2:$1"), "home:ada work:bob");
  assertEquals(replacePreview(compile("o", ""), "foo", "0"), "f0o");
  assertEquals(replacePreview(compile("(?<w>\\w+)", "g"), "hi", "<$<w>>"), "<hi>");
});

Deno.test("copy formats", () => {
  assertEquals(literal("a/b", "g"), "/a\\/b/g");
  assertEquals(literal("a\\/b", "g"), "/a\\/b/g");
  assertEquals(constructor("\\d+", "g"), 'new RegExp("\\\\d+", "g")');
  assertEquals(constructor("x", ""), 'new RegExp("x")');
});

Deno.test("token explanations", () => {
  const tokens = explainTokens("^(?<year>\\d{4})-[^a-z_]+?(?:foo|bar)*\\k<year>\\.$");
  assertEquals(tokens.map((t) => [t.text, t.description]), [
    ["^", "start of the text"],
    ["(?<year>", "start of capture group 1, named “year”"],
    ["\\d{4}", "a digit (0–9), exactly 4 times"],
    [")", "end of group 1 “year”"],
    ["-", "the character “-”"],
    ["[^a-z_]+?", "any character except a–z, “_”, one or more times, as few as possible"],
    ["(?:", "start of a group that doesn't capture"],
    ["foo", "the text “foo”"],
    ["|", "or"],
    ["bar", "the text “bar”"],
    [")*", "end of the group, zero or more times"],
    ["\\k<year>", "the same text as group “year”"],
    ["\\.", "the character “.”"],
    ["$", "end of the text"],
  ]);
  assertEquals(explainTokens("^a$", "m").map((t) => t.description), [
    "start of a line",
    "the character “a”",
    "end of a line",
  ]);
  assertEquals(explainTokens("colou?r").map((t) => t.text), ["colo", "u?", "r"]);
  assertEquals(explainTokens("(?=x)(?<!y)\\1").map((t) => t.description), [
    "only if followed by (lookaround, not part of the match)",
    "the character “x”",
    "end of the “followed by” check",
    "only if not preceded by (lookaround, not part of the match)",
    "the character “y”",
    "end of the “not preceded by” check",
    "the same text as group 1",
  ]);
  assertEquals(explainTokens("\\p{L}{2,}\\u00e9\\x41.\\b").map((t) => t.description), [
    "a character in Unicode category L, 2 or more times",
    "the character U+00E9",
    "the character U+0041",
    "any character except a line break",
    "a word boundary",
  ]);
  assertEquals(explainTokens("[\\d.-]{1,3}").map((t) => t.description), [
    "one of digits, “.”, “-”, between 1 and 3 times",
  ]);
});

Deno.test("every library pattern compiles and matches its examples", () => {
  const expected: Record<string, string[]> = {
    email: ["ada@example.com", "grace.hopper+navy@mail.example.org"],
    url: ["https://deno.com/blog?tag=release#top", "http://localhost.example:8080/api"],
    ipv4: ["192.168.1.1", "1.1.1.1"],
    ipv6: ["2001:0db8:85a3:0000:0000:8a2e:0370:7334", "fe80::1", "::1"],
    date: ["2026-10-28", "2026-11-02"],
    semver: ["v1.4.2", "2.0.0-rc.1+build.42"],
    hex: ["#fff", "#1e1e2e", "#ff000080"],
    duplicate: ["is is", "the the"],
    password: ["Correct-Horse-42!"],
  };
  for (const r of LIBRARY) {
    const { matches } = findMatches(compile(r.pattern, r.flags), r.examples);
    if (r.id !== "trim") assertEquals(matches.length > 0, true, r.id);
    if (expected[r.id]) assertEquals(matches.map((m) => m.text), expected[r.id], r.id);
  }
  const semver = findMatches(compile(LIBRARY.find((r) => r.id === "semver")!.pattern, "g"), "2.0.0-rc.1+build.42");
  assertEquals(
    semver.matches[0].groups.map((g) => [g.name, g.value]),
    [["major", "2"], ["minor", "0"], ["patch", "0"], ["pre", "rc.1"], ["build", "build.42"]],
  );
});
