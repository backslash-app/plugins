import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  buildDraft,
  cleanCommits,
  type Commit,
  githubQueries,
  githubSearchUrl,
  gitLogArgs,
  lastWorkingDay,
  linearQuery,
  parseGithubSearch,
  parseGitLog,
  parseLinear,
  parseWorkdays,
  renderDraft,
  standupWindow,
  summary,
  tidySubject,
} from "./lib.ts";
import { ALLOWED, findRepos } from "./sources.ts";

const at = (y: number, m: number, d: number, h = 9) => new Date(y, m - 1, d, h, 0);
const MONDAY = at(2026, 11, 2, 9);

Deno.test("working days", () => {
  assertEquals(parseWorkdays(""), [1, 2, 3, 4, 5]);
  assertEquals(parseWorkdays("sun-thu"), [0, 1, 2, 3, 4]);
  assertEquals(parseWorkdays("mon, tue,thu"), [1, 2, 4]);
  assertThrows(() => parseWorkdays("monday-someday"));
});

Deno.test("last working day: Friday on Mondays and weekends, else yesterday", () => {
  assertEquals(lastWorkingDay(MONDAY).getTime(), at(2026, 10, 30, 0).getTime());
  assertEquals(lastWorkingDay(at(2026, 11, 1)).getTime(), at(2026, 10, 30, 0).getTime()); // Sunday
  assertEquals(lastWorkingDay(at(2026, 11, 4)).getTime(), at(2026, 11, 3, 0).getTime()); // Wednesday
  // Sunday to Thursday weeks: on Sunday, Thursday.
  assertEquals(lastWorkingDay(at(2026, 11, 1), [0, 1, 2, 3, 4]).getTime(), at(2026, 10, 29, 0).getTime());
});

Deno.test("windows and labels", () => {
  const w = standupWindow(MONDAY);
  assertEquals([w.label, w.since.getTime(), w.until.getTime()], [
    "Friday",
    at(2026, 10, 30, 0).getTime(),
    MONDAY.getTime(),
  ]);
  assertEquals(standupWindow(at(2026, 11, 4)).label, "Yesterday");
  assertEquals(standupWindow(at(2026, 11, 4, 15), "today").since.getTime(), at(2026, 11, 4, 0).getTime());
  assertEquals(standupWindow(at(2026, 11, 5), "week").since.getTime(), at(2026, 11, 2, 0).getTime());
});

const LOG = [
  "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678\x1fa1b2c3d\x1f2026-10-30T16:42:10+01:00\x1fAda Lovelace\x1fada@example.com\x1ffeat(api): add search endpoint\x1fHEAD -> main, origin/main\x1e",
  "\nb2c3d4e5f60718293a4b5c6d7e8f901234567890\x1fb2c3d4e\x1f2026-10-30T11:05:00+01:00\x1fAda Lovelace\x1fada@example.com\x1ffixup! feat(api): add search endpoint\x1f\x1e",
  "\nc3d4e5f60718293a4b5c6d7e8f90123456789012\x1fc3d4e5f\x1f2026-10-30T10:00:00+01:00\x1fAda Lovelace\x1fada@example.com\x1fFix the tray refresh (#88)\x1f\x1e",
  "\nd4e5f60718293a4b5c6d7e8f9012345678901234\x1fd4e5f60\x1f2026-10-29T18:00:00+01:00\x1fAda Lovelace\x1fada@example.com\x1fFix the tray refresh (#88)\x1forigin/old\x1e",
].join("");

Deno.test("git log: parsed, fixups and rebased copies dropped", () => {
  const commits = parseGitLog(LOG, "/home/ada/Code/backslash");
  assertEquals(commits.length, 4);
  assertEquals(commits[0].refs, "HEAD -> main, origin/main");
  assertEquals(commits[0].date.toISOString(), "2026-10-30T15:42:10.000Z");
  const clean = cleanCommits(commits);
  assertEquals(clean.map((c) => c.short), ["c3d4e5f", "a1b2c3d"]); // oldest first, newest copy kept
  assertEquals(parseGitLog("", "/x"), []);
  assertEquals(parseGitLog("garbage\x1e", "/x"), []);
});

Deno.test("git log arguments", () => {
  const args = gitLogArgs("/r", new Date("2026-10-30T00:00:00Z"), ["ada@example.com", "Ada (work)"]);
  assertEquals(args.slice(0, 5), ["-C", "/r", "log", "--all", "--no-merges"]);
  assert(args.includes("--since=2026-10-30T00:00:00.000Z"));
  assert(args.includes("--author=ada@example\\.com"));
  assert(args.includes("--author=Ada \\(work\\)"));
});

Deno.test("commit subjects tidied", () => {
  assertEquals(tidySubject("feat(api): add search"), "Add search");
  assertEquals(tidySubject("fix!: drop node 16"), "Drop node 16");
  assertEquals(tidySubject("docs: typo"), "Typo");
  assertEquals(tidySubject("Release: 1.2"), "Release: 1.2"); // not a conventional type
  assertEquals(tidySubject("update readme"), "Update readme");
});

const SEARCH = {
  total_count: 2,
  incomplete_results: false,
  items: [
    {
      number: 1423,
      title: "Add Org Mode extension",
      html_url: "https://github.com/backslash-app/plugins/pull/1423",
      repository_url: "https://api.github.com/repos/backslash-app/plugins",
      state: "closed",
      draft: false,
      pull_request: { merged_at: "2026-10-30T15:00:00Z" },
    },
    {
      number: 77,
      title: "WIP: tray icons",
      html_url: "https://github.com/ada/dotfiles/pull/77",
      repository_url: "https://api.github.com/repos/ada/dotfiles",
      state: "open",
      draft: true,
    },
  ],
};

Deno.test("GitHub search results and queries", () => {
  const prs = parseGithubSearch(SEARCH, "merged");
  assertEquals(prs[0], {
    repo: "backslash-app/plugins",
    number: 1423,
    title: "Add Org Mode extension",
    url: "https://github.com/backslash-app/plugins/pull/1423",
    state: "merged",
    draft: undefined,
  });
  assertEquals(prs[1].draft, true);
  assertEquals(parseGithubSearch({ message: "Bad credentials" }, "open"), []);
  const q = githubQueries(at(2026, 10, 30, 0));
  assertEquals(q.merged, "is:pr author:@me is:merged merged:>=2026-10-30");
  assertEquals(q.reviewed, "is:pr reviewed-by:@me -author:@me updated:>=2026-10-30");
  assert(githubSearchUrl(q.open).startsWith("https://api.github.com/search/issues?q=is%3Apr%20author%3A%40me"));
});

const LINEAR = {
  data: {
    viewer: {
      completed: {
        nodes: [{
          identifier: "ENG-512",
          title: "Search returns stale results",
          url: "https://linear.app/acme/issue/ENG-512",
          completedAt: "2026-10-30T14:00:00.000Z",
          state: { name: "Done", type: "completed" },
        }],
      },
      started: {
        nodes: [{
          identifier: "ENG-530",
          title: "Paginate the search API",
          url: "https://linear.app/acme/issue/ENG-530",
          completedAt: null,
          state: { name: "In Progress", type: "started" },
        }],
      },
    },
  },
};

Deno.test("Linear issues and query", () => {
  const issues = parseLinear(LINEAR);
  assertEquals(issues.map((i) => [i.identifier, i.kind, i.state]), [
    ["ENG-512", "completed", "Done"],
    ["ENG-530", "started", "In Progress"],
  ]);
  assertThrows(() => parseLinear({ errors: [{ message: "Authentication required" }] }), Error, "Authentication");
  assertEquals(parseLinear({}), []);
  const q = linearQuery(new Date("2026-10-30T00:00:00Z"));
  assert(q.includes('completedAt: { gte: "2026-10-30T00:00:00.000Z" }'));
  assert(q.includes('state: { type: { eq: "started" } }'));
});

const SOURCES = {
  commits: cleanCommits(parseGitLog(LOG, "/home/ada/Code/backslash")),
  prs: [...parseGithubSearch(SEARCH, "merged").slice(0, 1), ...parseGithubSearch(SEARCH, "open").slice(1)],
  issues: parseLinear(LINEAR),
};

Deno.test("the draft in Markdown", () => {
  const draft = buildDraft(standupWindow(MONDAY), SOURCES);
  assertEquals(
    renderDraft(draft, "markdown"),
    [
      "**Friday (Fri, Oct 30)**",
      "- **Done** [ENG-512 Search returns stale results](https://linear.app/acme/issue/ENG-512)",
      "- **Merged** [Add Org Mode extension (#1423)](https://github.com/backslash-app/plugins/pull/1423) in backslash-app/plugins",
      "- **backslash:** Fix the tray refresh (#88); Add search endpoint",
      "",
      "**Today**",
      "- **In Progress:** [ENG-530 Paginate the search API](https://linear.app/acme/issue/ENG-530)",
      "- **Draft PR** [WIP: tray icons (#77)](https://github.com/ada/dotfiles/pull/77) in ada/dotfiles",
      "",
      "**Blockers**",
      "- None",
    ].join("\n"),
  );
});

Deno.test("the draft for Slack", () => {
  const draft = buildDraft(standupWindow(at(2026, 11, 4)), { ...SOURCES, prs: [], issues: [] }, { tidy: false });
  assertEquals(
    renderDraft(draft, "slack", { blockers: "Waiting for <design> & review" }),
    [
      "*Yesterday (Tue, Nov 3)*",
      "• *backslash:* Fix the tray refresh (#88); feat(api): add search endpoint",
      "",
      "*Today*",
      "• …",
      "",
      "*Blockers*",
      "• Waiting for <design> & review",
    ].join("\n"),
  );
  const link = renderDraft(
    buildDraft(standupWindow(MONDAY), { commits: [], prs: [], issues: SOURCES.issues }),
    "slack",
  );
  assert(link.includes("• *Done* <https://linear.app/acme/issue/ENG-512|ENG-512 Search returns stale results>"));
});

Deno.test("many commits in a repo are summed up", () => {
  const many: Commit[] = Array.from({ length: 6 }, (_, i) => ({
    repo: "/r/api",
    hash: `${i}`.repeat(40),
    short: `${i}`.repeat(7),
    date: new Date(2026, 9, 30, 10 + i),
    author: "Ada",
    email: "a@x",
    subject: `Change ${i}`,
    refs: "",
  }));
  const draft = buildDraft(standupWindow(MONDAY), { commits: many, prs: [], issues: [] });
  assertEquals(draft.done[0].text, "Change 0; Change 1; Change 2; Change 3 (+2 more)");
  assertEquals(summary({ commits: many, prs: [], issues: [] }), "6 commits in 1 repo");
  assertEquals(summary(SOURCES), "2 commits in 1 repo · 1 merged PR · 1 issue done");
  assertEquals(summary({ commits: [], prs: [], issues: [] }), "No commit");
});

Deno.test("a real repository: found, logged and parsed", async () => {
  const root = await Deno.makeTempDir({ prefix: "standup-test-" });
  try {
    const repo = `${root}/acme/api`;
    await Deno.mkdir(repo, { recursive: true });
    await Deno.mkdir(`${root}/notes`);
    const env = {
      GIT_AUTHOR_NAME: "Ada",
      GIT_AUTHOR_EMAIL: "ada@example.com",
      GIT_COMMITTER_NAME: "Ada",
      GIT_COMMITTER_EMAIL: "ada@example.com",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    const git = async (args: string[], extra: Record<string, string> = {}) => {
      const out = await new Deno.Command("git", { args, cwd: repo, env: { ...env, ...extra } }).output();
      if (!out.success) throw new Error(new TextDecoder().decode(out.stderr));
      return new TextDecoder().decode(out.stdout);
    };
    await git(["init", "-q"]);
    await git(["commit", "-q", "--allow-empty", "-m", "Old work"], {
      GIT_AUTHOR_DATE: "2026-10-20T10:00:00",
      GIT_COMMITTER_DATE: "2026-10-20T10:00:00",
    });
    await git(["commit", "-q", "--allow-empty", "-m", "feat: add search"], {
      GIT_AUTHOR_DATE: "2026-10-30T10:00:00",
      GIT_COMMITTER_DATE: "2026-10-30T10:00:00",
    });
    await git(["commit", "-q", "--allow-empty", "-m", "Someone else"], {
      GIT_AUTHOR_EMAIL: "bob@example.com",
      GIT_AUTHOR_DATE: "2026-10-30T11:00:00",
      GIT_COMMITTER_DATE: "2026-10-30T11:00:00",
    });
    assertEquals(await findRepos([root]), [repo]);
    const out = await git(gitLogArgs(repo, at(2026, 10, 30, 0), ["ADA@example.com"]).slice(2));
    const commits = parseGitLog(out, repo);
    assertEquals(commits.map((c) => c.subject), ["feat: add search"]);
    assertEquals(commits[0].email, "ada@example.com");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("manifest: the folders of ALLOWED, git, two hosts", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.read, ALLOWED);
  assertEquals(manifest.permissions.run, ["git"]);
  assertEquals(manifest.permissions.net, ["api.github.com", "api.linear.app"]);
  for (const name of ["githubToken", "linearKey"]) {
    assertEquals(manifest.preferences.find((p: any) => p.name === name).type, "secret");
  }
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
