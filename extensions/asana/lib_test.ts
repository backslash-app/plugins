import { assertEquals, assertInstanceOf, assertStringIncludes, assertThrows } from "@std/assert";
import {
  asanaColor,
  asanaError,
  AuthError,
  dueBody,
  dueBucket,
  dueChoices,
  dueColor,
  dueOf,
  parseWhen,
  pickWorkspace,
  projectStatus,
  sectionIn,
  setupItem,
  shortDue,
  sortTasks,
  type Task,
  taskMetadata,
  taskSection,
  tokenOf,
} from "./lib.ts";

Deno.test("token and errors", () => {
  assertThrows(() => tokenOf({ token: "  " }), AuthError, "Connect");
  assertEquals(tokenOf({ token: " 2/1200/1208:abc " }), "2/1200/1208:abc");
  assertInstanceOf(asanaError(401, { errors: [{ message: "Not Authorized" }] }), AuthError);
  assertEquals(
    asanaError(400, { errors: [{ message: "due_on: Invalid date" }] }).message,
    "Asana answered 400: due_on: Invalid date",
  );
  assertStringIncludes(asanaError(404, undefined).message, "Not found");
  assertStringIncludes(setupItem(new AuthError("Connect your Asana account")).detail!.markdown!, "Create new token");
});

Deno.test("workspace from the preferences", () => {
  const ws = [{ gid: "1", name: "Acme" }, { gid: "2", name: "Personal Projects" }];
  assertEquals(pickWorkspace(ws, "").gid, "1");
  assertEquals(pickWorkspace(ws, "personal projects").gid, "2");
  assertEquals(pickWorkspace(ws, "personal").gid, "2");
  assertEquals(pickWorkspace(ws, "2").gid, "2");
  assertThrows(() => pickWorkspace(ws, "Globex"), Error, "Acme, Personal Projects");
  assertThrows(() => pickWorkspace([], ""), Error, "no workspace");
});

Deno.test("colors and project status", () => {
  assertEquals(asanaColor("dark-green"), "green");
  assertEquals(asanaColor("light-warm-gray"), "gray");
  assertEquals(asanaColor("dark-brown"), "orange");
  assertEquals(asanaColor(null), "gray");
  assertEquals(projectStatus({ gid: "p", name: "P", current_status_update: { status_type: "at_risk" } }), {
    text: "At risk",
    color: "yellow",
  });
  assertEquals(projectStatus({ gid: "p", name: "P" }), undefined);
});

const NOW = new Date(2026, 9, 27, 14, 10, 0);
const task = (over: Partial<Task>): Task => ({
  gid: "t",
  name: "Task",
  permalink_url: "https://app.asana.com/0/0/1",
  ...over,
});

Deno.test("tasks: due, sections, order", () => {
  const late = task({ gid: "late", due_on: "2026-10-26" });
  const today = task({ gid: "today", due_on: "2026-10-27" });
  const todayAt = task({ gid: "at", due_at: new Date(2026, 9, 27, 17, 0).toISOString() });
  const pastAt = task({ gid: "pastAt", due_at: new Date(2026, 9, 27, 9, 0).toISOString() });
  const soon = task({ gid: "soon", due_on: "2026-10-30" });
  const later = task({ gid: "later", due_on: "2026-12-01" });
  const none = task({ gid: "none" });
  assertEquals(dueOf(today), { date: new Date(2026, 9, 27), time: false });
  assertEquals(taskSection(late, NOW), "Overdue");
  assertEquals(taskSection(today, NOW), "Today");
  assertEquals(taskSection(todayAt, NOW), "Today");
  assertEquals(taskSection(pastAt, NOW), "Overdue");
  assertEquals(taskSection(soon, NOW), "Upcoming");
  assertEquals(taskSection(later, NOW), "Later");
  assertEquals(taskSection(none, NOW), "No Due Date");
  assertEquals(
    sortTasks([none, later, soon, todayAt, today, late, pastAt], NOW).map((t) => t.gid),
    ["late", "pastAt", "today", "at", "soon", "later", "none"],
  );
  assertEquals(dueColor(late, NOW), "red");
  assertEquals(dueColor(today, NOW), "green");
  assertEquals(dueColor(soon, NOW), undefined);
});

Deno.test("task metadata and sections", () => {
  const t = task({
    due_at: new Date(2026, 9, 28, 9, 30).toISOString(),
    projects: [{ gid: "p1", name: "Website", color: "dark-blue" }],
    tags: [{ gid: "g1", name: "urgent", color: "dark-red" }],
    memberships: [{ project: { gid: "p1", name: "Website" }, section: { gid: "s1", name: "In progress" } }],
    num_subtasks: 3,
  });
  const lines = taskMetadata(t, NOW);
  const by = (label: string) => lines.find((l) => l.label === label);
  assertEquals(by("Due")?.value, "tomorrow 09:30");
  assertEquals(by("Projects")?.tags, [{ text: "Website", color: "blue" }]);
  assertEquals(by("Section")?.value, "In progress");
  assertEquals(by("Tags")?.tags, [{ text: "urgent", color: "red" }]);
  assertEquals(by("Subtasks")?.value, "3");
  assertEquals(sectionIn(t, "p1"), "In progress");
  assertEquals(
    sectionIn(
      task({ memberships: [{ project: { gid: "p", name: "P" }, section: { gid: "s", name: "Untitled section" } }] }),
    ),
    undefined,
  );
});

Deno.test("due body for the API", () => {
  assertEquals(dueBody(undefined), { due_on: null, due_at: null });
  assertEquals(dueBody(parseWhen("friday", NOW)), { due_on: "2026-10-30" });
  assertEquals(dueBody(parseWhen("friday 3pm", NOW)), { due_at: new Date(2026, 9, 30, 15).toISOString() });
});

// A Tuesday afternoon, local time.
const T = new Date(2026, 9, 27, 14, 10, 0);
const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

Deno.test("parseWhen: words, weekdays, relative days, times", () => {
  assertEquals(parseWhen("", T), undefined);
  assertEquals(parseWhen("today", T), { date: at(2026, 10, 27), time: false });
  assertEquals(parseWhen("Tomorrow", T), { date: at(2026, 10, 28), time: false });
  assertEquals(parseWhen("friday", T), { date: at(2026, 10, 30), time: false });
  // Today is a Tuesday: "tue" is next week's.
  assertEquals(parseWhen("tue", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("next week", T), { date: at(2026, 11, 2), time: false });
  assertEquals(parseWhen("+3d", T), { date: at(2026, 10, 30), time: false });
  assertEquals(parseWhen("in 2 weeks", T), { date: at(2026, 11, 10), time: false });
  assertEquals(parseWhen("2026-11-03", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("3 Nov", T), { date: at(2026, 11, 3), time: false });
  assertEquals(parseWhen("jan 5", T), { date: at(2027, 1, 5), time: false });
  assertEquals(parseWhen("tomorrow 3pm", T), { date: at(2026, 10, 28, 15), time: true });
  assertEquals(parseWhen("fri at 9:30am", T), { date: at(2026, 10, 30, 9, 30), time: true });
  assertEquals(parseWhen("2026-11-03 14:30", T), { date: at(2026, 11, 3, 14, 30), time: true });
  assertEquals(parseWhen("17h", T), { date: at(2026, 10, 27, 17), time: true });
  // Already past today: tomorrow.
  assertEquals(parseWhen("9am", T), { date: at(2026, 10, 28, 9), time: true });
  assertThrows(() => parseWhen("someday", T), Error, "Can't read the date");
  assertThrows(() => parseWhen("2026-02-31", T), Error);
});

Deno.test("due buckets and short dates", () => {
  assertEquals(dueBucket(undefined, T), "No Due Date");
  assertEquals(dueBucket(at(2026, 10, 26, 18), T), "Overdue");
  assertEquals(dueBucket(at(2026, 10, 27, 9), T), "Overdue");
  assertEquals(dueBucket(at(2026, 10, 27, 0), T, false), "Today");
  assertEquals(dueBucket(at(2026, 10, 27, 18), T), "Today");
  assertEquals(dueBucket(at(2026, 10, 28, 18), T), "Tomorrow");
  assertEquals(dueBucket(at(2026, 11, 1, 18), T), "This Week");
  assertEquals(dueBucket(at(2026, 11, 20), T), "Later");
  assertEquals(shortDue(at(2026, 10, 27, 18), T), "today 18:00");
  assertEquals(shortDue(at(2026, 10, 28), T, false), "tomorrow");
  assertEquals(shortDue(at(2026, 10, 30, 9), T), "Fri 09:00");
  assertEquals(shortDue(at(2026, 11, 20), T, false), "Nov 20");
  assertEquals(shortDue(at(2027, 1, 20), T, false), "Jan 20, 2027");
  assertEquals(dueChoices(T).map((c) => c.date), ["2026-10-27", "2026-10-28", "2026-11-02", "2026-11-10", null]);
});
