import { assertEquals, assertThrows } from "@std/assert";
// deno-lint-ignore no-import-prefix
import { parse } from "jsr:@std/yaml@^1";
import {
  appendMatch,
  formatDate,
  formFields,
  matchesBlock,
  matchKind,
  matchTitle,
  oneLine,
  parseMatchFile,
  parsePaths,
  parseStatus,
  removeMatch,
  resolve,
} from "./lib.ts";

const BASE = `# espanso match file

# For a complete introduction, visit the official docs at: https://espanso.org/docs/

matches:
  # Simple text replacement
  - trigger: ":espanso"
    replace: "Hi there!"

  # NOTE: espanso uses YAML to define matches, so pay attention to the indentation!

  # But matches can also be dynamic:

  # Print the current date
  - trigger: ":date"
    replace: "{{mydate}}"
    vars:
      - name: mydate
        type: date
        params:
          format: "%m/%d/%Y"

  # Print the output of a shell command
  - trigger: ":shell"
    replace: "{{output}}"
    vars:
      - name: output
        type: shell
        params:
          cmd: "echo 'Hello from your shell'"

  - triggers: [":sig", ":signature"]
    label: Signature
    word: true
    replace: |
      Best regards,
      Ada $|$

  - trigger: ":greet"
    form: |
      Hey [[name]],
      [[text]]
      Happy [[day]]
    form_fields:
      text:
        multiline: true
      day:
        type: choice
        values:
          - Monday
          - Friday

  - regex: ":hi(?P<person>.*)\\\\."
    replace: "Hi {{person}}!"

  - trigger: ":cat"
    image_path: "$CONFIG/images/cat.png"

global_vars:
  - name: today
    type: date
    params:
      format: "%A %e %B"
`;

Deno.test("match file", () => {
  const f = parseMatchFile(BASE, "/home/ada/.config/espanso/match/base.yml");
  assertEquals(f.matches.length, 7);
  assertEquals(f.matches.map(matchTitle), [
    ":espanso",
    ":date",
    ":shell",
    ":sig  :signature",
    ":greet",
    "/:hi(?P<person>.*)\\./",
    ":cat",
  ]);
  assertEquals(f.matches.map(matchKind), ["text", "text", "text", "text", "form", "text", "image"]);
  assertEquals(f.matches[3].label, "Signature");
  assertEquals(f.matches[3].word, true);
  assertEquals(f.matches[1].vars[0].params?.format, "%m/%d/%Y");
  assertEquals(f.globalVars[0].name, "today");
  assertEquals(f.matches[6].index, 6);
  assertEquals(parseMatchFile("", "x").matches, []);
  assertThrows(() => parseMatchFile("matches:\n  - trigger: x\n bad: [", "x"));
});

Deno.test("variables", () => {
  const f = parseMatchFile(BASE, "base.yml");
  const now = new Date(2026, 9, 28, 9, 5, 7);
  assertEquals(resolve(f.matches[1], [], { now }).text, "10/28/2026");
  assertEquals(resolve(f.matches[2], [], { now }), { text: "", unresolved: ["output (shell)"] });
  assertEquals(resolve(f.matches[2], [], { now, preview: true }).text, "⟨output: shell⟩");
  assertEquals(resolve(f.matches[3]).text, "Best regards,\nAda \n");
  const today = parseMatchFile(
    `matches:\n  - trigger: ":t"\n    replace: "{{today}} / {{pick}} / {{e}}"\n    vars:\n      - name: pick\n        type: random\n        params:\n          choices: [a, b, c]\n      - name: e\n        type: echo\n        params:\n          echo: "x {{today}}"\n`,
    "f",
  ).matches[0];
  assertEquals(
    resolve(today, f.globalVars, { now, random: () => 0.5 }).text,
    "Wednesday 28 October / b / x Wednesday 28 October",
  );
  const form = f.matches[4];
  assertEquals(formFields(form).map((x) => [x.id, x.kind]), [["name", "text"], ["text", "textArea"], [
    "day",
    "dropdown",
  ]]);
  assertEquals(formFields(form)[2].options, ["Monday", "Friday"]);
  assertEquals(
    resolve(form, [], { values: { name: "Bob", text: "See you", day: "Friday" } }).text,
    "Hey Bob,\nSee you\nHappy Friday\n",
  );
  const formVar = parseMatchFile(
    `matches:\n  - trigger: ":f"\n    replace: "Dear {{f.who}}"\n    vars:\n      - name: f\n        type: form\n        params:\n          layout: "Name [[who]]"\n`,
    "f",
  ).matches[0];
  assertEquals(formFields(formVar).map((x) => x.id), ["f.who"]);
  assertEquals(resolve(formVar, [], { values: { "f.who": "Ada" } }).text, "Dear Ada");
});

Deno.test("dates in chrono format", () => {
  const d = new Date(2026, 0, 5, 14, 3, 9);
  assertEquals(formatDate("%Y-%m-%d %H:%M:%S", d), "2026-01-05 14:03:09");
  assertEquals(formatDate("%a %e %b %y, %I:%M %p", d), "Mon  5 Jan 26, 02:03 PM");
  assertEquals(formatDate("%A %-d %B, day %j", d), "Monday 5 January, day 005");
  assertEquals(formatDate("%F %R %%", d), "2026-01-05 14:03 %");
  assertEquals(formatDate("%Q", d), "%Q");
});

Deno.test("espanso output", () => {
  assertEquals(
    parsePaths(
      "Config: /home/ada/.config/espanso\nPackages: /home/ada/.config/espanso/match/packages\nRuntime: /home/ada/.cache/espanso\n",
    ),
    {
      config: "/home/ada/.config/espanso",
      packages: "/home/ada/.config/espanso/match/packages",
      runtime: "/home/ada/.cache/espanso",
    },
  );
  assertEquals(parseStatus("espanso is running"), true);
  assertEquals(parseStatus("espanso is not running"), false);
  assertEquals(oneLine("a\n  b\tc"), "a b c");
});

Deno.test("adding a match keeps the file", () => {
  const out = appendMatch(BASE, {
    trigger: ":addr",
    replace: "12 Rue de Rivoli\n75001 Paris",
    label: "Address",
    word: true,
  });
  const parsed = parseMatchFile(out, "base.yml");
  assertEquals(parsed.matches.length, 8);
  assertEquals(parsed.matches[7].triggers, [":addr"]);
  assertEquals(parsed.matches[7].replace, "12 Rue de Rivoli\n75001 Paris");
  assertEquals(parsed.globalVars.length, 1);
  assertEquals(out.includes("# Print the current date"), true);
  // It goes before global_vars, at the list's indentation.
  assertEquals(out.indexOf(":addr") < out.indexOf("global_vars:"), true);
  assertEquals(out.includes("\n  - trigger: ':addr'"), true);

  const fresh = appendMatch("", { trigger: ":x", replace: "y" });
  assertEquals(parse(fresh), { matches: [{ trigger: ":x", replace: "y" }] });
  const flush = appendMatch("matches:\n- trigger: a\n  replace: b\n", { trigger: ":x", replace: "y" });
  assertEquals((parse(flush) as { matches: unknown[] }).matches.length, 2);
  const emptyList = appendMatch("matches: []\n", { trigger: ":x", replace: "y" });
  assertEquals((parse(emptyList) as { matches: unknown[] }).matches.length, 1);
  const noMatches = appendMatch("global_vars:\n  - name: a\n    type: echo\n    params: {echo: b}\n", {
    trigger: ":x",
    replace: "y",
  });
  assertEquals((parse(noMatches) as { matches: unknown[]; global_vars: unknown[] }).global_vars.length, 1);
  assertThrows(() => appendMatch("matches: [{trigger: a, replace: b}]\n", { trigger: ":x", replace: "y" }));
  assertThrows(() => appendMatch("", { trigger: " ", replace: "y" }));
});

Deno.test("deleting a match keeps the others", () => {
  const lines = BASE.split("\n");
  const block = matchesBlock(lines)!;
  assertEquals(block.indent, "  ");
  assertEquals(block.items.length, 7);
  const out = removeMatch(BASE, 1);
  const parsed = parseMatchFile(out, "base.yml");
  assertEquals(parsed.matches.map(matchTitle).slice(0, 3), [":espanso", ":shell", ":sig  :signature"]);
  assertEquals(out.includes("# Print the output of a shell command"), true);
  const last = removeMatch(BASE, 6);
  assertEquals(parseMatchFile(last, "x").matches.length, 6);
  assertEquals(parseMatchFile(last, "x").globalVars.length, 1);
  assertThrows(() => removeMatch(BASE, 9));
});
