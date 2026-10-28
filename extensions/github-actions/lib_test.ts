import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  ago,
  arrange,
  cleanLog,
  duration,
  failing,
  isActive,
  type Job,
  jobItem,
  jobToShow,
  logMarkdown,
  logTail,
  parseRepositories,
  recentRepos,
  type Run,
  runDuration,
  runItem,
  stateOf,
  summary,
  workflowUrl,
} from "./lib.ts";

const now = new Date("2026-10-28T12:00:00Z");
const repository = {
  full_name: "backslash-app/backslash",
  html_url: "https://github.com/backslash-app/backslash",
};
const ada = { login: "ada", avatar_url: "https://avatars.githubusercontent.com/u/1?v=4" };

// Shaped like GET /repos/{owner}/{repo}/actions/runs.
function run(over: Partial<Run>): Run {
  return {
    id: 1,
    name: "CI",
    display_title: "Detect terminals before pasting",
    run_number: 812,
    run_attempt: 1,
    event: "push",
    status: "completed",
    conclusion: "success",
    workflow_id: 100,
    path: ".github/workflows/ci.yml",
    head_branch: "main",
    head_sha: "8f3c2a1d9e7b6c5a4f3e2d1c0b9a8f7e6d5c4b3a",
    html_url: "https://github.com/backslash-app/backslash/actions/runs/1",
    created_at: "2026-10-28T11:00:00Z",
    updated_at: "2026-10-28T11:04:12Z",
    run_started_at: "2026-10-28T11:00:05Z",
    actor: ada,
    triggering_actor: ada,
    head_commit: { id: "8f3c2a1", message: "Detect terminals before pasting\n\nKitty needs --single-instance." },
    repository,
    pull_requests: [],
    ...over,
  };
}

const runs: Run[] = [
  // main: failed, then fixed: history.
  run({ id: 1, conclusion: "failure", created_at: "2026-10-28T08:00:00Z" }),
  run({ id: 2, conclusion: "success", created_at: "2026-10-28T09:00:00Z" }),
  // feature branch: latest failed → failing.
  run({ id: 3, head_branch: "fix/kitty", conclusion: "success", created_at: "2026-10-28T07:00:00Z" }),
  run({ id: 4, head_branch: "fix/kitty", conclusion: "timed_out", created_at: "2026-10-28T10:00:00Z" }),
  // Release workflow on main: failed, then cancelled (cancelled doesn't count) → still failing.
  run({ id: 5, workflow_id: 200, name: "Release", conclusion: "failure", created_at: "2026-10-27T10:00:00Z" }),
  run({ id: 6, workflow_id: 200, name: "Release", conclusion: "cancelled", created_at: "2026-10-27T11:00:00Z" }),
  // Running now.
  run({ id: 7, status: "in_progress", conclusion: null, created_at: "2026-10-28T11:55:00Z" }),
  run({ id: 8, status: "queued", conclusion: null, created_at: "2026-10-28T11:58:00Z" }),
];

Deno.test("repositories from the preference", () => {
  assertEquals(
    parseRepositories(
      "backslash-app/backslash, https://github.com/octocat/hello-world.git\ngit@github.com:denoland/deno.git, nope, BACKSLASH-APP/backslash",
    ),
    ["backslash-app/backslash", "octocat/hello-world", "denoland/deno"],
  );
  assertEquals(parseRepositories(undefined), []);
  assertEquals(
    recentRepos([
      { full_name: "a/old", pushed_at: "2026-08-01T00:00:00Z" },
      { full_name: "a/new", pushed_at: "2026-10-27T00:00:00Z" },
      { full_name: "a/archived", pushed_at: "2026-10-27T00:00:00Z", archived: true },
      { full_name: "a/mid", pushed_at: "2026-10-20T00:00:00Z" },
    ], now),
    ["a/new", "a/mid"],
  );
});

Deno.test("states", () => {
  assertEquals(stateOf({ status: "completed", conclusion: "failure" }).tint, "red");
  assertEquals(stateOf({ status: "in_progress", conclusion: null }).text, "In progress");
  assertEquals(stateOf({ status: "waiting", conclusion: null }).kind, "waiting");
  assertEquals(stateOf({ status: "completed", conclusion: "cancelled" }).icon, "bs-stop");
  assertEquals(stateOf({ status: "completed", conclusion: "skipped" }).kind, "skipped");
  assertEquals(isActive(runs[6]), true);
  assertEquals(isActive(runs[0]), false);
});

Deno.test("failing means the latest run of a workflow on a branch failed", () => {
  assertEquals(failing(runs).map((r) => r.id), [4, 5]);
  assertEquals(summary(runs), "2 failing · 2 running");
  assertEquals(summary([runs[1]]), "");
});

Deno.test("arranging runs by filter", () => {
  assertEquals(arrange(runs, "failing").map((r) => r.run.id), [4, 5]);
  assertEquals(arrange(runs, "running").map((r) => r.run.id), [8, 7]);
  const all = arrange(runs, "all");
  assertEquals(all.map((r) => `${r.section}:${r.run.id}`), [
    "Failing:4",
    "Failing:5",
    "In Progress:8",
    "In Progress:7",
    "Recent:2",
    "Recent:1",
    "Recent:3",
    "Recent:6",
  ]);
});

Deno.test("durations and dates", () => {
  assertEquals([duration(45_000), duration(192_000), duration(3_840_000)], ["45s", "3m 12s", "1h 04m"]);
  assertEquals(runDuration(runs[1], now), "4m 07s");
  assertEquals(runDuration(run({ status: "in_progress", run_started_at: "2026-10-28T11:58:30Z" }), now), "1m 30s");
  assertEquals(
    [ago("2026-10-28T11:59:30Z", now), ago("2026-10-28T11:15:00Z", now), ago("2026-10-27T09:00:00Z", now)],
    ["just now", "45 min ago", "yesterday"],
  );
  assertEquals(workflowUrl(runs[0]), "https://github.com/backslash-app/backslash/actions/workflows/ci.yml");
});

Deno.test("run item", () => {
  const item = runItem(runs[3], "Failing", [], now);
  assertEquals(item.title, "Detect terminals before pasting");
  assertEquals(item.subtitle, "backslash · CI");
  assertEquals(item.icon, { source: "bs-circle-x", tint: "red" });
  assertEquals(item.accessories?.map((a) => a.text ?? a.avatar), [
    "fix/kitty",
    "4m 07s",
    "https://avatars.githubusercontent.com/u/1?v=4",
    "2 h ago",
  ]);
  assertEquals(item.detail?.markdown, "**Detect terminals before pasting**\n\nKitty needs --single-instance.");
  const labels = item.detail?.metadata?.map((m) => m.label);
  assertEquals(labels?.slice(0, 6), ["Status", "Workflow", "Repository", "Branch", "Event", "Commit"]);
  assertEquals(item.detail?.metadata?.find((m) => m.label === "Status")?.value, "Timed out");
  assertEquals(item.detail?.stats?.map((s) => s.value), ["4m 07s", "#812"]);
});

// Shaped like GET /repos/{owner}/{repo}/actions/runs/{id}/jobs.
const jobs: Job[] = [
  {
    id: 11,
    run_id: 4,
    name: "lint",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/backslash-app/backslash/actions/runs/4/job/11",
    started_at: "2026-10-28T10:00:10Z",
    completed_at: "2026-10-28T10:00:58Z",
    labels: ["ubuntu-latest"],
    runner_name: "GitHub Actions 3",
    steps: [
      { name: "Set up job", number: 1, status: "completed", conclusion: "success" },
      { name: "deno lint", number: 2, status: "completed", conclusion: "success" },
    ],
  },
  {
    id: 12,
    run_id: 4,
    name: "test (ubuntu-latest)",
    status: "completed",
    conclusion: "failure",
    html_url: "https://github.com/backslash-app/backslash/actions/runs/4/job/12",
    started_at: "2026-10-28T10:00:10Z",
    completed_at: "2026-10-28T10:03:40Z",
    labels: ["ubuntu-latest"],
    steps: [
      {
        name: "Set up job",
        number: 1,
        status: "completed",
        conclusion: "success",
        started_at: "2026-10-28T10:00:10Z",
        completed_at: "2026-10-28T10:00:12Z",
      },
      { name: "cargo test", number: 2, status: "completed", conclusion: "failure" },
      { name: "Upload coverage", number: 3, status: "completed", conclusion: "skipped" },
    ],
  },
];

Deno.test("job item with its steps", () => {
  const item = jobItem(jobs[1], [], now);
  assertEquals(item.subtitle, "Failed at “cargo test”");
  assertEquals(item.section, "Failed");
  assertEquals(item.accessories?.map((a) => a.text), ["3/3 steps", "3m 30s"]);
  assertEquals(item.detail?.metadata?.slice(0, 3).map((m) => [m.label, m.value, m.color]), [
    ["Set up job", "Succeeded · 2s", "green"],
    ["cargo test", "Failed", "red"],
    ["Upload coverage", "Skipped", "gray"],
  ]);
  assertEquals(jobToShow(jobs)?.id, 12);
});

const LOG = [
  "﻿2026-10-28T10:00:10.1234567Z ##[group]Run cargo test",
  "2026-10-28T10:00:10.1234567Z \x1b[36;1mcargo test --workspace\x1b[0m",
  "2026-10-28T10:00:10.1234567Z ##[endgroup]",
  "2026-10-28T10:03:30.0000000Z ##[debug]Evaluating condition",
  "2026-10-28T10:03:31.0000000Z test paste::kitty ... \x1b[31mFAILED\x1b[0m",
  "2026-10-28T10:03:31.0000000Z thread 'paste::kitty' panicked at src/paste.rs:42:5",
  "2026-10-28T10:03:39.0000000Z ##[error]Process completed with exit code 101.",
  "2026-10-28T10:03:40.0000000Z Post job cleanup.",
  "2026-10-28T10:03:40.0000000Z ##[group]Post job cleanup.",
  "2026-10-28T10:03:40.0000000Z Cleaning up orphan processes",
  "",
].join("\n");

Deno.test("log tail", () => {
  assertEquals(cleanLog(LOG).slice(0, 3), [
    "▸ Run cargo test",
    "cargo test --workspace",
    "test paste::kitty ... FAILED",
  ]);
  const tail = logTail(LOG, 3);
  assertEquals(tail.errors, ["Process completed with exit code 101."]);
  assertEquals(tail.tail, [
    "thread 'paste::kitty' panicked at src/paste.rs:42:5",
    "Error: Process completed with exit code 101.",
    "Post job cleanup.",
  ]);
  const md = logMarkdown(jobs[1], LOG);
  assertStringIncludes(md, "Failed at step **2. cargo test**");
  assertStringIncludes(md, "## Errors\n\n- Process completed with exit code 101.");
  assertStringIncludes(md, "```text\n▸ Run cargo test");
  assertStringIncludes(logMarkdown(jobs[1], ""), "not available");
});
