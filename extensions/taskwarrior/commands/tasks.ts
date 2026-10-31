import { action, type Context, Icons, list, toast, updateCommandMetadata } from "@backslash/api";
import { dueSummary, exportArgs, isWaiting, matchesFilter, parseExport, sortByUrgency, topLabels } from "../lib.ts";
import { addTask, newTaskForm, SetupError, setupItem, task, taskItem } from "../tw.ts";

let footer = "";

export default async (ctx: Context) => {
  // The chips are built from the pending tasks, so they are read once here (fast: one `task export`).
  let labels = { projects: [] as string[], tags: [] as string[] };
  let first: string | undefined;
  try {
    first = await task(exportArgs("all", new Date()), ctx.signal);
    labels = topLabels(parseExport(first));
  } catch (e) {
    if (!(e instanceof SetupError)) throw e;
  }
  const query = ctx.query.trim();
  return list({
    placeholder: "Filter tasks by description, project:, +tag or ID…",
    filter: {
      options: [
        { value: "all", title: "Next" },
        { value: "due", title: "Due This Week" },
        { value: "active", title: "Active" },
        ...labels.projects.map((p) => ({ value: `project:${p}`, title: p })),
        ...labels.tags.map((t) => ({ value: `+${t}`, title: `+${t}` })),
        { value: "waiting", title: "Waiting" },
        { value: "done", title: "Completed" },
      ],
    },
    empty: {
      title: "Nothing to do here",
      description: "Press Ctrl+N to add a task, or pick another filter with Tab",
      icon: Icons.squareCheck,
    },
    status: () => footer,
    actions: [
      action("New Task", () => newTaskForm(query), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
      ...(query
        ? [action(`Add “${query}”`, async () => {
          await toast(await addTask(query), { style: "success" });
        }, { icon: Icons.plus })]
        : []),
    ],
    async items({ filter, signal }) {
      const now = new Date();
      try {
        // The first load reuses the export made for the chips; every other filter but "done" reads the same tasks.
        const output = first !== undefined && filter !== "done" ? first : await task(exportArgs(filter, now), signal);
        first = undefined;
        const tasks = parseExport(output);
        if (filter === "done") {
          footer = `${tasks.length} completed in the last 14 days`;
          return [...tasks].sort((a, b) => (b.end?.getTime() ?? 0) - (a.end?.getTime() ?? 0)).map((t) =>
            taskItem(t, new Map(), now)
          );
        }
        const open = new Map(tasks.map((t) => [t.uuid, t]));
        const summary = dueSummary(tasks, now);
        updateCommandMetadata({ subtitle: summary ?? null }).catch(() => {});
        const visible = tasks.filter((t) => !isWaiting(t, now));
        footer = [`${visible.length} pending`, summary].filter(Boolean).join(" · ");
        return sortByUrgency(tasks.filter((t) => matchesFilter(t, filter, now))).map((t) => taskItem(t, open, now));
      } catch (e) {
        if (e instanceof SetupError) return [setupItem(e)];
        throw e;
      }
    },
  });
};
