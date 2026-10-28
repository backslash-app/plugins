import { assert, assertEquals } from "@std/assert";
import {
  buildMessage,
  commitCommand,
  findArgs,
  footerLines,
  gitmojiKeywords,
  GITMOJIS,
  gitmojisFor,
  header,
  installCommand,
  learnHistory,
  lint,
  parseFolders,
  parseNames,
  parseShortstat,
  parseSubject,
  pickRepo,
  reposFromFind,
  scopesFromPaths,
  shellQuote,
  suggestScopes,
  tilde,
  TYPES,
  usesGitmoji,
  wrap,
} from "./lib.ts";

// Real `git log --format=%s -n 200` lines from a conventional repository, trimmed.
const LOG = [
  "feat(git-repos): show ahead/behind counts",
  "fix(git-repos): don't hang on credential prompts",
  "feat(linear)!: switch to the GraphQL API",
  "docs: explain the permissions",
  "chore(deps): bump @std/assert to 1.0.19",
  "fix(ssh): quote host names",
  "Merge pull request #42 from someone/branch",
  "refactor(sdk, cli): share the protocol types",
  "✨ feat(weather): hourly forecast",
  ":bug: fix(weather): wind units",
  "feat: Initial version",
  "wip: experiments",
  "",
];

Deno.test("types and gitmojis are complete", () => {
  assertEquals(TYPES.map((t) => t.type), [
    "feat",
    "fix",
    "docs",
    "refactor",
    "perf",
    "test",
    "build",
    "ci",
    "chore",
    "revert",
  ]);
  assertEquals(GITMOJIS.length, 75);
  assertEquals(new Set(GITMOJIS.map((g) => g.code)).size, GITMOJIS.length);
  // Every type's gitmojis exist.
  for (const t of TYPES) {
    for (const code of [t.gitmoji, ...t.alsoGitmojis]) assert(GITMOJIS.some((g) => g.code === code), code);
  }
  assertEquals(gitmojisFor("fix").slice(0, 3).map((g) => g.code), ["bug", "ambulance", "adhesive_bandage"]);
  assertEquals(gitmojisFor("fix").length, GITMOJIS.length);
  assertEquals(gitmojisFor("nope")[0].code, "art");
  assertEquals(gitmojiKeywords(GITMOJIS.find((g) => g.code === "white_check_mark")!), [
    "white",
    "check",
    "mark",
    "white_check_mark",
    "test",
  ]);
});

Deno.test("parseSubject reads conventional subjects", () => {
  assertEquals(parseSubject("feat(api)!: add pagination"), {
    type: "feat",
    scope: "api",
    breaking: true,
    description: "add pagination",
  });
  assertEquals(parseSubject("✨ feat: sparkle"), {
    type: "feat",
    breaking: false,
    description: "sparkle",
    gitmoji: "✨",
  });
  assertEquals(parseSubject(":bug: fix(x): y")?.gitmoji, ":bug:");
  assertEquals(parseSubject("🧑‍💻 chore: dx")?.gitmoji, "🧑‍💻");
  assertEquals(parseSubject("Fix(): odd")?.scope, undefined);
  assertEquals(parseSubject("Merge branch 'main'"), undefined);
  assertEquals(parseSubject("feat:no space"), undefined);
});

Deno.test("learnHistory finds scopes and habits", () => {
  const h = learnHistory(LOG);
  assertEquals(h.total, 12);
  assertEquals(h.conventional, 11);
  assertEquals(h.withGitmoji, 2);
  assertEquals(h.gitmojiAsCode, 1);
  assertEquals(h.lowercase, 10);
  assertEquals(h.types, { feat: 4, fix: 3, docs: 1, chore: 1, refactor: 1, wip: 1 });
  assertEquals(h.scopes.slice(0, 3), [
    { scope: "git-repos", count: 2, types: ["feat", "fix"] },
    { scope: "weather", count: 2, types: ["feat", "fix"] },
    { scope: "cli", count: 1, types: ["refactor"] },
  ]);
  assert(h.scopes.some((s) => s.scope === "sdk"));
  assert(!usesGitmoji(h));
  assert(usesGitmoji(learnHistory(["✨ feat: a", "🐛 fix: b", "📝 docs: c", "chore: d", "fix: e"])));
});

Deno.test("scopes come from staged folders, then history", () => {
  assertEquals(
    scopesFromPaths([
      "extensions/git-repos/lib.ts",
      "extensions/git-repos/commands/repos.ts",
      "extensions/ssh/terminal.ts",
      "README.md",
      "src/parser/lexer.rs",
      "docs/guide.md",
      ".github/workflows/ci.yml",
      "crates/core/src/lib.rs",
    ]),
    [
      { scope: "git-repos", files: 2 },
      { scope: "core", files: 1 },
      { scope: "docs", files: 1 },
      { scope: "github", files: 1 },
      { scope: "parser", files: 1 },
      { scope: "ssh", files: 1 },
    ],
  );
  // A file directly in a container folder names the container.
  assertEquals(scopesFromPaths(["packages/index.ts"]), [{ scope: "packages", files: 1 }]);

  const h = learnHistory(LOG);
  const s = suggestScopes(["extensions/weather/lib.ts"], h, "refactor");
  assertEquals(s[0], { scope: "weather", reason: "1 staged file, used 2 times", staged: true });
  // Then the scopes used with this type.
  assertEquals(s.slice(1, 3).map((x) => x.scope), ["cli", "sdk"]);
  assertEquals(new Set(s.map((x) => x.scope)).size, s.length);
  // On a tie, the scope the history knows wins.
  assertEquals(suggestScopes(["docs/a.md", "extensions/weather/a.ts"], h)[0].scope, "weather");
});

Deno.test("header and buildMessage", () => {
  assertEquals(header({ type: "feat", scope: "api", description: "add x" }), "feat(api): add x");
  assertEquals(
    header({ type: "fix", description: " y ", breaking: true, gitmoji: "bug" }),
    "🐛 fix!: y",
  );
  assertEquals(header({ type: "fix", description: "y", gitmoji: "bug", gitmojiStyle: "code" }), ":bug: fix: y");
  assertEquals(
    buildMessage({
      type: "feat",
      scope: "parser",
      description: "support comments",
      body:
        "Comments were rejected with a confusing error. They are now skipped by the lexer, which keeps their position for error messages.\n\n- line comments\n- block comments",
      breaking: true,
      breakingNote: "the `strict` option is gone",
      footers: "closes #12\nCo-authored-by: Ada <ada@example.com>",
    }),
    [
      "feat(parser)!: support comments",
      "",
      "Comments were rejected with a confusing error. They are now skipped by",
      "the lexer, which keeps their position for error messages.",
      "",
      "- line comments",
      "- block comments",
      "",
      "BREAKING CHANGE: the `strict` option is gone",
      "Closes #12",
      "Co-authored-by: Ada <ada@example.com>",
      "",
    ].join("\n"),
  );
  assertEquals(buildMessage({ type: "docs", description: "typo" }), "docs: typo\n");
});

Deno.test("wrap keeps lists and code", () => {
  assertEquals(wrap("a b c d", 3), "a b\nc d");
  assertEquals(wrap("- a long list item that stays as is", 10), "- a long list item that stays as is");
  assertEquals(wrap("    indented code line stays", 10), "    indented code line stays");
  assertEquals(wrap("https://example.com/a/very/long/url", 10), "https://example.com/a/very/long/url");
});

Deno.test("footerLines normalizes issue references", () => {
  assertEquals(footerLines("closes #1\nFIXES: #2\nrefs #3, #4\n\nReviewed-by: Z"), [
    "Closes #1",
    "Fixes #2",
    "Refs #3, #4",
    "Reviewed-by: Z",
  ]);
  assertEquals(footerLines(undefined), []);
});

Deno.test("lint catches common mistakes", () => {
  const texts = (d: Parameters<typeof lint>[0]) => lint(d).map((w) => w.text);
  assertEquals(texts({ type: "feat", description: "add x" }), []);
  assertEquals(texts({ type: "feat", description: "" }), ["The description is empty"]);
  assertEquals(texts({ type: "fix", description: "Added a thing." }), [
    "The description shouldn't end with a period",
    "Descriptions usually start with a lowercase letter",
    "Use the imperative mood: “add”, not “added” or “adds”",
  ]);
  assert(texts({ type: "feat", description: "x".repeat(80) })[0].includes("72 at most"));
  assert(texts({ type: "feat", description: "x".repeat(50) })[0].includes("50 or fewer"));
  assertEquals(texts({ type: "feat", description: "a", breaking: true }).length, 1);
  assertEquals(texts({ type: "revert", description: "a", body: "This reverts commit 1a2b3c4d." }), []);
  assertEquals(texts({ type: "revert", description: "a" }).length, 1);
  // A repository writing capitalized descriptions isn't nagged.
  const capital = learnHistory(["feat: Add a", "fix: Fix b", "docs: Update c", "chore: Bump d", "fix: Handle e"]);
  assertEquals(lint({ type: "feat", description: "Add x" }, capital), []);
});

Deno.test("git output parsing and shell quoting", () => {
  assertEquals(parseShortstat(" 3 files changed, 10 insertions(+), 2 deletions(-)"), {
    files: 3,
    insertions: 10,
    deletions: 2,
  });
  assertEquals(parseShortstat(" 1 file changed, 1 insertion(+)"), { files: 1, insertions: 1, deletions: 0 });
  assertEquals(parseShortstat(""), { files: 0, insertions: 0, deletions: 0 });
  assertEquals(parseNames("a.ts\0dir/b c.ts\0"), ["a.ts", "dir/b c.ts"]);
  assertEquals(shellQuote("simple"), "simple");
  assertEquals(shellQuote("it's here"), "'it'\\''s here'");
  assertEquals(commitCommand("feat: x\n\nbody line\n"), "git commit -m 'feat: x' -m 'body line'");
});

Deno.test("repository discovery", () => {
  assertEquals(parseFolders("~/code, /srv/git:~/x", "/home/ada"), ["/home/ada/code", "/srv/git", "/home/ada/x"]);
  assertEquals(parseFolders("", "/h").length, 9);
  const args = findArgs(["/h/code"], 3);
  assertEquals(args.slice(0, 5), ["/h/code", "-mindepth", "1", "-maxdepth", "4"]);
  assertEquals(reposFromFind("/h/code/b/.git\n/h/code/a/.git\n/h/code/a/.git\nnoise"), ["/h/code/a", "/h/code/b"]);
  assertEquals(tilde("/home/ada/code/x", "/home/ada"), "~/code/x");
  const repos = [
    { path: "/a", staged: 0, lastCommit: 300 },
    { path: "/b", staged: 2, lastCommit: 100 },
    { path: "/c", staged: 1, lastCommit: 200 },
  ];
  assertEquals(pickRepo(repos)?.path, "/c");
  assertEquals(pickRepo(repos, "/b")?.path, "/b");
  assertEquals(pickRepo(repos, "/a")?.path, "/c");
  assertEquals(
    pickRepo([{ path: "/a", staged: 0, lastCommit: 1 }, { path: "/z", staged: 0, lastCommit: 9 }], "/a")?.path,
    "/a",
  );
  assertEquals(pickRepo([]), undefined);
  assertEquals(installCommand("ID=fedora\nVERSION_ID=41"), "sudo dnf install git");
  assertEquals(installCommand('ID="linuxmint"\nID_LIKE="ubuntu debian"'), "sudo apt install git");
});
