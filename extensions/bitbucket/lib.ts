// Bitbucket objects and how they look in lists and panels. Tested in lib_test.ts.

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

export interface Account {
  uuid?: string;
  account_id?: string;
  display_name: string;
  nickname?: string;
  links?: { avatar?: { href: string } };
}

export interface Participant {
  user: Account;
  role: "REVIEWER" | "PARTICIPANT";
  approved: boolean;
  state?: "approved" | "changes_requested" | null;
}

/** `GET /repositories/{workspace}/{repo}/pullrequests[/{id}]`. */
export interface PullRequest {
  id: number;
  title: string;
  description?: string;
  state: "OPEN" | "MERGED" | "DECLINED" | "SUPERSEDED";
  draft?: boolean;
  author: Account;
  source: { branch: { name: string }; repository?: { full_name: string }; commit?: { hash: string } };
  destination: { branch: { name: string }; repository: { full_name: string } };
  comment_count?: number;
  task_count?: number;
  created_on: string;
  updated_on: string;
  links: { html: { href: string } };
  reviewers?: Account[];
  /** Only in the single pull request. */
  participants?: Participant[];
}

/** `GET …/pullrequests/{id}/statuses`. */
export interface BuildStatus {
  key: string;
  name?: string;
  state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED";
  url?: string;
  updated_on?: string;
}

export interface Repo {
  uuid: string;
  full_name: string;
  name: string;
  slug?: string;
  description?: string;
  is_private: boolean;
  language?: string;
  updated_on: string;
  size?: number;
  has_issues?: boolean;
  mainbranch?: { name: string } | null;
  links: { html: { href: string }; clone?: { name: string; href: string }[]; avatar?: { href: string } };
  workspace?: { slug: string; name?: string };
  project?: { key: string; name: string } | null;
  parent?: { full_name: string } | null;
}

export interface Issue {
  id: number;
  title: string;
  state: string;
  kind: "bug" | "enhancement" | "proposal" | "task";
  priority: "trivial" | "minor" | "major" | "critical" | "blocker";
  assignee?: Account | null;
  reporter?: Account | null;
  content?: { raw?: string };
  votes?: number;
  created_on: string;
  updated_on: string;
  links: { html: { href: string } };
  repository: { full_name: string };
}

// --- Formatting -------------------------------------------------------------------

/** `Basic …` for `user:secret`, UTF-8 safe. */
export function basicAuth(user: string, secret: string): string {
  const bytes = new TextEncoder().encode(`${user}:${secret}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** "today", "yesterday", "3d", "25 Oct", "Mar 2024". */
export function ago(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  if (days < 365) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

export const avatar = (a?: Account | null) => a?.links?.avatar?.href;

/** `x = "a"` for Bitbucket's `q` filter, quotes escaped. */
export const q = (field: string, value: string) => `${field}="${value.replace(/["\\]/g, "\\$&")}"`;

function excerpt(text: string | null | undefined, max = 500): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// --- Pull requests ----------------------------------------------------------------

export interface Pull extends PullRequest {
  statuses?: BuildStatus[];
}

export function prIcon(pr: PullRequest): { source: string; tint: Color } {
  if (pr.state === "MERGED") return { source: Icons.merged, tint: "purple" };
  if (pr.state === "DECLINED" || pr.state === "SUPERSEDED") return { source: Icons.pullRequestClosed, tint: "red" };
  if (pr.draft) return { source: Icons.pullRequestDraft, tint: "gray" };
  return { source: Icons.pullRequest, tint: "green" };
}

/** All builds of the source commit, as one: failed beats running beats passed. */
export function builds(statuses: BuildStatus[] | undefined): { icon: string; color: Color; text: string } | undefined {
  if (!statuses?.length) return undefined;
  const count = (s: BuildStatus["state"]) => statuses.filter((b) => b.state === s).length;
  const n = statuses.length;
  if (count("FAILED")) return { icon: Icons.cross, color: "red", text: `${count("FAILED")} of ${n} builds failed` };
  if (count("INPROGRESS")) return { icon: Icons.dot, color: "yellow", text: `${count("INPROGRESS")} of ${n} running` };
  if (count("STOPPED") === n) return { icon: Icons.stop, color: "gray", text: "Builds stopped" };
  return { icon: Icons.check, color: "green", text: n === 1 ? "Build passed" : `${n} builds passed` };
}

/** Approvals and change requests of the reviewers (and participants who approved). */
export function reviews(pr: PullRequest) {
  const people = pr.participants ?? [];
  const approved = people.filter((p) => p.approved || p.state === "approved");
  const changes = people.filter((p) => p.state === "changes_requested");
  const reviewers = people.filter((p) => p.role === "REVIEWER");
  const total = Math.max(reviewers.length, pr.reviewers?.length ?? 0);
  const reviewersApproved = reviewers.filter((p) => p.approved || p.state === "approved").length;
  return { approved, changes, total, reviewersApproved };
}

const stateText = (pr: PullRequest) =>
  pr.state === "OPEN" ? (pr.draft ? "Draft" : "Open") : pr.state[0] + pr.state.slice(1).toLowerCase();

export function prMetadata(pr: Pull): Metadata[] {
  const s = prIcon(pr);
  const b = builds(pr.statuses);
  const r = reviews(pr);
  const lines: Metadata[] = [
    meta.text("Status", stateText(pr), { icon: s.source, color: s.tint }),
    meta.person("Author", pr.author.display_name, avatar(pr.author)),
    meta.text("Branch", `${pr.source.branch.name} → ${pr.destination.branch.name}`, { icon: Icons.branch }),
  ];
  if (b) lines.push(meta.text("Builds", b.text, { icon: b.icon, color: b.color }));
  for (const st of pr.statuses ?? []) {
    const one = builds([st])!;
    lines.push(meta.text(`  ${st.name || st.key}`, st.state[0] + st.state.slice(1).toLowerCase(), {
      icon: one.icon,
      color: one.color,
    }));
  }
  if (pr.participants) {
    lines.push(meta.text("Approvals", String(r.approved.length), {
      icon: Icons.check,
      color: r.approved.length ? "green" : undefined,
    }));
    if (r.total) {
      lines.push(
        meta.progress("Reviewers", r.reviewersApproved / r.total, `${r.reviewersApproved} of ${r.total} approved`),
      );
    }
    if (r.approved.length) lines.push(meta.tags("Approved by", r.approved.map((p) => p.user.display_name)));
    if (r.changes.length) {
      lines.push(meta.tags("Changes requested", r.changes.map((p) => ({ text: p.user.display_name, color: "red" }))));
    }
  }
  const waiting = (pr.reviewers ?? []).filter((rv) => !r.approved.some((p) => p.user.uuid === rv.uuid));
  if (waiting.length) lines.push(meta.tags("Waiting on", waiting.map((w) => w.display_name)));
  lines.push(meta.separator());
  lines.push(meta.text("Repository", pr.destination.repository.full_name, { icon: Icons.repository }));
  if (pr.comment_count) lines.push(meta.text("Comments", pr.comment_count, { icon: Icons.comment }));
  if (pr.task_count) lines.push(meta.text("Open tasks", pr.task_count, { icon: Icons.squareCheck }));
  lines.push(meta.text("Opened", ago(pr.created_on)));
  lines.push(meta.text("Updated", ago(pr.updated_on)));
  return lines;
}

export function prActions(pr: Pull, page = false): Action[] {
  const url = pr.links.html.href;
  const repo = pr.destination.repository.full_name;
  return [
    open(url, "Open in Browser"),
    ...(page ? [] : [action("Show Details", () => prPage(pr), { icon: Icons.info })]),
    open(`${url}/diff`, "Open Diff", { icon: Icons.code, shortcut: "<Ctrl>f" }),
    open(`https://bitbucket.org/${repo}/pull-requests/`, "Open Repository Pull Requests", {
      icon: Icons.repository,
    }),
    copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(pr.source.branch.name, "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
    copy(
      `git fetch origin ${pr.source.branch.name} && git switch ${pr.source.branch.name}`,
      "Copy Checkout Command",
      { icon: Icons.terminal, section: "Copy" },
    ),
    copy(`[${repo}#${pr.id}: ${pr.title}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
  ];
}

export function prPage(pr: Pull): DetailSpec {
  return detail({
    title: `#${pr.id}`,
    markdown: `# ${pr.title}\n\n${pr.description?.trim() || "_No description._"}`,
    metadata: prMetadata(pr),
    status: `${pr.destination.repository.full_name} #${pr.id}`,
    actions: prActions(pr, true),
  });
}

export function prItem(pr: Pull, section?: string): Item {
  const b = builds(pr.statuses);
  const r = reviews(pr);
  const repo = pr.destination.repository.full_name;
  return {
    id: `${repo}#${pr.id}`,
    title: pr.title,
    subtitle: section === repo ? `#${pr.id}` : `${repo.split("/")[1]} #${pr.id}`,
    icon: prIcon(pr),
    section,
    keywords: [repo, String(pr.id), pr.author.display_name, pr.source.branch.name],
    accessories: [
      ...(b ? [{ icon: { source: b.icon, tint: b.color }, tooltip: b.text }] : []),
      ...(r.changes.length ? [{ tag: "Changes requested", color: "red" as Color }] : []),
      ...(pr.participants && r.approved.length
        ? [{
          icon: { source: Icons.check, tint: "green" as Color },
          text: String(r.approved.length),
          tooltip: `Approved by ${r.approved.map((p) => p.user.display_name).join(", ")}`,
        }]
        : []),
      ...(pr.comment_count ? [{ icon: Icons.comment, text: String(pr.comment_count), tooltip: "Comments" }] : []),
      { avatar: avatar(pr.author) ?? pr.author.display_name, tooltip: pr.author.display_name },
      { text: ago(pr.updated_on), tooltip: "Updated" },
    ],
    detail: { markdown: excerpt(pr.description), metadata: prMetadata(pr) },
    actions: prActions(pr),
  };
}

/** Most recently updated first, without the same pull request twice. */
export function uniquePulls(prs: PullRequest[]): PullRequest[] {
  const seen = new Map<string, PullRequest>();
  for (const pr of prs) seen.set(`${pr.destination.repository.full_name}#${pr.id}`, pr);
  return [...seen.values()].sort((a, b) => b.updated_on.localeCompare(a.updated_on));
}

// --- Repositories -----------------------------------------------------------------

const LANGUAGES: Record<string, Color> = {
  java: "orange",
  javascript: "yellow",
  typescript: "blue",
  python: "blue",
  go: "teal",
  rust: "orange",
  php: "purple",
  ruby: "red",
  kotlin: "purple",
  "c#": "green",
  "c++": "pink",
  c: "gray",
  swift: "orange",
  scala: "red",
  shell: "green",
  html: "red",
};

export const languageColor = (l?: string): Color => LANGUAGES[(l ?? "").toLowerCase()] ?? "gray";

const title = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

export function size(bytes?: number): string | undefined {
  if (!bytes) return undefined;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function repoItem(r: Repo, section?: string): Item {
  const clone = (name: string) => r.links.clone?.find((c) => c.name === name)?.href;
  const ssh = clone("ssh") ?? `git@bitbucket.org:${r.full_name}.git`;
  const https = (clone("https") ?? `https://bitbucket.org/${r.full_name}.git`).replace(
    /^https:\/\/[^@/]+@/,
    "https://",
  );
  const url = r.links.html.href;
  return {
    id: r.uuid,
    title: r.full_name,
    subtitle: r.description || undefined,
    icon: { source: r.is_private ? Icons.lock : Icons.repository, tint: languageColor(r.language) },
    section,
    keywords: [r.language ?? "", r.project?.name ?? "", r.project?.key ?? ""],
    accessories: [
      ...(r.project ? [{ tag: r.project.key, tooltip: r.project.name }] : []),
      ...(r.language
        ? [{ icon: { source: Icons.dot, tint: languageColor(r.language) }, text: title(r.language) }]
        : []),
      { text: ago(r.updated_on), tooltip: "Updated" },
    ],
    detail: {
      markdown: r.description || undefined,
      metadata: [
        meta.text("Workspace", r.workspace?.name ?? r.full_name.split("/")[0], { icon: Icons.apps }),
        ...(r.project ? [meta.text("Project", `${r.project.name} (${r.project.key})`, { icon: Icons.project })] : []),
        ...(r.language
          ? [meta.text("Language", title(r.language), { icon: Icons.dot, color: languageColor(r.language) })]
          : []),
        ...(r.mainbranch ? [meta.text("Main branch", r.mainbranch.name, { icon: Icons.branch })] : []),
        meta.text("Visibility", r.is_private ? "Private" : "Public", {
          icon: r.is_private ? Icons.lock : Icons.globe,
          color: r.is_private ? "orange" : "blue",
        }),
        ...(r.parent ? [meta.text("Fork of", r.parent.full_name, { icon: Icons.branch })] : []),
        ...(size(r.size) ? [meta.text("Size", size(r.size)!)] : []),
        meta.separator(),
        meta.text("Updated", ago(r.updated_on), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      open(`${url}/pull-requests/`, "Open Pull Requests", { icon: Icons.pullRequest, shortcut: "<Ctrl>p" }),
      open(`${url}/pipelines`, "Open Pipelines", { icon: Icons.activity }),
      open(`${url}/branches/`, "Open Branches", { icon: Icons.branch }),
      ...(r.has_issues ? [open(`${url}/issues`, "Open Issues", { icon: Icons.issue, shortcut: "<Ctrl>i" })] : []),
      copy(`git clone ${ssh}`, "Copy git clone (SSH)", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(`git clone ${https}`, "Copy git clone (HTTPS)", { icon: Icons.terminal, section: "Copy" }),
      copy(url, "Copy URL", { section: "Copy" }),
      copy(r.full_name, "Copy Name", { section: "Copy" }),
    ],
  };
}

// --- Issues -----------------------------------------------------------------------

const PRIORITIES: Record<Issue["priority"], { icon: string; color: Color }> = {
  blocker: { icon: Icons.urgent, color: "red" },
  critical: { icon: Icons.high, color: "orange" },
  major: { icon: Icons.medium, color: "yellow" },
  minor: { icon: Icons.low, color: "blue" },
  trivial: { icon: Icons.noPriority, color: "gray" },
};

const KINDS: Record<Issue["kind"], { icon: string; color: Color }> = {
  bug: { icon: Icons.bug, color: "red" },
  enhancement: { icon: Icons.sparkle, color: "blue" },
  proposal: { icon: Icons.lightbulb, color: "yellow" },
  task: { icon: Icons.squareCheck, color: "green" },
};

export const OPEN_STATES = ["new", "open", "on hold"];

export function issueIcon(i: Issue): { source: string; tint: Color } {
  if (!OPEN_STATES.includes(i.state)) return { source: Icons.issueClosed, tint: "purple" };
  const k = KINDS[i.kind] ?? KINDS.task;
  return { source: k.icon, tint: k.color };
}

export function issueItem(i: Issue): Item {
  const p = PRIORITIES[i.priority] ?? PRIORITIES.trivial;
  const url = i.links.html.href;
  const repo = i.repository.full_name;
  const metadata: Metadata[] = [
    meta.text("Status", title(i.state), { icon: issueIcon(i).source, color: issueIcon(i).tint }),
    meta.text("Kind", title(i.kind), { icon: (KINDS[i.kind] ?? KINDS.task).icon, color: KINDS[i.kind]?.color }),
    meta.text("Priority", title(i.priority), { icon: p.icon, color: p.color }),
    ...(i.assignee ? [meta.person("Assignee", i.assignee.display_name, avatar(i.assignee))] : []),
    ...(i.reporter ? [meta.person("Reporter", i.reporter.display_name, avatar(i.reporter))] : []),
    ...(i.votes ? [meta.text("Votes", i.votes, { icon: Icons.arrowUp })] : []),
    meta.separator(),
    meta.text("Repository", repo, { icon: Icons.repository }),
    meta.text("Opened", ago(i.created_on)),
    meta.text("Updated", ago(i.updated_on)),
  ];
  return {
    id: `${repo}#${i.id}`,
    title: i.title,
    subtitle: `#${i.id}`,
    icon: issueIcon(i),
    section: repo,
    keywords: [repo, String(i.id), i.kind, i.priority, i.state],
    accessories: [
      { icon: { source: p.icon, tint: p.color }, tooltip: `${title(i.priority)} priority` },
      ...(i.state !== "new" && i.state !== "open" ? [{ tag: title(i.state) }] : []),
      ...(i.reporter
        ? [{ avatar: avatar(i.reporter) ?? i.reporter.display_name, tooltip: i.reporter.display_name }]
        : []),
      { text: ago(i.updated_on), tooltip: "Updated" },
    ],
    detail: { markdown: excerpt(i.content?.raw), metadata },
    actions: [
      open(url, "Open in Browser"),
      action("Show Details", () =>
        detail({
          title: `#${i.id}`,
          markdown: `# ${i.title}\n\n${i.content?.raw?.trim() || "_No description._"}`,
          metadata,
          status: `${repo} #${i.id}`,
          actions: [open(url, "Open in Browser"), copy(url, "Copy URL")],
        }), { icon: Icons.info }),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`[${repo}#${i.id}: ${i.title}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}
