import { list } from "@backslash/api";
import { all, type Project, sortTasks, type Task, taskItem } from "../lib.ts";

export default list({
  placeholder: "Search your tasks…",
  empty: { title: "No tasks", icon: "bs-circle-check" },
  status: (items) => `${items.length} task${items.length === 1 ? "" : "s"}`,
  async items({ preferences, signal }) {
    const token = preferences.token as string;
    const [tasks, projects] = await Promise.all([
      all<Task>(token, "/tasks", signal),
      all<Project>(token, "/projects", signal),
    ]);
    const order = new Map(projects.map((p, i) => [p.id, i]));
    const byId = new Map(projects.map((p) => [p.id, p]));
    return sortTasks(tasks)
      .sort((a, b) => (order.get(a.project_id) ?? 1e9) - (order.get(b.project_id) ?? 1e9))
      .map((t) => {
        const project = byId.get(t.project_id);
        return taskItem(t, token, { section: project?.name ?? "Other", project });
      });
  },
});
