import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  askedVariables,
  builtinValues,
  copyTitle,
  excerpt,
  exportJson,
  fieldId,
  fill,
  labelOf,
  makePrompt,
  mergeImport,
  parseImport,
  parseTags,
  type Prompt,
  sortPrompts,
  starterPrompts,
  STARTERS,
  usesClipboard,
  validate,
  variables,
} from "./lib.ts";

const NOW = new Date(2026, 9, 28, 9, 5); // local time: Wednesday 28 October 2026, 09:05

Deno.test("variables: order, defaults, duplicates, built-ins and multi-line ones", () => {
  const body =
    "Translate into {{ target_language | French }}:\n\n{{text}}\n\nAgain in {{Target_Language}}. Today is {{date}}.";
  const vars = variables(body);
  assertEquals(vars.map((v) => v.name), ["target_language", "text", "date"]);
  assertEquals(vars[0], {
    name: "target_language",
    label: "Target language",
    default: "French",
    multiline: false,
    builtin: undefined,
  });
  assertEquals(vars[1].multiline, true);
  assertEquals(vars[2].builtin, "date");
  assertEquals(askedVariables(body).map((v) => v.name), ["target_language", "text"]);
});

Deno.test("variables: an empty default is a default, odd braces are not variables", () => {
  const vars = variables("{{a|}} {b} {{ }} {{c}");
  assertEquals(vars.length, 1);
  assertEquals(vars[0].default, "");
});

Deno.test("fill: values, defaults, built-ins, case-insensitive names", () => {
  const body = "Hi {{Name}}, tone {{tone|warm}}.\n{{clipboard}}\nOn {{weekday}} {{date}} at {{time}}; {{missing}}!";
  const out = fill(body, { name: "Ada", tone: "" }, builtinValues(NOW, "copied text"));
  assertEquals(out, "Hi Ada, tone warm.\ncopied text\nOn Wednesday 2026-10-28 at 09:05; !");
});

Deno.test("fill: values are inserted literally, even with $ patterns", () => {
  assertEquals(fill("Code: {{code}}", { code: "a $& b $1" }, {}), "Code: a $& b $1");
});

Deno.test("built-in values", () => {
  const b = builtinValues(NOW);
  assertEquals(b.date, "2026-10-28");
  assertEquals(b.time, "09:05");
  assertEquals(b.datetime, "2026-10-28 09:05");
  assertEquals(b.clipboard, "");
});

Deno.test("clipboard detection and field ids", () => {
  assert(usesClipboard("Summarize {{ Clipboard }}"));
  assert(!usesClipboard("Summarize {{text}}"));
  assertEquals(fieldId("Target language"), "v_target_language");
  assertEquals(fieldId("café-name"), "v_café_name");
  assertEquals(labelOf("what to match"), "What to match");
});

Deno.test("tags, excerpts and copy titles", () => {
  assertEquals(parseTags("code, #Review ,code\nGit"), ["code", "review", "git"]);
  assertEquals(excerpt("\n---\n  First real line  \nsecond"), "First real line");
  assertEquals(excerpt("x".repeat(100), 10), "xxxxxxxxx…");
  assertEquals(copyTitle("Review", ["Review"]), "Review (copy)");
  assertEquals(copyTitle("Review (copy)", ["Review", "Review (copy)"]), "Review (copy 2)");
});

Deno.test("validation", () => {
  assertEquals(validate(" ", "x"), "Give the prompt a title");
  assertEquals(validate("t", "  "), "The prompt is empty");
  assertEquals(validate("t", "{{a}"), "A {{variable}} is not closed: check the braces");
  assertEquals(validate("t", "{{a}} and {{b|c}}"), undefined);
});

const prompt = (title: string, o: Partial<Prompt> = {}): Prompt => ({
  ...makePrompt({ title, body: title }, 1, title),
  ...o,
});

Deno.test("sorting: pinned, then recently used, then by title", () => {
  const sorted = sortPrompts([
    prompt("b"),
    prompt("a"),
    prompt("used", { lastUsed: 50 }),
    prompt("pinned", { pinned: true }),
    prompt("recent", { lastUsed: 90 }),
  ]);
  assertEquals(sorted.map((p) => p.title), ["pinned", "recent", "used", "a", "b"]);
});

Deno.test("export then import gives the same library back", () => {
  const lib = [prompt("One", { tags: ["x"], pinned: true }), prompt("Two")];
  const json = exportJson(lib);
  assertEquals(JSON.parse(json).format, "backslash-prompts");
  const drafts = parseImport(json);
  assertEquals(drafts, [
    { title: "One", body: "One", tags: ["x"], pinned: true },
    { title: "Two", body: "Two", tags: [], pinned: false },
  ]);
  const r = mergeImport(lib, drafts, 5);
  assertEquals([r.added, r.updated, r.skipped], [0, 0, 2]);
});

Deno.test("import: other shapes and field names", () => {
  const drafts = parseImport(JSON.stringify([
    { name: "Fix", prompt: "Fix {{text}}", tags: "a, b" },
    { content: "No title here, so the start of the text is used" },
    { title: "Empty" },
    "junk",
  ]));
  assertEquals(drafts.map((d) => d.title), ["Fix", "No title here, so the start of the text is used"]);
  assertEquals(drafts[0].tags, ["a", "b"]);
  assertEquals(parseImport('{"prompts":[{"title":"T","text":"B"}]}')[0].body, "B");
});

Deno.test("import: readable errors", () => {
  assertThrows(() => parseImport("not json"), Error, "doesn't hold JSON");
  assertThrows(() => parseImport('{"a":1}'), Error, "No prompts");
  assertThrows(() => parseImport('[{"title":"x"}]'), Error, "None of the copied entries");
});

Deno.test("merge: updates prompts with the same title, adds new ones", () => {
  const lib = [prompt("Review", { body: "old" })];
  const r = mergeImport(lib, [
    { title: "review", body: "new", tags: ["code"], pinned: false },
    { title: "Other", body: "x", tags: [], pinned: false },
  ], 7);
  assertEquals([r.added, r.updated, r.skipped], [1, 1, 0]);
  assertEquals(r.prompts[0].body, "new");
  assertEquals(r.prompts[0].updated, 7);
  assertEquals(lib[0].body, "old", "the original library is not changed");
});

Deno.test("starter prompts are valid and distinct", () => {
  assert(STARTERS.length >= 20);
  assertEquals(new Set(STARTERS.map((s) => s.title.toLowerCase())).size, STARTERS.length);
  for (const s of STARTERS) {
    assertEquals(validate(s.title, s.body), undefined, s.title);
    assert(variables(s.body).length > 0, `${s.title} has no variable`);
    assert(!/\{\{[^}]*\{\{/.test(s.body), `${s.title} nests placeholders`);
  }
  const prompts = starterPrompts(3);
  assertEquals(new Set(prompts.map((p) => p.id)).size, prompts.length);
  assert(prompts.every((p) => p.created === 3 && p.uses === 0 && !p.pinned));
});

Deno.test("the translate starter fills from the clipboard", () => {
  const t = STARTERS.find((s) => s.title === "Translate")!;
  const out = fill(t.body, {}, builtinValues(NOW, "Bonjour"));
  assert(out.includes("into English"));
  assert(out.endsWith("Bonjour"));
});
