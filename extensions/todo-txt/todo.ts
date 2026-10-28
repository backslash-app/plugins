// The todo.txt file on disk, and its tasks as launcher items.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  pop,
  submenu,
  toast,
} from "@backslash/api";
import {
  addDays,
  applyEdit,
  completeTask,
  describeRecurrence,
  dirname,
  editValues,
  expandHome,
  isoDay,
  longDate,
  parseFile,
  priorityColor,
  relativeDay,
  replaceLine,
  sectionOf,
  setDue,
  setPriority,
  type Task,
  tildify,
  uncompleteTask,
  weekday,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** Where todo.txt is looked for, in order; the same places as `[permissions]`. */
export const CANDIDATES = ["~/todo.txt", "~/Documents/todo.txt", "~/Dropbox/todo/todo.txt", "~/.todo/todo.txt"];
export const ALLOWED = "~/todo.txt, ~/Documents/todo.txt, or a file in ~/Dropbox/todo or ~/.todo";

export interface Files {
  todo: string;
  done: string;
  exists: boolean;
}

const exists = (path: string) => Deno.stat(path).then((s) => s.isFile, () => false);

export async function locate(ctx: Pick<Context, "preferences">): Promise<Files> {
  const pref = String(ctx.preferences.file ?? "").trim();
  if (pref) {
    const todo = expandHome(pref, HOME);
    return { todo, done: `${dirname(todo)}/done.txt`, exists: await exists(todo) };
  }
  for (const c of CANDIDATES) {
    const todo = expandHome(c, HOME);
    if (await exists(todo)) return { todo, done: `${dirname(todo)}/done.txt`, exists: true };
  }
  const todo = expandHome(CANDIDATES[0], HOME);
  return { todo, done: `${dirname(todo)}/done.txt`, exists: false };
}

function explain(e: unknown, path: string): never {
  if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
    throw new Error(
      `Todo.txt may only use ${ALLOWED}; ${tildify(path, HOME)} is elsewhere. ` +
        "Change the file in Settings → Extensions → Todo.txt.",
    );
  }
  throw e;
}

export async function readText(path: string): Promise<string> {
  try {
    return await Deno.readTextFile(path);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    explain(e, path);
  }
}

async function writeText(path: string, text: string) {
  try {
    await Deno.mkdir(dirname(path), { recursive: true }).catch(() => {});
    await Deno.writeTextFile(path, text);
  } catch (e) {
    explain(e, path);
  }
}

export interface Row {
  task: Task;
  index: number;
  /** Lines of done.txt are shown, not changed. */
  archived?: boolean;
}

export async function loadTasks(files: Files, withDone = false): Promise<Row[]> {
  const rows = parseFile(await readText(files.todo)).map((task, index) => ({ task, index }));
  if (!withDone) return rows;
  const archived = parseFile(await readText(files.done)).slice(-200).map((task, index) => ({
    task,
    index: -1000 + index,
    archived: true,
  }));
  return [...rows, ...archived];
}

/** Changes one line of todo.txt; fails when it was edited elsewhere meanwhile. */
export async function changeLine(files: Files, old: string | undefined, lines: string[]) {
  const content = await readText(files.todo);
  const next = replaceLine(content, old, lines);
  if (next === undefined) throw new Error("This task changed in todo.txt meanwhile; the list was reloaded");
  await writeText(files.todo, next);
  notifyChanged();
}

export async function appendDone(files: Files, line: string) {
  const content = await readText(files.done);
  await writeText(files.done, replaceLine(content, undefined, [line])!);
}

export const today = () => isoDay(new Date());

/** Completes a task: archived to done.txt (or marked `x` in place), the next occurrence added for `rec:`. */
export async function complete(files: Files, task: Task, archive: boolean): Promise<string> {
  const { done, next } = completeTask(task, today());
  if (archive) {
    await appendDone(files, done);
    await changeLine(files, task.raw, next ? [next] : []);
  } else {
    await changeLine(files, task.raw, next ? [done, next] : [done]);
  }
  return next ? `Done; next one ${relativeDay(nextDue(next) ?? today(), today())}` : "Done";
}

const nextDue = (line: string) => parseFile(line)[0]?.due ?? parseFile(line)[0]?.threshold;

// --- Live reload -------------------------------------------------------------

const changes = new EventTarget();
export const notifyChanged = () => changes.dispatchEvent(new Event("change"));

/** Yields `load()`, again after each change made here or to the file elsewhere, until `signal` aborts. */
export async function* live<T>(load: () => Promise<T>, signal: AbortSignal, watch?: string): AsyncGenerator<T> {
  let watcher: Deno.FsWatcher | undefined;
  let fsChanged = () => {};
  if (watch) {
    try {
      watcher = Deno.watchFs(watch);
      (async () => {
        for await (const ev of watcher!) if (ev.kind !== "access") fsChanged();
      })().catch(() => {});
    } catch { /* no inotify, or the file doesn't exist yet */ }
  }
  try {
    while (!signal.aborted) {
      yield await load();
      await new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const done = () => {
          changes.removeEventListener("change", done);
          signal.removeEventListener("abort", done);
          fsChanged = () => {};
          clearTimeout(timer);
          resolve();
        };
        changes.addEventListener("change", done);
        signal.addEventListener("abort", done);
        // Editors write in several steps: wait for them to settle.
        fsChanged = () => {
          clearTimeout(timer);
          timer = setTimeout(done, 150);
        };
      });
    }
  } finally {
    watcher?.close();
  }
}

// --- Items -------------------------------------------------------------------

const PRIORITIES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

export function taskForm(
  files: Files,
  o: { task?: Task; text?: string; addCreated: boolean; standalone?: boolean },
): FormSpec {
  const v = o.task ? editValues(o.task) : { description: o.text ?? "", priority: "", due: "", threshold: "", rec: "" };
  return form({
    title: o.task ? "Edit Task" : "New Task",
    submitTitle: o.task ? "Save Task" : "Add Task",
    fields: [
      field.text("description", "Task", {
        required: true,
        placeholder: "Call the plumber +House @phone",
        value: v.description,
      }),
      field.dropdown("priority", "Priority", [
        { value: "", title: "None" },
        ...PRIORITIES.map((p) => ({ value: p, title: `(${p})` })),
      ], { value: v.priority }),
      field.text("due", "Due", { placeholder: "2026-11-03, tomorrow, fri, 3d", value: v.due }),
      field.text("threshold", "Not before (t:)", {
        placeholder: "Hidden from today until this date",
        value: v.threshold,
      }),
      field.text("rec", "Repeat (rec:)", {
        placeholder: "1w, +1m (from the due date), 5b (business days)",
        value: v.rec,
      }),
    ],
    async submit(values) {
      const line = applyEdit(
        o.task,
        {
          description: String(values.description ?? ""),
          priority: String(values.priority ?? ""),
          due: String(values.due ?? ""),
          threshold: String(values.threshold ?? ""),
          rec: String(values.rec ?? ""),
        },
        today(),
        o.addCreated,
      );
      await changeLine(files, o.task?.raw, [line]);
      await toast(o.task ? "Task saved" : "Task added", { style: "success" });
      return o.standalone ? close("Task added") : pop();
    },
  });
}

function taskMetadata(row: Row, files: Files, now: string): Metadata[] {
  const t = row.task;
  const lines: Metadata[] = [];
  if (t.priority) {
    lines.push(meta.text("Priority", `(${t.priority})`, { icon: Icons.flag, color: priorityColor(t.priority) }));
  }
  if (t.due) {
    const section = sectionOf(t, now);
    lines.push(meta.text("Due", `${longDate(t.due)} · ${relativeDay(t.due, now)}`, {
      icon: Icons.calendar,
      color: t.done ? undefined : section === "Overdue" ? "red" : section === "Today" ? "orange" : undefined,
    }));
  }
  if (t.threshold) lines.push(meta.text("Not before", longDate(t.threshold), { icon: Icons.hourglass }));
  if (t.rec) lines.push(meta.text("Repeats", describeRecurrence(t.rec) ?? t.rec, { icon: Icons.repeat }));
  if (t.projects.length) {
    lines.push(meta.tags("Projects", t.projects.map((p) => ({ text: `+${p}`, color: "purple" as const }))));
  }
  if (t.contexts.length) {
    lines.push(meta.tags("Contexts", t.contexts.map((c) => ({ text: `@${c}`, color: "teal" as const }))));
  }
  const other = Object.entries(t.tags).filter(([k]) => !["due", "t", "rec", "pri"].includes(k));
  for (const [k, v] of other.slice(0, 6)) lines.push(meta.text(k, v, { icon: Icons.tag }));
  lines.push(meta.separator());
  if (t.created) lines.push(meta.text("Created", `${longDate(t.created)} · ${relativeDay(t.created, now)}`));
  if (t.completed) lines.push(meta.text("Completed", longDate(t.completed), { icon: Icons.done, color: "green" }));
  const file = row.archived ? files.done : files.todo;
  lines.push(meta.text(row.archived ? "In" : "Line", row.archived ? tildify(file, HOME) : `${row.index + 1}`));
  return lines;
}

function dueAccessory(t: Task, now: string) {
  const day = t.due ?? (t.threshold && t.threshold > now ? t.threshold : undefined);
  if (!day || t.done) return [];
  const section = sectionOf(t, now);
  return [{
    icon: t.due ? Icons.calendar : Icons.hourglass,
    text: relativeDay(day, now),
    color: section === "Overdue" ? "red" as const : section === "Today" ? "orange" as const : undefined,
    tooltip: `${t.due ? "Due" : "Not before"} ${longDate(day)}`,
  }];
}

const nextMonday = (now: string) => addDays(now, ((8 - weekday(now)) % 7) || 7);

export function taskItem(row: Row, files: Files, o: { archive: boolean; addCreated: boolean; now: string }): Item {
  const t = row.task;
  const now = o.now;
  const section = sectionOf(t, now);
  const edit = (line: string, message: string) => async () => {
    await changeLine(files, t.raw, [line]);
    await toast(message, { style: "success" });
  };
  const actions: Action[] = [];
  if (!row.archived) {
    actions.push(
      t.done
        ? action("Mark as Not Done", edit(uncompleteTask(t), "Reopened"), { icon: Icons.todo })
        : action("Complete Task", async () => {
          await toast(await complete(files, t, o.archive), { style: "success" });
        }, { icon: Icons.done }),
      action("Edit Task", () => taskForm(files, { task: t, addCreated: o.addCreated }), {
        icon: Icons.text,
        shortcut: "<Ctrl>e",
      }),
      submenu("Set Priority", [
        ...PRIORITIES.slice(0, 5).map((p) =>
          action(`(${p})`, edit(setPriority(t, p), `Priority (${p})`), {
            icon: { A: Icons.urgent, B: Icons.high, C: Icons.medium, D: Icons.low }[p] ?? Icons.low,
          })
        ),
        action("No Priority", edit(setPriority(t, undefined), "Priority removed"), { icon: Icons.noPriority }),
      ], { icon: Icons.flag, shortcut: "<Ctrl><Shift>p" }),
      submenu("Set Due Date", [
        action("Today", edit(setDue(t, now), "Due today"), { icon: Icons.calendar }),
        action("Tomorrow", edit(setDue(t, addDays(now, 1)), "Due tomorrow"), { icon: Icons.calendar }),
        action("Next Monday", edit(setDue(t, nextMonday(now)), "Due next Monday"), { icon: Icons.calendar }),
        action("In a Week", edit(setDue(t, addDays(now, 7)), "Due in a week"), { icon: Icons.calendar }),
        ...(t.due
          ? [action("Remove Due Date", edit(setDue(t, undefined), "Due date removed"), { icon: Icons.cross })]
          : []),
      ], { icon: Icons.calendar, shortcut: "<Ctrl><Shift>d" }),
    );
  }
  actions.push(
    copy(t.title, "Copy Task", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(t.raw, "Copy todo.txt Line", { section: "Copy" }),
    action("New Task", () => taskForm(files, { addCreated: o.addCreated }), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
      section: "File",
    }),
    open(row.archived ? files.done : files.todo, `Open ${row.archived ? "done.txt" : "todo.txt"}`, {
      icon: Icons.file,
      shortcut: "<Ctrl>o",
      section: "File",
    }),
  );
  if (!row.archived) {
    actions.push(action("Delete Task", async () => {
      await changeLine(files, t.raw, []);
      await toast("Task deleted", { style: "success" });
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Delete “${t.title}”? It is removed from todo.txt.`,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
    }));
  }
  return {
    id: row.archived ? `done:${row.index}:${t.raw}` : t.raw,
    title: t.title,
    icon: t.done ? { source: Icons.done, tint: "green" } : { source: Icons.todo, tint: priorityColor(t.priority) },
    section: row.archived ? "Archived (done.txt)" : section,
    keywords: [
      ...t.projects.map((p) => `+${p}`),
      ...t.contexts.map((c) => `@${c}`),
      ...(t.priority ? [`(${t.priority})`] : []),
    ],
    accessories: [
      ...(t.priority && !t.done ? [{ tag: `(${t.priority})`, color: priorityColor(t.priority) }] : []),
      ...t.projects.slice(0, 2).map((p) => ({ tag: `+${p}`, color: "purple" as const })),
      ...t.contexts.slice(0, 2).map((c) => ({ tag: `@${c}`, color: "teal" as const })),
      ...(t.rec ? [{ icon: Icons.repeat, tooltip: describeRecurrence(t.rec) }] : []),
      ...dueAccessory(t, now),
      ...(t.done && t.completed ? [{ text: relativeDay(t.completed, now), tooltip: "Completed" }] : []),
    ],
    detail: {
      markdown: `### ${t.title.replace(/[#*_`[\]]/g, "\\$&")}\n\n\`${t.raw.replace(/`/g, "'")}\``,
      metadata: taskMetadata(row, files, now),
    },
    actions,
  };
}

export const prefs = (ctx: Pick<Context, "preferences">) => ({
  archive: ctx.preferences.archive !== false,
  addCreated: ctx.preferences.createdDate !== false,
});
