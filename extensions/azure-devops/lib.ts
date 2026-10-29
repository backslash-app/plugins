// Azure DevOps objects (REST API 7.1) and how they look in lists and panels. Tested in lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export const API_VERSION = "7.1";

// --- Organization and auth ----------------------------------------------------------

/** `https://dev.azure.com/acme/Project`, `acme.visualstudio.com` or `acme` → `acme`. */
export function normalizeOrg(input: unknown): string {
  const text = String(input ?? "").trim();
  const dev = /dev\.azure\.com\/([^/?#\s]+)/i.exec(text);
  if (dev) return decodeURIComponent(dev[1]);
  const vs = /^(?:https?:\/\/)?([a-z0-9-]+)\.visualstudio\.com/i.exec(text);
  if (vs) return vs[1];
  return text.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
}

/** A PAT goes in Basic auth with an empty user name. */
export function patAuth(token: string): string {
  const bytes = new TextEncoder().encode(`:${token}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

/** "Web, Mobile App" → ["Web", "Mobile App"]. */
export function parseList(text: unknown): string[] {
  return String(text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

/** Adds `api-version` unless the path has one. */
export function withVersion(path: string, version = API_VERSION): string {
  if (/[?&]api-version=/.test(path)) return path;
  return `${path}${path.includes("?") ? "&" : "?"}api-version=${version}`;
}

// --- Formatting ---------------------------------------------------------------------

/** "now", "5m", "3h", "2d", "25 Oct", "Mar 2024". */
export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  if (s < 365 * 86_400) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

export function formatDuration(ms: number | undefined): string {
  if (ms === undefined || ms < 0 || Number.isNaN(ms)) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** `refs/heads/feature/x` → `feature/x`; `refs/pull/12/merge` → `PR 12`. */
export function refName(ref: string | undefined): string {
  if (!ref) return "";
  const pull = /^refs\/pull\/(\d+)\//.exec(ref);
  if (pull) return `PR ${pull[1]}`;
  return ref.replace(/^refs\/(heads|tags)\//, "");
}

/** Very small HTML to text, for work item descriptions and PR bodies written in HTML. */
export function htmlToText(html: string | undefined, max = 800): string {
  const text = (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// --- Pull requests ------------------------------------------------------------------

export interface Identity {
  id: string;
  displayName: string;
  uniqueName?: string;
  imageUrl?: string;
}

export interface Reviewer extends Identity {
  /** 10 approved, 5 approved with suggestions, 0 none, -5 waiting for author, -10 rejected. */
  vote: number;
  isRequired?: boolean;
  isContainer?: boolean;
  hasDeclined?: boolean;
}

/** `GET {project}/_apis/git/pullrequests`. */
export interface PullRequest {
  pullRequestId: number;
  title: string;
  description?: string;
  status: "active" | "abandoned" | "completed" | "notSet";
  isDraft?: boolean;
  mergeStatus?: "succeeded" | "conflicts" | "failure" | "queued" | "rejectedByPolicy" | "notSet";
  createdBy: Identity;
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  reviewers?: Reviewer[];
  labels?: { name: string; active?: boolean }[];
  repository: { id: string; name: string; project: { id: string; name: string } };
}

/** `GET {project}/_apis/policy/evaluations`. */
export interface PolicyEvaluation {
  evaluationId: string;
  status: "approved" | "rejected" | "running" | "queued" | "notApplicable" | "broken";
  configuration: {
    isBlocking?: boolean;
    isEnabled?: boolean;
    type: { id?: string; displayName: string };
    settings?: { displayName?: string | null; buildDefinitionId?: number };
  };
  context?: { buildId?: number; isExpired?: boolean; buildOutputPreview?: unknown };
}

export interface Pull extends PullRequest {
  policies?: PolicyEvaluation[];
}

export const VOTES: Record<string, { label: string; icon: string; color: Color }> = {
  "10": { label: "Approved", icon: Icons.check, color: "green" },
  "5": { label: "Approved with suggestions", icon: Icons.check, color: "teal" },
  "0": { label: "No vote", icon: Icons.dot, color: "gray" },
  "-5": { label: "Waiting for author", icon: Icons.clock, color: "orange" },
  "-10": { label: "Rejected", icon: Icons.cross, color: "red" },
};

export const vote = (v: number) => VOTES[String(v)] ?? VOTES["0"];

export const prUrl = (org: string, pr: PullRequest) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(pr.repository.project.name)}/_git/${
    encodeURIComponent(pr.repository.name)
  }/pullrequest/${pr.pullRequestId}`;

/** The artifact id policies are evaluated against. */
export const prArtifactId = (pr: PullRequest) =>
  `vstfs:///CodeReview/CodeReviewId/${pr.repository.project.id}/${pr.pullRequestId}`;

export function votes(pr: PullRequest) {
  const people = (pr.reviewers ?? []).filter((r) => !r.isContainer || r.vote !== 0);
  const approved = people.filter((r) => r.vote >= 5);
  const rejected = people.filter((r) => r.vote === -10);
  const waiting = people.filter((r) => r.vote === -5);
  const required = (pr.reviewers ?? []).filter((r) => r.isRequired);
  const requiredPending = required.filter((r) => r.vote < 5);
  return { people, approved, rejected, waiting, required, requiredPending };
}

/** Enabled policies, as one: rejected beats running beats approved. */
export function policySummary(
  evals: PolicyEvaluation[] | undefined,
): { icon: string; color: Color; text: string; failed: PolicyEvaluation[] } | undefined {
  const list = (evals ?? []).filter((e) => e.configuration.isEnabled !== false && e.status !== "notApplicable");
  if (!list.length) return undefined;
  const failed = list.filter((e) => e.status === "rejected" || e.status === "broken");
  const running = list.filter((e) => e.status === "running" || e.status === "queued");
  const n = list.length;
  if (failed.length) {
    return {
      icon: Icons.cross,
      color: "red",
      text: `${failed.length} of ${plural(n, "policy", "policies")} failing`,
      failed,
    };
  }
  if (running.length) {
    return { icon: Icons.inProgress, color: "yellow", text: `${running.length} of ${n} running`, failed };
  }
  return { icon: Icons.check, color: "green", text: n === 1 ? "Policy passed" : `${n} policies passed`, failed };
}

export const policyName = (e: PolicyEvaluation) =>
  e.configuration.settings?.displayName || e.configuration.type.displayName;

const POLICY_STATUS: Record<PolicyEvaluation["status"], { label: string; icon: string; color: Color }> = {
  approved: { label: "Passed", icon: Icons.check, color: "green" },
  rejected: { label: "Failed", icon: Icons.cross, color: "red" },
  broken: { label: "Broken", icon: Icons.alert, color: "red" },
  running: { label: "Running", icon: Icons.inProgress, color: "yellow" },
  queued: { label: "Queued", icon: Icons.todo, color: "gray" },
  notApplicable: { label: "Not applicable", icon: Icons.minus, color: "gray" },
};

export function prIcon(pr: PullRequest): { source: string; tint: Color } {
  if (pr.status === "completed") return { source: Icons.merged, tint: "purple" };
  if (pr.status === "abandoned") return { source: Icons.pullRequestClosed, tint: "red" };
  if (pr.isDraft) return { source: Icons.pullRequestDraft, tint: "gray" };
  return { source: Icons.pullRequest, tint: "green" };
}

export function prMetadata(org: string, pr: Pull): Metadata[] {
  const s = prIcon(pr);
  const v = votes(pr);
  const p = policySummary(pr.policies);
  const lines: Metadata[] = [
    meta.text("Status", pr.isDraft ? "Draft" : pr.status === "active" ? "Active" : pr.status, {
      icon: s.source,
      color: s.tint,
    }),
    meta.person("Author", pr.createdBy.displayName),
    meta.text("Branch", `${refName(pr.sourceRefName)} → ${refName(pr.targetRefName)}`, { icon: Icons.branch }),
  ];
  if (pr.mergeStatus === "conflicts") lines.push(meta.text("Merge", "Conflicts", { icon: Icons.alert, color: "red" }));
  if (p) lines.push(meta.text("Policies", p.text, { icon: p.icon, color: p.color }));
  for (const e of pr.policies ?? []) {
    if (e.status === "notApplicable" || e.configuration.isEnabled === false) continue;
    const st = POLICY_STATUS[e.status] ?? POLICY_STATUS.queued;
    const blocking = e.configuration.isBlocking === false ? " (optional)" : "";
    lines.push(meta.text(`  ${policyName(e)}`, `${st.label}${blocking}`, { icon: st.icon, color: st.color }));
  }
  if (v.people.length) {
    lines.push(meta.separator());
    if (v.required.length) {
      const ok = v.required.length - v.requiredPending.length;
      lines.push(meta.progress("Required", ok / v.required.length, `${ok} of ${v.required.length} approved`));
    }
    for (const r of v.people) {
      const x = vote(r.vote);
      lines.push(meta.text(r.displayName + (r.isRequired ? " (required)" : ""), x.label, {
        icon: x.icon,
        color: x.color,
      }));
    }
  }
  lines.push(meta.separator());
  lines.push(
    meta.text("Repository", `${pr.repository.project.name}/${pr.repository.name}`, { icon: Icons.repository }),
  );
  const labels = (pr.labels ?? []).filter((l) => l.active !== false).map((l) => l.name);
  if (labels.length) lines.push(meta.tags("Tags", labels));
  lines.push(meta.text("Created", ago(pr.creationDate), { icon: Icons.clock }));
  lines.push(meta.link("Link", `#${pr.pullRequestId}`, prUrl(org, pr)));
  return lines;
}

/** One row; `extra` are the actions that call the API (vote), after Open. */
export function prItem(org: string, pr: Pull, meId: string | undefined, extra: Action[] = []): Item {
  const v = votes(pr);
  const p = policySummary(pr.policies);
  const mine = meId ? pr.reviewers?.find((r) => r.id === meId) : undefined;
  const url = prUrl(org, pr);
  const repo = `${pr.repository.project.name}/${pr.repository.name}`;
  const source = refName(pr.sourceRefName);
  return {
    id: `${pr.repository.id}#${pr.pullRequestId}`,
    title: pr.title,
    subtitle: `${pr.repository.name} !${pr.pullRequestId}`,
    icon: prIcon(pr),
    section: pr.repository.project.name,
    keywords: [repo, String(pr.pullRequestId), pr.createdBy.displayName, source, refName(pr.targetRefName)],
    accessories: [
      ...(pr.mergeStatus === "conflicts" ? [{ tag: "Conflicts", color: "red" as Color }] : []),
      ...(p ? [{ icon: { source: p.icon, tint: p.color }, tooltip: p.text }] : []),
      ...(v.rejected.length ? [{ tag: "Rejected", color: "red" as Color }] : []),
      ...(v.waiting.length ? [{ tag: "Waiting for author", color: "orange" as Color }] : []),
      ...(v.approved.length
        ? [{
          icon: { source: Icons.check, tint: "green" as Color },
          text: `${v.approved.length}/${v.people.length}`,
          tooltip: `Approved by ${v.approved.map((r) => r.displayName).join(", ")}`,
        }]
        : []),
      ...(mine && mine.vote !== 0 ? [{ tag: `You: ${vote(mine.vote).label}`, color: vote(mine.vote).color }] : []),
      { avatar: pr.createdBy.displayName, tooltip: pr.createdBy.displayName },
      { text: ago(pr.creationDate), tooltip: "Created" },
    ],
    detail: {
      markdown: pr.description?.trim() ? pr.description.trim().slice(0, 800) : undefined,
      metadata: prMetadata(org, pr),
    },
    actions: [
      open(url, "Open in Browser"),
      ...extra,
      open(`${url}?_a=files`, "Open Files", { icon: Icons.code, shortcut: "<Ctrl>f" }),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(source, "Copy Branch Name", { icon: Icons.branch, shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`git fetch origin ${source} && git switch ${source}`, "Copy Checkout Command", {
        icon: Icons.terminal,
        section: "Copy",
      }),
      copy(`[${pr.repository.name}!${pr.pullRequestId}: ${pr.title}](${url})`, "Copy as Markdown Link", {
        section: "Copy",
      }),
    ],
  };
}

/** Newest first, the same pull request once. */
export function uniquePulls(prs: PullRequest[]): PullRequest[] {
  const seen = new Map<string, PullRequest>();
  for (const pr of prs) seen.set(`${pr.repository.id}#${pr.pullRequestId}`, pr);
  return [...seen.values()].sort((a, b) => b.creationDate.localeCompare(a.creationDate));
}

// --- Work items ---------------------------------------------------------------------

export interface WorkItem {
  id: number;
  rev?: number;
  fields: {
    "System.Title": string;
    "System.State": string;
    "System.WorkItemType": string;
    "System.TeamProject": string;
    "System.ChangedDate"?: string;
    "System.CreatedDate"?: string;
    "System.AssignedTo"?: Identity;
    "System.CreatedBy"?: Identity;
    "System.Tags"?: string;
    "System.IterationPath"?: string;
    "System.AreaPath"?: string;
    "System.Description"?: string;
    "System.Reason"?: string;
    "Microsoft.VSTS.Common.Priority"?: number;
    "Microsoft.VSTS.Scheduling.RemainingWork"?: number;
    "Microsoft.VSTS.Scheduling.StoryPoints"?: number;
    "Microsoft.VSTS.Scheduling.Effort"?: number;
  };
}

export const WORK_ITEM_FIELDS = [
  "System.Id",
  "System.Title",
  "System.State",
  "System.WorkItemType",
  "System.TeamProject",
  "System.ChangedDate",
  "System.CreatedDate",
  "System.AssignedTo",
  "System.CreatedBy",
  "System.Tags",
  "System.IterationPath",
  "System.AreaPath",
  "System.Description",
  "System.Reason",
  "Microsoft.VSTS.Common.Priority",
  "Microsoft.VSTS.Scheduling.RemainingWork",
  "Microsoft.VSTS.Scheduling.StoryPoints",
  "Microsoft.VSTS.Scheduling.Effort",
];

/** States that mean "finished" in the Agile, Scrum, Basic and CMMI processes. */
export const CLOSED_STATES = ["Closed", "Done", "Removed", "Completed", "Cut"];

const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** The WIQL query of your open work items, most recently changed first. */
export function myWorkItemsQuery(projects: string[] = []): string {
  const where = [
    "[System.AssignedTo] = @Me",
    `[System.State] NOT IN (${CLOSED_STATES.map(quote).join(", ")})`,
    ...(projects.length ? [`[System.TeamProject] IN (${projects.map(quote).join(", ")})`] : []),
  ];
  return `SELECT [System.Id] FROM WorkItems WHERE ${where.join(" AND ")} ORDER BY [System.ChangedDate] DESC`;
}

/** Work item state category, from `…/workitemtypes/{type}/states`, or guessed from its name. */
export type StateCategory = "Proposed" | "InProgress" | "Resolved" | "Completed" | "Removed";

export function guessCategory(state: string): StateCategory {
  const s = state.toLowerCase();
  if (/^(closed|done|completed)$/.test(s)) return "Completed";
  if (/^(removed|cut)$/.test(s)) return "Removed";
  if (/^(resolved|in review|testing|ready for test)$/.test(s)) return "Resolved";
  if (/^(new|to do|proposed|approved|open|design)$/.test(s)) return "Proposed";
  return "InProgress";
}

export const CATEGORY_ICONS: Record<StateCategory, { source: string; tint: Color }> = {
  Proposed: { source: Icons.todo, tint: "gray" },
  InProgress: { source: Icons.inProgress, tint: "blue" },
  Resolved: { source: Icons.inReview, tint: "teal" },
  Completed: { source: Icons.done, tint: "green" },
  Removed: { source: Icons.canceled, tint: "gray" },
};

const TYPES: Record<string, { icon: string; color: Color }> = {
  bug: { icon: Icons.bug, color: "red" },
  task: { icon: Icons.squareCheck, color: "yellow" },
  "user story": { icon: Icons.book, color: "blue" },
  "product backlog item": { icon: Icons.note, color: "blue" },
  requirement: { icon: Icons.note, color: "blue" },
  feature: { icon: Icons.sparkle, color: "purple" },
  epic: { icon: Icons.layers, color: "orange" },
  issue: { icon: Icons.issue, color: "pink" },
  impediment: { icon: Icons.alert, color: "pink" },
  "test case": { icon: Icons.check, color: "teal" },
};

export const typeStyle = (type: string) => TYPES[type.toLowerCase()] ?? { icon: Icons.ticket, color: "gray" as Color };

export const PRIORITIES: Record<number, { label: string; icon: string; color: Color }> = {
  1: { label: "1 (Critical)", icon: Icons.urgent, color: "red" },
  2: { label: "2 (High)", icon: Icons.high, color: "orange" },
  3: { label: "3 (Medium)", icon: Icons.medium, color: "yellow" },
  4: { label: "4 (Low)", icon: Icons.low, color: "blue" },
};

export const priority = (p: number | undefined) =>
  p ? PRIORITIES[p] ?? { label: String(p), icon: Icons.noPriority, color: "gray" as Color } : undefined;

export const workItemUrl = (org: string, w: WorkItem) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${
    encodeURIComponent(w.fields["System.TeamProject"])
  }/_workitems/edit/${w.id}`;

export const splitTags = (tags: string | undefined) => (tags ?? "").split(";").map((t) => t.trim()).filter(Boolean);

/** Last segment of `Project\Sprint 12` → `Sprint 12`. */
export const leaf = (path: string | undefined) => (path ?? "").split("\\").pop() ?? "";

export function workItemItem(
  org: string,
  w: WorkItem,
  category: StateCategory = guessCategory(w.fields["System.State"]),
  extra: Action[] = [],
): Item {
  const f = w.fields;
  const t = typeStyle(f["System.WorkItemType"]);
  const p = priority(f["Microsoft.VSTS.Common.Priority"]);
  const st = CATEGORY_ICONS[category];
  const url = workItemUrl(org, w);
  const tags = splitTags(f["System.Tags"]);
  const iteration = leaf(f["System.IterationPath"]);
  const points = f["Microsoft.VSTS.Scheduling.StoryPoints"] ?? f["Microsoft.VSTS.Scheduling.Effort"];
  const remaining = f["Microsoft.VSTS.Scheduling.RemainingWork"];
  const metadata: Metadata[] = [
    meta.text("State", f["System.State"], { icon: st.source, color: st.tint }),
    meta.text("Type", f["System.WorkItemType"], { icon: t.icon, color: t.color }),
    ...(p ? [meta.text("Priority", p.label, { icon: p.icon, color: p.color })] : []),
    ...(f["System.Reason"] ? [meta.text("Reason", f["System.Reason"])] : []),
    ...(f["System.AssignedTo"] ? [meta.person("Assigned to", f["System.AssignedTo"].displayName)] : []),
    ...(f["System.CreatedBy"] ? [meta.person("Created by", f["System.CreatedBy"].displayName)] : []),
    ...(points !== undefined ? [meta.text("Points", points, { icon: Icons.hash })] : []),
    ...(remaining !== undefined ? [meta.text("Remaining", `${remaining} h`, { icon: Icons.hourglass })] : []),
    ...(tags.length ? [meta.tags("Tags", tags)] : []),
    meta.separator(),
    meta.text("Project", f["System.TeamProject"], { icon: Icons.project }),
    ...(f["System.AreaPath"] ? [meta.text("Area", f["System.AreaPath"])] : []),
    ...(f["System.IterationPath"] ? [meta.text("Iteration", f["System.IterationPath"], { icon: Icons.cycle })] : []),
    ...(f["System.CreatedDate"] ? [meta.text("Created", ago(f["System.CreatedDate"]))] : []),
    ...(f["System.ChangedDate"] ? [meta.text("Changed", ago(f["System.ChangedDate"]), { icon: Icons.clock })] : []),
  ];
  return {
    id: String(w.id),
    title: f["System.Title"],
    subtitle: `${f["System.WorkItemType"]} ${w.id}`,
    icon: { source: t.icon, tint: t.color },
    section: f["System.TeamProject"],
    keywords: [String(w.id), f["System.WorkItemType"], f["System.State"], iteration, ...tags],
    accessories: [
      ...(p ? [{ icon: { source: p.icon, tint: p.color }, tooltip: `Priority ${p.label}` }] : []),
      ...(iteration && iteration !== f["System.TeamProject"] ? [{ icon: Icons.cycle, text: iteration }] : []),
      { tag: f["System.State"], color: st.tint },
      ...(f["System.ChangedDate"] ? [{ text: ago(f["System.ChangedDate"]), tooltip: "Changed" }] : []),
    ],
    detail: { markdown: htmlToText(f["System.Description"]) || undefined, metadata },
    actions: [
      open(url, "Open in Browser"),
      ...extra,
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(String(w.id), "Copy ID", { icon: Icons.hash, shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`AB#${w.id}`, "Copy Commit Mention (AB#)", { icon: Icons.commit, section: "Copy" }),
      copy(`[${f["System.WorkItemType"]} ${w.id}: ${f["System.Title"]}](${url})`, "Copy as Markdown Link", {
        section: "Copy",
      }),
    ],
  };
}

/** In progress first, then resolved, then to do; by priority, then most recently changed. */
export function sortWorkItems(items: WorkItem[], categoryOf: (w: WorkItem) => StateCategory): WorkItem[] {
  const order: StateCategory[] = ["InProgress", "Resolved", "Proposed", "Completed", "Removed"];
  return [...items].sort((a, b) =>
    order.indexOf(categoryOf(a)) - order.indexOf(categoryOf(b)) ||
    (a.fields["Microsoft.VSTS.Common.Priority"] ?? 9) - (b.fields["Microsoft.VSTS.Common.Priority"] ?? 9) ||
    (b.fields["System.ChangedDate"] ?? "").localeCompare(a.fields["System.ChangedDate"] ?? "")
  );
}

/** The JSON Patch document setting the state. */
export const statePatch = (state: string) => [{ op: "add", path: "/fields/System.State", value: state }];

// --- Pipelines ----------------------------------------------------------------------

/** `GET {project}/_apis/build/builds`. */
export interface Build {
  id: number;
  buildNumber: string;
  status: "inProgress" | "completed" | "cancelling" | "postponed" | "notStarted" | "none";
  result?: "succeeded" | "partiallySucceeded" | "failed" | "canceled" | "none";
  definition: { id: number; name: string; path?: string };
  project: { id: string; name: string };
  sourceBranch?: string;
  sourceVersion?: string;
  reason?: string;
  requestedFor?: Identity;
  queueTime?: string;
  startTime?: string;
  finishTime?: string;
  repository?: { name?: string; type?: string };
  triggerInfo?: Record<string, string>;
  _links?: { web?: { href: string } };
}

export type RunStatus = "failed" | "partial" | "running" | "queued" | "succeeded" | "canceled";

export function runStatus(b: Build): RunStatus {
  if (b.status === "inProgress" || b.status === "cancelling") return "running";
  if (b.status === "notStarted" || b.status === "postponed") return "queued";
  switch (b.result) {
    case "failed":
      return "failed";
    case "partiallySucceeded":
      return "partial";
    case "canceled":
      return "canceled";
    case "succeeded":
      return "succeeded";
    default:
      return "queued";
  }
}

export const RUN_STYLES: Record<RunStatus, { label: string; icon: string; color: Color }> = {
  failed: { label: "Failed", icon: Icons.canceled, color: "red" },
  partial: { label: "Partially succeeded", icon: Icons.alert, color: "orange" },
  running: { label: "Running", icon: Icons.inProgress, color: "yellow" },
  queued: { label: "Queued", icon: Icons.todo, color: "gray" },
  succeeded: { label: "Succeeded", icon: Icons.done, color: "green" },
  canceled: { label: "Canceled", icon: Icons.canceled, color: "gray" },
};

const REASONS: Record<string, string> = {
  individualCI: "CI",
  batchedCI: "CI (batched)",
  pullRequest: "Pull request",
  manual: "Manual",
  schedule: "Scheduled",
  resourceTrigger: "Resource",
  buildCompletion: "Build completion",
};

export const reasonLabel = (r?: string) => r ? REASONS[r] ?? r : "";

export function buildDuration(b: Build, now = Date.now()): number | undefined {
  if (!b.startTime) return undefined;
  const end = b.finishTime ? new Date(b.finishTime).getTime() : now;
  return end - new Date(b.startTime).getTime();
}

export const buildUrl = (org: string, b: Build) =>
  b._links?.web?.href ??
    `https://dev.azure.com/${encodeURIComponent(org)}/${
      encodeURIComponent(b.project.name)
    }/_build/results?buildId=${b.id}`;

const runKey = (b: Build) => `${b.project.id}:${b.definition.id}:${b.sourceBranch ?? ""}`;

/** Failed runs that are still the latest finished run of their pipeline and branch. */
export function currentFailures(builds: Build[]): Set<Build> {
  const latest = new Map<string, Build>();
  for (const b of builds) {
    if (b.status !== "completed") continue;
    const k = runKey(b), seen = latest.get(k);
    if (!seen || (b.finishTime ?? "") > (seen.finishTime ?? "")) latest.set(k, b);
  }
  return new Set([...latest.values()].filter((b) => ["failed", "partial"].includes(runStatus(b))));
}

export type RunGroup = "Failing" | "Running" | "Recent";

export function runGroup(b: Build, failing: Set<Build>): RunGroup {
  if (failing.has(b)) return "Failing";
  const s = runStatus(b);
  return s === "running" || s === "queued" ? "Running" : "Recent";
}

/** Failing, then running and queued, then the rest, newest first in each. */
export function sortBuilds(builds: Build[], failing = currentFailures(builds)): Build[] {
  const order: RunGroup[] = ["Failing", "Running", "Recent"];
  return [...builds].sort((a, b) =>
    order.indexOf(runGroup(a, failing)) - order.indexOf(runGroup(b, failing)) ||
    (b.queueTime ?? "").localeCompare(a.queueTime ?? "")
  );
}

export function buildItem(org: string, b: Build, failing: Set<Build>, extra: Action[] = []): Item {
  const s = runStatus(b);
  const style = RUN_STYLES[s];
  const took = buildDuration(b);
  const branch = refName(b.sourceBranch);
  const message = b.triggerInfo?.["ci.message"] ?? b.triggerInfo?.["pr.title"];
  const stale = (s === "failed" || s === "partial") && !failing.has(b);
  const url = buildUrl(org, b);
  return {
    id: `${b.project.id}:${b.id}`,
    title: b.definition.name,
    subtitle: message ?? b.buildNumber,
    icon: { source: style.icon, tint: style.color },
    section: runGroup(b, failing),
    keywords: [b.project.name, b.buildNumber, branch, b.requestedFor?.displayName ?? "", reasonLabel(b.reason)],
    accessories: [
      ...(branch ? [{ icon: Icons.branch, text: branch, tooltip: "Branch" }] : []),
      ...(took !== undefined && s !== "queued"
        ? [{ icon: Icons.timer, text: formatDuration(took), tooltip: "Duration" }]
        : []),
      { text: ago(b.queueTime), tooltip: "Queued" },
      ...(b.requestedFor ? [{ avatar: b.requestedFor.displayName, tooltip: b.requestedFor.displayName }] : []),
      { tag: stale ? `${style.label} (fixed since)` : style.label, color: stale ? "gray" as Color : style.color },
    ],
    detail: {
      stats: [
        { label: "Status", value: style.label, color: style.color },
        { label: "Duration", value: formatDuration(took) },
        { label: "Run", value: b.buildNumber },
      ],
      markdown: message ? `**${message}**` : undefined,
      metadata: [
        meta.text("Pipeline", b.definition.name, { icon: Icons.cycle }),
        meta.text("Project", b.project.name, { icon: Icons.project }),
        ...(b.repository?.name ? [meta.text("Repository", b.repository.name, { icon: Icons.repository })] : []),
        ...(branch ? [meta.text("Branch", branch, { icon: Icons.branch })] : []),
        ...(b.sourceVersion ? [meta.text("Commit", b.sourceVersion.slice(0, 8), { icon: Icons.commit })] : []),
        ...(b.reason ? [meta.text("Trigger", reasonLabel(b.reason), { icon: Icons.bolt })] : []),
        ...(b.requestedFor ? [meta.person("Requested for", b.requestedFor.displayName)] : []),
        meta.separator(),
        ...(b.queueTime ? [meta.text("Queued", ago(b.queueTime), { icon: Icons.calendar })] : []),
        ...(b.finishTime ? [meta.text("Finished", ago(b.finishTime), { icon: Icons.clock })] : []),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      ...extra,
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(b.sourceVersion ? [copy(b.sourceVersion, "Copy Commit SHA", { icon: Icons.commit, section: "Copy" })] : []),
      ...(branch ? [copy(branch, "Copy Branch", { icon: Icons.branch, section: "Copy" })] : []),
    ],
  };
}

/** The body that queues the same pipeline again on the same branch and commit. */
export function queueBody(b: Build) {
  return {
    definition: { id: b.definition.id },
    ...(b.sourceBranch ? { sourceBranch: b.sourceBranch } : {}),
    ...(b.sourceVersion ? { sourceVersion: b.sourceVersion } : {}),
  };
}
