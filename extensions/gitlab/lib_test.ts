import { assertEquals } from "@std/assert";
import type { Context } from "@backslash/api";
import {
  ago,
  approvals,
  avatar,
  branchName,
  colorOf,
  duration,
  gidNumber,
  type Issue,
  issueItem,
  issueMetadata,
  type MergeRequest,
  mergeStatus,
  mrIcon,
  mrItem,
  mrMetadata,
  type Pipeline,
  pipelineItem,
  pipelineStatus,
  type Project,
  projectItem,
  stagesMarkdown,
} from "./lib.ts";
import { AuthError, countStatus, guarded, setupItems } from "./api.ts";

const ctx: Context = { args: {}, preferences: { token: "glpat-x" }, query: "", signal: new AbortController().signal };

// Shaped like GitLab's GraphQL `MergeRequest`.
const mr: MergeRequest = {
  id: "gid://gitlab/MergeRequest/301",
  iid: "128",
  title: "Cache the dependency proxy manifest",
  webUrl: "https://gitlab.com/acme/platform/api/-/merge_requests/128",
  draft: false,
  state: "opened",
  createdAt: "2026-10-26T08:00:00Z",
  updatedAt: "2026-10-27T10:00:00Z",
  sourceBranch: "cache-manifest",
  targetBranch: "main",
  description: "<!-- template -->Avoids a round trip per pull.",
  conflicts: false,
  detailedMergeStatus: "NOT_APPROVED",
  userNotesCount: 4,
  approved: false,
  approvalsRequired: 2,
  approvalsLeft: 1,
  author: { username: "ada", name: "Ada Lovelace", avatarUrl: "/uploads/-/system/user/avatar/1/avatar.png" },
  project: { fullPath: "acme/platform/api", name: "api" },
  headPipeline: { iid: "912", status: "SUCCESS", path: "/acme/platform/api/-/pipelines/1203" },
  approvedBy: {
    nodes: [{ username: "grace", name: "Grace Hopper", avatarUrl: "https://secure.gravatar.com/avatar/x" }],
  },
  reviewers: { nodes: [{ username: "linus", name: "Linus T", avatarUrl: null }] },
  labels: { nodes: [{ title: "backend", color: "#1f75cb" }, { title: "bug", color: "#dc143c" }] },
  diffStatsSummary: { additions: 86, deletions: 12, fileCount: 4 },
};

// Shaped like `GET /issues?with_labels_details=true`.
const issue: Issue = {
  id: 9001,
  iid: 42,
  project_id: 77,
  title: "Login page shows a blank screen on Firefox",
  description: "Steps:\n1. Open /login",
  state: "opened",
  created_at: "2026-10-20T09:00:00.000Z",
  updated_at: "2026-10-27T09:00:00.000Z",
  due_date: "2026-10-01",
  web_url: "https://gitlab.com/acme/web/-/issues/42",
  labels: [{ name: "frontend", color: "#108548" }, "priority::1"],
  milestone: { title: "16.6", due_date: "2026-11-15" },
  author: { id: 1, username: "ada", name: "Ada Lovelace", avatar_url: "https://secure.gravatar.com/avatar/a" },
  assignees: [{ id: 2, username: "grace", name: "Grace Hopper", avatar_url: null }],
  user_notes_count: 3,
  weight: 2,
  references: { short: "#42", full: "acme/web#42" },
  task_completion_status: { count: 4, completed_count: 1 },
};

const project: Project = {
  id: 77,
  name: "web",
  name_with_namespace: "Acme / web",
  path_with_namespace: "acme/web",
  description: "The website",
  web_url: "https://gitlab.com/acme/web",
  star_count: 1234,
  forks_count: 12,
  open_issues_count: 30,
  last_activity_at: "2026-10-27T08:00:00Z",
  default_branch: "main",
  visibility: "private",
  topics: ["vue"],
  ssh_url_to_repo: "git@gitlab.com:acme/web.git",
  http_url_to_repo: "https://gitlab.com/acme/web.git",
  namespace: { full_path: "acme", name: "Acme" },
};

const pipeline: Pipeline = {
  id: "gid://gitlab/Ci::Pipeline/1203",
  iid: "912",
  status: "FAILED",
  ref: "main",
  sha: "1f2e3d4c5b6a79881f2e3d4c5b6a79881f2e3d4c",
  path: "/acme/web/-/pipelines/1203",
  duration: 754,
  queuedDuration: 3.2,
  createdAt: "2026-10-27T09:00:00Z",
  finishedAt: "2026-10-27T09:13:00Z",
  source: "push",
  user: { username: "ada", name: "Ada Lovelace", avatarUrl: null },
  commit: { title: "Bump Vue to 3.5", shortId: "1f2e3d4c" },
  stages: {
    nodes: [{ name: "build", status: "success" }, { name: "test", status: "failed" }, {
      name: "deploy",
      status: "skipped",
    }],
  },
};

Deno.test("formatting", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assertEquals([ago("2026-10-27T09:00:00Z", now), ago("2026-10-26T09:00:00Z", now), ago("2026-10-22T09:00:00Z", now)], [
    "today",
    "yesterday",
    "5d",
  ]);
  assertEquals([duration(42), duration(754), duration(3720), duration(null)], ["42s", "12m 34s", "1h 2m", ""]);
  assertEquals([colorOf("#1f75cb"), colorOf("#dc143c"), colorOf("#108548"), colorOf("#808080")], [
    "blue",
    "red",
    "green",
    "gray",
  ]);
  assertEquals(avatar("/uploads/a.png", "Ada"), "https://gitlab.com/uploads/a.png");
  assertEquals(avatar(null, "Ada"), "Ada");
  assertEquals(gidNumber("gid://gitlab/Ci::Pipeline/1203"), 1203);
  assertEquals(
    branchName({ iid: 42, title: "Login page: blank screen on Firefox!" }),
    "42-login-page-blank-screen-on-firefox",
  );
});

Deno.test("pipeline statuses", () => {
  assertEquals(pipelineStatus("SUCCESS")?.color, "green");
  assertEquals(pipelineStatus("failed")?.icon, "bs-x");
  assertEquals(pipelineStatus("RUNNING")?.text, "Running");
  assertEquals(pipelineStatus("waiting_for_resource")?.text, "Pending");
  assertEquals(pipelineStatus("weird"), undefined);
});

Deno.test("merge request states, approvals and merge status", () => {
  assertEquals(mrIcon(mr), { source: "bs-pr-open", tint: "green" });
  assertEquals(mrIcon({ ...mr, draft: true }).source, "bs-pr-draft");
  assertEquals(mrIcon({ ...mr, state: "merged" }).source, "bs-pr-merged");
  assertEquals(approvals(mr), { text: "1 of 2 approvals", color: "orange" });
  assertEquals(approvals({ ...mr, approvalsLeft: 0 })?.text, "Approved");
  // Free tier: no rule, approvals still count.
  assertEquals(approvals({ ...mr, approvalsRequired: 0, approvalsLeft: null })?.text, "Approved");
  assertEquals(approvals({ ...mr, approvalsRequired: 0, approvedBy: { nodes: [] } }), undefined);
  assertEquals(mergeStatus(mr)?.text, "Waiting for approvals");
  assertEquals(mergeStatus({ ...mr, detailedMergeStatus: null, conflicts: true })?.color, "red");
});

Deno.test("merge request item and panel", () => {
  const item = mrItem(mr, ctx);
  assertEquals(item.subtitle, "!128");
  assertEquals(item.section, "acme/platform/api");
  assertEquals(item.accessories?.[0], { icon: { source: "bs-check", tint: "green" }, tooltip: "Pipeline passed" });
  assertEquals(item.accessories?.[1], { tag: "1 of 2 approvals", color: "orange" });
  assertEquals(item.accessories?.[2], { tag: "backend", color: "blue" });
  assertEquals(item.accessories?.[4], {
    avatar: "https://gitlab.com/uploads/-/system/user/avatar/1/avatar.png",
    tooltip: "Ada Lovelace",
  });
  assertEquals(item.detail?.markdown, "Avoids a round trip per pull.");
  assertEquals(item.detail?.stats?.map((s) => s.value), [4, "+86", "−12", 4]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 5), [
    "Open in Browser",
    "Show Details",
    "Open Changes",
    "Open Pipeline",
    "Approve",
  ]);
  assertEquals(mrMetadata(mr).map((m) => m.label).slice(0, 8), [
    "Status",
    "Author",
    "Branch",
    "Pipeline",
    "Approvals",
    "Approved by",
    "Reviewers",
    "Merge",
  ]);
});

Deno.test("issue item and panel", () => {
  const item = issueItem(issue, ctx);
  assertEquals(item.section, "acme/web");
  assertEquals(item.icon, { source: "bs-issue-open", tint: "green" });
  assertEquals(item.accessories?.slice(0, 2), [{ tag: "frontend", color: "green" }, {
    tag: "priority::1",
    color: "gray",
  }]);
  assertEquals(item.accessories?.[2].color, "red"); // overdue
  assertEquals(item.accessories?.[3].text, "1/4");
  assertEquals(item.actions?.map((a) => a.title).slice(0, 3), ["Open in Browser", "Show Details", "Close Issue"]);
  const closeAction = item.actions?.[2];
  assertEquals([closeAction?.destructive, closeAction?.confirm], [true, "Close acme/web#42?"]);
  const labels = issueMetadata(issue).map((m) => m.label);
  assertEquals(labels.slice(0, 7), ["Status", "Author", "Assignee", "Labels", "Milestone", "Due", "Weight"]);
});

Deno.test("project item", () => {
  const item = projectItem(project, ctx, { pipeline: "running" });
  assertEquals(item.subtitle, "acme");
  assertEquals(item.accessories?.[0].tooltip, "Last pipeline running");
  assertEquals(item.accessories?.[2], { icon: "bs-star", text: "1.2k", tooltip: "Stars" });
  assertEquals(item.actions?.[1].title, "Show Pipelines");
});

Deno.test("pipeline item: stages, duration, retry", () => {
  const item = pipelineItem(pipeline, project, ctx);
  assertEquals(item.title, "Bump Vue to 3.5");
  assertEquals(item.subtitle, "#912 · main");
  assertEquals(item.icon, { source: "bs-x", tint: "red" });
  assertEquals(item.accessories?.slice(0, 3).map((a) => a.tooltip), [
    "build: Passed",
    "test: Failed",
    "deploy: Skipped",
  ]);
  assertEquals(item.accessories?.[3], { icon: "bs-timer", text: "12m 34s", tooltip: "Duration" });
  assertEquals(item.detail?.stats?.map((s) => s.value), ["12m 34s", "3s", 3]);
  assertEquals(stagesMarkdown(pipeline), "- **build**: Passed\n- **test**: Failed\n- **deploy**: Skipped");
  const titles = item.actions?.map((a) => a.title);
  assertEquals(titles?.slice(0, 2), ["Open in Browser", "Retry Pipeline"]);
  assertEquals(titles?.includes("Cancel Pipeline"), false);
  const running = pipelineItem({ ...pipeline, status: "RUNNING" }, project, ctx);
  assertEquals(running.actions?.[1].title, "Cancel Pipeline");
});

Deno.test("a rejected token becomes a setup row with a link", async () => {
  const items = await guarded(() => Promise.reject(new AuthError("GitLab rejected the access token")));
  assertEquals(items.length, 1);
  assertEquals(items[0].id, "setup");
  assertEquals(items[0].actions?.[0].title, "Create Access Token");
  assertEquals(countStatus(items, "pipeline"), "Not connected");
  assertEquals(countStatus(setupItems(new AuthError("x")).map((i) => ({ ...i, id: "mr" })), "pipeline"), "1 pipeline");
});
