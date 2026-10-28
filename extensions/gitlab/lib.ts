// GitLab objects (merge requests, issues, projects, pipelines) as launcher items.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  type Stat,
  toast,
} from "@backslash/api";
import { countStatus, graphql, guarded, HOST, needToken, projectRef, rest } from "./api.ts";

// ---------------------------------------------------------------------------
// Formatting

/** "today", "yesterday", "3d", "25 Oct", "Mar 2024". */
export function ago(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 365) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

/** 75 → "1m 15s", 3720 → "1h 2m". */
export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** 1234 → "1.2k". */
export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** The palette color closest to a GitLab label color. */
export function colorOf(hex: string | null | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  const hue = (h * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return "red";
  if (hue < 40) return "orange";
  if (hue < 65) return "yellow";
  if (hue < 160) return "green";
  if (hue < 195) return "teal";
  if (hue < 250) return "blue";
  if (hue < 300) return "purple";
  return "pink";
}

/** GraphQL gives uploaded avatars as paths; gravatars are absolute. */
export function avatar(url: string | null | undefined, fallback: string): string {
  if (!url) return fallback;
  return url.startsWith("/") ? `${HOST}${url}` : url;
}

/** The numeric id at the end of a GraphQL global id (`gid://gitlab/Ci::Pipeline/42` → 42). */
export const gidNumber = (gid: string) => Number(gid.split("/").pop());

function excerpt(text: string | null | undefined, max = 400): string | undefined {
  const t = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// ---------------------------------------------------------------------------
// Pipelines

export interface PipelineLook {
  icon: string;
  color: Color;
  text: string;
}

/** A pipeline, job or stage status (REST lowercase or GraphQL uppercase). */
export function pipelineStatus(status: string | null | undefined): PipelineLook | undefined {
  switch ((status ?? "").toLowerCase()) {
    case "success":
      return { icon: Icons.check, color: "green", text: "Passed" };
    case "failed":
      return { icon: Icons.cross, color: "red", text: "Failed" };
    case "running":
      return { icon: Icons.inProgress, color: "blue", text: "Running" };
    case "pending":
    case "created":
    case "preparing":
    case "waiting_for_resource":
    case "waiting_for_callback":
      return { icon: Icons.clock, color: "yellow", text: "Pending" };
    case "scheduled":
      return { icon: Icons.calendar, color: "gray", text: "Scheduled" };
    case "manual":
      return { icon: Icons.play, color: "gray", text: "Manual" };
    case "canceled":
    case "canceling":
      return { icon: Icons.canceled, color: "gray", text: "Canceled" };
    case "skipped":
      return { icon: Icons.arrowRight, color: "gray", text: "Skipped" };
    default:
      return undefined;
  }
}

// ---------------------------------------------------------------------------
// Merge requests (GraphQL)

interface User {
  username: string;
  name: string;
  avatarUrl?: string | null;
}

export const MR_FIELDS = `
  id iid title webUrl draft state createdAt updatedAt sourceBranch targetBranch description
  conflicts detailedMergeStatus userNotesCount approved approvalsRequired approvalsLeft
  author { username name avatarUrl }
  project { fullPath name }
  headPipeline { iid status path }
  approvedBy { nodes { username name avatarUrl } }
  reviewers { nodes { username name avatarUrl } }
  labels { nodes { title color } }
  diffStatsSummary { additions deletions fileCount }
`;

export interface MergeRequest {
  id: string;
  iid: string;
  title: string;
  webUrl: string;
  draft: boolean;
  state: "opened" | "closed" | "merged" | "locked";
  createdAt: string;
  updatedAt: string;
  sourceBranch: string;
  targetBranch: string;
  description?: string | null;
  conflicts?: boolean;
  detailedMergeStatus?: string | null;
  userNotesCount?: number;
  approved?: boolean;
  approvalsRequired?: number | null;
  approvalsLeft?: number | null;
  author?: User | null;
  project: { fullPath: string; name: string };
  headPipeline?: { iid: string; status: string; path?: string | null } | null;
  approvedBy?: { nodes: User[] };
  reviewers?: { nodes: User[] };
  labels?: { nodes: { title: string; color: string }[] };
  diffStatsSummary?: { additions: number; deletions: number; fileCount: number } | null;
}

export function mrIcon(mr: Pick<MergeRequest, "state" | "draft">): { source: string; tint: Color } {
  if (mr.state === "merged") return { source: Icons.merged, tint: "blue" };
  if (mr.state === "closed") return { source: Icons.pullRequestClosed, tint: "red" };
  if (mr.draft) return { source: Icons.pullRequestDraft, tint: "gray" };
  return { source: Icons.pullRequest, tint: "green" };
}

/** "Approved", "1 of 2 approvals", or nothing when no approval is asked for and none given. */
export function approvals(mr: MergeRequest): { text: string; color: Color } | undefined {
  const given = mr.approvedBy?.nodes.length ?? 0;
  const required = mr.approvalsRequired ?? 0;
  if (required > 0) {
    const left = Math.max(0, mr.approvalsLeft ?? required - given);
    if (left === 0) return { text: "Approved", color: "green" };
    return { text: `${required - left} of ${required} approvals`, color: "orange" };
  }
  return given > 0 ? { text: given === 1 ? "Approved" : `Approved ×${given}`, color: "green" } : undefined;
}

const MERGE_STATUS: Record<string, { text: string; color: Color }> = {
  MERGEABLE: { text: "Ready to merge", color: "green" },
  CONFLICT: { text: "Merge conflicts", color: "red" },
  NEED_REBASE: { text: "Needs a rebase", color: "orange" },
  NOT_APPROVED: { text: "Waiting for approvals", color: "orange" },
  DISCUSSIONS_NOT_RESOLVED: { text: "Open discussions", color: "orange" },
  CI_MUST_PASS: { text: "Pipeline must pass", color: "orange" },
  CI_STILL_RUNNING: { text: "Pipeline running", color: "blue" },
  DRAFT_STATUS: { text: "Draft", color: "gray" },
  BLOCKED_STATUS: { text: "Blocked by another MR", color: "red" },
  NOT_OPEN: { text: "Not open", color: "gray" },
  CHECKING: { text: "Checking…", color: "gray" },
  UNCHECKED: { text: "Not checked yet", color: "gray" },
};

export const mergeStatus = (mr: MergeRequest) =>
  MERGE_STATUS[(mr.detailedMergeStatus ?? "").toUpperCase()] ??
    (mr.conflicts ? MERGE_STATUS.CONFLICT : undefined);

function mrStateText(mr: MergeRequest): string {
  if (mr.state === "merged") return "Merged";
  if (mr.state === "closed") return "Closed";
  return mr.draft ? "Draft" : "Open";
}

export function mrMetadata(mr: MergeRequest): Metadata[] {
  const icon = mrIcon(mr);
  const ci = pipelineStatus(mr.headPipeline?.status);
  const ok = approvals(mr);
  const status = mergeStatus(mr);
  const lines: Metadata[] = [
    meta.text("Status", mrStateText(mr), { icon: icon.source, color: icon.tint }),
    meta.person("Author", mr.author?.name ?? "Unknown", avatar(mr.author?.avatarUrl, mr.author?.name ?? "?")),
    meta.text("Branch", `${mr.sourceBranch} → ${mr.targetBranch}`, { icon: Icons.branch }),
  ];
  if (ci) lines.push(meta.text("Pipeline", ci.text, { icon: ci.icon, color: ci.color }));
  if (ok) lines.push(meta.text("Approvals", ok.text, { icon: Icons.check, color: ok.color }));
  const approvers = mr.approvedBy?.nodes ?? [];
  if (approvers.length) lines.push(meta.tags("Approved by", approvers.map((u) => ({ text: u.name, color: "green" }))));
  const reviewers = mr.reviewers?.nodes ?? [];
  if (reviewers.length) lines.push(meta.tags("Reviewers", reviewers.map((u) => u.name)));
  if (status && mr.state === "opened") lines.push(meta.text("Merge", status.text, { color: status.color }));
  const labels = mr.labels?.nodes ?? [];
  if (labels.length) lines.push(meta.tags("Labels", labels.map((l) => ({ text: l.title, color: colorOf(l.color) }))));
  lines.push(meta.separator());
  lines.push(meta.text("Project", mr.project.fullPath, { icon: Icons.repository }));
  lines.push(meta.text("Opened", ago(mr.createdAt)));
  lines.push(meta.text("Updated", ago(mr.updatedAt)));
  return lines;
}

function mrStats(mr: MergeRequest): Stat[] {
  const stats: Stat[] = [];
  const diff = mr.diffStatsSummary;
  if (diff) {
    stats.push(
      { label: "files", value: diff.fileCount },
      { label: "added", value: `+${diff.additions}`, color: "green" },
      { label: "removed", value: `−${diff.deletions}`, color: "red" },
    );
  }
  stats.push({ label: "comments", value: mr.userNotesCount ?? 0 });
  return stats;
}

export function mrActions(mr: MergeRequest, ctx: Context, page = false): Action[] {
  const token = needToken(ctx.preferences);
  const ref = `${mr.project.fullPath}!${mr.iid}`;
  return [
    open(mr.webUrl, "Open in Browser"),
    ...(page ? [] : [action("Show Details", () => mrPage(mr, ctx), { icon: Icons.info })]),
    open(`${mr.webUrl}/diffs`, "Open Changes", { icon: Icons.code, shortcut: "<Ctrl>f" }),
    ...(mr.headPipeline?.path
      ? [open(`${HOST}${mr.headPipeline.path}`, "Open Pipeline", { icon: Icons.activity, shortcut: "<Ctrl>p" })]
      : []),
    ...(mr.state === "opened"
      ? [action("Approve", async () => {
        await rest(token, `/projects/${projectRef(mr.project.fullPath)}/merge_requests/${mr.iid}/approve`, {
          method: "POST",
        });
        await toast(`Approved ${ref}`, { style: "success" });
        return refresh();
      }, { icon: Icons.check, shortcut: "<Ctrl><Shift>a", confirm: `Approve ${ref}?`, section: "Merge Request" })]
      : []),
    copy(mr.webUrl, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(ref, "Copy Reference", { icon: Icons.hash, shortcut: "<Ctrl>period", section: "Copy" }),
    copy(mr.sourceBranch, "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
    copy(
      `git fetch origin ${mr.sourceBranch} && git checkout ${mr.sourceBranch}`,
      "Copy Checkout Command",
      { icon: Icons.terminal, section: "Copy" },
    ),
    copy(`[${ref}: ${mr.title}](${mr.webUrl})`, "Copy as Markdown Link", { section: "Copy" }),
  ];
}

export function mrPage(mr: MergeRequest, ctx: Context): DetailSpec {
  return detail({
    title: `!${mr.iid}`,
    markdown: `# ${mr.title}\n\n${mr.description?.replace(/<!--[\s\S]*?-->/g, "").trim() || "_No description._"}`,
    stats: mrStats(mr),
    metadata: mrMetadata(mr),
    status: `${mr.project.fullPath} !${mr.iid}`,
    actions: mrActions(mr, ctx, true),
  });
}

export function mrItem(mr: MergeRequest, ctx: Context): Item {
  const ci = pipelineStatus(mr.headPipeline?.status);
  const ok = approvals(mr);
  const accessories: Accessory[] = [];
  if (ci) accessories.push({ icon: { source: ci.icon, tint: ci.color }, tooltip: `Pipeline ${ci.text.toLowerCase()}` });
  if (mr.conflicts && mr.state === "opened") accessories.push({ tag: "Conflicts", color: "red" });
  if (ok) accessories.push({ tag: ok.text, color: ok.color });
  const labels = mr.labels?.nodes ?? [];
  accessories.push(...labels.slice(0, 2).map((l) => ({ tag: l.title, color: colorOf(l.color) })));
  if (mr.author) {
    accessories.push({ avatar: avatar(mr.author.avatarUrl, mr.author.name), tooltip: mr.author.name });
  }
  accessories.push({ text: ago(mr.updatedAt), tooltip: "Updated" });
  return {
    id: mr.id,
    title: mr.title,
    subtitle: `!${mr.iid}`,
    icon: mrIcon(mr),
    section: mr.project.fullPath,
    keywords: [
      mr.project.fullPath,
      `!${mr.iid}`,
      mr.author?.username ?? "",
      mr.sourceBranch,
      ...labels.map((l) => l.title),
      mr.draft ? "draft" : "",
    ].filter(Boolean),
    accessories,
    detail: { stats: mrStats(mr), markdown: excerpt(mr.description), metadata: mrMetadata(mr) },
    actions: mrActions(mr, ctx),
  };
}

// ---------------------------------------------------------------------------
// Issues (REST, with_labels_details=true)

interface RestUser {
  id: number;
  username: string;
  name: string;
  avatar_url?: string | null;
}

export interface Issue {
  id: number;
  iid: number;
  project_id: number;
  title: string;
  description?: string | null;
  state: "opened" | "closed";
  created_at: string;
  updated_at: string;
  due_date?: string | null;
  web_url: string;
  labels: ({ name: string; color: string } | string)[];
  milestone?: { title: string; due_date?: string | null } | null;
  author: RestUser;
  assignees?: RestUser[];
  user_notes_count?: number;
  upvotes?: number;
  weight?: number | null;
  confidential?: boolean;
  issue_type?: string;
  references?: { short: string; full: string };
  task_completion_status?: { count: number; completed_count: number };
}

const labelOf = (l: Issue["labels"][number]) =>
  typeof l === "string" ? { text: l, color: "gray" as Color } : { text: l.name, color: colorOf(l.color) };

/** `group/project` from `group/project#12`. */
export const issueProject = (issue: Issue) => issue.references?.full.replace(/#\d+$/, "") ?? `#${issue.project_id}`;

export function isOverdue(due: string | null | undefined, now = new Date()): boolean {
  if (!due) return false;
  return new Date(`${due}T23:59:59`) < now;
}

/** GitLab's branch name for an issue: `12-fix-the-login-page`. */
export function branchName(issue: Pick<Issue, "iid" | "title">): string {
  const slug = issue.title.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${issue.iid}-${slug}`;
}

export function issueMetadata(issue: Issue): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Status", issue.state === "opened" ? "Open" : "Closed", {
      icon: issue.state === "opened" ? Icons.issue : Icons.issueClosed,
      color: issue.state === "opened" ? "green" : "blue",
    }),
    meta.person("Author", issue.author.name, avatar(issue.author.avatar_url, issue.author.name)),
  ];
  const assignees = issue.assignees ?? [];
  if (assignees.length === 1) {
    lines.push(meta.person("Assignee", assignees[0].name, avatar(assignees[0].avatar_url, assignees[0].name)));
  } else if (assignees.length) {
    lines.push(meta.tags("Assignees", assignees.map((a) => a.name)));
  } else {
    lines.push(meta.text("Assignee", "Unassigned", { icon: Icons.person }));
  }
  if (issue.labels.length) lines.push(meta.tags("Labels", issue.labels.map(labelOf)));
  if (issue.milestone) lines.push(meta.text("Milestone", issue.milestone.title, { icon: Icons.flag }));
  if (issue.due_date) {
    lines.push(meta.text("Due", issue.due_date, {
      icon: Icons.calendar,
      color: isOverdue(issue.due_date) && issue.state === "opened" ? "red" : undefined,
    }));
  }
  if (issue.weight != null) lines.push(meta.text("Weight", issue.weight));
  const tasks = issue.task_completion_status;
  if (tasks?.count) {
    lines.push(
      meta.progress("Tasks", tasks.completed_count / tasks.count, `${tasks.completed_count} of ${tasks.count}`),
    );
  }
  if (issue.confidential) lines.push(meta.text("Visibility", "Confidential", { icon: Icons.lock, color: "orange" }));
  lines.push(meta.separator());
  lines.push(meta.text("Project", issueProject(issue), { icon: Icons.repository }));
  lines.push(meta.text("Opened", ago(issue.created_at)));
  lines.push(meta.text("Updated", ago(issue.updated_at)));
  return lines;
}

export function issueActions(issue: Issue, ctx: Context, page = false): Action[] {
  const token = needToken(ctx.preferences);
  const ref = issue.references?.full ?? `#${issue.iid}`;
  return [
    open(issue.web_url, "Open in Browser"),
    ...(page ? [] : [action("Show Details", () => issuePage(issue, ctx), { icon: Icons.info })]),
    ...(issue.state === "opened"
      ? [action("Close Issue", async () => {
        await rest(token, `/projects/${issue.project_id}/issues/${issue.iid}`, {
          method: "PUT",
          body: { state_event: "close" },
        });
        await toast(`Closed ${ref}`, { style: "success" });
        return refresh();
      }, { icon: Icons.issueClosed, destructive: true, confirm: `Close ${ref}?`, section: "Issue" })]
      : []),
    copy(issue.web_url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(ref, "Copy Reference", { icon: Icons.hash, shortcut: "<Ctrl>period", section: "Copy" }),
    copy(branchName(issue), "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
    copy(`[${ref}: ${issue.title}](${issue.web_url})`, "Copy as Markdown Link", { section: "Copy" }),
  ];
}

export function issuePage(issue: Issue, ctx: Context): DetailSpec {
  return detail({
    title: issue.references?.short ?? `#${issue.iid}`,
    markdown: `# ${issue.title}\n\n${issue.description?.trim() || "_No description._"}`,
    metadata: issueMetadata(issue),
    status: `${issueProject(issue)} · updated ${ago(issue.updated_at)}`,
    actions: issueActions(issue, ctx, true),
  });
}

export function issueItem(issue: Issue, ctx: Context): Item {
  const tasks = issue.task_completion_status;
  const assignee = issue.assignees?.[0];
  const accessories: Accessory[] = issue.labels.slice(0, 2).map((l) => {
    const { text, color } = labelOf(l);
    return { tag: text, color };
  });
  if (issue.due_date) {
    accessories.push({
      icon: Icons.calendar,
      text: issue.due_date.slice(5),
      color: isOverdue(issue.due_date) ? "red" : undefined,
      tooltip: `Due ${issue.due_date}`,
    });
  }
  if (tasks?.count) accessories.push({ text: `${tasks.completed_count}/${tasks.count}`, tooltip: "Tasks done" });
  if (issue.user_notes_count) {
    accessories.push({ icon: Icons.comment, text: String(issue.user_notes_count), tooltip: "Comments" });
  }
  if (assignee) accessories.push({ avatar: avatar(assignee.avatar_url, assignee.name), tooltip: assignee.name });
  accessories.push({ text: ago(issue.updated_at), tooltip: "Updated" });
  return {
    id: String(issue.id),
    title: issue.title,
    subtitle: `#${issue.iid}`,
    icon: issue.state === "opened"
      ? { source: Icons.issue, tint: "green" }
      : { source: Icons.issueClosed, tint: "blue" },
    section: issueProject(issue),
    keywords: [
      issueProject(issue),
      `#${issue.iid}`,
      issue.milestone?.title ?? "",
      ...issue.labels.map((l) => labelOf(l).text),
    ].filter(Boolean),
    accessories,
    detail: { markdown: excerpt(issue.description), metadata: issueMetadata(issue) },
    actions: issueActions(issue, ctx),
  };
}

// ---------------------------------------------------------------------------
// Projects (REST)

export interface Project {
  id: number;
  name: string;
  name_with_namespace: string;
  path_with_namespace: string;
  description?: string | null;
  web_url: string;
  star_count: number;
  forks_count: number;
  open_issues_count?: number;
  last_activity_at: string;
  default_branch?: string | null;
  visibility?: "public" | "internal" | "private";
  topics?: string[];
  archived?: boolean;
  ssh_url_to_repo?: string;
  http_url_to_repo?: string;
  namespace?: { full_path: string; name: string };
}

export function projectMetadata(p: Project): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Path", p.path_with_namespace, { icon: Icons.repository }),
    meta.text("Visibility", (p.visibility ?? "private").replace(/^./, (c) => c.toUpperCase()), {
      icon: p.visibility === "public" ? Icons.globe : Icons.lock,
    }),
  ];
  if (p.default_branch) lines.push(meta.text("Default branch", p.default_branch, { icon: Icons.branch }));
  if (p.topics?.length) lines.push(meta.tags("Topics", p.topics.map((t) => ({ text: t, color: "blue" }))));
  if (p.archived) lines.push(meta.text("Archived", "Yes", { icon: Icons.archive, color: "orange" }));
  lines.push(meta.separator());
  lines.push(meta.text("Last activity", ago(p.last_activity_at)));
  return lines;
}

export function projectItem(p: Project, ctx: Context, options: { section?: string; pipeline?: string } = {}): Item {
  const ci = pipelineStatus(options.pipeline);
  const accessories: Accessory[] = [];
  if (ci) {
    accessories.push({ icon: { source: ci.icon, tint: ci.color }, tooltip: `Last pipeline ${ci.text.toLowerCase()}` });
  }
  if (p.visibility === "private") accessories.push({ icon: Icons.lock, tooltip: "Private" });
  if (p.star_count) accessories.push({ icon: Icons.star, text: compact(p.star_count), tooltip: "Stars" });
  accessories.push({ text: ago(p.last_activity_at), tooltip: "Last activity" });
  return {
    id: String(p.id),
    title: p.name,
    subtitle: p.namespace?.full_path ?? p.path_with_namespace.split("/").slice(0, -1).join("/"),
    icon: { source: Icons.repository, tint: p.archived ? "gray" : "orange" },
    section: options.section,
    keywords: [p.path_with_namespace, ...(p.topics ?? [])],
    accessories,
    detail: {
      stats: [
        { label: "stars", value: compact(p.star_count) },
        { label: "forks", value: compact(p.forks_count) },
        ...(p.open_issues_count != null ? [{ label: "open issues", value: p.open_issues_count }] : []),
      ],
      markdown: p.description?.trim() || undefined,
      metadata: projectMetadata(p),
    },
    actions: projectActions(p, ctx),
  };
}

export function projectActions(p: Project, ctx: Context): Action[] {
  return [
    open(p.web_url, "Open in Browser"),
    action("Show Pipelines", () => pipelinesView(p, ctx), { icon: Icons.activity, shortcut: "<Ctrl>p" }),
    open(`${p.web_url}/-/merge_requests`, "Open Merge Requests", { icon: Icons.pullRequest, shortcut: "<Ctrl>m" }),
    open(`${p.web_url}/-/issues`, "Open Issues", { icon: Icons.issue, shortcut: "<Ctrl>i" }),
    ...(p.ssh_url_to_repo
      ? [copy(p.ssh_url_to_repo, "Copy SSH Clone URL", { icon: Icons.terminal, section: "Copy" })]
      : []),
    ...(p.http_url_to_repo ? [copy(p.http_url_to_repo, "Copy HTTPS Clone URL", { section: "Copy" })] : []),
    copy(p.web_url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(p.path_with_namespace, "Copy Path", { section: "Copy" }),
  ];
}

// ---------------------------------------------------------------------------
// Pipelines of a project (GraphQL)

export interface Pipeline {
  id: string;
  iid: string;
  status: string;
  ref?: string | null;
  sha?: string | null;
  path?: string | null;
  duration?: number | null;
  queuedDuration?: number | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  source?: string | null;
  user?: User | null;
  commit?: { title?: string | null; shortId?: string | null } | null;
  stages?: { nodes: { name: string; status?: string | null }[] };
}

export const PIPELINES_QUERY = `query($path: ID!) { project(fullPath: $path) { pipelines(first: 30) { nodes {
  id iid status ref sha path duration queuedDuration createdAt startedAt finishedAt source
  user { username name avatarUrl }
  commit { title shortId }
  stages { nodes { name status } }
} } } }`;

const SOURCES: Record<string, string> = {
  push: "Push",
  web: "Run from the web",
  merge_request_event: "Merge request",
  schedule: "Schedule",
  api: "API",
  trigger: "Trigger",
  pipeline: "Parent pipeline",
  parent_pipeline: "Parent pipeline",
  external: "External",
  chat: "Chat",
};

export function pipelineMetadata(p: Pipeline): Metadata[] {
  const s = pipelineStatus(p.status);
  const lines: Metadata[] = [
    meta.text("Status", s?.text ?? p.status, { icon: s?.icon, color: s?.color }),
  ];
  if (p.ref) lines.push(meta.text("Ref", p.ref, { icon: Icons.branch }));
  if (p.commit?.shortId || p.sha) {
    lines.push(meta.text("Commit", p.commit?.shortId ?? p.sha!.slice(0, 8), { icon: Icons.commit }));
  }
  if (p.user) lines.push(meta.person("Triggered by", p.user.name, avatar(p.user.avatarUrl, p.user.name)));
  if (p.source) lines.push(meta.text("Source", SOURCES[p.source] ?? p.source));
  const stages = p.stages?.nodes ?? [];
  if (stages.length) {
    lines.push(meta.tags("Stages", stages.map((st) => ({ text: st.name, color: pipelineStatus(st.status)?.color }))));
  }
  lines.push(meta.separator());
  lines.push(meta.text("Created", ago(p.createdAt)));
  if (p.finishedAt) lines.push(meta.text("Finished", ago(p.finishedAt)));
  return lines;
}

/** Stage by stage, like GitLab's mini graph. */
export function stagesMarkdown(p: Pipeline): string | undefined {
  const stages = p.stages?.nodes ?? [];
  if (!stages.length) return undefined;
  return stages.map((st) => `- **${st.name}**: ${pipelineStatus(st.status)?.text ?? st.status ?? "?"}`).join("\n");
}

export function pipelineItem(p: Pipeline, project: Pick<Project, "path_with_namespace">, ctx: Context): Item {
  const token = needToken(ctx.preferences);
  const s = pipelineStatus(p.status);
  const url = p.path ? `${HOST}${p.path}` : `${HOST}/${project.path_with_namespace}/-/pipelines/${gidNumber(p.id)}`;
  const status = p.status.toLowerCase();
  const id = gidNumber(p.id);
  const base = `/projects/${projectRef(project.path_with_namespace)}/pipelines/${id}`;
  const stages = p.stages?.nodes ?? [];
  const accessories: Accessory[] = stages.slice(0, 6).map((st) => {
    const look = pipelineStatus(st.status);
    return {
      icon: { source: look?.icon ?? Icons.dot, tint: look?.color ?? "gray" },
      tooltip: `${st.name}: ${look?.text ?? st.status}`,
    };
  });
  if (p.duration) accessories.push({ icon: Icons.timer, text: duration(p.duration), tooltip: "Duration" });
  if (p.user) accessories.push({ avatar: avatar(p.user.avatarUrl, p.user.name), tooltip: p.user.name });
  accessories.push({ text: ago(p.createdAt), tooltip: "Created" });
  const actions: Action[] = [open(url, "Open in Browser")];
  if (["failed", "canceled"].includes(status)) {
    actions.push(action("Retry Pipeline", async () => {
      await rest(token, `${base}/retry`, { method: "POST" });
      await toast(`Pipeline #${p.iid} restarted`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.refresh,
      shortcut: "<Ctrl>r",
      confirm: `Retry the failed jobs of #${p.iid}?`,
      section: "Pipeline",
    }));
  }
  if (["running", "pending", "created", "preparing", "waiting_for_resource", "scheduled"].includes(status)) {
    actions.push(action("Cancel Pipeline", async () => {
      await rest(token, `${base}/cancel`, { method: "POST" });
      await toast(`Pipeline #${p.iid} canceled`, { style: "success" });
      return refresh();
    }, { icon: Icons.stop, destructive: true, confirm: `Cancel pipeline #${p.iid}?`, section: "Pipeline" }));
  }
  actions.push(
    copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ...(p.sha ? [copy(p.sha, "Copy Commit SHA", { icon: Icons.commit, section: "Copy" })] : []),
    ...(p.ref ? [copy(p.ref, "Copy Ref", { icon: Icons.branch, section: "Copy" })] : []),
  );
  return {
    id: p.id,
    title: p.commit?.title || `Pipeline #${p.iid}`,
    subtitle: `#${p.iid}${p.ref ? ` · ${p.ref}` : ""}`,
    icon: s ? { source: s.icon, tint: s.color } : Icons.dot,
    keywords: [p.ref ?? "", p.sha ?? "", p.user?.username ?? "", s?.text ?? p.status].filter(Boolean),
    accessories,
    detail: {
      stats: [
        { label: "duration", value: duration(p.duration) || "—" },
        { label: "queued", value: duration(p.queuedDuration) || "—" },
        { label: "stages", value: stages.length },
      ],
      markdown: stagesMarkdown(p),
      metadata: pipelineMetadata(p),
    },
    actions,
  };
}

/** The pipelines of one project, newest first. */
export function pipelinesView(project: Pick<Project, "path_with_namespace" | "name">, ctx: Context): ListSpec {
  return list({
    title: `${project.name} pipelines`,
    placeholder: `Filter pipelines of ${project.path_with_namespace} by ref, status, commit…`,
    empty: { title: "No pipelines yet", icon: Icons.activity },
    status: (items) => countStatus(items, "pipeline"),
    items: ({ preferences, signal }) =>
      guarded(async () => {
        const token = needToken(preferences);
        const data = await graphql<{ project: { pipelines: { nodes: Pipeline[] } } | null }>(
          token,
          PIPELINES_QUERY,
          { path: project.path_with_namespace },
          signal,
        );
        if (!data.project) throw new Error(`Project ${project.path_with_namespace} not found`);
        return data.project.pipelines.nodes.map((p) => pipelineItem(p, project, ctx));
      }),
  });
}
