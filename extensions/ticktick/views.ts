// Items, actions and the new task form.

import { type Action, action, copy, field, form, Icons, type Item, open, pop, submenu, toast } from "@backslash/api";
import type { Client } from "./api.ts";
import {
  checklist,
  colorOf,
  dateFields,
  dueChoices,
  dueOf,
  findProject,
  INBOX,
  parseQuickAdd,
  parseWhen,
  PRIORITIES,
  priorityOf,
  type Project,
  repeatText,
  shortDue,
  type Task,
  taskMarkdown,
  taskMetadata,
  taskSection,
  taskUrl,
} from "./lib.ts";
import { notifyChanged } from "./live.ts";

async function edit(api: Client, task: Task, fields: Record<string, unknown>, message: string) {
  await api.call("POST", `/task/${task.id}`, { id: task.id, projectId: task.projectId, ...fields });
  notifyChanged();
  await toast(message, { style: "success" });
}

export function taskActions(api: Client, task: Task, projects: Project[]): Action[] {
  return [
    action("Complete Task", async () => {
      await api.call("POST", `/project/${task.projectId}/task/${task.id}/complete`);
      notifyChanged();
      await toast(task.repeatFlag ? "Done, next one scheduled" : `Completed “${task.title}”`, { style: "success" });
    }, { icon: Icons.squareCheck }),
    open(taskUrl(task), "Open in TickTick"),
    submenu(
      "Change Due Date",
      dueChoices().filter((c) => c.date).map((c) =>
        action(c.title, () => {
          const when = parseWhen(c.date!)!;
          // Keep the time of day of a task due at a time.
          const due = dueOf(task);
          if (due?.time) when.date.setHours(due.date.getHours(), due.date.getMinutes());
          return edit(api, task, dateFields({ date: when.date, time: !!due?.time }), `Due ${c.title.toLowerCase()}`);
        }, { icon: Icons.calendar })
      ),
      { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
    ),
    submenu(
      "Set Priority",
      PRIORITIES.map((p) =>
        action(p.name, () => edit(api, task, { priority: p.value }, `Priority ${p.name.toLowerCase()}`), {
          icon: Icons.flag,
        })
      ),
      { icon: Icons.flag, shortcut: "<Ctrl>p", section: "Task" },
    ),
    action("New Task…", () => taskForm(api, projects, { project: task.projectId }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Task",
    }),
    copy(task.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(taskUrl(task), "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    action("Delete Task", async () => {
      await api.call("DELETE", `/project/${task.projectId}/task/${task.id}`);
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

export function taskItem(api: Client, task: Task, projects: Project[], now = new Date()): Item {
  const project = projects.find((p) => p.id === task.projectId);
  const due = dueOf(task);
  const prio = priorityOf(task.priority);
  const list = checklist(task);
  const section = taskSection(task, now);
  return {
    id: task.id,
    title: task.title || "Untitled",
    subtitle: (task.content || task.desc || "").split("\n")[0].replace(/[*_`#>]/g, "").trim().slice(0, 80) || undefined,
    icon: { source: Icons.square, tint: prio.color },
    section,
    keywords: [project?.name ?? "", ...(task.tags ?? [])].filter(Boolean),
    accessories: [
      ...(list.total
        ? [{
          icon: Icons.squareCheck,
          text: `${list.done}/${list.total}`,
          color: list.done === list.total ? "green" as const : undefined,
          tooltip: "Checklist",
        }]
        : []),
      ...(task.repeatFlag ? [{ icon: Icons.repeat, tooltip: repeatText(task.repeatFlag) }] : []),
      ...(due
        ? [{
          icon: Icons.calendar,
          // In "Today", the time says more than "today".
          text: section === "Today" && !due.time ? "today" : shortDue(due.date, now, due.time).replace(/^today /, ""),
          color: section === "Overdue" ? "red" as const : undefined,
          tooltip: "Due",
        }]
        : []),
      ...(project ? [{ icon: { source: Icons.dot, tint: colorOf(project.color) }, text: project.name }] : []),
    ],
    detail: { markdown: taskMarkdown(task), metadata: taskMetadata(task, project, now) },
    actions: taskActions(api, task, projects),
  };
}

export async function createTask(api: Client, projects: Project[], text: string, projectId?: string) {
  const q = parseQuickAdd(text);
  const named = findProject(projects, q.project);
  if (q.project && !named) throw new Error(`No TickTick list “${q.project}”`);
  const target = named?.id ?? projectId;
  const task = await api.call<Task>("POST", "/task", {
    title: q.title,
    priority: q.priority,
    // Without a list, TickTick files it in the inbox.
    ...(target && target !== INBOX.id && !/^inbox/.test(target) ? { projectId: target } : {}),
    ...(q.when ? dateFields(q.when) : {}),
  });
  notifyChanged();
  const where = named?.name ?? projects.find((p) => p.id === (target ?? task.projectId))?.name ?? "Inbox";
  const when = q.when ? ` · ${shortDue(q.when.date, new Date(), q.when.time)}` : "";
  return { task, summary: `Added “${q.title}” to ${where}${when}` };
}

export function taskForm(api: Client, projects: Project[], options: { project?: string } = {}) {
  return form({
    title: "New TickTick task",
    submitTitle: "Add Task",
    fields: [
      field.text("title", "Task", {
        required: true,
        placeholder: "Call Bob tomorrow 3pm !high: dates and priority are understood",
      }),
      field.dropdown("project", "List", projects.map((p) => ({ value: p.id, title: p.name })), {
        value: options.project ?? projects[0]?.id,
      }),
    ],
    async submit(values) {
      const { summary } = await createTask(api, projects, String(values.title), String(values.project));
      await toast(summary, { style: "success" });
      return pop();
    },
  });
}
