import { action, type Context, Icons, type Item, list, open, updateCommandMetadata } from "@backslash/api";
import { client, guarded, signOutAction } from "../api.ts";
import { AuthError, dueBucket, dueOf, plural, sortTasks, type TodoList, todoUrl } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { isToday, loadLists, loadTasks, taskForm, taskItem } from "../todo.ts";

const VIEWS = [
  { value: "today", title: "Today" },
  { value: "week", title: "Next 7 Days" },
  { value: "all", title: "All" },
];

let summary = "";
let lists: TodoList[] = [];

export default async (ctx: Context) => {
  // The lists become chips after the date views; without a sign-in there are none yet.
  try {
    lists = await loadLists(await client(ctx.preferences), ctx.signal);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
  }
  const tenant = ctx.preferences.tenant;
  return list({
    placeholder: "Filter tasks by title, list or category…",
    filter: {
      options: [
        ...VIEWS,
        ...lists.filter((l) => l.wellknownListName !== "flaggedEmails").map((l) => ({
          value: `list:${l.id}`,
          title: l.displayName,
        })),
      ],
    },
    empty: { title: "Nothing to do", description: "Press Ctrl+N to add a task.", icon: Icons.squareCheck },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      action("New Task…", async () => taskForm(await client(ctx.preferences), lists, { title: ctx.query }), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      open(todoUrl(tenant), "Open Microsoft To Do", { icon: Icons.squareCheck }),
      signOutAction(ctx.preferences, notifyChanged),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(ctx.preferences, async (api): Promise<Item[]> => {
          lists = await loadLists(api, signal);
          const tasks = sortTasks(await loadTasks(api, lists, signal));
          const now = new Date();
          const today = tasks.filter((t) => dueBucket(dueOf(t), now) === "Today").length;
          const overdue = tasks.filter((t) => dueBucket(dueOf(t), now) === "Overdue").length;
          updateCommandMetadata({
            subtitle: [today ? `${plural(today, "task")} today` : "", overdue ? `${overdue} overdue` : ""]
              .filter(Boolean).join(" · ") || null,
          }).catch(() => {});

          const view = filter ?? "today";
          const listId = view.startsWith("list:") ? view.slice(5) : undefined;
          const known = listId ? lists.find((l) => l.id === listId) : undefined;
          const shown = tasks.filter((t) => {
            if (listId) return !known || t.listId === listId;
            if (view === "all") return true;
            if (view === "week") {
              const b = dueBucket(dueOf(t), now);
              return b !== "Later" && b !== "No Due Date";
            }
            return isToday(t, now);
          });
          summary = [
            plural(shown.length, "task"),
            overdue ? `${overdue} overdue` : "",
            known ? known.displayName : plural(lists.length, "list"),
          ].filter(Boolean).join(" · ");
          return shown.map((t) => taskItem(api, t, lists, { tenant, now }));
        }), signal),
  });
};
