// Microsoft To Do: loading, items, actions and the new task form.

import { type Action, action, copy, field, form, Icons, type Item, open, pop, submenu, toast } from "@backslash/api";
import { all, type Client } from "./api.ts";
import {
  type Bucket,
  dueBucket,
  dueOf,
  findList,
  graphDue,
  IMPORTANCE,
  parseQuickAdd,
  shortDue,
  sortLists,
  taskMarkdown,
  taskMetadata,
  taskNotes,
  type TodoList,
  type TodoTask,
  todoUrl,
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

export async function loadLists(api: Client, signal?: AbortSignal): Promise<TodoList[]> {
  return sortLists(await all<TodoList>(api, "/me/todo/lists?$top=100", signal));
}

/** Every open task of every list, each tagged with its list. */
export async function loadTasks(api: Client, lists: TodoList[], signal?: AbortSignal): Promise<TodoTask[]> {
  const q = new URLSearchParams({ $filter: "status ne 'completed'", $top: "100", $expand: "checklistItems" });
  const per = await pool(
    lists,
    4,
    async (l) =>
      (await all<TodoTask>(api, `/me/todo/lists/${encodeURIComponent(l.id)}/tasks?${q}`, signal, 300))
        .map((t) => ({ ...t, listId: l.id })),
  );
  return per.flat();
}

const taskPath = (t: TodoTask) =>
  `/me/todo/lists/${encodeURIComponent(t.listId ?? "")}/tasks/${encodeURIComponent(t.id)}`;

async function edit(api: Client, task: TodoTask, body: unknown, message: string) {
  await api.send("PATCH", taskPath(task), body);
  notifyChanged();
  await toast(message, { style: "success" });
}

const day = (offset: number) => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offset);
};

export const DUE_CHOICES = [
  { value: "", title: "No due date" },
  { value: "0", title: "Today" },
  { value: "1", title: "Tomorrow" },
  { value: "next-week", title: "Next week" },
] as const;

function dueChoice(value: string): Date | undefined {
  if (value === "") return undefined;
  if (value === "next-week") {
    const now = new Date();
    return day((8 - now.getDay()) % 7 || 7);
  }
  return day(Number(value));
}

export function taskActions(api: Client, task: TodoTask, lists: TodoList[], tenant: unknown): Action[] {
  const list = lists.find((l) => l.id === task.listId);
  return [
    action("Complete Task", () => edit(api, task, { status: "completed" }, `Completed “${task.title}”`), {
      icon: Icons.squareCheck,
    }),
    open(todoUrl(tenant), "Open Microsoft To Do"),
    submenu(
      "Set Due Date",
      DUE_CHOICES.map((c) =>
        action(c.title, () => {
          const due = dueChoice(c.value);
          return edit(
            api,
            task,
            { dueDateTime: due ? graphDue(due) : null },
            due ? `Due ${shortDue(due)}` : "No due date",
          );
        }, { icon: Icons.calendar })
      ),
      { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
    ),
    submenu(
      "Set Importance",
      IMPORTANCE.map((i) =>
        action(i.title, () => edit(api, task, { importance: i.value }, `Importance ${i.title.toLowerCase()}`), {
          icon: i.value === "high" ? Icons.starFilled : Icons.star,
        })
      ),
      { icon: Icons.star, shortcut: "<Ctrl>i", section: "Task" },
    ),
    ...(lists.length > 1
      ? [submenu(
        "Move to List",
        lists.filter((l) => l.id !== task.listId && l.wellknownListName !== "flaggedEmails").map((l) =>
          action(l.displayName, async () => {
            // Graph has no move: recreate the task in the other list, then delete the original.
            await api.send("POST", `/me/todo/lists/${encodeURIComponent(l.id)}/tasks`, {
              title: task.title,
              importance: task.importance,
              status: task.status,
              ...(task.dueDateTime ? { dueDateTime: task.dueDateTime } : {}),
              ...(task.body?.content ? { body: task.body } : {}),
              ...(task.categories?.length ? { categories: task.categories } : {}),
            });
            await api.send("DELETE", taskPath(task));
            notifyChanged();
            await toast(`Moved to ${l.displayName}`, { style: "success" });
          }, { icon: Icons.inbox })
        ),
        { icon: Icons.inbox, section: "Task" },
      )]
      : []),
    action("New Task…", () => taskForm(api, lists, { list: list?.id }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Task",
    }),
    copy(task.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    ...(taskNotes(task) ? [copy(taskNotes(task), "Copy Notes", { section: "Copy" })] : []),
    action("Delete Task", async () => {
      await api.send("DELETE", taskPath(task));
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
  task: TodoTask,
  lists: TodoList[],
  options: { tenant: unknown; section?: string; now?: Date },
): Item {
  const now = options.now ?? new Date();
  const list = lists.find((l) => l.id === task.listId);
  const due = dueOf(task);
  const bucket: Bucket = dueBucket(due, now);
  const steps = task.checklistItems ?? [];
  const done = steps.filter((s) => s.isChecked).length;
  const notes = taskNotes(task).split("\n")[0].trim();
  return {
    id: task.id,
    title: task.title || "Untitled",
    subtitle: notes.slice(0, 80) || undefined,
    icon: {
      source: task.status === "inProgress" ? Icons.inProgress : Icons.square,
      tint: task.importance === "high" ? "red" : undefined,
    },
    section: options.section ?? bucket,
    keywords: [list?.displayName ?? "", ...(task.categories ?? [])].filter(Boolean),
    accessories: [
      ...(task.importance === "high"
        ? [{ icon: { source: Icons.starFilled, tint: "red" as const }, tooltip: "Important" }]
        : []),
      ...(steps.length
        ? [{
          icon: Icons.squareCheck,
          text: `${done}/${steps.length}`,
          color: done === steps.length ? "green" as const : undefined,
          tooltip: "Steps",
        }]
        : []),
      ...(task.isReminderOn ? [{ icon: Icons.bell, tooltip: "Reminder" }] : []),
      ...(due
        ? [{
          icon: Icons.calendar,
          text: shortDue(due, now),
          color: bucket === "Overdue" ? "red" as const : bucket === "Today" ? "blue" as const : undefined,
          tooltip: "Due",
        }]
        : []),
      ...(list && lists.length > 1 ? [{ icon: Icons.inbox, text: list.displayName }] : []),
    ],
    detail: { markdown: taskMarkdown(task), metadata: taskMetadata(task, list, now) },
    actions: taskActions(api, task, lists, options.tenant),
  };
}

/** Adds a task from quick-add text ("Call Bob tomorrow !high #Work"). */
export async function createTask(
  api: Client,
  lists: TodoList[],
  values: { text: string; list?: string; due?: Date; importance?: string; notes?: string },
): Promise<string> {
  const q = parseQuickAdd(values.text);
  if (!q.title) throw new Error("Type the task's title");
  const named = findList(lists, q.list);
  if (q.list && !named) throw new Error(`No To Do list “${q.list}”`);
  const target = named ?? lists.find((l) => l.id === values.list) ??
    lists.find((l) => l.wellknownListName === "defaultList") ??
    lists[0];
  if (!target) throw new Error("No To Do list found");
  const due = q.due ?? values.due;
  await api.send("POST", `/me/todo/lists/${encodeURIComponent(target.id)}/tasks`, {
    title: q.title,
    importance: q.importance ?? values.importance ?? "normal",
    ...(due ? { dueDateTime: graphDue(due) } : {}),
    ...(values.notes?.trim() ? { body: { content: values.notes.trim(), contentType: "text" } } : {}),
  });
  notifyChanged();
  return `Added “${q.title}” to ${target.displayName}${due ? ` · due ${shortDue(due)}` : ""}`;
}

export function taskForm(api: Client, lists: TodoList[], options: { list?: string; title?: string } = {}) {
  const writable = lists.filter((l) => l.wellknownListName !== "flaggedEmails");
  return form({
    title: "New To Do task",
    submitTitle: "Add Task",
    fields: [
      field.text("title", "Task", {
        required: true,
        value: options.title ?? "",
        placeholder: "Call Bob tomorrow !high: dates and importance are understood",
      }),
      field.dropdown("list", "List", writable.map((l) => ({ value: l.id, title: l.displayName })), {
        value: options.list && writable.some((l) => l.id === options.list) ? options.list : writable[0]?.id,
      }),
      field.dropdown("due", "Due", DUE_CHOICES.map((c) => ({ value: c.value || "none", title: c.title })), {
        value: "none",
      }),
      field.dropdown("importance", "Importance", IMPORTANCE.map((i) => ({ value: i.value, title: i.title })), {
        value: "normal",
      }),
      field.textArea("notes", "Notes"),
    ],
    async submit(values) {
      const due = values.due === "none" ? undefined : dueChoice(String(values.due));
      const summary = await createTask(api, lists, {
        text: String(values.title),
        list: String(values.list),
        due,
        importance: String(values.importance),
        notes: String(values.notes ?? ""),
      });
      await toast(summary, { style: "success" });
      return pop();
    },
  });
}

export const isToday = (t: TodoTask, now = new Date()) => {
  const b = dueBucket(dueOf(t), now);
  return b === "Today" || b === "Overdue";
};
