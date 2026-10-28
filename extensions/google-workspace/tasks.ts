// Google Tasks: loading, items, actions and the new task form.

import { type Action, action, copy, field, form, Icons, type Item, open, pop, submenu, toast } from "@backslash/api";
import type { Client } from "./api.ts";
import {
  type Bucket,
  dueBucket,
  dueOf,
  findList,
  googleDue,
  parseQuickAdd,
  shortDue,
  type Task,
  type TaskList,
  taskMarkdown,
  taskMetadata,
  TASKS,
  TASKS_URL,
} from "./lib.ts";
import { notifyChanged } from "./live.ts";

/** Runs `fn` on every item, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

export async function loadLists(api: Client, signal?: AbortSignal): Promise<TaskList[]> {
  const res = await api.get<{ items?: TaskList[] }>(`${TASKS}/users/@me/lists`, { maxResults: "100" }, signal);
  return res.items ?? [];
}

/** Every open task of every list, each tagged with its list. */
export async function loadTasks(api: Client, lists: TaskList[], signal?: AbortSignal): Promise<Task[]> {
  const per = await pool(lists, 4, async (l) => {
    const out: Task[] = [];
    let pageToken = "";
    do {
      const res: { items?: Task[]; nextPageToken?: string } = await api.get(
        `${TASKS}/lists/${encodeURIComponent(l.id)}/tasks`,
        { showCompleted: "false", showHidden: "false", maxResults: "100", ...(pageToken ? { pageToken } : {}) },
        signal,
      );
      out.push(...(res.items ?? []).map((t) => ({ ...t, listId: l.id })));
      pageToken = res.nextPageToken ?? "";
    } while (pageToken && out.length < 500);
    return out;
  });
  return per.flat();
}

const taskUrl = (t: Task) => `${TASKS}/lists/${encodeURIComponent(t.listId ?? "")}/tasks/${encodeURIComponent(t.id)}`;

async function edit(api: Client, task: Task, body: unknown, message: string) {
  await api.send("PATCH", taskUrl(task), body);
  notifyChanged();
  await toast(message, { style: "success" });
}

const day = (offset: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
};

export const DUE_CHOICES = [
  { value: "none", title: "No due date" },
  { value: "0", title: "Today" },
  { value: "1", title: "Tomorrow" },
  { value: "next-week", title: "Next week" },
] as const;

function dueChoice(value: string): Date | undefined {
  if (value === "none" || value === "") return undefined;
  if (value === "next-week") return day((8 - new Date().getDay()) % 7 || 7);
  return day(Number(value));
}

export function taskActions(api: Client, task: Task, lists: TaskList[]): Action[] {
  return [
    action("Complete Task", () => edit(api, task, { status: "completed" }, `Completed “${task.title}”`), {
      icon: Icons.squareCheck,
    }),
    open(task.webViewLink || TASKS_URL, "Open in Google Tasks"),
    submenu(
      "Set Due Date",
      DUE_CHOICES.map((c) =>
        action(c.title, () => {
          const due = dueChoice(c.value);
          return edit(api, task, { due: due ? googleDue(due) : null }, due ? `Due ${shortDue(due)}` : "No due date");
        }, { icon: Icons.calendar })
      ),
      { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
    ),
    ...(lists.length > 1 && !task.parent
      ? [submenu(
        "Move to List",
        lists.filter((l) => l.id !== task.listId).map((l) =>
          action(l.title, async () => {
            // Tasks.move takes a destination list.
            await api.send(
              "POST",
              `${taskUrl(task)}/move?destinationTasklist=${encodeURIComponent(l.id)}`,
            );
            notifyChanged();
            await toast(`Moved to ${l.title}`, { style: "success" });
          }, { icon: Icons.inbox })
        ),
        { icon: Icons.inbox, section: "Task" },
      )]
      : []),
    action("New Task…", () => taskForm(api, lists, { list: task.listId }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Task",
    }),
    copy(task.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(task.notes?.trim() ? [copy(task.notes.trim(), "Copy Notes", { section: "Copy" })] : []),
    action("Delete Task", async () => {
      await api.send("DELETE", taskUrl(task));
      notifyChanged();
      await toast("Deleted", { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${task.title}”?`,
      shortcut: "<Ctrl><Shift>Delete",
      section: "Danger",
    }),
  ];
}

export function taskItem(
  api: Client,
  task: Task,
  lists: TaskList[],
  options: { parent?: Task; now?: Date; section?: string } = {},
): Item {
  const now = options.now ?? new Date();
  const list = lists.find((l) => l.id === task.listId);
  const due = dueOf(task);
  const bucket: Bucket = dueBucket(due, now);
  const note = (task.notes ?? "").split("\n")[0].trim();
  return {
    id: task.id,
    title: `${options.parent ? "↳ " : ""}${task.title || "Untitled"}`,
    subtitle: note.slice(0, 80) || undefined,
    icon: { source: Icons.square, tint: bucket === "Overdue" ? "red" : undefined },
    section: options.section ?? bucket,
    keywords: [list?.title ?? "", options.parent?.title ?? ""].filter(Boolean),
    accessories: [
      ...(task.notes?.trim() ? [{ icon: Icons.note, tooltip: "Notes" }] : []),
      ...((task.links ?? []).length ? [{ icon: Icons.link, tooltip: "Linked" }] : []),
      ...(due
        ? [{
          icon: Icons.calendar,
          text: shortDue(due, now),
          color: bucket === "Overdue" ? "red" as const : bucket === "Today" ? "blue" as const : undefined,
          tooltip: "Due",
        }]
        : []),
      ...(list && lists.length > 1 ? [{ icon: Icons.inbox, text: list.title }] : []),
    ],
    detail: { markdown: taskMarkdown(task), metadata: taskMetadata(task, list, options.parent, now) },
    actions: taskActions(api, task, lists),
  };
}

/** Adds a task from quick-add text ("Send invoice friday #Work"). */
export async function createTask(
  api: Client,
  lists: TaskList[],
  values: { text: string; list?: string; due?: Date; notes?: string },
): Promise<string> {
  const q = parseQuickAdd(values.text);
  if (!q.title) throw new Error("Type the task's title");
  const named = findList(lists, q.list);
  if (q.list && !named) throw new Error(`No Google Tasks list “${q.list}”`);
  const target = named ?? lists.find((l) => l.id === values.list) ?? lists[0];
  if (!target) throw new Error("No Google Tasks list found");
  const due = q.due ?? values.due;
  await api.send("POST", `${TASKS}/lists/${encodeURIComponent(target.id)}/tasks`, {
    title: q.title,
    ...(due ? { due: googleDue(due) } : {}),
    ...(values.notes?.trim() ? { notes: values.notes.trim() } : {}),
  });
  notifyChanged();
  return `Added “${q.title}” to ${target.title}${due ? ` · due ${shortDue(due)}` : ""}`;
}

export function taskForm(api: Client, lists: TaskList[], options: { list?: string; title?: string } = {}) {
  return form({
    title: "New Google task",
    submitTitle: "Add Task",
    fields: [
      field.text("title", "Task", {
        required: true,
        value: options.title ?? "",
        placeholder: "Send invoice friday: dates are understood",
      }),
      field.dropdown("list", "List", lists.map((l) => ({ value: l.id, title: l.title })), {
        value: options.list ?? lists[0]?.id,
      }),
      field.dropdown("due", "Due", DUE_CHOICES.map((c) => ({ value: c.value, title: c.title })), { value: "none" }),
      field.textArea("notes", "Notes"),
    ],
    async submit(values) {
      const summary = await createTask(api, lists, {
        text: String(values.title),
        list: String(values.list),
        due: dueChoice(String(values.due)),
        notes: String(values.notes ?? ""),
      });
      await toast(summary, { style: "success" });
      return pop();
    },
  });
}
