import { action, Icons, list, updateCommandMetadata } from "@backslash/api";
import { guarded, paged, type Session, session, TASK_FIELDS } from "../api.ts";
import { sortTasks, type Task, taskSection } from "../lib.ts";
import { live } from "../live.ts";
import { taskForm, taskItem } from "../views.ts";

let summary = "";

export default list({
  placeholder: "Filter your tasks by name, project, tag…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "soon", title: "Due This Week" },
    ],
  },
  empty: { title: "No open task", description: "Nothing assigned to you here.", icon: Icons.done },
  status: (items) => items[0]?.id === "setup" ? "Not connected" : summary,
  actions: [
    action("New Task…", async ({ preferences }) => taskForm(await session(preferences)), {
      icon: Icons.plus,
      shortcut: "<Ctrl>n",
    }),
  ],
  items: ({ preferences, signal, filter }) =>
    live(() =>
      guarded(preferences, async (s: Session) => {
        const tasks = await paged<Task>(
          s.token,
          `/tasks?assignee=me&workspace=${s.workspace.gid}&completed_since=now&opt_fields=${TASK_FIELDS}`,
          500,
          signal,
        );
        const now = new Date();
        const open = tasks.filter((t) => !t.completed);
        const count = (name: string) => open.filter((t) => taskSection(t, now) === name).length;
        const overdue = count("Overdue"), today = count("Today");
        summary = [
          `${open.length} task${open.length === 1 ? "" : "s"}`,
          overdue ? `${overdue} overdue` : "",
          today ? `${today} today` : "",
          s.workspace.name,
        ].filter(Boolean).join(" · ");
        updateCommandMetadata({
          subtitle: [overdue ? `${overdue} overdue` : "", today ? `${today} due today` : ""].filter(Boolean)
            .join(" · ") || null,
        }).catch(() => {});
        const shown = filter === "soon"
          ? open.filter((t) => ["Overdue", "Today", "Upcoming"].includes(taskSection(t, now)))
          : open;
        return sortTasks(shown, now).map((t) => taskItem(s, t, { section: taskSection(t, now) }));
      }, signal), signal),
});
