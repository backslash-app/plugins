// Items, actions and forms shared by the commands.

import {
  type Action,
  action,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  pop,
  storage,
  submenu,
  toast,
} from "@backslash/api";
import { asana, guarded, paged, type Session, TASK_FIELDS } from "./api.ts";
import {
  asanaColor,
  dayOf,
  dueBody,
  dueChoices,
  dueColor,
  dueOf,
  excerpt,
  parseWhen,
  type Project,
  projectStatus,
  sectionIn,
  shortDue,
  type Task,
  taskMetadata,
} from "./lib.ts";
import { live, notifyChanged } from "./live.ts";

async function updateTask(s: Session, task: Task, body: Record<string, unknown>, message: string) {
  await asana(s.token, `/tasks/${task.gid}`, { method: "PUT", body });
  notifyChanged();
  await toast(message, { style: "success" });
}

export function taskActions(s: Session, task: Task): Action[] {
  const reschedule = submenu(
    "Change Due Date",
    dueChoices().map((c) =>
      action(
        c.title,
        () =>
          updateTask(
            s,
            task,
            c.date ? { due_on: c.date } : { due_on: null, due_at: null },
            c.date ? `Due ${shortDue(dayOf(c.date), new Date(), false)}` : "Due date removed",
          ),
        { icon: c.date ? Icons.calendar : Icons.cross },
      )
    ),
    { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
  );
  return [
    open(task.permalink_url, "Open in Asana"),
    task.completed
      ? action("Mark Incomplete", () => updateTask(s, task, { completed: false }, "Marked incomplete"), {
        icon: Icons.todo,
      })
      : action("Complete Task", () => updateTask(s, task, { completed: true }, `Completed “${task.name}”`), {
        icon: Icons.done,
      }),
    reschedule,
    action("New Task…", () => taskForm(s), { icon: Icons.plus, shortcut: "<Ctrl>n", section: "Task" }),
    copy(task.permalink_url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${task.name}](${task.permalink_url})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(task.name, "Copy Title", { shortcut: "<Ctrl>period", section: "Copy" }),
  ];
}

export function taskItem(s: Session, task: Task, options: { section?: string; project?: string } = {}): Item {
  const now = new Date();
  const due = dueOf(task);
  const projects = (task.projects ?? []).filter((p) => p.gid !== options.project);
  const tags = task.tags ?? [];
  const where = options.project ? undefined : sectionIn(task);
  return {
    id: task.gid,
    title: task.name || "Untitled task",
    subtitle: where,
    icon: task.completed
      ? { source: Icons.done, tint: "green" }
      : { source: Icons.todo, tint: dueColor(task, now) ?? "gray" },
    section: options.section,
    keywords: [...(task.projects ?? []).map((p) => p.name), ...tags.map((t) => t.name)],
    accessories: [
      ...tags.slice(0, 1).map((t) => ({ tag: t.name, color: asanaColor(t.color) })),
      ...projects.slice(0, 1).map((p) => ({
        icon: { source: Icons.dot, tint: asanaColor(p.color) },
        text: p.name,
        tooltip: "Project",
      })),
      ...(task.num_subtasks ? [{ icon: Icons.squareCheck, text: String(task.num_subtasks), tooltip: "Subtasks" }] : []),
      ...(due
        ? [{
          icon: Icons.calendar,
          text: shortDue(due.date, now, due.time),
          color: dueColor(task, now),
          tooltip: "Due",
        }]
        : []),
    ],
    detail: { markdown: excerpt(task.notes), metadata: taskMetadata(task, now) },
    actions: taskActions(s, task),
  };
}

/** The open tasks of a project, by section, live after a change. */
export function projectTasks(s: Session, project: Project, prefs: Record<string, unknown>): ListSpec {
  return list({
    title: project.name,
    placeholder: `Filter tasks of ${project.name}…`,
    empty: { title: "No open task in this project", icon: Icons.done },
    status: (items) => `${items.length} open task${items.length === 1 ? "" : "s"}`,
    actions: [
      action("New Task in Project…", () => taskForm(s, { project: project.gid }), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      ...(project.permalink_url ? [open(project.permalink_url, "Open Project in Asana")] : []),
    ],
    items: ({ signal }) =>
      live(() =>
        guarded(prefs, async () => {
          const tasks = await paged<Task>(
            s.token,
            `/projects/${project.gid}/tasks?completed_since=now&opt_fields=${TASK_FIELDS}`,
            500,
            signal,
          );
          // Asana returns them in the project's order, section by section.
          return tasks.map((t) =>
            taskItem(s, t, { section: sectionIn(t, project.gid) ?? "Tasks", project: project.gid })
          );
        }, signal), signal),
  });
}

export function projectItem(s: Session, p: Project, prefs: Record<string, unknown>, favorite: boolean): Item {
  const status = projectStatus(p);
  return {
    id: p.gid,
    title: p.name,
    // Sections are teams; favorites say which team.
    subtitle: favorite ? p.team?.name : p.current_status_update?.title || undefined,
    icon: { source: Icons.project, tint: asanaColor(p.color) },
    section: favorite ? "Favorites" : p.team?.name ?? "Projects",
    keywords: [p.owner?.name ?? "", p.team?.name ?? ""].filter(Boolean),
    accessories: [
      ...(favorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }] : []),
      ...(status ? [{ tag: status.text, color: status.color }] : []),
      ...(p.owner ? [{ avatar: p.owner.name, tooltip: `Owner: ${p.owner.name}` }] : []),
    ],
    detail: {
      markdown: excerpt(p.notes),
      metadata: [
        ...(status
          ? [
            meta.text("Status", status.text, { icon: Icons.activity, color: status.color }),
            ...(p.current_status_update?.title ? [meta.text("Update", p.current_status_update.title)] : []),
          ]
          : []),
        ...(p.owner ? [meta.person("Owner", p.owner.name)] : []),
        ...(p.team ? [meta.text("Team", p.team.name, { icon: Icons.person })] : []),
        ...(p.due_on ? [meta.text("Due", shortDue(dayOf(p.due_on), new Date(), false), { icon: Icons.calendar })] : []),
        meta.separator(),
        ...(p.modified_at ? [meta.text("Modified", shortDue(new Date(p.modified_at), new Date(), false))] : []),
        ...(p.permalink_url ? [meta.link("Link", "Open in Asana", p.permalink_url)] : []),
      ],
    },
    actions: [
      action("Show Tasks", () => projectTasks(s, p, prefs), { icon: Icons.layers }),
      ...(p.permalink_url ? [open(p.permalink_url, "Open in Asana")] : []),
      action("New Task in Project…", () => taskForm(s, { project: p.gid }), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...(p.permalink_url ? [copy(p.permalink_url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
    ],
  };
}

export async function projects(s: Session, signal?: AbortSignal): Promise<Project[]> {
  return await paged<Project>(
    s.token,
    `/projects?workspace=${s.workspace.gid}&archived=false&opt_fields=name,color`,
    500,
    signal,
  );
}

/** A new task; `standalone` when the form is the command itself (nothing to go back to). */
export async function taskForm(
  s: Session,
  options: { project?: string; name?: string; standalone?: boolean } = {},
) {
  const all = await projects(s).catch(() => [] as Project[]);
  const last = await storage.get<string>("lastProject").catch(() => undefined);
  const initial = options.project ?? (all.some((p) => p.gid === last) ? last! : "");
  return form({
    title: "New Asana task",
    submitTitle: "Create Task",
    fields: [
      field.text("name", "Task name", { required: true, placeholder: "What needs doing?", value: options.name ?? "" }),
      field.textArea("notes", "Description"),
      field.dropdown(
        "project",
        "Project",
        [
          { value: "", title: "No project (My Tasks)" },
          ...[...all].sort((a, b) => a.name.localeCompare(b.name))
            .map((p) => ({ value: p.gid, title: p.name })),
        ],
        { value: initial },
      ),
      field.text("due", "Due", { placeholder: "today, friday 3pm, next week, +3d, 2026-11-03…" }),
      field.checkbox("me", "Assign to me", { value: true }),
    ],
    async submit(values) {
      const when = parseWhen(String(values.due ?? ""));
      const project = String(values.project ?? "");
      const task = await asana<Task>(s.token, "/tasks?opt_fields=name,permalink_url", {
        method: "POST",
        body: {
          name: String(values.name).trim(),
          notes: String(values.notes ?? "").trim() || undefined,
          workspace: s.workspace.gid,
          ...(project ? { projects: [project] } : {}),
          ...(values.me ? { assignee: "me" } : {}),
          ...(when ? dueBody(when) : {}),
        },
      });
      await storage.set("lastProject", project).catch(() => {});
      notifyChanged();
      await toast(`Created “${task.name}”`, { style: "success" });
      if (!options.standalone) return pop();
      const projectName = all.find((p) => p.gid === project)?.name;
      return detail({
        title: task.name,
        markdown: `# ${task.name}\n\nCreated in **${projectName ?? "My Tasks"}**.`,
        metadata: [
          meta.text("Workspace", s.workspace.name),
          ...(projectName ? [meta.text("Project", projectName, { icon: Icons.project })] : []),
          ...(when ? [meta.text("Due", shortDue(when.date, new Date(), when.time), { icon: Icons.calendar })] : []),
          meta.link("Link", "Open in Asana", task.permalink_url),
        ],
        status: "Task created",
        actions: [
          open(task.permalink_url, "Open in Asana"),
          copy(task.permalink_url, "Copy Link", { shortcut: "<Ctrl><Shift>c" }),
        ],
      });
    },
  });
}
