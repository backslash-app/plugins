import { action, type Context, Icons, list, updateCommandMetadata } from "@backslash/api";
import { client, everything, guarded } from "../api.ts";
import { type Project, sortTasks, taskSection } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { taskForm, taskItem } from "../views.ts";

let summary = "";
let lists: Project[] = [];

export default (ctx: Context) =>
  list({
    placeholder: "Filter tasks by title, list, tag…",
    filter: {
      options: [
        { value: "today", title: "Today" },
        { value: "week", title: "Next 7 Days" },
        { value: "all", title: "All" },
      ],
    },
    empty: { title: "Nothing to do", description: "Enjoy the rest of the day.", icon: Icons.squareCheck },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      action("New Task…", async () => taskForm(await client(ctx.preferences), lists), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      action("Sign Out of TickTick", async () => {
        await (await client(ctx.preferences)).signOut();
        notifyChanged();
      }, { icon: Icons.power, section: "Account" }),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(ctx.preferences, async (api) => {
          const { projects, tasks } = await everything(api, signal);
          lists = projects;
          const now = new Date();
          const sections = new Map(tasks.map((t) => [t.id, taskSection(t, now)]));
          const overdue = tasks.filter((t) => sections.get(t.id) === "Overdue").length;
          const today = tasks.filter((t) => sections.get(t.id) === "Today").length;
          updateCommandMetadata({
            subtitle:
              [today ? `${today} today` : "", overdue ? `${overdue} overdue` : ""].filter(Boolean).join(" · ") ||
              null,
          }).catch(() => {});
          const keep = filter === "all"
            ? () => true
            : filter === "week"
            ? (s: string) => s !== "Later" && s !== "No Due Date"
            : (s: string) => s === "Overdue" || s === "Today";
          const shown = tasks.filter((t) => keep(sections.get(t.id)!));
          summary = [
            `${shown.length} task${shown.length === 1 ? "" : "s"}`,
            overdue ? `${overdue} overdue` : "",
            `${projects.length} lists`,
          ].filter(Boolean).join(" · ");
          return sortTasks(shown, now).map((t) => taskItem(api, t, projects, now));
        }), signal),
  });
