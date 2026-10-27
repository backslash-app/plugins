// Todoist API v1 helper and the mapping from tasks to launcher items.

import { action, copy, type Item, open, refresh, toast } from "@backslash/api";

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
}

export interface Project {
  id: string;
  name: string;
}

export const taskUrl = (id: string) => `https://app.todoist.com/app/task/${id}`;

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
  return date;
}

/** Time of day for tasks due at a precise time. */
export function dueTime(task: Task): string | undefined {
  const at = task.due?.datetime;
  if (!at) return undefined;
  const d = new Date(at);
  return isNaN(d.getTime()) ? undefined : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The API's priority 4 is the app's P1. */
const PRIORITY: Record<number, { tag: string; color: "red" | "orange" | "blue" }> = {
  4: { tag: "P1", color: "red" },
  3: { tag: "P2", color: "orange" },
  2: { tag: "P3", color: "blue" },
};

export function sortTasks(tasks: Task[]): Task[] {
  const due = (t: Task) => t.due?.datetime ?? t.due?.date ?? "9999";
  return [...tasks].sort((a, b) =>
    due(a).slice(0, 10).localeCompare(due(b).slice(0, 10)) || b.priority - a.priority || due(a).localeCompare(due(b))
  );
}

export function taskItem(
  task: Task,
  token: string,
  options: { section?: string; project?: string; now?: Date } = {},
): Item {
  const priority = PRIORITY[task.priority];
  const time = dueTime(task);
  const section = options.section ?? dueSection(task, options.now);
  return {
    id: task.id,
    title: task.content,
    subtitle: [options.project, task.description.split("\n")[0]].filter(Boolean).join(" · "),
    icon: "⭕",
    section: options.section,
    keywords: [...task.labels, options.project ?? "", task.due?.string ?? ""].filter(Boolean),
    accessories: [
      ...(priority ? [priority] : []),
      ...task.labels.map((l) => ({ text: `@${l}` })),
      ...(time ? [{ text: time }] : task.due && !options.section ? [{ text: section }] : []),
      ...(task.due?.is_recurring ? [{ icon: "view-refresh" }] : []),
    ],
    actions: [
      action("Complete Task", async () => {
        await todoist(token, `/tasks/${task.id}/close`, { method: "POST" });
        await toast(task.due?.is_recurring ? "Done, next occurrence scheduled" : "Completed", { style: "success" });
        return refresh();
      }, { icon: "object-select" }),
      open(taskUrl(task.id), "Open in Todoist"),
      copy(task.content, "Copy Task", { shortcut: "<Ctrl><Shift>c" }),
      copy(taskUrl(task.id), "Copy Link"),
    ],
  };
}
