import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  biggest,
  bodyChanges,
  buildQueries,
  checksState,
  DEFAULT_AUTHORS,
  matchesChip,
  parseAuthors,
  parsePull,
  parseScope,
  parseUpdate,
  semverJump,
  sortPulls,
  tickRebase,
  versionParts,
  versionText,
} from "./lib.ts";

const RENOVATE_BODY = `This PR contains the following updates:

| Package | Change | Age | Adoption | Passing | Confidence |
|---|---|---|---|---|---|
| [@types/node](https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/master/types/node) ([source](https://redirect.github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node)) | [\`20.11.0\` -> \`20.11.5\`](https://renovatebot.com/diffs/npm/@types%2fnode/20.11.0/20.11.5) | [![age](https://developer.mend.io/api/mc/badges/age/npm/@types%2fnode/20.11.5?slim=true)](https://docs.renovatebot.com/merge-confidence/) |

---

### Configuration

📅 **Schedule**: Branch creation - At any time (no schedule defined).

 - [ ] <!-- rebase-check -->If you want to rebase/retry this PR, check this box
`;

const RENOVATE_GROUP_BODY = `This PR contains the following updates:

| Package | Type | Update | Change |
|---|---|---|---|
| [eslint](https://eslint.org) ([source](https://redirect.github.com/eslint/eslint)) | devDependencies | major | [\`8.57.0\` → \`9.2.0\`](https://renovatebot.com/diffs/npm/eslint/8.57.0/9.2.0) |
| [prettier](https://prettier.io) | devDependencies | minor | [\`3.2.5\` → \`3.3.0\`](https://renovatebot.com/diffs/npm/prettier/3.2.5/3.3.0) |
| node | | patch | \`20.12.1\` -> \`20.12.2\` |
`;

const DEPENDABOT_GROUP_BODY =
  `Bumps the npm_and_yarn group with 2 updates in the / directory: [lodash](https://github.com/lodash/lodash) and [express](https://github.com/expressjs/express).

Updates \`lodash\` from 4.17.20 to 4.17.21
<details>
<summary>Commits</summary>
</details>

Updates \`express\` from 4.18.2 to 5.0.0
`;

Deno.test("manifest: every command has its file", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    commands: { name: string }[];
    permissions: { net: string[]; run: string[] };
  };
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  assertEquals(manifest.permissions.net, ["api.github.com"]);
  assertEquals(
    (manifest as unknown as { preferences: { name: string; default?: string }[] }).preferences
      .find((p) => p.name === "authors")?.default,
    DEFAULT_AUTHORS,
  );
  assertEquals(manifest.permissions.run, ["gh"]);
});

Deno.test("version parts", () => {
  assertEquals(versionParts("v1.2.3"), [1, 2, 3]);
  assertEquals(versionParts("^1.2"), [1, 2]);
  assertEquals(versionParts("~5.4.0"), [5, 4, 0]);
  assertEquals(versionParts("<2.32"), [2, 32]);
  assertEquals(versionParts(">= 1.0.0-rc.1"), [1, 0, 0]);
  assertEquals(versionParts("latest"), undefined);
  assertEquals(versionParts(undefined), undefined);
});

Deno.test("semver jumps", () => {
  assertEquals(semverJump("4.17.20", "4.17.21"), "patch");
  assertEquals(semverJump("1.2.3", "1.3.0"), "minor");
  assertEquals(semverJump("1.2.3", "2.0.0"), "major");
  assertEquals(semverJump("v3", "v4"), "major");
  assertEquals(semverJump("<2.28", "<2.32"), "minor");
  assertEquals(semverJump("0.7", "0.8"), "minor");
  assertEquals(semverJump("1.0.0-rc.1", "1.0.0-rc.2"), "patch");
  assertEquals(semverJump("1.2.3", "1.2.3"), undefined);
  // Renovate writes "to v4" only for majors.
  assertEquals(semverJump(undefined, "v4"), "major");
  assertEquals(semverJump(undefined, "v18.3.1"), undefined);
  assertEquals(semverJump(undefined, "8e5e7e5"), "digest");
  assertEquals(semverJump("b4ffde6", "8e5e7e5"), "digest");
  assertEquals(biggest(["patch", undefined, "major", "minor"]), "major");
  assertEquals(biggest([]), undefined);
});

Deno.test("Dependabot titles", () => {
  const cases: [string, string, string | undefined, string | undefined, string | undefined, string | undefined][] = [
    ["Bump lodash from 4.17.20 to 4.17.21", "lodash", "4.17.20", "4.17.21", "patch", undefined],
    ["Bump actions/checkout from 3 to 4", "actions/checkout", "3", "4", "major", undefined],
    ["build(deps): bump serde from 1.0.196 to 1.0.197", "serde", "1.0.196", "1.0.197", "patch", undefined],
    [
      "chore(deps-dev): bump @types/node from 20.1.0 to 20.2.0 in /web",
      "@types/node",
      "20.1.0",
      "20.2.0",
      "minor",
      "/web",
    ],
    ["Bump golang.org/x/net from 0.7.0 to 0.17.0 in /tools", "golang.org/x/net", "0.7.0", "0.17.0", "minor", "/tools"],
    ["Update requests requirement from <2.28 to <2.32", "requests", "<2.28", "<2.32", "minor", undefined],
    ["Bump vite from 4.5.0 to 5.0.12 in the npm_and_yarn group", "vite", "4.5.0", "5.0.12", "major", undefined],
  ];
  for (const [title, label, from, to, jump, dir] of cases) {
    const u = parseUpdate(title);
    assertEquals([u.kind, u.label, u.changes[0]?.from, u.changes[0]?.to, u.jump, u.directory], [
      "single",
      label,
      from,
      to,
      jump,
      dir,
    ], title);
  }
});

Deno.test("Dependabot groups take their changes from the body", () => {
  const u = parseUpdate("Bump the npm_and_yarn group across 1 directory with 2 updates", DEPENDABOT_GROUP_BODY);
  assertEquals(u.kind, "group");
  assertEquals(u.label, "npm_and_yarn");
  assertEquals(u.changes.map((c) => [c.name, c.from, c.to, c.jump]), [
    ["lodash", "4.17.20", "4.17.21", "patch"],
    ["express", "4.18.2", "5.0.0", "major"],
  ]);
  assertEquals(u.jump, "major");
  assertEquals(versionText(u), "2 packages");
  const several = parseUpdate("Bump express and body-parser in /api", DEPENDABOT_GROUP_BODY);
  assertEquals([several.kind, several.label, several.directory], ["group", "express, body-parser", "/api"]);
  assertEquals(several.changes[0].jump, "major");
  assertEquals(parseUpdate("chore(deps): bump the actions group with 3 updates").kind, "group");
});

Deno.test("Renovate titles", () => {
  const cases: [string, string, string | undefined, string | undefined][] = [
    ["Update dependency react to v18.3.1", "react", "v18.3.1", undefined],
    ["Update dependency eslint to v9", "eslint", "v9", "major"],
    ["chore(deps): update dependency @types/node to v20.11.5", "@types/node", "v20.11.5", undefined],
    ["fix(deps): update rust crate serde to 1.0.200", "serde", "1.0.200", undefined],
    ["Update actions/checkout action to v4", "actions/checkout", "v4", "major"],
    ["Update postgres Docker tag to v16.2", "postgres", "v16.2", undefined],
    ["Update Node.js to v20.12", "Node.js", "v20.12", undefined],
    ["Update module github.com/spf13/cobra to v1.8.1", "github.com/spf13/cobra", "v1.8.1", undefined],
    ["chore(deps): update helm release grafana to v7.3.0", "grafana", "v7.3.0", undefined],
    ["Update terraform aws to v5", "aws", "v5", "major"],
    ["⬆️ Update dependency typescript to ~5.4.0", "typescript", "~5.4.0", undefined],
    ["Update dependency next to v14.1.1 [SECURITY]", "next", "v14.1.1", undefined],
  ];
  for (const [title, label, to, jump] of cases) {
    const u = parseUpdate(title);
    assertEquals([u.kind, u.label, u.changes[0]?.to, u.jump], ["single", label, to, jump], title);
  }
  assertEquals(parseUpdate("Update dependency next to v14.1.1 [SECURITY]").security, true);
  assertEquals(parseUpdate("Update dependency react to v18.3.1").security, false);
});

Deno.test("Renovate: the old version comes from the body", () => {
  const u = parseUpdate("chore(deps): update dependency @types/node to v20.11.5", RENOVATE_BODY);
  assertEquals(u.changes, [{ name: "@types/node", from: "20.11.0", to: "v20.11.5", jump: "patch" }]);
  assertEquals(u.jump, "patch");
  assertEquals(versionText(u), "20.11.0 → 20.11.5");
});

Deno.test("Renovate groups, digests, pins and lock files", () => {
  const all = parseUpdate("chore(deps): update all non-major dependencies", RENOVATE_GROUP_BODY);
  assertEquals(all.kind, "group");
  assertEquals(all.label, "all non-major dependencies");
  assertEquals(all.changes.map((c) => [c.name, c.jump]), [["eslint", "major"], ["prettier", "minor"], [
    "node",
    "patch",
  ]]);
  assertEquals(all.jump, "major");
  const mono = parseUpdate("Update react monorepo to v18.3.0");
  assertEquals([mono.kind, mono.label, mono.changes[0].to], ["single", "react", "v18.3.0"]);
  const monoGroup = parseUpdate("Update linting packages to v9", RENOVATE_GROUP_BODY);
  assertEquals([monoGroup.kind, monoGroup.changes.length], ["group", 3]);
  const digest = parseUpdate("Update actions/checkout digest to 8e5e7e5");
  assertEquals([digest.kind, digest.label, digest.jump], ["digest", "actions/checkout", "digest"]);
  assertEquals(versionText(digest), "→ 8e5e7e5");
  assertEquals(parseUpdate("Lock file maintenance").kind, "lockfile");
  assertEquals(versionText(parseUpdate("chore(deps): lock file maintenance")), "lock file");
  assertEquals(parseUpdate("Pin dependencies").kind, "pin");
  assertEquals(parseUpdate("Pin dependency typescript to 5.4.5").changes[0].to, "5.4.5");
  const replace = parseUpdate("Replace dependency node-sass with sass 1.77.0");
  assertEquals([replace.kind, replace.label], ["replacement", "node-sass → sass"]);
  assertEquals(parseUpdate("Configure Renovate").kind, "other");
});

Deno.test("body changes", () => {
  assertEquals(bodyChanges(RENOVATE_GROUP_BODY).map((c) => `${c.name} ${c.from}→${c.to}`), [
    "eslint 8.57.0→9.2.0",
    "prettier 3.2.5→3.3.0",
    "node 20.12.1→20.12.2",
  ]);
  assertEquals(bodyChanges(undefined), []);
  assertEquals(bodyChanges("No table here"), []);
});

const NODE = {
  id: "PR_kwDOA",
  number: 42,
  title: "chore(deps): update dependency @types/node to v20.11.5",
  url: "https://github.com/acme/web/pull/42",
  body: RENOVATE_BODY,
  createdAt: "2026-10-25T10:00:00Z",
  updatedAt: "2026-10-27T10:00:00Z",
  isDraft: false,
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  headRefName: "renovate/node-20.x",
  baseRefName: "main",
  author: { login: "renovate" },
  repository: { nameWithOwner: "acme/web", isArchived: false },
  labels: { nodes: [{ name: "dependencies" }] },
  autoMergeRequest: null,
  commits: {
    nodes: [{
      commit: {
        oid: "abc123",
        statusCheckRollup: {
          state: "FAILURE",
          contexts: {
            totalCount: 3,
            nodes: [
              {
                __typename: "CheckRun",
                name: "test",
                status: "COMPLETED",
                conclusion: "FAILURE",
                detailsUrl: "https://github.com/acme/web/runs/1",
              },
              { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null, detailsUrl: "" },
              {
                __typename: "StatusContext",
                context: "ci/circleci",
                state: "SUCCESS",
                targetUrl: "https://circleci.com/x",
              },
            ],
          },
        },
      },
    }],
  },
};

Deno.test("pull requests from GraphQL search", () => {
  const p = parsePull(NODE)!;
  assertEquals([p.repo, p.number, p.bot, p.checks, p.mergeable, p.review], [
    "acme/web",
    42,
    "renovate",
    "failing",
    "MERGEABLE",
    "REVIEW_REQUIRED",
  ]);
  assertEquals(p.checkRuns.map((c) => [c.name, c.state]), [["test", "failure"], ["lint", "pending"], [
    "ci/circleci",
    "success",
  ]]);
  assertEquals(p.renovateRebase, true);
  assertEquals(p.update.label, "@types/node");
  assertEquals(parsePull({ ...NODE, repository: { nameWithOwner: "acme/old", isArchived: true } }), undefined);
  assertEquals(parsePull({}), undefined);
  const dependabot = parsePull({
    ...NODE,
    title: "Bump lodash from 4.17.20 to 4.17.21",
    body: "",
    author: { login: "dependabot" },
    commits: { nodes: [{ commit: { statusCheckRollup: null } }] },
    mergeable: "CONFLICTING",
  })!;
  assertEquals([dependabot.bot, dependabot.checks, dependabot.mergeable, dependabot.renovateRebase], [
    "dependabot",
    "none",
    "CONFLICTING",
    false,
  ]);
  assertEquals(checksState({ state: "SUCCESS" }), "passing");
  assertEquals(checksState({ state: "EXPECTED" }), "pending");
  assertEquals(tickRebase(RENOVATE_BODY).includes("- [x] <!-- rebase-check -->"), true);
});

Deno.test("order and filter chips", () => {
  const base = parsePull(NODE)!;
  const pulls = [
    {
      ...base,
      id: "1",
      repo: "acme/web",
      checks: "passing" as const,
      update: parseUpdate("Bump a from 1.0.0 to 1.0.1"),
    },
    {
      ...base,
      id: "2",
      repo: "acme/api",
      checks: "passing" as const,
      update: parseUpdate("Bump b from 1.0.0 to 2.0.0"),
    },
    {
      ...base,
      id: "3",
      repo: "acme/web",
      checks: "failing" as const,
      update: parseUpdate("Bump c from 1.0.0 to 1.1.0"),
    },
    {
      ...base,
      id: "4",
      repo: "acme/web",
      checks: "passing" as const,
      update: parseUpdate("Bump d from 1.0.0 to 3.0.0"),
    },
  ];
  assertEquals(sortPulls(pulls).map((p) => p.id), ["2", "3", "4", "1"]);
  assertEquals(pulls.filter((p) => matchesChip(p, "passing")).map((p) => p.id), ["1", "2", "4"]);
  assertEquals(pulls.filter((p) => matchesChip(p, "failing")).map((p) => p.id), ["3"]);
  assertEquals(pulls.filter((p) => matchesChip(p, "major")).map((p) => p.id), ["2", "4"]);
  assertEquals(pulls.filter((p) => matchesChip(p, "all")).length, 4);
});

Deno.test("authors, scope and queries", () => {
  assertEquals(parseAuthors(""), ["app/renovate", "app/dependabot"]);
  assertEquals(parseAuthors("dependabot[bot], @renovate-bot, app/renovate"), [
    "app/dependabot",
    "renovate-bot",
    "app/renovate",
  ]);
  assertEquals(parseScope("acme, ada/dotfiles https://github.com/x/y.git, not/a/repo"), [
    "user:acme",
    "repo:ada/dotfiles",
    "repo:x/y",
  ]);
  assertEquals(parseScope(""), []);
  assertEquals(buildQueries(["app/renovate"], ["user:ada"]), [
    "is:pr is:open archived:false author:app/renovate user:ada",
  ]);
  const many = Array.from({ length: 30 }, (_, i) => `repo:acme/service-number-${i}`);
  const queries = buildQueries(["app/renovate", "app/dependabot"], many);
  for (const q of queries) assertEquals(q.length <= 256, true, q);
  assertEquals(queries.filter((q) => q.includes("app/renovate")).join(" ").match(/repo:/g)!.length, 30);
});

Deno.test("age", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(age("2026-10-28T08:00:00Z", now), "today");
  assertEquals(age("2026-10-27T08:00:00Z", now), "yesterday");
  assertEquals(age("2026-10-20T08:00:00Z", now), "8d");
  assertEquals(age("2026-09-20T08:00:00Z", now), "5w");
  assertEquals(age("2026-01-20T08:00:00Z", now), "9mo");
});
