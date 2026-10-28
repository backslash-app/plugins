import { action, type Context, Icons, list, open, toast, updateCommandMetadata } from "@backslash/api";
import { dueSummary, matchesFilter, normalizeNewTask, sortTasks, tildify, topLabels } from "../lib.ts";
import { changeLine, HOME, live, loadTasks, locate, prefs, taskForm, taskItem, today } from "../todo.ts";

let footer = "";

export default async (ctx: Context) => {
  const files = await locate(ctx);
  const { archive, addCreated } = prefs(ctx);
  const open0 = (await loadTasks(files)).map((r) => r.task);
  const { projects, contexts } = topLabels(open0);
  const where = tildify(files.todo, HOME);
  const newTask = action("New Task", () => taskForm(files, { text: ctx.query, addCreated }), {
    icon: Icons.plus,
    shortcut: "<Ctrl>n",
  });
  return list({
    placeholder: "Filter tasks by text, +project, @context or (A)…",
    filter: {
      options: [
        { value: "all", title: "All" },
        { value: "due", title: "Due This Week" },
        { value: "pri", title: "Prioritized" },
        ...projects.map((p) => ({ value: `+${p}`, title: `+${p}` })),
        ...contexts.map((c) => ({ value: `@${c}`, title: `@${c}` })),
        { value: "done", title: "Completed" },
      ],
    },
    empty: files.exists ? { title: "No task here", description: "Press Ctrl+N to add one", icon: Icons.squareCheck } : {
      title: `No todo.txt yet`,
      description: `Press Ctrl+N to add your first task: it creates ${where}. ` +
        "Set another file (e.g. ~/Dropbox/todo/todo.txt) in Settings → Extensions → Todo.txt.",
      icon: Icons.squareCheck,
    },
    status: () => footer,
    actions: [
      newTask,
      ...(ctx.query.trim()
        ? [action(`Add “${ctx.query.trim()}”`, async () => {
          await changeLine(files, undefined, [normalizeNewTask(ctx.query, today(), addCreated)]);
          await toast("Task added", { style: "success" });
        }, { icon: Icons.plus })]
        : []),
      open(files.todo, "Open todo.txt", { icon: Icons.file, shortcut: "<Ctrl>o" }),
    ],
    items: ({ signal, filter }) =>
      live(
        async () => {
          const now = today();
          const rows = await loadTasks(files, filter === "done");
          const tasks = rows.filter((r) => !r.archived).map((r) => r.task);
          const summary = dueSummary(tasks, now);
          updateCommandMetadata({ subtitle: summary ?? null }).catch(() => {});
          const shown = sortTasks(rows.filter((r) => matchesFilter(r.task, filter, now)), now);
          const openCount = tasks.filter((t) => !t.done).length;
          footer = [`${openCount} open task${openCount === 1 ? "" : "s"}`, summary, where].filter(Boolean).join(" · ");
          return shown.map((r) => taskItem(r, files, { archive, addCreated, now }));
        },
        signal,
        files.exists ? files.todo : undefined,
      ),
  });
};
