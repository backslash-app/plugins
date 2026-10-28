// Linear GraphQL helper and the mapping from issues to launcher items.

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
  submenu,
  toast,
} from "@backslash/api";

export const API = "https://api.linear.app/graphql";

export async function linear<T>(
  apiKey: string,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    signal,
    // Personal API keys go as is; OAuth tokens would be "Bearer …".
    headers: { "Content-Type": "application/json", Authorization: apiKey.trim() },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new Error("Linear rejected the API key: check it in Settings → Extensions → Linear");
  const body = await res.json().catch(() => ({})) as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`Linear: ${body.errors[0].message}`);
  if (!res.ok || !body.data) throw new Error(`Linear answered ${res.status}`);
  return body.data;
}

export const ISSUE_FIELDS = `
  id identifier title url priority priorityLabel updatedAt createdAt dueDate estimate branchName
  description
  state { id name type color }
  team { id key name }
  project { name }
  cycle { number }
  assignee { name avatarUrl }
  creator { name }
  labels { nodes { name color } }
  children { nodes { state { type } } }
`;

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  updatedAt: string;
  createdAt?: string;
  dueDate?: string | null;
  estimate?: number | null;
  branchName?: string;
  description?: string | null;
  state: { id: string; name: string; type: string; color?: string };
  team: { id: string; key: string; name: string };
  project?: { name: string } | null;
  cycle?: { number: number } | null;
  assignee?: { name: string; avatarUrl?: string | null } | null;
  creator?: { name: string } | null;
  labels?: { nodes: { name: string; color: string }[] };
  children?: { nodes: { state: { type: string } }[] };
}

export interface WorkflowState {
  id: string;
  name: string;
  type: string;
  position: number;
}

/** Order of the sections in "My Issues": what's moving first. */
const STATE_ORDER = ["started", "unstarted", "backlog", "triage", "completed", "canceled"];

export function stateRank(type: string): number {
  const i = STATE_ORDER.indexOf(type);
  return i === -1 ? STATE_ORDER.length : i;
}

/** Urgent, high, medium, low first; no priority (0) last. */
export function sortIssues(issues: Issue[]): Issue[] {
  const p = (n: number) => n === 0 ? 5 : n;
  return [...issues].sort((a, b) =>
    stateRank(a.state.type) - stateRank(b.state.type) || a.state.name.localeCompare(b.state.name) ||
    p(a.priority) - p(b.priority) || b.updatedAt.localeCompare(a.updatedAt)
  );
}

/** The icon of a workflow state, colored like Linear does. */
export function stateIcon(state: { name: string; type: string }): { source: string; tint: Color } {
  switch (state.type) {
    case "started":
      return /review/i.test(state.name)
        ? { source: Icons.inReview, tint: "green" }
        : { source: Icons.inProgress, tint: "yellow" };
    case "unstarted":
      return { source: Icons.todo, tint: "gray" };
    case "backlog":
      return { source: Icons.backlog, tint: "gray" };
    case "triage":
      return { source: Icons.alert, tint: "orange" };
    case "completed":
      return { source: Icons.done, tint: "purple" };
    case "canceled":
      return { source: Icons.canceled, tint: "gray" };
    default:
      return { source: Icons.todo, tint: "gray" };
  }
}

export function priorityIcon(priority: number): { source: string; tint: Color } {
  switch (priority) {
    case 1:
      return { source: Icons.urgent, tint: "orange" };
    case 2:
      return { source: Icons.high, tint: "gray" };
    case 3:
      return { source: Icons.medium, tint: "gray" };
    case 4:
      return { source: Icons.low, tint: "gray" };
    default:
      return { source: Icons.noPriority, tint: "gray" };
  }
}

/** The palette color closest to a Linear label color. */
export function colorOf(hex: string | undefined): Color {
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

/** "today", "yesterday", "3d", "25 Oct". */
export function shortDate(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const days = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (days <= 0 && d.getDate() === now.getDate()) return "today";
  if (days <= 1) return "yesterday";
  if (days < 7) return `${days}d`;
  return d.toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** Sub-issues done, out of all. */
export function subIssues(issue: Issue): { done: number; total: number } {
  const all = issue.children?.nodes ?? [];
  return { done: all.filter((c) => c.state.type === "completed").length, total: all.length };
}

/** The side panel of an issue: its properties, like Linear's. */
export function issueMetadata(issue: Issue): Metadata[] {
  const state = stateIcon(issue.state);
  const prio = priorityIcon(issue.priority);
  const lines: Metadata[] = [
    meta.text("Status", issue.state.name, { icon: state.source, color: state.tint }),
    meta.text("Priority", issue.priorityLabel, {
      icon: prio.source,
      color: issue.priority === 1 ? "orange" : undefined,
    }),
    issue.assignee
      ? meta.person("Assignee", issue.assignee.name, issue.assignee.avatarUrl ?? undefined)
      : meta.text("Assignee", "Unassigned", { icon: Icons.person }),
  ];
  const labels = issue.labels?.nodes ?? [];
  if (labels.length) lines.push(meta.tags("Labels", labels.map((l) => ({ text: l.name, color: colorOf(l.color) }))));
  if (issue.project) lines.push(meta.text("Project", issue.project.name, { icon: Icons.project }));
  if (issue.cycle) lines.push(meta.text("Cycle", `Cycle ${issue.cycle.number}`, { icon: Icons.cycle }));
  if (issue.estimate) lines.push(meta.text("Estimate", `${issue.estimate} point${issue.estimate > 1 ? "s" : ""}`));
  if (issue.dueDate) {
    const overdue = new Date(issue.dueDate) < new Date();
    lines.push(meta.text("Due", issue.dueDate, { icon: Icons.calendar, color: overdue ? "red" : undefined }));
  }
  const subs = subIssues(issue);
  if (subs.total) lines.push(meta.progress("Sub-issues", subs.done / subs.total, `${subs.done} of ${subs.total}`));
  lines.push(meta.separator());
  lines.push(meta.text("Team", issue.team.name));
  if (issue.creator) lines.push(meta.text("Created by", issue.creator.name));
  lines.push(meta.text("Updated", shortDate(issue.updatedAt)));
  return lines;
}

/** The first paragraphs of the description, for the side panel. */
export function excerpt(markdown: string | null | undefined, max = 360): string | undefined {
  const text = (markdown ?? "").trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

export const PRIORITIES = [
  { value: "0", title: "No priority" },
  { value: "1", title: "Urgent" },
  { value: "2", title: "High" },
  { value: "3", title: "Medium" },
  { value: "4", title: "Low" },
];

// Views of this extension run in one process: a change made from one view
// (a new status) reloads the lists still open.
const changes = new EventTarget();

export function notifyChanged() {
  changes.dispatchEvent(new Event("change"));
}

/** Yields `load()`, then again after each change, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal): AsyncGenerator<T> {
  while (!signal.aborted) {
    yield await load();
    await new Promise<void>((resolve) => {
      const done = () => {
        changes.removeEventListener("change", done);
        signal.removeEventListener("abort", done);
        resolve();
      };
      changes.addEventListener("change", done);
      signal.addEventListener("abort", done);
    });
  }
}

async function update(apiKey: string, issue: Issue, input: Record<string, unknown>, message: string) {
  const res = await linear<{ issueUpdate: { success: boolean } }>(
    apiKey,
    `mutation($id: String!, $input: IssueUpdateInput!) { issueUpdate(id: $id, input: $input) { success } }`,
    { id: issue.id, input },
  );
  if (!res.issueUpdate.success) throw new Error("Linear did not update the issue");
  notifyChanged();
  await toast(`${issue.identifier}: ${message}`, { style: "success" });
}

/** Everything you can do with an issue, grouped like in Linear. */
export function issueActions(issue: Issue, ctx: Context, options: { details?: boolean } = {}): Action[] {
  const apiKey = ctx.preferences.apiKey as string;
  const statuses = submenu("Change Status", async () => {
    const data = await linear<{ team: { states: { nodes: WorkflowState[] } } }>(
      apiKey,
      `query($id: String!) { team(id: $id) { states { nodes { id name type position } } } }`,
      { id: issue.team.id },
    );
    return data.team.states.nodes
      .sort((a, b) => stateRank(a.type) - stateRank(b.type) || a.position - b.position)
      .map((s) =>
        action(s.name, () => update(apiKey, issue, { stateId: s.id }, s.name), {
          icon: stateIcon(s).source,
        })
      );
  }, { icon: Icons.inProgress, shortcut: "<Ctrl>s", section: "Issue" });
  const priorities = submenu(
    "Set Priority",
    PRIORITIES.map((p) =>
      action(p.title, () => update(apiKey, issue, { priority: Number(p.value) }, p.title), {
        icon: priorityIcon(Number(p.value)).source,
      })
    ),
    { icon: Icons.high, shortcut: "<Ctrl>p", section: "Issue" },
  );
  const assignees = submenu("Assign To", async () => {
    const data = await linear<{ viewer: { id: string }; team: { members: { nodes: { id: string; name: string }[] } } }>(
      apiKey,
      `query($id: String!) { viewer { id } team(id: $id) { members { nodes { id name } } } }`,
      { id: issue.team.id },
    );
    const me = data.viewer.id;
    const people = [...data.team.members.nodes].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : 0));
    return [
      ...people.map((m) =>
        action(m.id === me ? `${m.name} (me)` : m.name, () => update(apiKey, issue, { assigneeId: m.id }, m.name), {
          icon: Icons.person,
        })
      ),
      action("Unassign", () => update(apiKey, issue, { assigneeId: null }, "unassigned"), { icon: Icons.cross }),
    ];
  }, { icon: Icons.person, shortcut: "<Ctrl><Shift>a", section: "Issue" });

  return [
    open(issue.url, "Open in Linear"),
    ...(options.details === false ? [] : [action("Show Details", () => issuePage(issue, ctx), { icon: Icons.info })]),
    statuses,
    priorities,
    assignees,
    copy(issue.identifier, "Copy Identifier", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(issue.url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${issue.identifier}: ${issue.title}](${issue.url})`, "Copy as Markdown Link", { section: "Copy" }),
    ...(issue.branchName ? [copy(issue.branchName, "Copy Branch Name", { icon: Icons.branch, section: "Copy" })] : []),
  ];
}

/** The full page of an issue: description and properties. */
export function issuePage(issue: Issue, ctx: Context): DetailSpec {
  const head = `# ${issue.title}\n\n`;
  const body = issue.description?.trim() || "_No description._";
  return detail({
    title: issue.identifier,
    markdown: head + body,
    metadata: issueMetadata(issue),
    status: `${issue.team.key} · updated ${shortDate(issue.updatedAt)}`,
    actions: issueActions(issue, ctx, { details: false }),
  });
}

export function issueItem(issue: Issue, ctx: Context, options: { section?: string } = {}): Item {
  const labels = issue.labels?.nodes ?? [];
  const prio = priorityIcon(issue.priority);
  return {
    id: issue.id,
    title: issue.title,
    subtitle: issue.identifier,
    icon: stateIcon(issue.state),
    section: options.section,
    keywords: [
      issue.identifier,
      issue.state.name,
      issue.team.name,
      issue.assignee?.name ?? "",
      issue.project?.name ?? "",
      ...labels.map((l) => l.name),
    ].filter(Boolean),
    accessories: [
      { icon: prio, tooltip: issue.priorityLabel },
      ...labels.slice(0, 2).map((l) => ({ tag: l.name, color: colorOf(l.color) })),
      ...(issue.assignee
        ? [{ avatar: issue.assignee.avatarUrl ?? issue.assignee.name, tooltip: issue.assignee.name }]
        : []),
      { text: shortDate(issue.updatedAt), tooltip: "Updated" },
    ],
    detail: {
      markdown: excerpt(issue.description),
      metadata: issueMetadata(issue),
    },
    actions: issueActions(issue, ctx),
  };
}
