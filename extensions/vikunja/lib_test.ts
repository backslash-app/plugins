import { assert, assertEquals, assertInstanceOf } from "@std/assert";
import { parse } from "@std/toml";
import {
  apiDate,
  bucketOf,
  colorOf,
  dueOf,
  findProject,
  HOSTS,
  htmlToText,
  isAllowedHost,
  nextWeek,
  normalizeUrl,
  onDay,
  parseQuickAdd,
  priorityOf,
  type Project,
  projectPath,
  repeatText,
  SetupError,
  shortDue,
  sortTasks,
  type Task,
  tasksQuery,
  updated,
  usableProjects,
  vikunjaError,
} from "./lib.ts";

// Thursday 29 October 2026, 10:00 local time.
const NOW = new Date(2026, 9, 29, 10, 0);
const at = (d: number, h = 12, m = 0, month = 9, y = 2026) => new Date(y, month, d, h, m);
const task = (id: number, due?: Date, extra: Partial<Task> = {}): Task => ({
  id,
  title: `Task ${id}`,
  done: false,
  project_id: 1,
  due_date: due ? due.toISOString() : "0001-01-01T00:00:00Z",
  ...extra,
});

Deno.test("quick add: labels, project, priority", () => {
  const q = parseQuickAdd('Fix the sink *home *"two words" +House !4', NOW);
  assertEquals(q.title, "Fix the sink");
  assertEquals(q.labels, ["home", "two words"]);
  assertEquals(q.project, "House");
  assertEquals(q.priority, 4);
  assertEquals(q.due, undefined);
  const plain = parseQuickAdd("Buy sun cream !9", NOW);
  assertEquals([plain.title, plain.labels, plain.project, plain.priority, plain.due], [
    "Buy sun cream !9",
    [],
    undefined,
    undefined,
    undefined,
  ]);
  assertEquals(parseQuickAdd("Read +'Reading List'", NOW).project, "Reading List");
});

Deno.test("quick add: dates and times", () => {
  const due = (text: string) => parseQuickAdd(text, NOW).due;
  assertEquals(due("Call Bob tomorrow"), at(30));
  assertEquals(due("Call Bob tomorrow at 15:00"), at(30, 15));
  assertEquals(due("Call Bob today 3pm"), at(29, 15));
  assertEquals(due("Standup at 9am"), at(30, 9), "a time already past: tomorrow");
  assertEquals(due("Pay rent on monday"), at(2, 12, 0, 10));
  assertEquals(due("Review next thursday"), at(5, 12, 0, 10), "the coming one, never today");
  assertEquals(due("Ship 2026-11-17"), at(17, 12, 0, 10));
  assertEquals(due("Dentist 17/02"), at(17, 12, 0, 1, 2027), "past this year: next year's");
  assertEquals(due("Dentist 02/17/2027"), at(17, 12, 0, 1, 2027));
  assertEquals(due("Dentist 5.11. ok"), at(5, 12, 0, 10));
  assertEquals(due("Party feb 3rd"), at(3, 12, 0, 1, 2027));
  assertEquals(due("Party 3 december"), at(3, 12, 0, 11));
  assertEquals(due("Taxes in 3 days"), at(1, 12, 0, 10));
  assertEquals(due("Plan next week"), at(2, 12, 0, 10));
  assertEquals(due("Invoice end of month"), at(31, 12));
  assertEquals(due("Hike this weekend"), at(31, 12));
  assertEquals(due("Buy sun cream"), undefined);
  const q = parseQuickAdd("Call Bob tomorrow at 15:00 *phone +Work !3", NOW);
  assertEquals(q.title, "Call Bob");
});

Deno.test("due dates, buckets and sorting", () => {
  assertEquals(dueOf({ due_date: "0001-01-01T00:00:00Z" }), undefined);
  assertEquals(dueOf({ due_date: null }), undefined);
  assertEquals(bucketOf(task(1, at(28)), NOW), "Overdue");
  assertEquals(bucketOf(task(1, at(29, 8)), NOW), "Today", "past hours of today stay today's");
  assertEquals(bucketOf(task(1, at(30)), NOW), "Tomorrow");
  assertEquals(bucketOf(task(1, at(3, 12, 0, 10)), NOW), "This Week");
  assertEquals(bucketOf(task(1, at(20, 12, 0, 10)), NOW), "Later");
  assertEquals(bucketOf(task(1), NOW), "No Due Date");
  const sorted = sortTasks([
    task(1),
    task(2, at(30)),
    task(3, at(29, 9), { priority: 1 }),
    task(4, at(29, 9), { priority: 4 }),
    task(5, at(20)),
  ], NOW);
  assertEquals(sorted.map((t) => t.id), [5, 4, 3, 2, 1]);
  assertEquals(shortDue(at(29), NOW), "today");
  assertEquals(shortDue(at(30, 15, 30), NOW), "tomorrow 15:30");
  assertEquals(shortDue(at(1, 12, 0, 10), NOW), "Sun");
  assertEquals(shortDue(at(3, 12, 0, 1, 2027), NOW), "Feb 3, 2027");
  assertEquals(nextWeek(NOW), at(2, 0, 0, 10));
  assertEquals(nextWeek(at(2, 9, 0, 10)), at(9, 0, 0, 10), "on a Monday: the next one");
  assertEquals(onDay(at(30, 0), at(1, 15, 45)), at(30, 15, 45));
  assertEquals(onDay(at(30, 0)), at(30, 12));
  assertEquals(apiDate(null), "0001-01-01T00:00:00Z");
});

Deno.test("priorities, colors, repeats, descriptions", () => {
  assertEquals(priorityOf(4).name, "Urgent");
  assertEquals(priorityOf(undefined).name, "Unset");
  assertEquals(colorOf("e8445a"), "red");
  assertEquals(colorOf("#1973ff"), "blue");
  assertEquals(colorOf("4caf50"), "green");
  assertEquals(colorOf(""), "gray");
  assertEquals(repeatText(task(1, undefined, { repeat_after: 86_400 })), "every day");
  assertEquals(repeatText(task(1, undefined, { repeat_after: 1_209_600 })), "every 2 weeks");
  assertEquals(repeatText(task(1, undefined, { repeat_mode: 1 })), "every month");
  assertEquals(repeatText(task(1)), undefined);
  assertEquals(
    htmlToText(
      '<p>Buy <b>milk</b> &amp; eggs</p><ul data-type="taskList"><li data-checked="true"><p>Shop</p></li><li data-checked="false"><p>Cook</p></li></ul>',
    ),
    "Buy milk & eggs\n\n- [x] Shop\n\n- [ ] Cook",
  );
});

Deno.test("projects and requests", () => {
  const projects: Project[] = [
    { id: -1, title: "Favorites" },
    { id: 2, title: "Work", position: 2 },
    { id: 3, title: "Clients", parent_project_id: 2, position: 1 },
    { id: 4, title: "Old", is_archived: true },
    { id: 5, title: "Workshop", position: 3 },
  ];
  assertEquals(usableProjects(projects).map((p) => p.id), [3, 2, 5]);
  assertEquals(findProject(projects, "work")?.id, 2);
  assertEquals(findProject(projects, "cli")?.id, 3);
  assertEquals(findProject(projects, "wo"), undefined, "ambiguous");
  assertEquals(projectPath(projects[2], projects), "Work › Clients");
  const q = new URLSearchParams(tasksQuery(2));
  assertEquals(q.get("filter"), "done = false");
  assertEquals(q.get("page"), "2");
  assertEquals(q.getAll("sort_by"), ["due_date", "id"]);
  const t = task(9, at(30), { labels: [{ id: 1, title: "x" }], priority: 2 });
  const u = updated(t, { done: true });
  assertEquals(u.done, true);
  assertEquals(u.priority, 2);
  assertEquals("labels" in u, false, "labels are changed through their own routes");
  assertInstanceOf(vikunjaError(401, ""), SetupError);
  assertEquals(
    vikunjaError(404, '{"message":"The task does not exist."}').message,
    "Not found on Vikunja: The task does not exist.",
  );
  assertEquals(vikunjaError(500, "<html>").message, "Vikunja answered 500");
});

Deno.test("hosts: the manifest's, and server addresses", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("app.vikunja.cloud"));
  assert(isAllowedHost("tasks.home.lan"));
  assert(isAllowedHost("100.101.1.2"));
  assert(!isAllowedHost("tasks.example.com"));
  assertEquals(normalizeUrl("tasks.home.lan:3456/projects/3/1"), "http://tasks.home.lan:3456");
  assertEquals(normalizeUrl("app.vikunja.cloud/api/v1/"), "https://app.vikunja.cloud");
  assertEquals(normalizeUrl("https://vikunja.example.ts.net/tasks/12"), "https://vikunja.example.ts.net");
});
