import { assert, assertEquals } from "@std/assert";
import {
  CATEGORIES,
  codePoint,
  countByCategory,
  display,
  htmlEntity,
  jsEscape,
  remember,
  searchSymbols,
  template,
  usePackage,
} from "./lib.ts";
import { SYMBOLS } from "./symbols.ts";

const commands = (query: string, category?: Parameters<typeof searchSymbols>[2]) =>
  searchSymbols(SYMBOLS, query, category).map((s) => s.command);

Deno.test("the table: several hundred symbols, unique commands, valid fields", () => {
  assert(SYMBOLS.length >= 400, `only ${SYMBOLS.length} symbols`);
  const seen = new Set<string>();
  for (const s of SYMBOLS) {
    assert(!seen.has(s.command), `${s.command} twice`);
    seen.add(s.command);
    assert(s.command.startsWith("\\"), s.command);
    assert(s.char.length > 0, s.command);
    assert(s.names.length > 0, s.command);
    assert(CATEGORIES.some((c) => c.value === s.category), s.category);
    assert(/^[a-z]*$/.test(s.package), s.package);
  }
  const counts = countByCategory(SYMBOLS);
  assertEquals(counts.all, SYMBOLS.length);
  for (const c of CATEGORIES) assert(counts[c.value] > 10, `${c.value}: ${counts[c.value]}`);
});

Deno.test("letters: Letterlike Symbols holes are filled", () => {
  const char = (cmd: string) => SYMBOLS.find((s) => s.command === cmd)?.char;
  assertEquals(char("\\mathbb{R}"), "ℝ");
  assertEquals(char("\\mathbb{A}"), "𝔸");
  assertEquals(char("\\mathbb{Y}"), "𝕐");
  assertEquals(char("\\mathcal{B}"), "ℬ");
  assertEquals(char("\\mathcal{A}"), "𝒜");
  assertEquals(char("\\mathcal{Z}"), "𝒵");
  assertEquals(char("\\mathfrak{g}"), "𝔤");
  assertEquals(char("\\mathfrak{Z}"), "ℨ");
  assertEquals(char("\\mathfrak{A}"), "𝔄");
});

Deno.test("search: the character, exact command with its case, prefixes", () => {
  assertEquals(commands("α")[0], "\\alpha");
  assertEquals(commands("∀")[0], "\\forall");
  assertEquals(commands("\\Delta")[0], "\\Delta");
  assertEquals(commands("delta")[0], "\\delta");
  assertEquals(commands("Delta")[0], "\\Delta");
  assertEquals(commands("\\le").slice(0, 2), ["\\leq", "\\leqq"]);
  assertEquals(commands("in")[0], "\\in");
  assertEquals(commands("int")[0], "\\int");
});

Deno.test("search: names, aliases, code points and categories", () => {
  assertEquals(commands("reals")[0], "\\mathbb{R}");
  assertEquals(commands("real numbers")[0], "\\mathbb{R}");
  assert(commands("for all").includes("\\forall"));
  assert(commands("empty set").includes("\\varnothing"));
  assert(commands("not equal").includes("\\neq"));
  assertEquals(commands("U+2200")[0], "\\forall");
  assertEquals(commands("2200")[0], "\\forall");
  assertEquals(commands("u+1d538")[0], "\\mathbb{A}");
  assertEquals(commands("amssymb").length > 50, true);
  assert(commands("arrow", "arrows").every((c) => SYMBOLS.find((s) => s.command === c)?.category === "arrows"));
  assertEquals(commands("zzzz-nothing"), []);
  assertEquals(searchSymbols(SYMBOLS, "", "greek").length, countByCategory(SYMBOLS).greek);
});

Deno.test("text forms", () => {
  assertEquals(codePoint("α"), "U+03B1");
  assertEquals(codePoint("𝔸"), "U+1D538");
  assertEquals(jsEscape("α"), "\\u03b1");
  assertEquals(jsEscape("𝔸"), "\\u{1d538}");
  assertEquals(htmlEntity("∀"), "&#x2200;");
  assertEquals(usePackage({ package: "amssymb" }), "\\usepackage{amssymb}");
  assertEquals(usePackage({ package: "" }), undefined);
  const hat = SYMBOLS.find((s) => s.command === "\\hat")!;
  assertEquals(display(hat), "a\u0302");
  assertEquals(template(hat), "\\hat{}");
  assertEquals(codePoint(hat.char), "U+0302");
  const alpha = SYMBOLS.find((s) => s.command === "\\alpha")!;
  assertEquals(template(alpha), "\\alpha");
});

Deno.test("recently copied", () => {
  assertEquals(remember(["\\beta", "\\alpha"], "\\alpha"), ["\\alpha", "\\beta"]);
  assertEquals(remember([], "\\pi"), ["\\pi"]);
  assertEquals(remember(["a", "b", "c"], "d", 3), ["d", "a", "b"]);
});
