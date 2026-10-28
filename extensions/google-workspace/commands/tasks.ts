import { action, type Context, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { client, guarded, signOutAction } from "../api.ts";
import { AuthError, dueBucket, dueOf, plural, sortTasks, type TaskList, TASKS_URL, withSubtasks } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { loadLists, loadTasks, taskForm, taskItem } from "../tasks.ts";

const VIEWS = [
  { value: "today", title: "Today" },
  { value: "week", title: "Next 7 Days" },
  { value: "all", title: "All" },
];

let summary = "";
let lists: TaskList[] = [];

export default async (ctx: Context) => {
  // The lists become chips after the date views; without a sign-in there are none yet.
  try {
    lists = await loadLists(await client(ctx.preferences), ctx.signal);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  return list({
    placeholder: "Filter tasks by title, notes or list…",
    filter: {
      options: [...VIEWS, ...lists.map((l) => ({ value: `list:${l.id}`, title: l.title }))],
    },
    empty: { title: "Nothing to do", description: "Press Ctrl+N to add a task.", icon: Icons.squareCheck },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      action("New Task…", async () => taskForm(await client(ctx.preferences), lists, { title: ctx.query }), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      open(TASKS_URL, "Open Google Tasks", { icon: Icons.squareCheck }),
      signOutAction(ctx.preferences, notifyChanged),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(ctx.preferences, async (api): Promise<Item[]> => {
          lists = await loadLists(api, signal);
          const tasks = await loadTasks(api, lists, signal);
          const now = new Date();
          const bucket = (t: (typeof tasks)[number]) => dueBucket(dueOf(t), now);
          const today = tasks.filter((t) => bucket(t) === "Today").length;
          const overdue = tasks.filter((t) => bucket(t) === "Overdue").length;
          updateCommandMetadata({
            subtitle: [today ? `${plural(today, "task")} today` : "", overdue ? `${overdue} overdue` : ""]
              .filter(Boolean).join(" · ") || null,
          }).catch(() => {});

          const view = filter ?? "today";
          const listId = view.startsWith("list:") ? view.slice(5) : undefined;
          const known = listId ? lists.find((l) => l.id === listId) : undefined;
          const byId = new Map(tasks.map((t) => [t.id, t]));
          const keep = (t: (typeof tasks)[number]) => {
            if (listId) return !known || t.listId === listId;
            if (view === "all") return true;
            const b = bucket(t);
            if (view === "week") return b !== "Later" && b !== "No Due Date";
            return b === "Today" || b === "Overdue";
          };
          const shown = tasks.filter(keep);
          summary = [
            plural(shown.length, "task"),
            overdue ? `${overdue} overdue` : "",
            known ? known.title : plural(lists.length, "list"),
          ].filter(Boolean).join(" · ");
          // In one list, keep Google's order with subtasks under their parent; elsewhere, by due date.
          if (known) {
            return withSubtasks(shown.sort((a, b) => (a.position ?? "").localeCompare(b.position ?? ""))).map((
              { task },
            ) =>
              taskItem(api, task, lists, {
                parent: task.parent ? byId.get(task.parent) : undefined,
                now,
                section: known.title,
              })
            );
          }
          return sortTasks(shown).map((t) =>
            taskItem(api, t, lists, { parent: t.parent ? byId.get(t.parent) : undefined, now })
          );
        }), signal),
  });
};
