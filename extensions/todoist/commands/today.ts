import { list, updateCommandMetadata } from "@backslash/api";
import { all, dueSection, localDate, type Project, sortTasks, type Task, taskItem, todoist } from "../lib.ts";

const QUERIES: Record<string, string> = {
  today: "today | overdue",
  week: "7 days | overdue",
  nodate: "no date",
};

/** Tasks completed today, for the footer (0 when the API refuses). */
async function doneToday(token: string, signal: AbortSignal): Promise<number> {
  try {
    const since = `${localDate(new Date())}T00:00:00Z`;
    const until = new Date(Date.now() + 86_400_000).toISOString().slice(0, 19) + "Z";
    const page = await todoist<{ items: unknown[] }>(
      token,
      `/tasks/completed/by_completion_date?since=${since}&until=${until}&limit=200`,
      { signal },
    );
    return page.items?.length ?? 0;
  } catch {
    return 0;
  }
}

let done = 0;

export default list({
  placeholder: "Filter tasks by name, label, project…",
  filter: {
    options: [
      { value: "today", title: "Today" },
      { value: "week", title: "Next 7 days" },
      { value: "nodate", title: "No date" },
    ],
  },
  empty: { title: "Nothing left", description: "Enjoy the rest of the day.", icon: "bs-circle-check" },
  status: (items) => `${items.length} to do${done ? ` · ${done} done today` : ""}`,
  async items({ preferences, signal, filter }) {
    const token = preferences.token as string;
    const key = filter ?? "today";
    const [tasks, projects, completed] = await Promise.all([
      all<Task>(token, `/tasks/filter?query=${encodeURIComponent(QUERIES[key] ?? QUERIES.today)}`, signal),
      all<Project>(token, "/projects", signal),
      key === "today" ? doneToday(token, signal) : Promise.resolve(0),
    ]);
    done = completed;
    const byId = new Map(projects.map((p) => [p.id, p]));
    const sorted = sortTasks(tasks);
    if (key === "today") {
      updateCommandMetadata({ subtitle: sorted.length ? `${sorted.length} today` : null }).catch(() => {});
    }
    return sorted.map((t) =>
      taskItem(t, token, { section: key === "nodate" ? undefined : dueSection(t), project: byId.get(t.project_id) })
    );
  },
});
