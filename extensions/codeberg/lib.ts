// Forgejo objects and how they look in lists and panels. Tested in lib_test.ts.

import {
  type Action,
  action,
  type Color,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
} from "@backslash/api";

export interface User {
  login: string;
  full_name?: string;
  avatar_url?: string;
}

export interface Label {
  name: string;
  color: string;
}

/** An issue or pull request from `/repos/issues/search`. */
export interface Issue {
  id: number;
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
  body?: string | null;
  user: User;
  labels?: Label[];
  milestone?: { title: string } | null;
  assignees?: User[] | null;
  comments: number;
  created_at: string;
  updated_at: string;
  repository: { full_name: string; name: string; owner: string };
  pull_request?: { merged: boolean; draft?: boolean; html_url?: string } | null;
}

/** `/repos/{owner}/{repo}/pulls/{index}`: what the search doesn't say. */
export interface PullDetail {
  head: { ref: string; sha: string };
  base: { ref: string };
  mergeable?: boolean;
  merged?: boolean;
  draft?: boolean;
  additions?: number;
  deletions?: number;
  changed_files?: number;
  requested_reviewers?: User[] | null;
}

/** `/repos/{owner}/{repo}/commits/{sha}/status`. */
export interface CombinedStatus {
  state: "" | "pending" | "success" | "error" | "failure" | "warning";
  total_count: number;
}

export interface Repo {
  id: number;
  full_name: string;
  name: string;
  owner: User;
  description: string;
  html_url: string;
  clone_url: string;
  ssh_url: string;
  website?: string;
  stars_count: number;
  forks_count: number;
  watchers_count?: number;
  open_issues_count: number;
  open_pr_counter?: number;
  release_counter?: number;
  language?: string;
  default_branch: string;
  private: boolean;
  fork: boolean;
  archived: boolean;
  mirror?: boolean;
  size?: number;
  updated_at: string;
  topics?: string[] | null;
}

export interface Notification {
  id: number;
  unread: boolean;
  pinned: boolean;
  updated_at: string;
  repository: { full_name: string };
  subject: {
    title: string;
    type: "Issue" | "Pull" | "Commit" | "Repository";
    state?: "open" | "closed" | "merged";
    html_url?: string;
    latest_comment_html_url?: string;
  };
}

// --- Formatting -------------------------------------------------------------------

/** "today", "yesterday", "3d", "25 Oct". */
export function ago(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 365) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k`;
  return String(n);
}

/** The palette color closest to a label color (`e11d21` or `#e11d21`). */
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

function excerpt(text: string | null | undefined, max = 500): string | undefined {
  const t = (text ?? "").replace(/<!--[\s\S]*?-->/g, "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// --- Issues and pull requests -----------------------------------------------------

export interface Pull extends Issue {
  detail?: PullDetail;
  ci?: CombinedStatus;
}

export const isPull = (i: Issue) => !!i.pull_request;

export function stateIcon(i: Pull): { source: string; tint: Color } {
  if (isPull(i)) {
    if (i.pull_request?.merged || i.detail?.merged) return { source: Icons.merged, tint: "purple" };
    if (i.state === "closed") return { source: Icons.pullRequestClosed, tint: "red" };
    if (i.pull_request?.draft || i.detail?.draft || /^(WIP|Draft)\b:?/i.test(i.title)) {
      return { source: Icons.pullRequestDraft, tint: "gray" };
    }
    return { source: Icons.pullRequest, tint: "green" };
  }
  return i.state === "closed" ? { source: Icons.issueClosed, tint: "purple" } : { source: Icons.issue, tint: "green" };
}

function stateText(i: Pull): string {
  const s = stateIcon(i).source;
  if (s === Icons.merged) return "Merged";
  if (s === Icons.pullRequestDraft) return "Draft";
  return i.state === "closed" ? "Closed" : "Open";
}

/** CI of the head commit. */
export function checks(i: Pull): { icon: string; color: Color; text: string } | undefined {
  if (!i.ci || !i.ci.total_count) return undefined;
  switch (i.ci.state) {
    case "success":
      return { icon: Icons.check, color: "green", text: "Checks passed" };
    case "failure":
    case "error":
      return { icon: Icons.cross, color: "red", text: "Checks failed" };
    case "warning":
      return { icon: Icons.alert, color: "orange", text: "Checks passed with warnings" };
    case "pending":
      return { icon: Icons.dot, color: "yellow", text: "Checks running" };
    default:
      return undefined;
  }
}

export function issueMetadata(i: Pull): Metadata[] {
  const s = stateIcon(i);
  const ci = checks(i);
  const lines: Metadata[] = [
    meta.text("Status", stateText(i), { icon: s.source, color: s.tint }),
    meta.person("Author", i.user.full_name || i.user.login, i.user.avatar_url),
  ];
  if (i.detail) lines.push(meta.text("Branch", `${i.detail.head.ref} → ${i.detail.base.ref}`, { icon: Icons.branch }));
  if (ci) lines.push(meta.text("Checks", ci.text, { icon: ci.icon, color: ci.color }));
  if (i.detail?.mergeable === false && i.state === "open" && !i.detail.merged) {
    lines.push(meta.text("Merge", "Conflicts with the base branch", { icon: Icons.alert, color: "red" }));
  }
  const reviewers = (i.detail?.requested_reviewers ?? []).map((u) => u.login);
  if (reviewers.length) lines.push(meta.tags("Reviewers", reviewers));
  const assignees = (i.assignees ?? []).map((u) => u.login);
  if (assignees.length) lines.push(meta.tags("Assignees", assignees));
  if (i.labels?.length) {
    lines.push(meta.tags("Labels", i.labels.map((l) => ({ text: l.name, color: colorOf(l.color) }))));
  }
  if (i.milestone) lines.push(meta.text("Milestone", i.milestone.title, { icon: Icons.flag }));
  lines.push(meta.separator());
  lines.push(meta.text("Repository", i.repository.full_name, { icon: Icons.repository }));
  lines.push(meta.text("Comments", String(i.comments), { icon: Icons.comment }));
  lines.push(meta.text("Opened", ago(i.created_at)));
  lines.push(meta.text("Updated", ago(i.updated_at)));
  return lines;
}

const stats = (i: Pull) =>
  i.detail?.additions !== undefined
    ? [
      { label: "files", value: i.detail.changed_files ?? 0 },
      { label: "added", value: `+${i.detail.additions}`, color: "green" as Color },
      { label: "removed", value: `−${i.detail.deletions ?? 0}`, color: "red" as Color },
    ]
    : [];

export function issueActions(i: Pull, page = false): Action[] {
  const ref = `${i.repository.full_name}#${i.number}`;
  return [
    open(i.html_url, "Open in Browser"),
    ...(page ? [] : [action("Show Details", () => issuePage(i), { icon: Icons.info })]),
    ...(isPull(i)
      ? [open(`${i.html_url}/files`, "Open Files Changed", { icon: Icons.code, shortcut: "<Ctrl>f" })]
      : []),
    copy(i.html_url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(ref, "Copy Reference", { icon: Icons.hash, section: "Copy" }),
    copy(`[${ref}: ${i.title}](${i.html_url})`, "Copy as Markdown Link", { section: "Copy" }),
    ...(i.detail
      ? [
        copy(i.detail.head.ref, "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
        copy(
          `git fetch https://codeberg.org/${i.repository.full_name}.git pull/${i.number}/head:pr-${i.number} && git switch pr-${i.number}`,
          "Copy Checkout Command",
          { icon: Icons.terminal, section: "Copy" },
        ),
      ]
      : []),
  ];
}

export function issuePage(i: Pull): DetailSpec {
  return detail({
    title: `#${i.number}`,
    markdown: `# ${i.title}\n\n${i.body?.replace(/<!--[\s\S]*?-->/g, "").trim() || "_No description._"}`,
    stats: stats(i),
    metadata: issueMetadata(i),
    status: `${i.repository.full_name} #${i.number}`,
    actions: issueActions(i, true),
  });
}

export function issueItem(i: Pull, section?: string): Item {
  const ci = checks(i);
  const labels = (i.labels ?? []).slice(0, 2);
  return {
    id: String(i.id),
    title: i.title,
    subtitle: section ? `#${i.number}` : `${i.repository.name} #${i.number}`,
    icon: stateIcon(i),
    section,
    keywords: [
      i.repository.full_name,
      String(i.number),
      i.user.login,
      ...(i.labels ?? []).map((l) => l.name),
      i.detail?.head.ref ?? "",
    ],
    accessories: [
      ...(ci ? [{ icon: { source: ci.icon, tint: ci.color }, tooltip: ci.text }] : []),
      ...labels.map((l) => ({ tag: l.name, color: colorOf(l.color) })),
      ...(i.detail?.additions !== undefined
        ? [{
          text: `+${i.detail.additions} −${i.detail.deletions ?? 0}`,
          tooltip: `${i.detail.changed_files ?? 0} files`,
        }]
        : []),
      ...(i.comments ? [{ icon: Icons.comment, text: String(i.comments), tooltip: "Comments" }] : []),
      { avatar: i.user.avatar_url ?? i.user.login, tooltip: i.user.login },
      { text: ago(i.updated_at), tooltip: "Updated" },
    ],
    detail: { stats: stats(i), markdown: excerpt(i.body), metadata: issueMetadata(i) },
    actions: issueActions(i),
  };
}

/** Repositories first by most recent activity, as Codeberg orders them. */
export function groupByRepo(issues: Pull[]): Pull[] {
  const order = new Map<string, number>();
  issues.forEach((i, n) => order.has(i.repository.full_name) || order.set(i.repository.full_name, n));
  return [...issues].sort((a, b) => order.get(a.repository.full_name)! - order.get(b.repository.full_name)!);
}

// --- Repositories -----------------------------------------------------------------

const LANGUAGE_COLORS: Record<string, Color> = {
  Rust: "orange",
  Go: "teal",
  Python: "blue",
  TypeScript: "blue",
  JavaScript: "yellow",
  C: "gray",
  "C++": "pink",
  Java: "orange",
  Kotlin: "purple",
  Ruby: "red",
  PHP: "purple",
  Shell: "green",
  Lua: "blue",
  Zig: "orange",
  Nix: "blue",
  HTML: "red",
  CSS: "purple",
  Elixir: "purple",
  Haskell: "purple",
  Dart: "teal",
  Vue: "green",
};

export const languageColor = (l?: string): Color => LANGUAGE_COLORS[l ?? ""] ?? "gray";

export function repoIcon(r: Repo): { source: string; tint: Color } {
  if (r.archived) return { source: Icons.archive, tint: "gray" };
  if (r.private) return { source: Icons.lock, tint: "orange" };
  if (r.fork) return { source: Icons.branch, tint: languageColor(r.language) };
  return { source: Icons.repository, tint: languageColor(r.language) };
}

export function repoItem(r: Repo, section?: string): Item {
  const flags = [
    ...(r.private ? [{ text: "Private", color: "orange" as Color }] : []),
    ...(r.fork ? [{ text: "Fork", color: "blue" as Color }] : []),
    ...(r.mirror ? [{ text: "Mirror", color: "teal" as Color }] : []),
    ...(r.archived ? [{ text: "Archived", color: "gray" as Color }] : []),
  ];
  return {
    id: String(r.id),
    title: r.full_name,
    subtitle: r.description || undefined,
    icon: repoIcon(r),
    section,
    keywords: [r.language ?? "", ...(r.topics ?? [])],
    accessories: [
      ...(r.language ? [{ icon: { source: Icons.dot, tint: languageColor(r.language) }, text: r.language }] : []),
      ...(r.stars_count ? [{ icon: Icons.star, text: compact(r.stars_count), tooltip: "Stars" }] : []),
      { text: ago(r.updated_at), tooltip: "Updated" },
    ],
    detail: {
      stats: [
        { label: "stars", value: compact(r.stars_count) },
        { label: "forks", value: compact(r.forks_count) },
        { label: "issues", value: r.open_issues_count },
        ...(r.open_pr_counter !== undefined ? [{ label: "pull requests", value: r.open_pr_counter }] : []),
      ],
      markdown: r.description || undefined,
      metadata: [
        meta.person("Owner", r.owner.full_name || r.owner.login, r.owner.avatar_url),
        ...(r.language
          ? [meta.text("Language", r.language, { icon: Icons.dot, color: languageColor(r.language) })]
          : []),
        meta.text("Default branch", r.default_branch, { icon: Icons.branch }),
        ...(flags.length ? [meta.tags("Visibility", flags)] : []),
        ...(r.topics?.length ? [meta.tags("Topics", r.topics)] : []),
        ...(r.release_counter ? [meta.text("Releases", String(r.release_counter), { icon: Icons.tag })] : []),
        ...(r.website ? [meta.link("Website", r.website.replace(/^https?:\/\//, ""), r.website)] : []),
        meta.separator(),
        meta.text("Updated", ago(r.updated_at), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(r.html_url, "Open in Browser"),
      open(`${r.html_url}/issues`, "Open Issues", { icon: Icons.issue, shortcut: "<Ctrl>i" }),
      open(`${r.html_url}/pulls`, "Open Pull Requests", { icon: Icons.pullRequest, shortcut: "<Ctrl>p" }),
      ...(r.release_counter ? [open(`${r.html_url}/releases`, "Open Releases", { icon: Icons.tag })] : []),
      copy(`git clone ${r.ssh_url}`, "Copy git clone (SSH)", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(`git clone ${r.clone_url}`, "Copy git clone (HTTPS)", { icon: Icons.terminal, section: "Copy" }),
      copy(r.html_url, "Copy URL", { section: "Copy" }),
      copy(r.full_name, "Copy Name", { section: "Copy" }),
    ],
  };
}

// --- Notifications ----------------------------------------------------------------

export function notificationIcon(n: Notification): { source: string; tint: Color } {
  const { type, state } = n.subject;
  if (type === "Pull") {
    if (state === "merged") return { source: Icons.merged, tint: "purple" };
    if (state === "closed") return { source: Icons.pullRequestClosed, tint: "red" };
    return { source: Icons.pullRequest, tint: "green" };
  }
  if (type === "Issue") {
    return state === "closed" ? { source: Icons.issueClosed, tint: "purple" } : { source: Icons.issue, tint: "green" };
  }
  if (type === "Commit") return { source: Icons.commit, tint: "gray" };
  return { source: Icons.repository, tint: "gray" };
}

/** The web page of a notification: the latest comment, else the subject. */
export function notificationUrl(n: Notification): string {
  return n.subject.latest_comment_html_url || n.subject.html_url || `https://codeberg.org/${n.repository.full_name}`;
}

const TYPE_NAMES: Record<string, string> = {
  Pull: "Pull request",
  Issue: "Issue",
  Commit: "Commit",
  Repository: "Repository",
};

export function notificationMeta(n: Notification): Metadata[] {
  const icon = notificationIcon(n);
  return [
    meta.text("Type", TYPE_NAMES[n.subject.type] ?? n.subject.type, { icon: icon.source, color: icon.tint }),
    ...(n.subject.state ? [meta.text("State", n.subject.state[0].toUpperCase() + n.subject.state.slice(1))] : []),
    meta.text("Repository", n.repository.full_name, { icon: Icons.repository }),
    meta.text("Updated", ago(n.updated_at), { icon: Icons.clock }),
    ...(n.pinned ? [meta.text("Pinned", "Yes", { icon: Icons.pin })] : []),
    meta.text("Status", n.unread ? "Unread" : "Read", {
      icon: n.unread ? Icons.dot : Icons.check,
      color: n.unread ? "blue" : "gray",
    }),
  ];
}

/** `#12` from a subject URL, if any. */
export function subjectNumber(n: Notification): string | undefined {
  return /\/(?:issues|pulls)\/(\d+)/.exec(n.subject.html_url ?? "")?.[1];
}
