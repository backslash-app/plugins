import { assertEquals } from "@std/assert";
import { dueSection, projectColor, sortTasks, type Task, taskItem, taskMetadata } from "./lib.ts";

const task = (id: string, date: string | null, priority = 1, extra: Partial<Task> = {}): Task => ({
  id,
  content: `Task ${id}`,
  description: "",
  priority,
  project_id: "p",
  labels: [],
  due: date ? { date, string: date, is_recurring: false } : null,
  ...extra,
});

const NOW = new Date(2026, 9, 27, 10, 0); // Tuesday 27 October 2026, local time

Deno.test("due sections", () => {
  assertEquals(
    ["2026-10-20", "2026-10-27", "2026-10-28", "2026-10-30", "2026-11-12", null].map((d) =>
      dueSection(task("x", d), NOW)
    ),
    ["Overdue", "Today", "Tomorrow", "Friday", "Thu, Nov 12", "No date"],
  );
  assertEquals(dueSection(task("x", "2026-10-27T18:00:00"), NOW), "Today");
});

Deno.test("sorted by day, then priority (4 = P1), then time", () => {
  const sorted = sortTasks([
    task("a", "2026-10-27", 1),
    task("b", "2026-10-27", 4),
    task("c", "2026-10-26", 1),
    task("d", null, 4),
    task("e", "2026-10-27T09:00:00", 1),
  ]);
  assertEquals(sorted.map((t) => t.id), ["c", "b", "a", "e", "d"]);
});

Deno.test("task item and panel", () => {
  const project = { id: "p", name: "Work", color: "blue" };
  const t = task("1", "2026-10-26", 4, { labels: ["work"], description: "Details\nmore" });
  const item = taskItem(t, "tok", { project, now: NOW });
  assertEquals(item.icon, { source: "bs-circle", tint: "red" });
  assertEquals(item.subtitle, "Details");
  assertEquals(item.accessories?.map((a) => a.text), ["@work", "Overdue", "Work"]);
  assertEquals(item.accessories?.[1].color, "red");
  assertEquals(item.actions?.map((a) => a.title).slice(0, 4), [
    "Complete Task",
    "Open in Todoist",
    "Reschedule",
    "Set Priority",
  ]);
  assertEquals(taskMetadata(t, project, NOW).map((m) => m.label), ["Due", "Priority", "Project", "Labels"]);
  assertEquals(projectColor(project), "blue");
});
