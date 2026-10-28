// Jira issues as launcher items, Atlassian Document Format to Markdown, and the actions on an issue.

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
  meta,
  type Metadata,
  open,
  submenu,
  toast,
} from "@backslash/api";
import { type Account, account, issueUrl, jira, myAccountId } from "./api.ts";

// ---------------------------------------------------------------------------
// Shapes (REST v3)

interface User {
  accountId: string;
  displayName: string;
  avatarUrls?: Record<string, string>;
}

export interface Sprint {
  id: number;
  name: string;
  state: "active" | "closed" | "future";
}

export interface Issue {
  id: string;
  key: string;
  fields: {
    summary: string;
    status: { name: string; statusCategory: { key: "new" | "indeterminate" | "done" | string; name: string } };
    priority?: { id: string; name: string } | null;
    issuetype: { name: string; subtask?: boolean; hierarchyLevel?: number };
    assignee?: User | null;
    reporter?: User | null;
    labels?: string[];
    project: { key: string; name: string };
    created: string;
    updated: string;
    duedate?: string | null;
    description?: AdfNode | null;
    parent?: { key: string; fields?: { summary?: string } } | null;
    [custom: string]: unknown;
  };
}

/** Fields asked for in searches; the sprint field id is added per site. */
export const FIELDS = [
  "summary",
  "status",
  "priority",
  "issuetype",
  "assignee",
  "reporter",
  "labels",
  "project",
  "created",
  "updated",
  "duedate",
  "description",
  "parent",
];

// ---------------------------------------------------------------------------
// Formatting

/** "today", "yesterday", "3d", "25 Oct". */
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

export const avatarOf = (u: User) => u.avatarUrls?.["48x48"] ?? u.avatarUrls?.["32x32"] ?? u.displayName;

const CATEGORY_ORDER = ["indeterminate", "new", "done"];
const CATEGORY_NAMES: Record<string, string> = { indeterminate: "In Progress", new: "To Do", done: "Done" };

/** The section of an issue in "My Issues": its status category. */
export const categoryName = (issue: Issue) =>
  CATEGORY_NAMES[issue.fields.status.statusCategory.key] ?? issue.fields.status.statusCategory.name;

export function categoryRank(key: string): number {
  const i = CATEGORY_ORDER.indexOf(key);
  return i === -1 ? CATEGORY_ORDER.length : i;
}

export function statusIcon(status: Issue["fields"]["status"]): { source: string; tint: Color } {
  switch (status.statusCategory.key) {
    case "indeterminate":
      return /review|qa|test/i.test(status.name)
        ? { source: Icons.inReview, tint: "green" }
        : { source: Icons.inProgress, tint: "blue" };
    case "done":
      return { source: Icons.done, tint: "green" };
    default:
      return { source: Icons.todo, tint: "gray" };
  }
}

export const statusColor = (categoryKey: string): Color =>
  categoryKey === "done" ? "green" : categoryKey === "indeterminate" ? "blue" : "gray";

/** Jira's default schemes: Highest…Lowest, and the older Blocker…Trivial. */
const PRIORITIES: Record<string, { rank: number; icon: string; tint: Color }> = {
  blocker: { rank: 0, icon: Icons.urgent, tint: "red" },
  highest: { rank: 1, icon: Icons.urgent, tint: "red" },
  critical: { rank: 1, icon: Icons.urgent, tint: "red" },
  high: { rank: 2, icon: Icons.high, tint: "red" },
  major: { rank: 2, icon: Icons.high, tint: "red" },
  medium: { rank: 3, icon: Icons.medium, tint: "orange" },
  low: { rank: 4, icon: Icons.low, tint: "blue" },
  minor: { rank: 4, icon: Icons.low, tint: "blue" },
  lowest: { rank: 5, icon: Icons.low, tint: "gray" },
  trivial: { rank: 5, icon: Icons.noPriority, tint: "gray" },
};

export function priorityLook(p: Issue["fields"]["priority"]): { rank: number; icon: string; tint: Color } {
  return PRIORITIES[(p?.name ?? "").toLowerCase()] ?? { rank: 6, icon: Icons.noPriority, tint: "gray" };
}

export function typeIcon(type: Issue["fields"]["issuetype"]): { source: string; tint: Color } {
  const name = type.name.toLowerCase();
  if (type.subtask || /sub-?task/.test(name)) return { source: Icons.layers, tint: "blue" };
  if (name.includes("bug")) return { source: Icons.bug, tint: "red" };
  if (name.includes("epic")) return { source: Icons.bolt, tint: "purple" };
  if (name.includes("story")) return { source: Icons.note, tint: "green" };
  if (name.includes("incident")) return { source: Icons.alert, tint: "red" };
  if (/feature|improvement/.test(name)) return { source: Icons.plus, tint: "green" };
  if (name.includes("task")) return { source: Icons.squareCheck, tint: "blue" };
  return { source: Icons.ticket, tint: "gray" };
}

/** In progress first, then to do; by priority, then most recently updated. */
export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) =>
    categoryRank(a.fields.status.statusCategory.key) - categoryRank(b.fields.status.statusCategory.key) ||
    priorityLook(a.fields.priority).rank - priorityLook(b.fields.priority).rank ||
    b.fields.updated.localeCompare(a.fields.updated)
  );
}

/** The active sprint of an issue, else its latest one. */
export function sprintOf(issue: Issue, field: string | undefined): Sprint | undefined {
  if (!field) return undefined;
  const sprints = issue.fields[field] as Sprint[] | null | undefined;
  if (!Array.isArray(sprints) || !sprints.length) return undefined;
  return sprints.find((s) => s.state === "active") ?? sprints[sprints.length - 1];
}

export function isOverdue(due: string | null | undefined, now = new Date()): boolean {
  return !!due && new Date(`${due}T23:59:59`) < now;
}

/** `ENG-12-fix-the-login-page`, like Jira's "Create branch". */
export function branchName(issue: Issue): string {
  const slug = issue.fields.summary.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/, "");
  return slug ? `${issue.key}-${slug}` : issue.key;
}

// ---------------------------------------------------------------------------
// Atlassian Document Format

export interface AdfNode {
  type: string;
  version?: number;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
  marks?: { type: string; attrs?: Record<string, unknown> }[];
}

function inline(nodes: AdfNode[] = []): string {
  return nodes.map((n) => {
    switch (n.type) {
      case "text": {
        let t = n.text ?? "";
        for (const m of n.marks ?? []) {
          if (m.type === "strong") t = `**${t}**`;
          else if (m.type === "em") t = `_${t}_`;
          else if (m.type === "code") t = `\`${t}\``;
          else if (m.type === "strike") t = `~~${t}~~`;
          else if (m.type === "link") t = `[${t}](${m.attrs?.href})`;
        }
        return t;
      }
      case "hardBreak":
        return "\n";
      case "mention":
        return String(n.attrs?.text ?? "@someone").replace(/^(?!@)/, "@");
      case "emoji":
        return String(n.attrs?.text ?? n.attrs?.shortName ?? "");
      case "inlineCard":
        return String(n.attrs?.url ?? "");
      case "status":
        return `\`${String(n.attrs?.text ?? "").toUpperCase()}\``;
      case "date":
        return new Date(Number(n.attrs?.timestamp)).toISOString().slice(0, 10);
      default:
        return inline(n.content);
    }
  }).join("");
}

function block(n: AdfNode, indent = ""): string {
  switch (n.type) {
    case "paragraph":
      return indent + inline(n.content);
    case "heading":
      return `${"#".repeat(Math.min(6, Number(n.attrs?.level ?? 2)))} ${inline(n.content)}`;
    case "bulletList":
    case "orderedList":
    case "taskList":
      return (n.content ?? []).map((item, i) => {
        const bullet = n.type === "orderedList"
          ? `${i + 1}.`
          : n.type === "taskList"
          ? (item.attrs?.state === "DONE" ? "- [x]" : "- [ ]")
          : "-";
        if (item.type === "taskItem") return `${indent}${bullet} ${inline(item.content)}`;
        const [first, ...rest] = item.content ?? [];
        const head = first ? block(first).trimStart() : "";
        const tail = rest.map((c) => block(c, `${indent}  `)).join("\n");
        return `${indent}${bullet} ${head}${tail ? `\n${tail}` : ""}`;
      }).join("\n");
    case "codeBlock":
      return `\`\`\`${n.attrs?.language ?? ""}\n${inline(n.content)}\n\`\`\``;
    case "blockquote":
    case "panel":
      return (n.content ?? []).map((c) => block(c)).join("\n\n").split("\n").map((l) => `> ${l}`).join("\n");
    case "rule":
      return "---";
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return "_[attachment]_";
    case "table":
      return (n.content ?? []).map((row) =>
        `| ${(row.content ?? []).map((cell) => (cell.content ?? []).map((c) => block(c)).join(" ")).join(" | ")} |`
      ).join("\n");
    default:
      return n.content ? (n.content.map((c) => block(c, indent)).join("\n\n")) : inline([n]);
  }
}

export function adfToMarkdown(doc: AdfNode | null | undefined): string {
  if (!doc) return "";
  if (typeof doc === "string") return doc;
  return (doc.content ?? []).map((n) => block(n)).filter((s) => s.trim()).join("\n\n").trim();
}

/** Plain text (blank lines between paragraphs) as an ADF document. */
export function textToAdf(text: string): AdfNode {
  const paragraphs = text.trim().split(/\n\s*\n/).filter(Boolean);
  return {
    type: "doc",
    version: 1,
    content: paragraphs.map((p) => ({
      type: "paragraph",
      content: p.split("\n").flatMap((line, i): AdfNode[] => [
        ...(i ? [{ type: "hardBreak" }] : []),
        ...(line ? [{ type: "text", text: line }] : []),
      ]),
    })),
  };
}

function excerpt(markdown: string, max = 400): string | undefined {
  const t = markdown.trim();
  if (!t) return undefined;
  return t.length > max ? `${t.slice(0, max).trimEnd()}…` : t;
}

// ---------------------------------------------------------------------------
// Search

/** `project = ENG`, `assignee in (…)`, `labels is EMPTY`, `ORDER BY created`… */
const FIELD = String.raw`^\s*(\w+|"[^"]+"|cf\[\d+\])`;
const JQL = [
  new RegExp(String.raw`${FIELD}\s*(!=|!~|>=|<=|=|~|>|<)`),
  new RegExp(String.raw`${FIELD}\s+(not\s+)?in\s*\(`, "i"),
  new RegExp(String.raw`${FIELD}\s+is\s+(not\s+)?(empty|null)\b`, "i"),
  /\border\s+by\s+\w+/i,
];

/** What to search when the user types `q`: JQL as is, else a text search on what they typed. */
export function jqlFor(q: string): string {
  const query = q.trim();
  if (!query) return "issuekey in issueHistory() ORDER BY lastViewed DESC";
  if (JQL.some((re) => re.test(query))) return query;
  const escaped = query.replace(/["\\]/g, "\\$&");
  // A trailing * matches the word being typed.
  const text = /\w$/.test(escaped) ? `${escaped}*` : escaped;
  return `text ~ "${text}" ORDER BY updated DESC`;
}

/** `ENG-123` (any case) as an issue key, if that is what was typed. */
export function asKey(q: string): string | undefined {
  const m = /^\s*([a-z][a-z0-9_]+-\d+)\s*$/i.exec(q);
  return m ? m[1].toUpperCase() : undefined;
}

// ---------------------------------------------------------------------------
// Live lists: a change made from one view reloads the lists still open.

const changes = new EventTarget();

export function notifyChanged() {
  changes.dispatchEvent(new Event("change"));
}

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

// ---------------------------------------------------------------------------
// Items

export interface Transition {
  id: string;
  name: string;
  to: { name: string; statusCategory: { key: string } };
  isAvailable?: boolean;
}

export function issueMetadata(issue: Issue, sprintFieldId?: string): Metadata[] {
  const f = issue.fields;
  const status = statusIcon(f.status);
  const prio = priorityLook(f.priority);
  const type = typeIcon(f.issuetype);
  const lines: Metadata[] = [
    meta.text("Status", f.status.name, { icon: status.source, color: status.tint }),
    meta.text("Type", f.issuetype.name, { icon: type.source, color: type.tint }),
    meta.text("Priority", f.priority?.name ?? "None", { icon: prio.icon, color: prio.tint }),
    f.assignee
      ? meta.person("Assignee", f.assignee.displayName, avatarOf(f.assignee))
      : meta.text("Assignee", "Unassigned", { icon: Icons.person }),
  ];
  const sprint = sprintOf(issue, sprintFieldId);
  if (sprint) {
    lines.push(meta.text("Sprint", sprint.name, {
      icon: Icons.cycle,
      color: sprint.state === "active" ? "blue" : undefined,
    }));
  }
  if (f.labels?.length) lines.push(meta.tags("Labels", f.labels));
  if (f.parent) {
    lines.push(meta.text("Parent", `${f.parent.key}${f.parent.fields?.summary ? ` ${f.parent.fields.summary}` : ""}`));
  }
  if (f.duedate) {
    lines.push(meta.text("Due", f.duedate, {
      icon: Icons.calendar,
      color: isOverdue(f.duedate) && f.status.statusCategory.key !== "done" ? "red" : undefined,
    }));
  }
  lines.push(meta.separator());
  lines.push(meta.text("Project", `${f.project.name} (${f.project.key})`, { icon: Icons.project }));
  if (f.reporter) lines.push(meta.person("Reporter", f.reporter.displayName, avatarOf(f.reporter)));
  lines.push(meta.text("Created", ago(f.created)));
  lines.push(meta.text("Updated", ago(f.updated)));
  return lines;
}

async function transitionsOf(a: Account, key: string): Promise<Transition[]> {
  const data = await jira<{ transitions: Transition[] }>(a, `/rest/api/3/issue/${key}/transitions`);
  return data.transitions.filter((t) => t.isAvailable !== false);
}

/** Transitions in workflow order: back to do, in progress, done. */
const WORKFLOW = ["new", "indeterminate", "done"];

export function transitionActions(a: Account, issue: Issue, transitions: Transition[]): Action[] {
  return transitions
    .sort((x, y) => WORKFLOW.indexOf(x.to.statusCategory.key) - WORKFLOW.indexOf(y.to.statusCategory.key))
    .map((t) => {
      const icon = statusIcon({ name: t.to.name, statusCategory: t.to.statusCategory as never });
      const title = t.name === t.to.name ? t.name : `${t.name} → ${t.to.name}`;
      return action(title, async () => {
        await jira(a, `/rest/api/3/issue/${issue.key}/transitions`, {
          method: "POST",
          body: { transition: { id: t.id } },
        });
        notifyChanged();
        await toast(`${issue.key}: ${t.to.name}`, { style: "success" });
      }, { icon: icon.source });
    });
}

export function issueActions(issue: Issue, ctx: Context, options: { page?: boolean; sprintField?: string } = {}) {
  const a = account(ctx.preferences);
  const url = issueUrl(a, issue.key);
  const actions: Action[] = [
    open(url, "Open in Jira"),
    ...(options.page ? [] : [action("Show Details", () => issuePage(issue, ctx, options.sprintField), {
      icon: Icons.info,
    })]),
    submenu("Change Status", async () => transitionActions(a, issue, await transitionsOf(a, issue.key)), {
      icon: Icons.inProgress,
      shortcut: "<Ctrl>s",
      section: "Issue",
    }),
    action("Assign to Me", async () => {
      await jira(a, `/rest/api/3/issue/${issue.key}/assignee`, {
        method: "PUT",
        body: { accountId: await myAccountId(a) },
      });
      notifyChanged();
      await toast(`${issue.key} assigned to you`, { style: "success" });
    }, { icon: Icons.person, shortcut: "<Ctrl><Shift>a", section: "Issue" }),
  ];
  if (issue.fields.assignee) {
    actions.push(action("Unassign", async () => {
      await jira(a, `/rest/api/3/issue/${issue.key}/assignee`, { method: "PUT", body: { accountId: null } });
      notifyChanged();
      await toast(`${issue.key} unassigned`, { style: "success" });
    }, { icon: Icons.cross, section: "Issue" }));
  }
  actions.push(
    copy(issue.key, "Copy Key", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${issue.key}: ${issue.fields.summary}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(branchName(issue), "Copy Branch Name", { icon: Icons.branch, section: "Copy" }),
  );
  return actions;
}

export function issuePage(issue: Issue, ctx: Context, sprintField?: string): DetailSpec {
  const body = adfToMarkdown(issue.fields.description) || "_No description._";
  return detail({
    title: issue.key,
    markdown: `# ${issue.fields.summary}\n\n${body}`,
    metadata: issueMetadata(issue, sprintField),
    status: `${issue.fields.project.name} · updated ${ago(issue.fields.updated)}`,
    actions: issueActions(issue, ctx, { page: true, sprintField }),
  });
}

export function issueItem(issue: Issue, ctx: Context, options: { section?: string; sprintField?: string } = {}): Item {
  const f = issue.fields;
  const prio = priorityLook(f.priority);
  const sprint = sprintOf(issue, options.sprintField);
  const accessories: Accessory[] = [
    { tag: f.status.name, color: statusColor(f.status.statusCategory.key) },
    ...(f.labels ?? []).slice(0, 2).map((l) => ({ tag: l })),
  ];
  if (sprint?.state === "active") accessories.push({ icon: Icons.cycle, tooltip: sprint.name });
  if (f.duedate) {
    accessories.push({
      icon: Icons.calendar,
      text: f.duedate.slice(5),
      color: isOverdue(f.duedate) ? "red" : undefined,
      tooltip: `Due ${f.duedate}`,
    });
  }
  accessories.push({ icon: { source: prio.icon, tint: prio.tint }, tooltip: f.priority?.name ?? "No priority" });
  if (f.assignee) accessories.push({ avatar: avatarOf(f.assignee), tooltip: f.assignee.displayName });
  accessories.push({ text: ago(f.updated), tooltip: "Updated" });
  return {
    id: issue.id,
    title: f.summary,
    subtitle: issue.key,
    icon: typeIcon(f.issuetype),
    section: options.section,
    keywords: [
      issue.key,
      f.status.name,
      f.issuetype.name,
      f.project.name,
      f.assignee?.displayName ?? "",
      sprint?.name ?? "",
      ...(f.labels ?? []),
    ].filter(Boolean),
    accessories,
    detail: { markdown: excerpt(adfToMarkdown(f.description)), metadata: issueMetadata(issue, options.sprintField) },
    actions: issueActions(issue, ctx, { sprintField: options.sprintField }),
  };
}

/** `POST /rest/api/3/search/jql` (the paginated search that replaced `/search`). */
export async function searchIssues(
  a: Account,
  jql: string,
  options: { sprintField?: string; max?: number; signal?: AbortSignal } = {},
): Promise<Issue[]> {
  const fields = options.sprintField ? [...FIELDS, options.sprintField] : FIELDS;
  const out: Issue[] = [];
  let nextPageToken: string | undefined;
  const max = options.max ?? 100;
  do {
    const page = await jira<{ issues: Issue[]; nextPageToken?: string; isLast?: boolean }>(
      a,
      "/rest/api/3/search/jql",
      {
        method: "POST",
        body: { jql, fields, maxResults: Math.min(50, max - out.length), nextPageToken },
        signal: options.signal,
      },
    );
    out.push(...page.issues);
    nextPageToken = page.isLast ? undefined : page.nextPageToken;
  } while (nextPageToken && out.length < max);
  return out;
}
