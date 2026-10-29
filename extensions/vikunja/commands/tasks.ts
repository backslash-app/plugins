import { action, type Context, Icons, list, updateCommandMetadata } from "@backslash/api";
import { client, everything } from "../api.ts";
import { bucketOf, type Project, projectPath, sortTasks } from "../lib.ts";
import { live, notifyChanged } from "../live.ts";
import { guarded, taskForm, taskItem } from "../views.ts";

let summary = "";
let known: Project[] = [];

export default (ctx: Context) =>
  list({
    placeholder: "Filter tasks by title, project, label…",
    filter: {
      options: [
        { value: "today", title: "Today" },
        { value: "upcoming", title: "Next 7 Days" },
        { value: "projects", title: "By Project" },
      ],
      default: "today",
    },
    empty: { title: "Nothing to do", description: "No open task here: enjoy the day.", icon: Icons.squareCheck },
    status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
    actions: [
      action("New Task…", () => taskForm(client(ctx.preferences), known, ctx.preferences), {
        icon: Icons.plus,
        shortcut: "<Ctrl>n",
      }),
      action("Reload", () => notifyChanged(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
    items: ({ signal, filter }) =>
      live(() =>
        guarded(async () => {
          const api = client(ctx.preferences);
          const { projects, tasks } = await everything(api, signal);
          known = projects;
          const now = new Date();
          const bucket = new Map(tasks.map((t) => [t.id, bucketOf(t, now)]));
          const overdue = tasks.filter((t) => bucket.get(t.id) === "Overdue").length;
          const today = tasks.filter((t) => bucket.get(t.id) === "Today").length;
          updateCommandMetadata({
            subtitle:
              [today ? `${today} today` : "", overdue ? `${overdue} overdue` : ""].filter(Boolean).join(" · ") ||
              null,
          }).catch(() => {});
          const keep = filter === "projects"
            ? () => true
            : filter === "upcoming"
            ? (b: string) => b !== "Later" && b !== "No Due Date"
            : (b: string) => b === "Overdue" || b === "Today";
          const shown = sortTasks(tasks.filter((t) => keep(bucket.get(t.id)!)), now);
          summary = [
            `${shown.length} task${shown.length === 1 ? "" : "s"}`,
            overdue ? `${overdue} overdue` : "",
            `${projects.filter((p) => p.id > 0 && !p.is_archived).length} projects`,
          ].filter(Boolean).join(" · ");
          if (filter !== "projects") {
            return shown.map((t) => taskItem(api, t, projects, ctx.preferences, { now }));
          }
          // By project: projects in Vikunja's order, their tasks by due date.
          const order = new Map(projects.map((p, i) => [p.id, i]));
          return [...shown]
            .sort((a, b) => (order.get(a.project_id) ?? 1e9) - (order.get(b.project_id) ?? 1e9))
            .map((t) =>
              taskItem(api, t, projects, ctx.preferences, {
                now,
                section: projectPath(projects.find((p) => p.id === t.project_id), projects) || "Other",
                showProject: false,
              })
            );
        }), signal),
  });
