// Items, actions and the new task form.

import {
  type Action,
  action,
  copy,
  detail,
  field,
  form,
  Icons,
  type Item,
  meta,
  open,
  pop,
  storage,
  submenu,
  toast,
} from "@backslash/api";
import { allLists, clickup, type Session } from "./api.ts";
import {
  avatarOf,
  dueChoices,
  dueColor,
  dueFields,
  excerpt,
  hasTime,
  type ListRef,
  msDate,
  parseWhen,
  PRIORITIES,
  priorityOf,
  shortDue,
  type Status,
  statusIcon,
  statusName,
  type Task,
  taskMetadata,
  typeRank,
  whereOf,
} from "./lib.ts";
import { notifyChanged } from "./live.ts";

async function update(s: Session, task: Task, body: Record<string, unknown>, message: string) {
  await clickup(s.token, `/task/${task.id}`, { method: "PUT", body });
  notifyChanged();
  await toast(message, { style: "success" });
}

/** The statuses of the task's list (lists can override their space's). */
async function statusesOf(s: Session, task: Task): Promise<Status[]> {
  const list = await clickup<ListRef>(s.token, `/list/${task.list.id}`);
  let statuses = list.statuses ?? [];
  if (!statuses.length && task.space) {
    const space = await clickup<{ statuses?: Status[] }>(s.token, `/space/${task.space.id}`);
    statuses = space.statuses ?? [];
  }
  return [...statuses].sort((a, b) => Number(a.orderindex) - Number(b.orderindex));
}

export function taskActions(s: Session, task: Task): Action[] {
  const status = submenu("Change Status", async () => {
    const statuses = await statusesOf(s, task);
    return statuses.filter((st) => st.status !== task.status.status).map((st) =>
      action(statusName(st.status), () => update(s, task, { status: st.status }, statusName(st.status)), {
        icon: statusIcon(st).source,
      })
    );
  }, { icon: Icons.inProgress, shortcut: "<Ctrl>s", section: "Task" });
  const priority = submenu(
    "Set Priority",
    [
      ...PRIORITIES.map((p) =>
        action(p.name, () => update(s, task, { priority: p.id }, `Priority ${p.name.toLowerCase()}`), { icon: p.icon })
      ),
      action("No Priority", () => update(s, task, { priority: null }, "Priority removed"), { icon: Icons.noPriority }),
    ],
    { icon: Icons.high, shortcut: "<Ctrl>p", section: "Task" },
  );
  const due = submenu(
    "Change Due Date",
    dueChoices().map((c) =>
      action(c.title, () => {
        const when = c.date ? parseWhen(c.date) : undefined;
        return update(
          s,
          task,
          dueFields(when),
          when ? `Due ${shortDue(when.date, new Date(), false)}` : "Due date removed",
        );
      }, { icon: c.date ? Icons.calendar : Icons.cross })
    ),
    { icon: Icons.calendar, shortcut: "<Ctrl>d", section: "Task" },
  );
  return [
    open(task.url, "Open in ClickUp"),
    status,
    priority,
    due,
    action("New Task in This List…", () => taskForm(s, { list: task.list.id }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "Task",
    }),
    copy(task.url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(`[${task.name}](${task.url})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(task.custom_id ?? task.id, "Copy Task ID", { shortcut: "<Ctrl>period", section: "Copy" }),
  ];
}

export function taskItem(s: Session, task: Task, now = new Date()): Item {
  const due = msDate(task.due_date);
  const prio = priorityOf(task);
  const team = s.teams.length > 1 ? s.teams.find((t) => t.id === task.team_id)?.name : undefined;
  const others = task.assignees.filter((u) => u.id !== s.me.id);
  return {
    id: task.id,
    title: task.name,
    subtitle: whereOf(task),
    icon: statusIcon(task.status),
    section: statusName(task.status.status),
    keywords: [
      task.custom_id ?? "",
      task.list.name,
      task.folder?.name ?? "",
      ...task.tags.map((t) => t.name),
      team ?? "",
    ]
      .filter(Boolean),
    accessories: [
      ...task.tags.slice(0, 1).map((t) => ({ tag: t.name })),
      ...(prio ? [{ icon: { source: prio.icon, tint: prio.color }, tooltip: `${prio.name} priority` }] : []),
      ...(due
        ? [{ icon: Icons.calendar, text: shortDue(due, now, hasTime(due)), color: dueColor(task, now), tooltip: "Due" }]
        : []),
      ...others.slice(0, 2).map((u) => ({ avatar: avatarOf(u), tooltip: u.username ?? undefined })),
    ],
    detail: { markdown: excerpt(task.text_content), metadata: taskMetadata(task, { team }, now) },
    actions: taskActions(s, task),
  };
}

/** Statuses sorted like the sections: in progress, to do, done. */
export function sectionOrder(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) =>
    typeRank(a.status.type) - typeRank(b.status.type) || Number(a.status.orderindex) - Number(b.status.orderindex)
  );
}

/** A new task; `standalone` when the form is the command itself (nothing to go back to). */
export async function taskForm(s: Session, options: { list?: string; name?: string; standalone?: boolean } = {}) {
  const lists = await allLists(s);
  if (!lists.length) throw new Error("No ClickUp list found: create one in ClickUp first");
  const last = await storage.get<string>("lastList").catch(() => undefined);
  const initial = [options.list, last].find((id) => lists.some((l) => l.value === id)) ?? lists[0].value;
  return form({
    title: "New ClickUp task",
    submitTitle: "Create Task",
    fields: [
      field.text("name", "Task name", { required: true, placeholder: "What needs doing?", value: options.name ?? "" }),
      field.textArea("description", "Description"),
      field.dropdown("list", "List", lists, { value: initial }),
      field.dropdown(
        "priority",
        "Priority",
        [{ value: "", title: "No priority" }, ...PRIORITIES.map((p) => ({ value: String(p.id), title: p.name }))],
        { value: "" },
      ),
      field.text("due", "Due", { placeholder: "today 5pm, friday, next week, +3d, 2026-11-03…" }),
      field.checkbox("me", "Assign to me", { value: true }),
    ],
    async submit(values) {
      const when = parseWhen(String(values.due ?? ""));
      const task = await clickup<Task>(s.token, `/list/${values.list}/task`, {
        method: "POST",
        body: {
          name: String(values.name).trim(),
          description: String(values.description ?? "").trim() || undefined,
          assignees: values.me ? [s.me.id] : [],
          priority: values.priority ? Number(values.priority) : null,
          ...(when ? dueFields(when) : {}),
        },
      });
      await storage.set("lastList", String(values.list)).catch(() => {});
      notifyChanged();
      const where = lists.find((l) => l.value === values.list)?.title ?? "";
      await toast(`Created “${task.name}”`, { style: "success" });
      if (!options.standalone) return pop();
      return detail({
        title: task.name,
        markdown: `# ${task.name}\n\nCreated in **${where}**.`,
        metadata: [
          meta.text("List", where, { icon: Icons.layers }),
          meta.text("Status", statusName(task.status?.status ?? "to do"), {
            icon: task.status ? statusIcon(task.status).source : Icons.todo,
          }),
          ...(when ? [meta.text("Due", shortDue(when.date, new Date(), when.time), { icon: Icons.calendar })] : []),
          meta.link("Link", "Open in ClickUp", task.url),
        ],
        status: "Task created",
        actions: [open(task.url, "Open in ClickUp"), copy(task.url, "Copy Link", { shortcut: "<Ctrl><Shift>c" })],
      });
    },
  });
}
