// Linear GraphQL helper and the mapping from issues to launcher items.

import { action, copy, type Item, open, type View } from "@backslash/api";

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
  id identifier title url priority priorityLabel updatedAt
  state { id name type }
  team { id key name }
  project { name }
  assignee { name }
`;

export interface Issue {
  id: string;
  identifier: string;
  title: string;
  url: string;
  priority: number;
  priorityLabel: string;
  updatedAt: string;
  state: { id: string; name: string; type: string };
  team: { id: string; key: string; name: string };
  project?: { name: string } | null;
  assignee?: { name: string } | null;
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

const PRIORITY_COLOR: Record<number, "red" | "orange" | "yellow" | "blue"> = {
  1: "red",
  2: "orange",
  3: "yellow",
  4: "blue",
};

const STATE_ICON: Record<string, string> = {
  started: "🟡",
  unstarted: "⚪",
  backlog: "◌",
  triage: "🔶",
  completed: "✅",
  canceled: "⛔",
};

export function issueItem(
  issue: Issue,
  options: { section?: string; moveTo?: (issue: Issue) => Promise<View> } = {},
): Item {
  const where = [issue.team.key, issue.project?.name].filter(Boolean).join(" · ");
  const actions = [
    open(issue.url, "Open in Linear"),
    copy(issue.identifier, "Copy Identifier", { shortcut: "<Ctrl>period" }),
    copy(issue.url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
    copy(`[${issue.identifier}: ${issue.title}](${issue.url})`, "Copy as Markdown Link"),
  ];
  if (options.moveTo) {
    const moveTo = options.moveTo;
    actions.splice(1, 0, action("Change Status…", () => moveTo(issue), { icon: "go-next", shortcut: "<Ctrl>s" }));
  }
  return {
    id: issue.id,
    title: issue.title,
    subtitle: where,
    icon: STATE_ICON[issue.state.type] ?? "📐",
    section: options.section,
    keywords: [issue.identifier, issue.state.name, issue.team.name, issue.assignee?.name ?? ""].filter(Boolean),
    accessories: [
      ...(issue.priority ? [{ tag: issue.priorityLabel, color: PRIORITY_COLOR[issue.priority] }] : []),
      { text: issue.identifier },
    ],
    actions,
  };
}

export const PRIORITIES = [
  { value: "0", title: "No priority" },
  { value: "1", title: "Urgent" },
  { value: "2", title: "High" },
  { value: "3", title: "Medium" },
  { value: "4", title: "Low" },
];

// Views of this extension run in one process: a change made in one view
// (a new status) reloads the lists still open under it.
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
