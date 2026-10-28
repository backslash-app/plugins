// Todoist API v1 helper and the mapping from tasks to launcher items.

import {
  type Action,
  action,
  type Color,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";

export const API = "https://api.todoist.com/api/v1";

export async function todoist<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Todoist rejected the token: check it in Settings → Extensions → Todoist");
  }
  if (!res.ok) throw new Error(`Todoist answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? undefined as T : await res.json() as T;
}

/** Follows `next_cursor` through every page. */
export async function all<T>(token: string, path: string, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null = null;
  do {
    const sep = path.includes("?") ? "&" : "?";
    const url: string = cursor ? `${path}${sep}cursor=${encodeURIComponent(cursor)}` : `${path}${sep}limit=200`;
    const page: { results: T[]; next_cursor: string | null } = await todoist(token, url, { signal });
    out.push(...page.results);
    cursor = page.next_cursor;
  } while (cursor && out.length < 2000);
  return out;
}

export interface Task {
  id: string;
  content: string;
  description: string;
  priority: number;
  project_id: string;
  labels: string[];
  due: { date: string; string: string; is_recurring: boolean; datetime?: string | null } | null;
  duration?: { amount: number; unit: string } | null;
  added_at?: string | null;
  note_count?: number;
}

export interface Project {
  id: string;
  name: string;
  color?: string;
  is_inbox_project?: boolean;
}

export const taskUrl = (id: string) => `https://app.todoist.com/app/task/${id}`;

/** Todoist's project colors, as the launcher's palette. */
const PROJECT_COLORS: Record<string, Color> = {
  berry_red: "pink",
  red: "red",
  orange: "orange",
  yellow: "yellow",
  olive_green: "green",
  lime_green: "green",
  green: "green",
  mint_green: "teal",
  teal: "teal",
  sky_blue: "blue",
  light_blue: "blue",
  blue: "blue",
  grape: "purple",
  violet: "purple",
  lavender: "purple",
  magenta: "pink",
  salmon: "orange",
  charcoal: "gray",
  grey: "gray",
  taupe: "gray",
};

export const projectColor = (p: Project | undefined): Color => PROJECT_COLORS[p?.color ?? ""] ?? "gray";

/** `YYYY-MM-DD` in local time. */
export function localDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "Overdue", "Today", "Tomorrow", a weekday this week, or the date. */
export function dueSection(task: Task, now = new Date()): string {
  if (!task.due) return "No date";
  const today = localDate(now);
  const date = task.due.date.slice(0, 10);
  if (date < today) return "Overdue";
  if (date === today) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date === localDate(tomorrow)) return "Tomorrow";
  const d = new Date(`${date}T12:00:00`);
  const days = Math.round((d.getTime() - now.getTime()) / 86_400_000);
  if (days < 7) return d.toLocaleDateString("en", { weekday: "long" });
  return d.toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short" });
}

/** Time of day for tasks due at a precise time. */
export function dueTime(task: Task): string | undefined {
  const at = task.due?.datetime;
  if (!at) return undefined;
  const d = new Date(at);
  return isNaN(d.getTime()) ? undefined : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The API's priority 4 is the app's P1. */
const PRIORITY: Record<number, { name: string; color: Color }> = {
  4: { name: "P1", color: "red" },
  3: { name: "P2", color: "orange" },
  2: { name: "P3", color: "blue" },
  1: { name: "P4", color: "gray" },
};

export const priorityOf = (n: number) => PRIORITY[n] ?? PRIORITY[1];

export function sortTasks(tasks: Task[]): Task[] {
  const due = (t: Task) => t.due?.datetime ?? t.due?.date ?? "9999";
  return [...tasks].sort((a, b) =>
    due(a).slice(0, 10).localeCompare(due(b).slice(0, 10)) || b.priority - a.priority || due(a).localeCompare(due(b))
  );
}

function overdue(task: Task, now = new Date()): boolean {
  return !!task.due && task.due.date.slice(0, 10) < localDate(now);
}

export function taskMetadata(task: Task, project: Project | undefined, now = new Date()): Metadata[] {
  const p = priorityOf(task.priority);
  const lines: Metadata[] = [];
  if (task.due) {
    const when = [dueSection(task, now), dueTime(task)].filter(Boolean).join(" at ");
    lines.push(meta.text("Due", when, { icon: Icons.calendar, color: overdue(task, now) ? "red" : undefined }));
    if (task.due.is_recurring) lines.push(meta.text("Repeats", task.due.string, { icon: Icons.refresh }));
  } else {
    lines.push(meta.text("Due", "No date", { icon: Icons.calendar }));
  }
  lines.push(meta.text("Priority", p.name, { icon: Icons.flag, color: p.color === "gray" ? undefined : p.color }));
  if (project) lines.push(meta.text("Project", project.name, { icon: Icons.dot, color: projectColor(project) }));
  if (task.labels.length) lines.push(meta.tags("Labels", task.labels));
  if (task.duration) lines.push(meta.text("Duration", `${task.duration.amount} ${task.duration.unit}`));
  if (task.note_count) lines.push(meta.text("Comments", task.note_count, { icon: Icons.comment }));
  return lines;
}

async function edit(token: string, task: Task, body: Record<string, unknown>, message: string) {
  await todoist(token, `/tasks/${task.id}`, { method: "POST", body });
  await toast(message, { style: "success" });
  return refresh();
}

export function taskActions(task: Task, token: string): Action[] {
  return [
    action("Complete Task", async () => {
      await todoist(token, `/tasks/${task.id}/close`, { method: "POST" });
      await toast(task.due?.is_recurring ? "Done, next one scheduled" : "Completed", { style: "success" });
      return refresh();
    }, { icon: Icons.check }),
    open(taskUrl(task.id), "Open in Todoist"),
    submenu(
      "Reschedule",
      [
        ["Today", "today"],
        ["Tomorrow", "tomorrow"],
        ["This Weekend", "saturday"],
        ["Next Week", "next monday"],
        ["No Date", "no date"],
      ].map(([title, due]) =>
        action(title, () => edit(token, task, { due_string: due }, `Moved to ${title.toLowerCase()}`), {
          icon: Icons.calendar,
        })
      ),
      { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
    ),
    submenu(
      "Set Priority",
      [4, 3, 2, 1].map((n) =>
        action(priorityOf(n).name, () => edit(token, task, { priority: n }, `Priority ${priorityOf(n).name}`), {
          icon: Icons.flag,
        })
      ),
      { icon: Icons.flag, shortcut: "<Ctrl>p", section: "Task" },
    ),
    copy(task.content, "Copy Task", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(taskUrl(task.id), "Copy Link", { section: "Copy" }),
    action("Delete Task", async () => {
      await todoist(token, `/tasks/${task.id}`, { method: "DELETE" });
      await toast("Deleted", { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: "Delete this task?",
      section: "Danger",
      shortcut: "<Ctrl>Delete",
    }),
  ];
}

export function taskItem(
  task: Task,
  token: string,
  options: { section?: string; project?: Project; now?: Date } = {},
): Item {
  const p = priorityOf(task.priority);
  const time = dueTime(task);
  const now = options.now ?? new Date();
  const when = time ?? (task.due && !options.section ? dueSection(task, now) : undefined);
  return {
    id: task.id,
    title: task.content,
    subtitle: task.description.split("\n")[0] || undefined,
    icon: { source: Icons.todo, tint: p.color },
    section: options.section,
    keywords: [...task.labels, options.project?.name ?? "", task.due?.string ?? ""].filter(Boolean),
    accessories: [
      ...task.labels.slice(0, 2).map((l) => ({ text: `@${l}` })),
      ...(task.due?.is_recurring ? [{ icon: Icons.refresh, tooltip: task.due.string }] : []),
      ...(when
        ? [{ text: when, color: overdue(task, now) ? "red" as const : time ? "green" as const : undefined }]
        : []),
      ...(options.project
        ? [{ icon: { source: Icons.dot, tint: projectColor(options.project) }, text: options.project.name }]
        : []),
    ],
    detail: {
      markdown: task.description || undefined,
      metadata: taskMetadata(task, options.project, now),
    },
    actions: taskActions(task, token),
  };
}
