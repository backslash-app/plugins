import { list } from "@backslash/api";
import { all, dueSection, type Project, sortTasks, type Task, taskItem } from "../lib.ts";

export default list({
  placeholder: "Filter today's tasks…",
  empty: { title: "Nothing left for today", icon: "🎉" },
  async items({ preferences, signal }) {
    const token = preferences.token as string;
    const [tasks, projects] = await Promise.all([
      all<Task>(token, `/tasks/filter?query=${encodeURIComponent("today | overdue")}`, signal),
      all<Project>(token, "/projects", signal),
    ]);
    const names = new Map(projects.map((p) => [p.id, p.name]));
    return sortTasks(tasks).map((t) =>
      taskItem(t, token, { section: dueSection(t), project: names.get(t.project_id) })
    );
  },
});
