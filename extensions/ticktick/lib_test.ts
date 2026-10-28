import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  AuthError,
  checklist,
  colorOf,
  dateFields,
  dueBucket,
  dueChoices,
  dueOf,
  findProject,
  parseQuickAdd,
  parseWhen,
  priorityOf,
  provider,
  repeatText,
  shortDue,
  sortTasks,
  type Task,
  taskMarkdown,
  taskSection,
  tickDate,
  tickError,
  toTick,
} from "./lib.ts";

Deno.test("provider: the user's own app, basic auth, the registered port", () => {
  assertThrows(() => provider({}), AuthError, "Connect");
  assertThrows(() => provider({ clientId: "abc" }), AuthError, "Client Secret");
  const p = provider({ clientId: " abc ", clientSecret: " s3cret ", redirectPort: 43118 });
  assertEquals(p.clientId, "abc");
  assertEquals(p.clientSecret, "s3cret");
  assertEquals(p.clientAuth, "basic");
  assertEquals(p.redirectPort, 43118);
  assertEquals(p.scopes, ["tasks:read", "tasks:write"]);
  assertEquals(new URL(p.tokenUrl).host, "ticktick.com");
  assertEquals(provider({ clientId: "a", clientSecret: "b", redirectPort: "" }).redirectPort, 43118);
  assertEquals(provider({ clientId: "a", clientSecret: "b", redirectPort: 9000 }).redirectPort, 9000);
});

Deno.test("errors", () => {
  assertInstanceOf(tickError(401, ""), AuthError);
  assertEquals(tickError(500, '{"errorMessage":"boom"}').message, "TickTick answered 500: boom");
  assertEquals(tickError(400, "bad request").message, "TickTick answered 400: bad request");
});

Deno.test("TickTick dates", () => {
  assertEquals(tickDate("2026-10-29T15:00:00.000+0000")?.toISOString(), "2026-10-29T15:00:00.000Z");
  assertEquals(tickDate("2026-10-29T15:00:00+0100")?.toISOString(), "2026-10-29T14:00:00.000Z");
  assertEquals(tickDate(""), undefined);
  assertEquals(tickDate("nope"), undefined);
  assertEquals(toTick(new Date("2026-10-29T15:00:00Z")), "2026-10-29T15:00:00.000+0000");
  const allDay = dateFields({ date: new Date(2026, 9, 30, 12), time: false }, "Europe/Paris");
  assertEquals(allDay.isAllDay, true);
  assertEquals(allDay.timeZone, "Europe/Paris");
  assertEquals(tickDate(allDay.dueDate)?.getTime(), new Date(2026, 9, 30).getTime());
  const atTime = dateFields({ date: new Date(2026, 9, 30, 15, 30), time: true }, "UTC");
  assertEquals(atTime.isAllDay, false);
  assertEquals(tickDate(atTime.startDate)?.getTime(), new Date(2026, 9, 30, 15, 30).getTime());
});

const NOW = new Date(2026, 9, 27, 14, 10, 0);
const task = (over: Partial<Task>): Task => ({
  id: "t",
  projectId: "p",
  title: "Task",
  priority: 0,
  status: 0,
  ...over,
});

Deno.test("tasks: due, sections, order", () => {
  const allDayToday = task({ id: "a", isAllDay: true, dueDate: toTick(new Date(2026, 9, 27)) });
  const lateAtTime = task({ id: "b", isAllDay: false, dueDate: toTick(new Date(2026, 9, 27, 9)) });
  const soon = task({ id: "c", isAllDay: false, dueDate: toTick(new Date(2026, 9, 28, 9)), priority: 5 });
  const none = task({ id: "d" });
  assertEquals(dueOf(allDayToday)?.time, false);
  assertEquals(taskSection(allDayToday, NOW), "Today");
  assertEquals(taskSection(lateAtTime, NOW), "Overdue");
  assertEquals(taskSection(soon, NOW), "Tomorrow");
  assertEquals(taskSection(none, NOW), "No Due Date");
  assertEquals(sortTasks([none, soon, allDayToday, lateAtTime], NOW).map((t) => t.id), ["b", "a", "c", "d"]);
  // A task with only a start date is due then.
  assertEquals(taskSection(task({ isAllDay: true, startDate: toTick(new Date(2026, 9, 27)) }), NOW), "Today");
});

Deno.test("priorities, colors, repeats, checklists", () => {
  assertEquals(priorityOf(5).name, "High");
  assertEquals(priorityOf(3).color, "yellow");
  assertEquals(priorityOf(42).name, "None");
  assertEquals(colorOf("#F18181"), "red");
  assertEquals(colorOf("#4CA1FF"), "blue");
  assertEquals(repeatText("RRULE:FREQ=WEEKLY;INTERVAL=1"), "Every week");
  assertEquals(repeatText("RRULE:FREQ=DAILY;INTERVAL=2"), "Every 2 days");
  assertEquals(repeatText(null), undefined);
  const t = task({
    content: "Bring the slides",
    items: [{ id: "1", title: "Print", status: 1 }, { id: "2", title: "Staple", status: 0 }],
  });
  assertEquals(checklist(t), { done: 1, total: 2 });
  assertEquals(taskMarkdown(t), "Bring the slides\n\n- ~~Print~~\n- Staple");
  assertEquals(taskMarkdown(task({})), undefined);
});

Deno.test("quick add: dates, times, lists and priority", () => {
  const a = parseQuickAdd("Call Bob tomorrow 3pm ^Work !high", NOW);
  assertEquals(a.title, "Call Bob");
  assertEquals(a.when, { date: new Date(2026, 9, 28, 15), time: true });
  assertEquals(a.project, "Work");
  assertEquals(a.priority, 5);

  const b = parseQuickAdd("Pay rent on friday", NOW);
  assertEquals(b.title, "Pay rent");
  assertEquals(b.when, { date: new Date(2026, 9, 30), time: false });

  const c = parseQuickAdd("tomorrow call mom at 18:30 !!", NOW);
  assertEquals(c.title, "call mom");
  assertEquals(c.when, { date: new Date(2026, 9, 28, 18, 30), time: true });
  assertEquals(c.priority, 3);

  const d = parseQuickAdd("Dentist next week ~Personal_Stuff", NOW);
  assertEquals(d.title, "Dentist");
  assertEquals(d.when?.date, new Date(2026, 10, 2));
  assertEquals(d.project, "Personal Stuff");

  // Words that only look like dates stay in the title.
  const e = parseQuickAdd("Call Tom about the sun cream for 1h", NOW);
  assertEquals(e.title, "Call Tom about the sun cream for 1h");
  assertEquals(e.when, undefined);
  assertEquals(e.priority, 0);

  const f = parseQuickAdd("Buy 3 apples #groceries 2026-11-03", NOW);
  assertEquals(f.title, "Buy 3 apples #groceries");
  assertEquals(f.when, { date: new Date(2026, 10, 3), time: false });

  assertEquals(parseQuickAdd("Read 3 nov issue !low", NOW).when?.date, new Date(2026, 10, 3));
  assertEquals(parseQuickAdd("today", NOW).title, "today");
});

Deno.test("find the list a quick add names", () => {
  const lists = [{ id: "1", name: "📥 Inbox" }, { id: "2", name: "Work" }, { id: "3", name: "Personal stuff" }];
  assertEquals(findProject(lists, "work")?.id, "2");
  assertEquals(findProject(lists, "personal")?.id, "3");
  assertEquals(findProject(lists, "inbox")?.id, "1");
  assertEquals(findProject(lists, "garden"), undefined);
  assertEquals(findProject(lists, undefined), undefined);
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
