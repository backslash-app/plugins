// Rows, actions and the new task form.

import { type Action, action, copy, field, form, Icons, type Item, open, pop, submenu, toast } from "@backslash/api";
import { type Client, quickAdd, taskUrl, update } from "./api.ts";
import {
  apiDate,
  bucketOf,
  colorOf,
  dueOf,
  htmlToText,
  isRepeating,
  onDay,
  PRIORITIES,
  priorityOf,
  type Project,
  projectPath,
  rescheduleChoices,
  SetupError,
  shortDue,
  type Task,
  taskMetadata,
  usableProjects,
} from "./lib.ts";
import { notifyChanged } from "./live.ts";

export function setupItems(e: SetupError): Item[] {
  return [{
    id: "setup",
    title: e.message,
    subtitle: "Settings → Extensions → Vikunja",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Vikunja",
        "",
        "1. In Vikunja, open **Settings → API Tokens → Create a token**.",
        "2. Give it the **tasks**, **projects** and **labels** permissions (read and write: *read all*,",
        "   *update*, *create*, *delete*), and an expiry date that suits you.",
        "3. In **Settings → Extensions → Vikunja → Configure**, paste it as **API token**, with the",
        "   **Server address** you open Vikunja at (`https://app.vikunja.cloud` for Vikunja Cloud).",
        "",
        "Self-hosted servers can be on this computer, your local network (`*.lan`, `*.local`, `192.168.x.x`…)",
        "or Tailscale (`*.ts.net`): an extension declares in advance the hosts it may reach.",
      ].join("\n"),
    },
    actions: [open("https://vikunja.io/docs/api-tokens/", "Open Vikunja Docs", { icon: Icons.book })],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return setupItems(e);
    throw e;
  }
}

async function edit(api: Client, task: Task, changes: Partial<Task>, message: string) {
  await update(api, task, changes);
  notifyChanged();
  await toast(message, { style: "success", message: task.title });
}

export function taskActions(api: Client, task: Task, projects: Project[], prefs: Record<string, unknown>): Action[] {
  const url = taskUrl(api, task);
  const due = dueOf(task);
  return [
    action("Complete Task", async () => {
      await update(api, task, { done: true });
      notifyChanged();
      await toast(isRepeating(task) ? "Done, next one scheduled" : "Completed", {
        style: "success",
        message: task.title,
      });
    }, { icon: Icons.squareCheck }),
    open(url, "Open in Vikunja"),
    submenu(
      "Reschedule",
      rescheduleChoices().map((c) =>
        action(c.title, () =>
          edit(
            api,
            task,
            { due_date: apiDate(c.date ? onDay(c.date, due) : null) },
            c.date ? `Due ${c.title.toLowerCase()}` : "No due date",
          ), { icon: c.date ? Icons.calendar : Icons.cross })
      ),
      { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
    ),
    submenu(
      "Set Priority",
      PRIORITIES.map((p) =>
        action(p.name, () => edit(api, task, { priority: p.value }, `Priority ${p.name.toLowerCase()}`), {
          icon: p.icon,
        })
      ),
      { icon: Icons.flag, shortcut: "<Ctrl>p", section: "Task" },
    ),
    action(task.is_favorite ? "Remove from Favorites" : "Add to Favorites", () =>
      edit(
        api,
        task,
        { is_favorite: !task.is_favorite },
        task.is_favorite ? "Removed from favorites" : "Added to favorites",
      ), { icon: task.is_favorite ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>f", section: "Task" }),
    action("New Task…", () => taskForm(api, projects, prefs, task.project_id), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Task",
    }),
    copy(task.title, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
    copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    action("Delete Task", async () => {
      await api.call("DELETE", `/tasks/${task.id}`);
      notifyChanged();
      await toast("Deleted", { style: "success", message: task.title });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${task.title}”? This can't be undone.`,
      shortcut: "<Ctrl><Shift>Delete",
      section: "Danger",
    }),
  ];
}

export function taskItem(
  api: Client,
  task: Task,
  projects: Project[],
  prefs: Record<string, unknown>,
  o: { section?: string; showProject?: boolean; now?: Date } = {},
): Item {
  const now = o.now ?? new Date();
  const project = projects.find((p) => p.id === task.project_id);
  const path = projectPath(project, projects);
  const due = dueOf(task);
  const prio = priorityOf(task.priority);
  const bucket = bucketOf(task, now);
  const description = htmlToText(task.description);
  const late = !!due && due < now;
  return {
    id: String(task.id),
    title: task.title || "Untitled",
    subtitle: description.split("\n")[0].replace(/^- (\[[ x]\] )?/, "").slice(0, 80) || undefined,
    icon: { source: task.priority && task.priority >= 1 ? prio.icon : Icons.square, tint: prio.color ?? "gray" },
    section: o.section ?? bucket,
    keywords: [path, task.identifier ?? "", ...(task.labels ?? []).map((l) => l.title)].filter(Boolean),
    accessories: [
      ...(task.is_favorite
        ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }]
        : []),
      ...(task.labels ?? []).slice(0, 2).map((l) => ({ tag: l.title, color: colorOf(l.hex_color) })),
      ...(isRepeating(task) ? [{ icon: Icons.repeat, tooltip: "Repeats" }] : []),
      ...(due
        ? [{
          icon: Icons.calendar,
          text: shortDue(due, now),
          color: bucket === "Overdue" ? "red" as const : bucket === "Today" && late ? "orange" as const : undefined,
          tooltip: `Due ${due.toLocaleString("en-GB")}`,
        }]
        : []),
      ...(o.showProject !== false && project
        ? [{ icon: { source: Icons.dot, tint: colorOf(project.hex_color) }, text: project.title, tooltip: path }]
        : []),
    ],
    detail: {
      markdown: `### ${task.title}${description ? `\n\n${description}` : ""}`,
      metadata: taskMetadata(task, path, taskUrl(api, task), now),
    },
    actions: taskActions(api, task, projects, prefs),
  };
}

export function taskForm(api: Client, projects: Project[], prefs: Record<string, unknown>, projectId?: number) {
  const usable = usableProjects(projects);
  return form({
    title: "New Vikunja task",
    submitTitle: "Add Task",
    fields: [
      field.text("title", "Task", {
        required: true,
        placeholder: "Call Bob tomorrow at 15:00 *phone +Work !3",
      }),
      field.dropdown(
        "project",
        "Project",
        [
          { value: "", title: "Default project" },
          ...usable.map((p) => ({ value: String(p.id), title: projectPath(p, projects) })),
        ],
        { value: projectId ? String(projectId) : "" },
      ),
    ],
    async submit(values) {
      const { summary } = await quickAdd(api, String(values.title), prefs, {
        projects,
        projectId: Number(values.project) || undefined,
      });
      notifyChanged();
      await toast(summary, { style: "success" });
      return pop();
    },
  });
}
