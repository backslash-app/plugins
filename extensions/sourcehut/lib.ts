// SourceHut GraphQL objects (git, builds, todo and lists.sr.ht) and how they look in lists. Tested in
// lib_test.ts.

import { type Action, type Color, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";

export type Service = "git" | "builds" | "todo" | "lists";

export const serviceUrl = (s: Service) => `https://${s}.sr.ht`;

export interface Entity {
  canonicalName: string;
}

/** "~ada" → "ada". */
export const username = (e?: Entity | null) => (e?.canonicalName ?? "").replace(/^~/, "");

export interface Page<T> {
  results: T[];
  cursor?: string | null;
}

/** GraphQL errors, as one sentence. */
export function graphqlError(errors: { message: string }[] | undefined): string | undefined {
  if (!errors?.length) return undefined;
  return [...new Set(errors.map((e) => e.message.trim()))].join("; ");
}

/** "now", "5m", "3h", "2d", "25 Oct", "Mar 2024". */
export function ago(iso: string | undefined | null, now = Date.now()): string {
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

export const firstLine = (s: string | null | undefined) => (s ?? "").split("\n")[0].trim();

function excerpt(text: string | null | undefined, max = 1200): string | undefined {
  const t = (text ?? "").trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

const title = (s: string) => s ? s[0].toUpperCase() + s.slice(1).toLowerCase().replace(/_/g, " ") : s;

// --- git.sr.ht ----------------------------------------------------------------------

export const REPOS_QUERY = `query Repos($cursor: Cursor) {
  me {
    canonicalName
    repositories(cursor: $cursor) {
      cursor
      results {
        id name description visibility created updated
        owner { canonicalName }
        HEAD { name }
      }
    }
  }
}`;

export interface Repo {
  id: number;
  name: string;
  description?: string | null;
  visibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  created: string;
  updated: string;
  owner: Entity;
  HEAD?: { name: string } | null;
}

export const repoUrl = (r: Repo) => `${serviceUrl("git")}/${r.owner.canonicalName}/${r.name}`;

const VISIBILITY: Record<Repo["visibility"], { icon: string; color: Color; label: string }> = {
  PUBLIC: { icon: Icons.repository, color: "blue", label: "Public" },
  UNLISTED: { icon: Icons.eyeOff, color: "teal", label: "Unlisted" },
  PRIVATE: { icon: Icons.lock, color: "orange", label: "Private" },
};

export function repoItem(r: Repo): Item {
  const url = repoUrl(r);
  const v = VISIBILITY[r.visibility] ?? VISIBILITY.PUBLIC;
  const branch = r.HEAD?.name.replace(/^refs\/heads\//, "");
  const ssh = `git@git.sr.ht:${r.owner.canonicalName}/${r.name}`;
  return {
    id: String(r.id),
    title: r.name,
    subtitle: r.description || undefined,
    icon: { source: v.icon, tint: v.color },
    keywords: [r.owner.canonicalName, v.label],
    accessories: [
      ...(r.visibility !== "PUBLIC" ? [{ tag: v.label, color: v.color }] : []),
      ...(branch ? [{ icon: Icons.branch, text: branch, tooltip: "Default branch" }] : []),
      { text: ago(r.updated), tooltip: "Updated" },
    ],
    detail: {
      markdown: r.description || undefined,
      metadata: [
        meta.text("Owner", r.owner.canonicalName, { icon: Icons.person }),
        meta.text("Visibility", v.label, { icon: v.icon, color: v.color }),
        ...(branch ? [meta.text("Default branch", branch, { icon: Icons.branch })] : []),
        meta.separator(),
        meta.text("Created", ago(r.created), { icon: Icons.calendar }),
        meta.text("Updated", ago(r.updated), { icon: Icons.clock }),
        meta.link("Link", url.replace("https://", ""), url),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      open(`${url}/log`, "Open Log", { icon: Icons.commit, shortcut: "<Ctrl>l" }),
      open(`${url}/tree`, "Open Tree", { icon: Icons.folder, shortcut: "<Ctrl>t" }),
      open(`${url}/refs`, "Open Refs", { icon: Icons.tag }),
      open(`${serviceUrl("builds")}/${r.owner.canonicalName}/${r.name}`, "Open Builds", { icon: Icons.cycle }),
      copy(`git clone ${url}`, "Copy git clone (HTTPS)", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>c",
        section: "Copy",
      }),
      copy(`git clone ${ssh}`, "Copy git clone (SSH)", { icon: Icons.terminal, section: "Copy" }),
      copy(url, "Copy URL", { section: "Copy" }),
    ],
  };
}

// --- builds.sr.ht -------------------------------------------------------------------

export const JOBS_QUERY = `query Jobs($cursor: Cursor) {
  jobs(cursor: $cursor) {
    cursor
    results {
      id created updated status note tags visibility image
      owner { canonicalName }
      tasks { name status }
    }
  }
}`;

export const JOB_MANIFEST_QUERY = `query Job($id: Int!) {
  job(id: $id) { id manifest note tags visibility }
}`;

export const SUBMIT_MUTATION =
  `mutation Submit($manifest: String!, $tags: [String!], $note: String, $visibility: Visibility) {
  submit(manifest: $manifest, tags: $tags, note: $note, visibility: $visibility) { id owner { canonicalName } }
}`;

export const CANCEL_MUTATION = `mutation Cancel($id: Int!) { cancel(jobId: $id) { id status } }`;

export type JobStatus = "PENDING" | "QUEUED" | "RUNNING" | "SUCCESS" | "FAILED" | "TIMEOUT" | "CANCELLED";
export type TaskStatus = "PENDING" | "RUNNING" | "SUCCESS" | "FAILED" | "SKIPPED";

export interface Job {
  id: number;
  created: string;
  updated: string;
  status: JobStatus;
  note?: string | null;
  tags: string[];
  visibility?: "PUBLIC" | "UNLISTED" | "PRIVATE";
  image: string;
  owner: Entity;
  tasks: { name: string; status: TaskStatus }[];
}

export const JOB_STYLES: Record<JobStatus, { label: string; icon: string; color: Color }> = {
  FAILED: { label: "Failed", icon: Icons.canceled, color: "red" },
  TIMEOUT: { label: "Timed out", icon: Icons.hourglass, color: "red" },
  RUNNING: { label: "Running", icon: Icons.inProgress, color: "yellow" },
  QUEUED: { label: "Queued", icon: Icons.todo, color: "gray" },
  PENDING: { label: "Pending", icon: Icons.backlog, color: "gray" },
  SUCCESS: { label: "Success", icon: Icons.done, color: "green" },
  CANCELLED: { label: "Cancelled", icon: Icons.canceled, color: "gray" },
};

const TASK_STYLES: Record<TaskStatus, { icon: string; color: Color }> = {
  PENDING: { icon: Icons.todo, color: "gray" },
  RUNNING: { icon: Icons.inProgress, color: "yellow" },
  SUCCESS: { icon: Icons.check, color: "green" },
  FAILED: { icon: Icons.cross, color: "red" },
  SKIPPED: { icon: Icons.minus, color: "gray" },
};

export const jobUrl = (j: Job) => `${serviceUrl("builds")}/${j.owner.canonicalName}/job/${j.id}`;

export const isActive = (j: Job) => j.status === "RUNNING" || j.status === "QUEUED" || j.status === "PENDING";
export const isFailed = (j: Job) => j.status === "FAILED" || j.status === "TIMEOUT";

/** What a job builds: its tags joined (`repo/branch`), else its image. */
export const jobName = (j: Job) => j.tags.length ? j.tags.join("/") : j.image;

/** Failed jobs that are the latest finished job of their tags. */
export function currentFailures(jobs: Job[]): Set<Job> {
  const latest = new Map<string, Job>();
  for (const j of jobs) {
    if (isActive(j)) continue;
    const k = `${j.owner.canonicalName}:${j.tags.join("/") || j.image}`;
    const seen = latest.get(k);
    if (!seen || j.id > seen.id) latest.set(k, j);
  }
  return new Set([...latest.values()].filter(isFailed));
}

export type JobGroup = "Failing" | "Running" | "Recent";

export const jobGroup = (j: Job, failing: Set<Job>): JobGroup =>
  failing.has(j) ? "Failing" : isActive(j) ? "Running" : "Recent";

export function sortJobs(jobs: Job[], failing = currentFailures(jobs)): Job[] {
  const order: JobGroup[] = ["Failing", "Running", "Recent"];
  return [...jobs].sort((a, b) =>
    order.indexOf(jobGroup(a, failing)) - order.indexOf(jobGroup(b, failing)) || b.id - a.id
  );
}

/** "3/5 tasks", with the failed one named. */
export function taskSummary(j: Job): string {
  if (!j.tasks.length) return "";
  const done = j.tasks.filter((t) => t.status === "SUCCESS").length;
  const failed = j.tasks.find((t) => t.status === "FAILED");
  return failed ? `${failed.name} failed` : `${done}/${j.tasks.length} tasks`;
}

export function jobItem(j: Job, failing: Set<Job>, extra: Action[] = []): Item {
  const s = JOB_STYLES[j.status] ?? JOB_STYLES.PENDING;
  const stale = isFailed(j) && !failing.has(j);
  const url = jobUrl(j);
  const note = firstLine(j.note);
  const tasks = taskSummary(j);
  return {
    id: String(j.id),
    title: note || jobName(j),
    subtitle: note ? jobName(j) : `#${j.id}`,
    icon: { source: s.icon, tint: s.color },
    section: jobGroup(j, failing),
    keywords: [String(j.id), j.image, ...j.tags, s.label],
    accessories: [
      ...(tasks ? [{ text: tasks, tooltip: "Tasks" }] : []),
      { tag: j.image, color: "gray" as Color },
      { text: ago(j.created), tooltip: "Submitted" },
      { tag: stale ? `${s.label} (fixed since)` : s.label, color: stale ? "gray" as Color : s.color },
    ],
    detail: {
      stats: [
        { label: "Status", value: s.label, color: s.color },
        { label: "Job", value: `#${j.id}` },
        { label: "Tasks", value: j.tasks.length },
      ],
      markdown: excerpt(j.note),
      metadata: [
        ...j.tasks.map((t) =>
          meta.text(t.name, title(t.status), { icon: TASK_STYLES[t.status]?.icon, color: TASK_STYLES[t.status]?.color })
        ),
        ...(j.tasks.length ? [meta.separator()] : []),
        meta.text("Image", j.image, { icon: Icons.box }),
        ...(j.tags.length ? [meta.tags("Tags", j.tags)] : []),
        meta.text("Owner", j.owner.canonicalName, { icon: Icons.person }),
        meta.text("Submitted", ago(j.created), { icon: Icons.calendar }),
        meta.text("Updated", ago(j.updated), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      ...extra,
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(String(j.id), "Copy Job ID", { icon: Icons.hash, section: "Copy" }),
    ],
  };
}

// --- todo.sr.ht ---------------------------------------------------------------------

const TICKET_FIELDS = `id ref subject status resolution created updated body
        submitter { canonicalName }
        assignees { canonicalName }
        labels { name foregroundColor backgroundColor }`;

export const TRACKERS_QUERY = `query Trackers {
  me {
    canonicalName
    trackers { results { id name description updated owner { canonicalName } } }
  }
}`;

export const TICKETS_QUERY = `query Tickets($owner: String!, $tracker: String!, $cursor: Cursor) {
  user(username: $owner) {
    tracker(name: $tracker) {
      id name
      owner { canonicalName }
      tickets(cursor: $cursor) {
        cursor
        results {
        ${TICKET_FIELDS}
        }
      }
    }
  }
}`;

export const SUBSCRIPTIONS_QUERY = `query Subscriptions {
  subscriptions {
    results {
      ... on TrackerSubscription { tracker { id name owner { canonicalName } } }
    }
  }
}`;

export const STATUS_MUTATION = `mutation Status($tracker: Int!, $ticket: Int!, $input: UpdateStatusInput!) {
  updateTicketStatus(trackerId: $tracker, ticketId: $ticket, input: $input) { id }
}`;

export type TicketStatus = "REPORTED" | "CONFIRMED" | "IN_PROGRESS" | "PENDING" | "RESOLVED";

export interface Tracker {
  id: number;
  name: string;
  description?: string | null;
  updated?: string;
  owner: Entity;
}

export interface Ticket {
  id: number;
  ref?: string;
  subject: string;
  status: TicketStatus;
  resolution?: string | null;
  created: string;
  updated: string;
  body?: string | null;
  submitter: Entity;
  assignees: Entity[];
  labels: { name: string; foregroundColor?: string; backgroundColor?: string }[];
}

export interface TrackedTicket extends Ticket {
  tracker: Tracker;
}

export const TICKET_STYLES: Record<TicketStatus, { label: string; icon: string; color: Color }> = {
  REPORTED: { label: "Reported", icon: Icons.issue, color: "green" },
  CONFIRMED: { label: "Confirmed", icon: Icons.todo, color: "blue" },
  IN_PROGRESS: { label: "In progress", icon: Icons.inProgress, color: "yellow" },
  PENDING: { label: "Pending", icon: Icons.pause, color: "orange" },
  RESOLVED: { label: "Resolved", icon: Icons.issueClosed, color: "purple" },
};

/** The statuses offered in "Change Status", with the resolution a resolved ticket needs. */
export const STATUS_CHOICES: { title: string; status: TicketStatus; resolution?: string }[] = [
  { title: "Confirmed", status: "CONFIRMED" },
  { title: "In Progress", status: "IN_PROGRESS" },
  { title: "Pending", status: "PENDING" },
  { title: "Resolved: Fixed", status: "RESOLVED", resolution: "FIXED" },
  { title: "Resolved: Implemented", status: "RESOLVED", resolution: "IMPLEMENTED" },
  { title: "Resolved: Won't Fix", status: "RESOLVED", resolution: "WONT_FIX" },
  { title: "Resolved: Duplicate", status: "RESOLVED", resolution: "DUPLICATE" },
  { title: "Reopen", status: "REPORTED", resolution: "UNRESOLVED" },
];

const RESOLUTIONS: Record<string, string> = {
  WONT_FIX: "won't fix",
  BY_DESIGN: "by design",
  NOT_OUR_BUG: "not our bug",
};

export const resolutionLabel = (r: string) => RESOLUTIONS[r] ?? r.toLowerCase().replace(/_/g, " ");

export const ticketUrl = (t: TrackedTicket) =>
  `${serviceUrl("todo")}/${t.tracker.owner.canonicalName}/${t.tracker.name}/${t.id}`;

export const ticketRef = (t: TrackedTicket) => t.ref ?? `${t.tracker.owner.canonicalName}/${t.tracker.name}#${t.id}`;

export const isOpenTicket = (t: Ticket) => t.status !== "RESOLVED";

export const assignedTo = (t: Ticket, me: string) => t.assignees.some((a) => a.canonicalName === me);

/** Open first by status, then most recently updated. */
export function sortTickets(tickets: TrackedTicket[]): TrackedTicket[] {
  const order: TicketStatus[] = ["IN_PROGRESS", "CONFIRMED", "REPORTED", "PENDING", "RESOLVED"];
  return [...tickets].sort((a, b) =>
    order.indexOf(a.status) - order.indexOf(b.status) || b.updated.localeCompare(a.updated)
  );
}

export function ticketItem(t: TrackedTicket, me: string, extra: Action[] = []): Item {
  const s = TICKET_STYLES[t.status] ?? TICKET_STYLES.REPORTED;
  const url = ticketUrl(t);
  const tracker = `${t.tracker.owner.canonicalName}/${t.tracker.name}`;
  const metadata: Metadata[] = [
    meta.text(
      "Status",
      t.resolution && t.status === "RESOLVED" ? `${s.label} (${resolutionLabel(t.resolution)})` : s.label,
      {
        icon: s.icon,
        color: s.color,
      },
    ),
    meta.person("Submitter", t.submitter.canonicalName),
    ...(t.assignees.length ? [meta.tags("Assignees", t.assignees.map((a) => a.canonicalName))] : []),
    ...(t.labels.length ? [meta.tags("Labels", t.labels.map((l) => l.name))] : []),
    meta.separator(),
    meta.text("Tracker", tracker, { icon: Icons.ticket }),
    meta.text("Opened", ago(t.created), { icon: Icons.calendar }),
    meta.text("Updated", ago(t.updated), { icon: Icons.clock }),
  ];
  return {
    id: `${tracker}#${t.id}`,
    title: t.subject,
    subtitle: `#${t.id}`,
    icon: { source: s.icon, tint: s.color },
    section: tracker,
    keywords: [tracker, String(t.id), t.submitter.canonicalName, ...t.labels.map((l) => l.name), s.label],
    accessories: [
      ...t.labels.slice(0, 3).map((l) => ({ tag: l.name })),
      ...(assignedTo(t, me)
        ? [{ icon: { source: Icons.person, tint: "blue" as Color }, tooltip: "Assigned to you" }]
        : []),
      { tag: s.label, color: s.color },
      { text: ago(t.updated), tooltip: "Updated" },
    ],
    detail: { markdown: excerpt(t.body), metadata },
    actions: [
      open(url, "Open in Browser"),
      ...extra,
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(ticketRef(t), "Copy Reference", { icon: Icons.hash, shortcut: "<Ctrl>period", section: "Copy" }),
      copy(`[${ticketRef(t)}: ${t.subject}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}

// --- lists.sr.ht --------------------------------------------------------------------

export const LISTS_QUERY = `query Lists {
  me {
    canonicalName
    lists {
      results {
        id name description
        owner { canonicalName }
        patches {
          results {
            id subject status created updated version prefix
            submitter { canonicalName }
          }
        }
      }
    }
  }
}`;

export const PATCHSET_MUTATION = `mutation Patchset($id: Int!, $status: PatchsetStatus!) {
  updatePatchset(id: $id, status: $status) { id status }
}`;

export type PatchsetStatus =
  | "UNKNOWN"
  | "PROPOSED"
  | "NEEDS_REVISION"
  | "SUPERSEDED"
  | "APPROVED"
  | "REJECTED"
  | "APPLIED";

export interface MailingList {
  id: number;
  name: string;
  description?: string | null;
  owner: Entity;
}

export interface Patchset {
  id: number;
  subject: string;
  status: PatchsetStatus;
  created: string;
  updated: string;
  version: number;
  prefix?: string | null;
  submitter: Entity;
}

export interface ListedPatchset extends Patchset {
  list: MailingList;
}

export const PATCH_STYLES: Record<PatchsetStatus, { label: string; icon: string; color: Color }> = {
  PROPOSED: { label: "Proposed", icon: Icons.pullRequest, color: "green" },
  NEEDS_REVISION: { label: "Needs revision", icon: Icons.pullRequestDraft, color: "orange" },
  APPROVED: { label: "Approved", icon: Icons.check, color: "teal" },
  APPLIED: { label: "Applied", icon: Icons.merged, color: "purple" },
  REJECTED: { label: "Rejected", icon: Icons.pullRequestClosed, color: "red" },
  SUPERSEDED: { label: "Superseded", icon: Icons.pullRequestClosed, color: "gray" },
  UNKNOWN: { label: "Unknown", icon: Icons.question, color: "gray" },
};

export const PATCH_CHOICES: PatchsetStatus[] = [
  "PROPOSED",
  "NEEDS_REVISION",
  "APPROVED",
  "APPLIED",
  "REJECTED",
  "SUPERSEDED",
];

export const isOpenPatch = (p: Patchset) =>
  p.status === "PROPOSED" || p.status === "NEEDS_REVISION" || p.status === "APPROVED" || p.status === "UNKNOWN";

export const patchUrl = (p: ListedPatchset) =>
  `${serviceUrl("lists")}/${p.list.owner.canonicalName}/${p.list.name}/patches/${p.id}`;

/** "[PATCH project v2] Subject". */
export function patchTitle(p: Patchset): string {
  const prefix = ["PATCH", p.prefix?.trim(), p.version > 1 ? `v${p.version}` : ""].filter(Boolean).join(" ");
  return `[${prefix}] ${p.subject}`;
}

export function sortPatches(patches: ListedPatchset[]): ListedPatchset[] {
  const order: PatchsetStatus[] = [
    "PROPOSED",
    "NEEDS_REVISION",
    "APPROVED",
    "UNKNOWN",
    "APPLIED",
    "REJECTED",
    "SUPERSEDED",
  ];
  return [...patches].sort((a, b) =>
    order.indexOf(a.status) - order.indexOf(b.status) || b.updated.localeCompare(a.updated)
  );
}

export function patchItem(p: ListedPatchset, extra: Action[] = []): Item {
  const s = PATCH_STYLES[p.status] ?? PATCH_STYLES.UNKNOWN;
  const url = patchUrl(p);
  const list = `${p.list.owner.canonicalName}/${p.list.name}`;
  return {
    id: String(p.id),
    title: p.subject,
    subtitle: [p.prefix?.trim(), p.version > 1 ? `v${p.version}` : ""].filter(Boolean).join(" ") || undefined,
    icon: { source: s.icon, tint: s.color },
    section: list,
    keywords: [list, p.submitter.canonicalName, p.prefix ?? "", s.label],
    accessories: [
      { avatar: username(p.submitter), tooltip: p.submitter.canonicalName },
      { tag: s.label, color: s.color },
      { text: ago(p.updated), tooltip: "Updated" },
    ],
    detail: {
      markdown: `**${patchTitle(p)}**`,
      metadata: [
        meta.text("Status", s.label, { icon: s.icon, color: s.color }),
        meta.person("Submitter", p.submitter.canonicalName),
        meta.text("Version", `v${p.version}`, { icon: Icons.tag }),
        meta.separator(),
        meta.text("List", list, { icon: Icons.mail }),
        meta.text("Sent", ago(p.created), { icon: Icons.calendar }),
        meta.text("Updated", ago(p.updated), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(url, "Open in Browser"),
      open(`${url}/mbox`, "Open mbox", { icon: Icons.download, shortcut: "<Ctrl>m" }),
      ...extra,
      copy(`curl -s ${url}/mbox | git am -3`, "Copy git am Command", {
        icon: Icons.terminal,
        shortcut: "<Ctrl><Shift>a",
        section: "Copy",
      }),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    ],
  };
}
