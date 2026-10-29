import { assert, assertEquals } from "@std/assert";
import {
  bump,
  type Commit,
  compareUrl,
  findArgs,
  formatVersion,
  groupCommits,
  hasVersion,
  installCommand,
  isNoise,
  parseChange,
  parseLog,
  parseRemote,
  parseVersion,
  prependChangelog,
  renderMarkdown,
  renderPlain,
  reposFromFind,
  suggest,
} from "./lib.ts";
import { commitsIn, latestTag, repoInfo, summarize } from "./git.ts";

let n = 0;
const commit = (subject: string, body = ""): Commit => {
  n++;
  const hash = n.toString(16).padStart(40, "a");
  return { hash, short: hash.slice(0, 7), author: "Ada", date: "2026-10-01T10:00:00+02:00", subject, body };
};

Deno.test("parsing git log output", () => {
  const out = "abc1234def5678abc1234def5678abc1234def56\x1fabc1234\x1fAda\x1f2026-10-01T10:00:00+02:00\x1f" +
    "feat: x\x1fbody line\n\x1e\n0123456789012345678901234567890123456789\x1f0123456\x1fBob\x1f2026-10-02\x1ffix: y\x1f\x1e\n";
  const commits = parseLog(out);
  assertEquals(commits.length, 2);
  assertEquals(commits[0].subject, "feat: x");
  assertEquals(commits[0].body, "body line");
  assertEquals(commits[1].author, "Bob");
});

Deno.test("Conventional Commits", () => {
  const c = parseChange(commit("feat(parser): support ranges (#12)"));
  assertEquals([c.type, c.scope, c.description, c.breaking, c.refs], [
    "feat",
    "parser",
    "support ranges (#12)",
    false,
    ["#12"],
  ]);
  const bang = parseChange(commit("refactor(api)!: drop the v1 endpoints"));
  assertEquals([bang.breaking, bang.breakingNote], [true, "drop the v1 endpoints"]);
  const footer = parseChange(commit("fix: read the config once", "Details.\n\nBREAKING CHANGE: `load()` is now async"));
  assertEquals([footer.breaking, footer.breakingNote], [true, "`load()` is now async"]);
  const emoji = parseChange(commit("✨ feat: sparkles"));
  assertEquals([emoji.type, emoji.description], ["feat", "sparkles"]);
  const code = parseChange(commit(":bug: fix(ui): a crash"));
  assertEquals([code.type, code.scope], ["fix", "ui"]);
  const other = parseChange(commit("Update README"));
  assertEquals([other.type, other.description], ["other", "Update README"]);
  assert(isNoise(commit("Merge pull request #3 from a/b")));
  assert(isNoise(commit("chore(release): 1.2.0")));
  assert(isNoise(commit("v1.2.0")));
  assert(!isNoise(commit("chore: bump deps")));
});

const COMMITS = [
  commit("feat(cli): add --json (#40)"),
  commit("fix: crash on empty input"),
  commit("docs: usage"),
  commit("chore: deps"),
  commit("Merge branch 'main'"),
  commit("perf(parser): faster tokenizer"),
  commit("Tweak the logo"),
];

Deno.test("grouping", () => {
  const notes = groupCommits(COMMITS);
  assertEquals(notes.groups.map(([t]) => t), [
    "Features",
    "Bug Fixes",
    "Performance",
    "Documentation",
    "Chores",
    "Other Changes",
  ]);
  assertEquals(notes.skipped, 1);
  assertEquals(groupCommits(COMMITS, { hideMinor: true }).groups.map(([t]) => t).includes("Chores"), false);
});

Deno.test("versions", () => {
  assertEquals(parseVersion("v1.2.3"), { prefix: "v", major: 1, minor: 2, patch: 3, pre: undefined });
  assertEquals(parseVersion("my-lib@2.0.0-beta.1")?.pre, "beta.1");
  assertEquals(parseVersion("release-1.4")?.patch, 0);
  assertEquals(parseVersion("nightly"), undefined);
  const v = parseVersion("v1.2.3")!;
  assertEquals(formatVersion(bump(v, "major")), "v2.0.0");
  assertEquals(formatVersion(bump(v, "minor")), "v1.3.0");
  assertEquals(formatVersion(bump(v, "patch")), "v1.2.4");
  assertEquals(formatVersion(bump(parseVersion("1.3.0-rc.1")!, "minor")), "1.3.0");
  assertEquals(formatVersion(bump(parseVersion("1.3.0-rc.1")!, "major")), "2.0.0");
  const feat = groupCommits(COMMITS);
  assertEquals(formatVersion(suggest(v, feat).next), "v1.3.0");
  assertEquals(formatVersion(suggest(v, groupCommits([commit("fix: x")])).next), "v1.2.4");
  const breaking = groupCommits([commit("feat!: new API")]);
  assertEquals(formatVersion(suggest(v, breaking).next), "v2.0.0");
  assertEquals(formatVersion(suggest(parseVersion("0.4.1"), breaking).next), "0.5.0");
  assertEquals(formatVersion(suggest(undefined, feat).next), "v0.1.0");
});

Deno.test("remotes", () => {
  assertEquals(parseRemote("git@github.com:denoland/deno.git")?.web, "https://github.com/denoland/deno");
  assertEquals(parseRemote("https://github.com/denoland/deno")?.kind, "github");
  const gl = parseRemote("ssh://git@gitlab.example.com:2222/group/sub/project.git")!;
  assertEquals([gl.kind, gl.path, gl.host], ["gitlab", "group/sub/project", "gitlab.example.com"]);
  assertEquals(parseRemote("https://codeberg.org/a/b.git")?.kind, "other");
  assertEquals(parseRemote("/srv/git/repo"), undefined);
  assertEquals(
    compareUrl(parseRemote("git@github.com:o/r.git")!, "v1.0.0", "v1.1.0"),
    "https://github.com/o/r/compare/v1.0.0...v1.1.0",
  );
  assertEquals(compareUrl(gl, "v1", "main"), "https://gitlab.example.com/group/sub/project/-/compare/v1...main");
});

Deno.test("markdown", () => {
  const notes = groupCommits([commit("feat(cli): add --json (#40)"), commit("fix!: stop reading ~/.rc")]);
  const md = renderMarkdown(notes, {
    version: "v2.0.0",
    date: "2026-10-29",
    remote: parseRemote("git@github.com:o/r.git"),
    from: "v1.4.0",
    to: "v2.0.0",
    links: true,
  });
  const fixHash = notes.breaking[0].commit;
  const featHash = notes.changes[0].commit;
  assertEquals(
    md,
    [
      "## [v2.0.0](https://github.com/o/r/compare/v1.4.0...v2.0.0) (2026-10-29)",
      "",
      "### Breaking Changes",
      "",
      `- stop reading ~/.rc ([${fixHash.short}](https://github.com/o/r/commit/${fixHash.hash}))`,
      "",
      "### Features",
      "",
      `- **cli:** add --json ([#40](https://github.com/o/r/issues/40)) ([${featHash.short}](https://github.com/o/r/commit/${featHash.hash}))`,
      "",
      "### Bug Fixes",
      "",
      `- stop reading ~/.rc ([${fixHash.short}](https://github.com/o/r/commit/${fixHash.hash}))`,
    ].join("\n"),
  );
  const plain = renderMarkdown(notes, { version: "1.0.0", date: "2026-10-29", to: "HEAD", heading: false });
  assert(plain.startsWith("### Breaking Changes"));
  assert(!plain.includes("]("));
  assertEquals(renderPlain(notes, "v2.0.0").split("\n")[0], "v2.0.0");
  assertEquals(
    renderMarkdown(groupCommits([]), { version: "v1", date: "d", to: "HEAD" }),
    "## v1 (d)\n\n_No changes._",
  );
});

Deno.test("CHANGELOG.md", () => {
  const section = "## v1.1.0 (2026-10-29)\n\n### Features\n\n- a";
  assertEquals(prependChangelog(undefined, section), `# Changelog\n\n${section}\n`);
  const existing =
    "# Changelog\n\nAll notable changes.\n\n## [Unreleased]\n\n- wip\n\n## [1.0.0] - 2026-01-01\n\n- first\n";
  assertEquals(
    prependChangelog(existing, section),
    `# Changelog\n\nAll notable changes.\n\n## [Unreleased]\n\n- wip\n\n${section}\n\n## [1.0.0] - 2026-01-01\n\n- first\n`,
  );
  assertEquals(prependChangelog("# Changelog\n", section), `# Changelog\n\n${section}\n`);
  assertEquals(prependChangelog("Some notes\n", section), `# Changelog\n\n${section}\n\nSome notes\n`);
  assert(hasVersion(existing, "v1.0.0"));
  assert(hasVersion("## v2.0.0 (2026)", "v2.0.0"));
  assert(!hasVersion(existing, "1.0.1"));
  assert(!hasVersion(existing, "v1.0"));
});

Deno.test("scan helpers", () => {
  assertEquals(reposFromFind("/a/x/.git\n/a/y/.git\n/a/x/.git\nnoise\n"), ["/a/x", "/a/y"]);
  assertEquals(findArgs(["/a"], 2).slice(0, 5), ["/a", "-mindepth", "1", "-maxdepth", "3"]);
  assertEquals(installCommand("ID=ubuntu\nID_LIKE=debian\n", "gh"), "sudo apt install gh");
  assertEquals(installCommand("ID=arch\n", "gh"), "sudo pacman -S github-cli");
});

Deno.test("a real repository", async () => {
  const dir = await Deno.makeTempDir({ prefix: "release-notes-" });
  const run = async (...args: string[]) => {
    const out = await new Deno.Command("git", {
      args: ["-C", dir, ...args],
      env: {
        GIT_AUTHOR_NAME: "T",
        GIT_AUTHOR_EMAIL: "t@example.com",
        GIT_COMMITTER_NAME: "T",
        GIT_COMMITTER_EMAIL: "t@example.com",
        GIT_CONFIG_GLOBAL: "/dev/null",
      },
    }).output();
    if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
  };
  try {
    await run("init", "-q", "-b", "main");
    await run("commit", "-q", "--allow-empty", "-m", "feat: first");
    await run("tag", "v0.1.0");
    await run("commit", "-q", "--allow-empty", "-m", "fix: a bug");
    await run("commit", "-q", "--allow-empty", "-m", "feat(ui): a button");
    await run("remote", "add", "origin", "git@github.com:me/demo.git");
    assertEquals(await latestTag(dir), "v0.1.0");
    const s = await summarize(dir);
    assertEquals([s.tag, s.pending], ["v0.1.0", 2]);
    const commits = await commitsIn(dir, "v0.1.0", "HEAD");
    assertEquals(commits.map((c) => c.subject), ["feat(ui): a button", "fix: a bug"]);
    const info = await repoInfo(dir);
    assertEquals([info.branch, info.tags, info.remote?.path, info.remoteName], [
      "main",
      ["v0.1.0"],
      "me/demo",
      "origin",
    ]);
    assertEquals(formatVersion(suggest(parseVersion("v0.1.0"), groupCommits(commits)).next), "v0.2.0");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
