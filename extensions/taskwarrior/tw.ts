// Running `task`, and tasks as launcher items.

import {
  type Accessory,
  type Action,
  action,
  type Color,
  copy,
  exec,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  addArgs,
  blockedBy,
  createdId,
  dueState,
  editValues,
  elapsed,
  longDate,
  modifyArgs,
  priorityLabel,
  relativeDay,
  type Task,
  taskArgs,
  taskMarkdown,
} from "./lib.ts";

export class SetupError extends Error {}

/** Runs `task` with human errors for a missing program. */
export async function task(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec("task", args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SetupError(
        "Taskwarrior is not installed: install the “task” package (taskwarrior) with your package manager",
      );
    }
    const message = (e as Error).message ?? String(e);
    if (/Cannot proceed without rc file/i.test(message) || /A configuration file could not be found/i.test(message)) {
      throw new SetupError("Taskwarrior has no configuration yet: run “task” once in a terminal to create ~/.taskrc");
    }
    throw new Error(message.replace(/^task exited with \d+: /, "Taskwarrior: "));
  }
}

export function setupItem(e: SetupError): Item {
  return {
    id: "setup",
    title: e.message,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## Set up Taskwarrior",
        "",
        "This extension runs the `task` command of this computer, with your own `~/.taskrc`",
        "and data: nothing to configure here.",
        "",
        "- Fedora: `sudo dnf install task`",
        "- Debian, Ubuntu: `sudo apt install taskwarrior`",
        "- Arch: `sudo pacman -S task`",
        "",
        "Then run `task` once in a terminal so it creates its configuration.",
      ].join("\n"),
    },
    actions: [copy("task", "Copy Command")],
  };
}

export async function addTask(input: string): Promise<string> {
  const out = await task(addArgs(input));
  const id = createdId(out);
  return id ? `Created task ${id}` : "Task created";
}

// --- Items -------------------------------------------------------------------

export const PRIORITY_COLOR: Record<string, Color> = { H: "red", M: "orange", L: "blue" };
const PRIORITY_ICON: Record<string, string> = { H: Icons.high, M: Icons.medium, L: Icons.low };

function icon(t: Task) {
  if (t.status === "completed") return { source: Icons.done, tint: "green" as const };
  if (t.start) return { source: Icons.inProgress, tint: "yellow" as const };
  if (t.priority) return { source: Icons.todo, tint: PRIORITY_COLOR[t.priority] };
  return Icons.todo;
}

function dueAccessory(t: Task, now: Date): Accessory[] {
  if (!t.due || t.status === "completed") return [];
  const state = dueState(t, now);
  return [{
    icon: Icons.calendar,
    text: relativeDay(t.due, now),
    color: state === "overdue" ? "red" : state === "today" ? "orange" : undefined,
    tooltip: `Due ${longDate(t.due)}`,
  }];
}

function metadata(t: Task, now: Date): Metadata[] {
  const lines: Metadata[] = [];
  lines.push(meta.text("ID", t.id ? String(t.id) : "–", { icon: Icons.hash }));
  if (t.project) lines.push(meta.tags("Project", [{ text: t.project, color: "purple" }]));
  if (t.tags.length) lines.push(meta.tags("Tags", t.tags.map((tag) => ({ text: `+${tag}`, color: "teal" as const }))));
  if (t.priority) {
    lines.push(meta.text("Priority", priorityLabel(t.priority), {
      icon: PRIORITY_ICON[t.priority],
      color: PRIORITY_COLOR[t.priority],
    }));
  }
  lines.push(meta.text("Urgency", t.urgency.toFixed(1), { icon: Icons.bolt }));
  lines.push(meta.separator());
  if (t.due) {
    const s = dueState(t, now);
    lines.push(meta.text("Due", `${longDate(t.due)} · ${relativeDay(t.due, now)}`, {
      icon: Icons.calendar,
      color: s === "overdue" ? "red" : s === "today" ? "orange" : undefined,
    }));
  }
  if (t.scheduled) lines.push(meta.text("Scheduled", longDate(t.scheduled), { icon: Icons.clock }));
  if (t.wait && t.wait > now) lines.push(meta.text("Hidden until", longDate(t.wait), { icon: Icons.hourglass }));
  if (t.until) lines.push(meta.text("Until", longDate(t.until), { icon: Icons.hourglass }));
  if (t.recur) lines.push(meta.text("Repeats", t.recur, { icon: Icons.repeat }));
  if (t.start) {
    lines.push(meta.text("Started", `${longDate(t.start)} · ${elapsed(t.start, now)}`, {
      icon: Icons.play,
      color: "yellow",
    }));
  }
  if (t.end) lines.push(meta.text("Completed", longDate(t.end), { icon: Icons.done, color: "green" }));
  if (t.entry) lines.push(meta.text("Added", `${longDate(t.entry)} · ${relativeDay(t.entry, now)}`));
  for (const [k, v] of Object.entries(t.udas).slice(0, 5)) lines.push(meta.text(k, v, { icon: Icons.tag }));
  lines.push(meta.text("UUID", t.uuid.slice(0, 8)));
  return lines;
}

/** Runs a change, tells the user and reloads the list. */
const change = (args: string[], message: string) => async () => {
  await task(args);
  await toast(message, { style: "success" });
  return refresh();
};

export function annotateForm(t: Task): FormSpec {
  return form({
    title: `Annotate “${t.description}”`,
    submitTitle: "Add Annotation",
    fields: [field.textArea("text", "Annotation", { required: true, placeholder: "A note, a link, a phone number…" })],
    async submit(values) {
      const text = String(values.text ?? "").trim().replace(/\s*\n\s*/g, " ");
      if (!text) throw new Error("Write the annotation first");
      await task(taskArgs(t.uuid, "annotate", text));
      await toast("Annotation added", { style: "success" });
      return pop();
    },
  });
}

export function modifyForm(t: Task): FormSpec {
  const v = editValues(t);
  return form({
    title: "Modify Task",
    submitTitle: "Save Task",
    fields: [
      field.text("description", "Description", { required: true, value: v.description }),
      field.text("project", "Project", { placeholder: "Home.Garden", value: v.project }),
      field.text("tags", "Tags", { placeholder: "next phone (separated by spaces)", value: v.tags }),
      field.dropdown("priority", "Priority", [
        { value: "", title: "None" },
        { value: "H", title: "High" },
        { value: "M", title: "Medium" },
        { value: "L", title: "Low" },
      ], { value: v.priority }),
      field.text("due", "Due", { placeholder: "2026-11-02, fri, eow, tomorrow, 3d", value: v.due }),
    ],
    async submit(values) {
      const args = modifyArgs(t, {
        description: String(values.description ?? ""),
        project: String(values.project ?? ""),
        tags: String(values.tags ?? ""),
        priority: String(values.priority ?? ""),
        due: String(values.due ?? ""),
      });
      if (args.length) {
        await task(args);
        await toast("Task saved", { style: "success" });
      }
      return pop();
    },
  });
}

export function newTaskForm(text = ""): FormSpec {
  return form({
    title: "New Task",
    submitTitle: "Add Task",
    fields: [
      field.text("line", "Task", {
        required: true,
        value: text,
        placeholder: "Call the plumber project:Home due:fri +phone priority:H",
      }),
    ],
    async submit(values) {
      await toast(await addTask(String(values.line ?? "")), { style: "success" });
      return pop();
    },
  });
}

export function taskItem(t: Task, open: Map<string, Task>, now: Date): Item {
  const done = t.status === "completed";
  const blockers = blockedBy(t, open);
  const actions: Action[] = done
    ? [
      action("Mark as Pending", change([...taskArgs(t.uuid, "modify"), "status:pending"], "Task reopened"), {
        icon: Icons.todo,
      }),
    ]
    : [
      action("Mark as Done", change(taskArgs(t.uuid, "done"), `Done: ${t.description}`), { icon: Icons.done }),
      t.start
        ? action("Stop Task", change(taskArgs(t.uuid, "stop"), "Task stopped"), { icon: Icons.stop })
        : action("Start Task", change(taskArgs(t.uuid, "start"), "Task started"), { icon: Icons.play }),
      action("Annotate", () => annotateForm(t), { icon: Icons.comment, shortcut: "<Ctrl>a" }),
      action("Modify Task", () => modifyForm(t), { icon: Icons.text, shortcut: "<Ctrl>e" }),
      submenu("Set Priority", [
        ...(["H", "M", "L"] as const).map((p) =>
          action(priorityLabel(p), change([...taskArgs(t.uuid, "modify"), `priority:${p}`], `Priority ${p}`), {
            icon: PRIORITY_ICON[p],
          })
        ),
        action("None", change([...taskArgs(t.uuid, "modify"), "priority:"], "Priority removed"), {
          icon: Icons.noPriority,
        }),
      ], { icon: Icons.flag, shortcut: "<Ctrl><Shift>p" }),
      submenu("Set Due Date", [
        ...[["Today", "today"], ["Tomorrow", "tomorrow"], ["End of Week", "eow"], ["Next Monday", "monday"], [
          "In a Week",
          "today+7d",
        ]].map(([title, value]) =>
          action(title, change([...taskArgs(t.uuid, "modify"), `due:${value}`], `Due ${title.toLowerCase()}`), {
            icon: Icons.calendar,
          })
        ),
        ...(t.due
          ? [action("Remove Due Date", change([...taskArgs(t.uuid, "modify"), "due:"], "Due date removed"), {
            icon: Icons.cross,
          })]
          : []),
      ], { icon: Icons.calendar, shortcut: "<Ctrl><Shift>d" }),
    ];
  actions.push(
    copy(t.description, "Copy Description", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(t.uuid, "Copy UUID", { section: "Copy" }),
    ...(t.id ? [copy(String(t.id), "Copy ID", { section: "Copy" })] : []),
    action("Delete Task", change(taskArgs(t.uuid, "delete"), "Task deleted"), {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${t.description}”${t.recur ? " (this occurrence)" : ""}?`,
      shortcut: "<Ctrl>Delete",
      section: "Danger",
    }),
  );
  return {
    id: t.uuid,
    title: t.description,
    subtitle: t.project,
    icon: icon(t),
    keywords: [
      ...(t.project ? [`project:${t.project}`] : []),
      ...t.tags.map((tag) => `+${tag}`),
      ...(t.id ? [String(t.id)] : []),
    ],
    accessories: [
      ...(t.start && !done ? [{ tag: `active ${elapsed(t.start, now)}`, color: "yellow" as const }] : []),
      ...(blockers.length ? [{ icon: Icons.lock, tooltip: `Blocked by ${blockers.length} task(s)` }] : []),
      ...(t.annotations.length ? [{ icon: Icons.comment, tooltip: `${t.annotations.length} annotation(s)` }] : []),
      ...(t.recur ? [{ icon: Icons.repeat, tooltip: `Repeats ${t.recur}` }] : []),
      ...t.tags.slice(0, 3).map((tag) => ({ tag: `+${tag}`, color: "teal" as const })),
      ...dueAccessory(t, now),
      ...(done && t.end
        ? [{ text: relativeDay(t.end, now), tooltip: "Completed" }]
        : [{ text: t.urgency.toFixed(1), tooltip: "Urgency" }]),
    ],
    detail: { markdown: taskMarkdown(t, blockers, now), metadata: metadata(t, now) },
    actions,
  };
}
