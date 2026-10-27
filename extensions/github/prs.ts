// Pull requests: GraphQL fields, and how they look in the list and the panel.

import {
  type Action,
  action,
  type Color,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
} from "@backslash/api";
import { ago, colorOf } from "./api.ts";

export const PR_FIELDS = `
  ... on PullRequest {
    id number title url body isDraft state createdAt updatedAt
    additions deletions changedFiles
    headRefName baseRefName mergeable reviewDecision
    author { login avatarUrl }
    repository { nameWithOwner }
    labels(first: 6) { nodes { name color } }
    commits(last: 1) { totalCount nodes { commit { statusCheckRollup { state } } } }
    reviewRequests(first: 6) { nodes { requestedReviewer { ... on User { login avatarUrl } ... on Team { name } } } }
    comments { totalCount }
  }
`;

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  url: string;
  body?: string | null;
  isDraft: boolean;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  updatedAt: string;
  additions: number;
  deletions: number;
  changedFiles: number;
  headRefName: string;
  baseRefName: string;
  mergeable?: "MERGEABLE" | "CONFLICTING" | "UNKNOWN";
  reviewDecision?: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  author?: { login: string; avatarUrl?: string } | null;
  repository: { nameWithOwner: string };
  labels?: { nodes: { name: string; color: string }[] };
  commits?: { totalCount: number; nodes: { commit: { statusCheckRollup?: { state: string } | null } }[] };
  reviewRequests?: { nodes: { requestedReviewer?: { login?: string; avatarUrl?: string; name?: string } | null }[] };
  comments?: { totalCount: number };
}

export function stateIcon(pr: PullRequest): { source: string; tint: Color } {
  if (pr.state === "MERGED") return { source: Icons.merged, tint: "purple" };
  if (pr.state === "CLOSED") return { source: Icons.pullRequestClosed, tint: "red" };
  if (pr.isDraft) return { source: Icons.pullRequestDraft, tint: "gray" };
  return { source: Icons.pullRequest, tint: "green" };
}

/** CI of the last commit: icon, color, words. */
export function checks(pr: PullRequest): { icon: string; color: Color; text: string } | undefined {
  const state = pr.commits?.nodes[0]?.commit.statusCheckRollup?.state;
  switch (state) {
    case "SUCCESS":
      return { icon: Icons.check, color: "green", text: "Checks passed" };
    case "FAILURE":
    case "ERROR":
      return { icon: Icons.cross, color: "red", text: "Checks failed" };
    case "PENDING":
    case "EXPECTED":
      return { icon: Icons.dot, color: "yellow", text: "Checks running" };
    default:
      return undefined;
  }
}

export function review(pr: PullRequest): { text: string; color: Color } | undefined {
  switch (pr.reviewDecision) {
    case "APPROVED":
      return { text: "Approved", color: "green" };
    case "CHANGES_REQUESTED":
      return { text: "Changes requested", color: "red" };
    case "REVIEW_REQUIRED":
      return { text: "Review required", color: "orange" };
    default:
      return undefined;
  }
}

function stateText(pr: PullRequest): string {
  if (pr.state === "MERGED") return "Merged";
  if (pr.state === "CLOSED") return "Closed";
  return pr.isDraft ? "Draft" : "Open";
}

export function prMetadata(pr: PullRequest): Metadata[] {
  const s = stateIcon(pr);
  const ci = checks(pr);
  const r = review(pr);
  const lines: Metadata[] = [
    meta.text("Status", stateText(pr), { icon: s.source, color: s.tint }),
    meta.person("Author", pr.author?.login ?? "ghost", pr.author?.avatarUrl),
    meta.text("Branch", `${pr.headRefName} → ${pr.baseRefName}`, { icon: Icons.branch }),
  ];
  if (ci) lines.push(meta.text("Checks", ci.text, { icon: ci.icon, color: ci.color }));
  if (r) lines.push(meta.text("Review", r.text, { color: r.color }));
  if (pr.mergeable === "CONFLICTING") {
    lines.push(meta.text("Merge", "Conflicts with the base branch", { icon: Icons.alert, color: "red" }));
  }
  const reviewers = (pr.reviewRequests?.nodes ?? [])
    .map((n) => n.requestedReviewer?.login ?? n.requestedReviewer?.name)
    .filter((n): n is string => !!n);
  if (reviewers.length) lines.push(meta.tags("Reviewers", reviewers));
  const labels = pr.labels?.nodes ?? [];
  if (labels.length) lines.push(meta.tags("Labels", labels.map((l) => ({ text: l.name, color: colorOf(l.color) }))));
  lines.push(meta.separator());
  lines.push(meta.text("Repository", pr.repository.nameWithOwner, { icon: Icons.repository }));
  lines.push(meta.text("Opened", ago(pr.createdAt)));
  lines.push(meta.text("Updated", ago(pr.updatedAt)));
  return lines;
}

const stats = (pr: PullRequest) => [
  { label: "files", value: pr.changedFiles },
  { label: "added", value: `+${pr.additions}`, color: "green" as Color },
  { label: "removed", value: `−${pr.deletions}`, color: "red" as Color },
];

function excerpt(text: string | null | undefined, max = 400): string | undefined {
  const t = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

export function prActions(pr: PullRequest, ctx: Context, page = false): Action[] {
  return [
    open(pr.url, "Open in Browser"),
    ...(page ? [] : [action("Show Details", () => prPage(pr, ctx), { icon: Icons.info })]),
    open(`${pr.url}/files`, "Open Changed Files", { icon: Icons.code, shortcut: "<Ctrl>f" }),
    copy(pr.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`gh pr checkout ${pr.number} -R ${pr.repository.nameWithOwner}`, "Copy Checkout Command", {
      icon: Icons.terminal,
      section: "Copy",
    }),
    copy(pr.headRefName, "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
    copy(`[${pr.repository.nameWithOwner}#${pr.number}: ${pr.title}](${pr.url})`, "Copy as Markdown Link", {
      section: "Copy",
    }),
  ];
}

export function prPage(pr: PullRequest, ctx: Context): DetailSpec {
  return detail({
    title: `#${pr.number}`,
    markdown: `# ${pr.title}\n\n${pr.body?.replace(/<!--[\s\S]*?-->/g, "").trim() || "_No description._"}`,
    stats: stats(pr),
    metadata: prMetadata(pr),
    status: `${pr.repository.nameWithOwner} #${pr.number}`,
    actions: prActions(pr, ctx, true),
  });
}

export function prItem(pr: PullRequest, ctx: Context, section?: string): Item {
  const ci = checks(pr);
  const r = review(pr);
  return {
    id: pr.id,
    title: pr.title,
    subtitle: section ? `#${pr.number}` : `${pr.repository.nameWithOwner.split("/")[1]} #${pr.number}`,
    icon: stateIcon(pr),
    section,
    keywords: [pr.repository.nameWithOwner, String(pr.number), pr.author?.login ?? "", pr.headRefName],
    accessories: [
      ...(ci ? [{ icon: { source: ci.icon, tint: ci.color }, tooltip: ci.text }] : []),
      // "Review required" is the usual case: only decisions stand out.
      ...(r && pr.reviewDecision !== "REVIEW_REQUIRED" ? [{ tag: r.text, color: r.color }] : []),
      { text: `+${pr.additions} −${pr.deletions}`, tooltip: `${pr.changedFiles} files` },
      ...(pr.author ? [{ avatar: pr.author.avatarUrl ?? pr.author.login, tooltip: pr.author.login }] : []),
      { text: ago(pr.updatedAt), tooltip: "Updated" },
    ],
    detail: { stats: stats(pr), markdown: excerpt(pr.body), metadata: prMetadata(pr) },
    actions: prActions(pr, ctx),
  };
}
