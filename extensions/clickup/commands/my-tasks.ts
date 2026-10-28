import { action, Icons, list, updateCommandMetadata } from "@backslash/api";
import { guarded, myTasks, type Session, session } from "../api.ts";
import { dueBucket, hasTime, matchesFilter, msDate, sortTasks, type Task } from "../lib.ts";
import { live } from "../live.ts";
import { sectionOrder, taskForm, taskItem } from "../views.ts";

let summary = "";

export default list({
  placeholder: "Filter tasks by name, list, tag, ID…",
  filter: {
    options: [
      { value: "active", title: "Not Done" },
      { value: "todo", title: "To Do" },
      { value: "progress", title: "In Progress" },
      { value: "done", title: "Done" },
    ],
  },
  empty: { title: "No task here", description: "Tasks assigned to you show up here.", icon: Icons.done },
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
        const closed = filter === "done";
        const all = (await Promise.all(s.teams.map((t) => myTasks(s, t, closed, signal)))).flat();
        const shown = all.filter((t) => matchesFilter(t, filter));
        const now = new Date();
        if (!filter || filter === "active") {
          const overdue = shown.filter((t: Task) => {
            const due = msDate(t.due_date);
            return due && dueBucket(due, now, hasTime(due)) === "Overdue";
          }).length;
          const moving = shown.filter((t) => t.status.type === "custom").length;
          summary = [
            `${shown.length} task${shown.length === 1 ? "" : "s"}`,
            moving ? `${moving} in progress` : "",
            overdue ? `${overdue} overdue` : "",
          ].filter(Boolean).join(" · ");
          updateCommandMetadata({
            subtitle: [moving ? `${moving} in progress` : "", overdue ? `${overdue} overdue` : ""].filter(Boolean)
              .join(" · ") || null,
          }).catch(() => {});
        } else {
          summary = `${shown.length} task${shown.length === 1 ? "" : "s"}`;
        }
        // Sections in status order; inside, by priority and due date.
        const order = new Map(sectionOrder(shown).map((t, i) => [t.status.status, i]));
        return sortTasks(shown)
          .sort((a, b) => (order.get(a.status.status) ?? 0) - (order.get(b.status.status) ?? 0))
          .map((t) => taskItem(s, t, now));
      }, signal), signal),
});
