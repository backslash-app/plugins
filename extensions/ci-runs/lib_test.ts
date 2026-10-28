import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { accounts, SetupError } from "./api.ts";
import {
  buildkiteSlugs,
  circleStatus,
  circleUrl,
  currentFailures,
  duration,
  filterRuns,
  flattenJobs,
  formatDuration,
  fromBuildkite,
  fromCircle,
  fromJenkins,
  fromWoodpecker,
  group,
  jenkinsTree,
  normalizeUrl,
  parseOrgs,
  shortSha,
  sortRuns,
} from "./lib.ts";

const SHA = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

const PIPELINE = {
  id: "5034460f-c7c4-4c43-9457-de07e2029e7b",
  number: 1287,
  project_slug: "gh/acme/api",
  state: "created",
  created_at: "2026-10-28T10:00:00.000Z",
  trigger: { type: "webhook", actor: { login: "alice", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" } },
  vcs: { branch: "main", revision: SHA, commit: { subject: "Fix the login redirect" } },
};

const WORKFLOWS = [
  {
    id: "wf-build",
    name: "build",
    status: "success",
    created_at: "2026-10-28T10:00:02Z",
    stopped_at: "2026-10-28T10:04:02Z",
  },
  {
    id: "wf-test",
    name: "test",
    status: "failed",
    created_at: "2026-10-28T10:00:03Z",
    stopped_at: "2026-10-28T10:07:33Z",
  },
];

Deno.test("CircleCI: the worst workflow wins, duration across workflows, app URL", () => {
  const r = fromCircle(PIPELINE, WORKFLOWS);
  assertEquals(r.status, "failed");
  assertEquals(r.rawStatus, "failed");
  assertEquals(r.project, "acme/api");
  assertEquals(r.author, "alice");
  assertEquals(formatDuration(duration(r)), "7m 31s");
  assertEquals(r.url, "https://app.circleci.com/pipelines/github/acme/api/1287");
  assertEquals(r.ref.failed, "wf-test");
  assertEquals(r.ref.rerun, "wf-build,wf-test");
  assertEquals(r.canCancel, false);
  assertEquals(
    circleUrl("bb/acme/web", 3, "w1"),
    "https://app.circleci.com/pipelines/bitbucket/acme/web/3/workflows/w1",
  );
  assertEquals(circleStatus({ ...PIPELINE, state: "errored" }, []).status, "failed");
  assertEquals(circleStatus(PIPELINE, []).status, "queued");
  const running = fromCircle(PIPELINE, [{ ...WORKFLOWS[1], status: "running", stopped_at: null }]);
  assertEquals(running.status, "running");
  assertEquals(running.finished, undefined);
  assertEquals(running.canCancel, true);
  assertEquals(running.canRerun, false);
});

const BUILD = {
  id: "f62a1b4d-10f9-4790-bc1c-e2c3a0c80983",
  url: "https://api.buildkite.com/v2/organizations/acme/pipelines/web-app/builds/42",
  web_url: "https://buildkite.com/acme/web-app/builds/42",
  number: 42,
  state: "running",
  message: "Bump deps\n\nSigned-off-by: bob",
  commit: SHA,
  branch: "renovate/deps",
  source: "webhook",
  created_at: "2026-10-28T11:50:00.000Z",
  started_at: "2026-10-28T11:51:00.000Z",
  finished_at: null,
  creator: { name: "Bob", avatar_url: "https://www.gravatar.com/avatar/abc" },
  author: { name: "Bob Builder", username: "bob" },
  pipeline: { slug: "web-app", name: "Web App" },
};

Deno.test("Buildkite: slugs from the API URL, first line of the message, cancel while running", () => {
  const r = fromBuildkite(BUILD);
  assertEquals(r.status, "running");
  assertEquals(r.project, "Web App");
  assertEquals(r.message, "Bump deps");
  assertEquals(r.author, "Bob Builder");
  assertEquals(r.ref, { org: "acme", pipeline: "web-app", number: "42" });
  assertEquals([r.canRerun, r.canCancel], [false, true]);
  assertEquals(duration(r, Date.parse("2026-10-28T11:53:30Z")), 150_000);
  assertEquals(fromBuildkite({ ...BUILD, state: "passed", commit: "HEAD" }).commit, undefined);
  assertEquals(buildkiteSlugs("https://example.com"), undefined);
});

Deno.test("Woodpecker: feed with unix times, repo names from the repo list, tags", () => {
  const repos = new Map([[7, "acme/site"]]);
  const r = fromWoodpecker(
    {
      repo_id: 7,
      id: 900,
      number: 55,
      event: "push",
      status: "failure",
      created: 1761645600,
      started: 1761645610,
      finished: 1761645730,
      commit: SHA,
      branch: "main",
      message: "Update README\n",
      author: "carol",
      author_avatar: "https://secure.gravatar.com/avatar/x",
    },
    "https://ci.example.com",
    repos,
  )!;
  assertEquals(r.project, "acme/site");
  assertEquals(r.status, "failed");
  assertEquals(r.url, "https://ci.example.com/repos/7/pipeline/55");
  assertEquals(formatDuration(duration(r)), "2m 0s");
  assertEquals(r.message, "Update README");
  const tag = fromWoodpecker(
    { repo_id: 8, number: 2, event: "tag", status: "pending", ref: "refs/tags/v1.2.0", full_name: "acme/lib" },
    "https://ci.example.com",
    repos,
  )!;
  assertEquals([tag.project, tag.tag, tag.branch, tag.status, tag.canCancel], [
    "acme/lib",
    "v1.2.0",
    undefined,
    "queued",
    true,
  ]);
  assertEquals(fromWoodpecker({ number: 1, status: "success" }, "https://x", repos), undefined);
});

const JENKINS = {
  jobs: [
    {
      _class: "hudson.model.FreeStyleProject",
      name: "nightly",
      fullName: "nightly",
      url: "https://jenkins.example.com/job/nightly/",
      buildable: true,
      lastBuild: {
        number: 311,
        url: "https://jenkins.example.com/job/nightly/311/",
        result: "UNSTABLE",
        building: false,
        timestamp: 1761631200000,
        duration: 3_725_000,
        actions: [
          { _class: "hudson.model.CauseAction", causes: [{ shortDescription: "Started by timer" }] },
          null,
          { lastBuiltRevision: { SHA1: SHA, branch: [{ name: "refs/remotes/origin/main" }] } },
        ],
        changeSets: [],
      },
    },
    {
      _class: "org.jenkinsci.plugins.workflow.multibranch.WorkflowMultiBranchProject",
      name: "api",
      fullName: "api",
      url: "https://jenkins.example.com/job/api/",
      jobs: [
        {
          name: "feature%2Flogin",
          fullName: "api/feature%2Flogin",
          url: "https://jenkins.example.com/job/api/job/feature%252Flogin/",
          lastBuild: {
            number: 4,
            url: "https://jenkins.example.com/job/api/job/feature%252Flogin/4/",
            result: null,
            building: true,
            timestamp: 1761645000000,
            duration: 0,
            estimatedDuration: 600_000,
            changeSets: [{ items: [{ commitId: SHA, msg: "Add login form", author: { fullName: "Dana" } }] }],
          },
        },
        { name: "old", fullName: "api/old", url: "https://jenkins.example.com/job/api/job/old/", lastBuild: null },
      ],
    },
  ],
};

Deno.test("Jenkins: folders flattened, results, branches from revisions or job names", () => {
  const jobs = flattenJobs(JENKINS.jobs);
  assertEquals(jobs.map((j) => j.fullName), ["nightly", "api/feature%2Flogin"]);
  const [nightly, feature] = jobs.map((j) => fromJenkins(j)!);
  assertEquals(nightly.status, "failed");
  assertEquals(nightly.rawStatus, "UNSTABLE");
  assertEquals(nightly.branch, "main");
  assertEquals(nightly.message, "Started by timer");
  assertEquals(formatDuration(duration(nightly)), "1h 2m");
  assertEquals(feature.status, "running");
  assertEquals(feature.branch, "feature/login");
  assertEquals(feature.author, "Dana");
  assertEquals([feature.canRerun, feature.canCancel], [false, true]);
  assertEquals(feature.ref.job, "https://jenkins.example.com/job/api/job/feature%252Flogin/");
  assert(jenkinsTree().startsWith("jobs[name,fullName,url,color,buildable,lastBuild[number"));
  assertEquals(jenkinsTree().split("jobs[").length - 1, 3);
});

Deno.test("order: current failures first, fixed failures with history", () => {
  const failedOld = { ...fromBuildkite({ ...BUILD, id: "1", state: "failed", created_at: "2026-10-28T08:00:00Z" }) };
  const passedNew = fromBuildkite({ ...BUILD, id: "2", state: "passed", created_at: "2026-10-28T09:00:00Z" });
  const running = fromBuildkite({ ...BUILD, id: "3", branch: "other", created_at: "2026-10-28T07:00:00Z" });
  const failing = fromCircle(PIPELINE, WORKFLOWS);
  const runs = [failedOld, passedNew, running, failing];
  const current = currentFailures(runs);
  assertEquals([...current], [failing]);
  assertEquals(group(failedOld, current), "Recent");
  assertEquals(sortRuns(runs).map((r) => r.id), [failing.id, "3", "2", "1"]);
  assertEquals(filterRuns(runs, "failed").length, 2);
  assertEquals(filterRuns(runs, "running").map((r) => r.id), ["3"]);
  assertEquals(filterRuns(runs, "circleci"), [failing]);
});

Deno.test("formatting and preferences", () => {
  assertEquals(formatDuration(42_000), "42s");
  assertEquals(formatDuration(undefined), "");
  assertEquals(shortSha(SHA), "a1b2c3d");
  assertEquals(shortSha("v1"), "v1");
  assertEquals(parseOrgs("gh/acme, bb/foo junk circleci/1a2b-3c"), ["gh/acme", "bb/foo", "circleci/1a2b-3c"]);
  assertEquals(normalizeUrl("jenkins.example.com/ci/"), "https://jenkins.example.com/ci");
  const acc = accounts({ jenkinsUrl: "jenkins.example.com", jenkinsUser: "me", jenkinsToken: "t", woodpeckerUrl: "x" });
  assertEquals(acc.map((a) => a.provider), ["woodpecker", "jenkins"]);
  assert(acc[0] instanceof SetupError);
  assertEquals(!(acc[1] instanceof SetupError) && acc[1].headers.Authorization, `Basic ${btoa("me:t")}`);
  assertEquals(accounts({}), []);
});

Deno.test("the manifest reaches the fixed APIs and your own servers", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assert(manifest.permissions.net.includes("*"));
  assert(manifest.permissions.net.includes("circleci.com"));
  assert(manifest.permissions.net.includes("api.buildkite.com"));
});
