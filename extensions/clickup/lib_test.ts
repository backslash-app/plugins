import { assertEquals, assertInstanceOf, assertThrows } from "@std/assert";
import {
  AuthError,
  avatarOf,
  clickupError,
  colorOf,
  dueBucket,
  dueChoices,
  dueColor,
  dueFields,
  estimate,
  hasTime,
  matchesFilter,
  parseWhen,
  priorityOf,
  shortDue,
  sortTasks,
  statusIcon,
  statusName,
  type Task,
  taskMetadata,
  tokenOf,
  whereOf,
} from "./lib.ts";

Deno.test("token and errors", () => {
  assertThrows(() => tokenOf({}), AuthError, "Connect");
  assertThrows(() => tokenOf({ token: "abc" }), AuthError, "pk_");
  assertEquals(tokenOf({ token: " pk_123_ABC " }), "pk_123_ABC");
  assertInstanceOf(clickupError(401, { err: "Token invalid", ECODE: "OAUTH_025" }), AuthError);
  assertInstanceOf(clickupError(400, { err: "Oauth token not found", ECODE: "OAUTH_019" }), AuthError);
  assertEquals(
    clickupError(400, { err: "Status does not exist", ECODE: "ITEM_120" }).message,
    "ClickUp answered 400: Status does not exist",
  );
});

Deno.test("status colors, icons and names", () => {
  assertEquals(colorOf("#d3d3d3"), "gray");
  assertEquals(colorOf("#4194f6"), "blue");
  assertEquals(colorOf("#6bc950"), "green");
  assertEquals(colorOf("#f50"), "orange");
  assertEquals(colorOf("#a875ff"), "purple");
  assertEquals(statusIcon({ status: "to do", color: "#d3d3d3", type: "open", orderindex: 0 }), {
    source: "bs-circle",
    tint: "gray",
  });
  assertEquals(
    statusIcon({ status: "in review", color: "#a875ff", type: "custom", orderindex: 2 }).source,
    "bs-circle-three-quarters",
  );
  assertEquals(
    statusIcon({ status: "in progress", color: "#4194f6", type: "custom", orderindex: 1 }).source,
    "bs-circle-half",
  );
  assertEquals(
    statusIcon({ status: "complete", color: "#6bc950", type: "closed", orderindex: 3 }).source,
    "bs-circle-check",
  );
  assertEquals(statusName("in progress"), "In Progress");
  assertEquals(statusName("à faire"), "À Faire");
});

const NOW = new Date(2026, 9, 27, 14, 10, 0);
const ms = (d: Date) => String(d.getTime());

function task(over: Partial<Task>): Task {
  return {
    id: "86abc",
    name: "Task",
    status: { status: "to do", color: "#d3d3d3", type: "open", orderindex: 0 },
    assignees: [],
    tags: [],
    priority: null,
    due_date: null,
    list: { id: "l1", name: "Sprint 12" },
    folder: { id: "f1", name: "Engineering", hidden: false },
    url: "https://app.clickup.com/t/86abc",
    ...over,
  };
}

Deno.test("filters by status type", () => {
  const open = task({});
  const doing = task({ status: { status: "in progress", color: "#4194f6", type: "custom", orderindex: 1 } });
  const done = task({ status: { status: "done", color: "#6bc950", type: "done", orderindex: 2 } });
  const closed = task({ status: { status: "closed", color: "#6bc950", type: "closed", orderindex: 3 } });
  assertEquals([open, doing, done, closed].map((t) => matchesFilter(t, "active")), [true, true, false, false]);
  assertEquals([open, doing, done, closed].map((t) => matchesFilter(t, "todo")), [true, false, false, false]);
  assertEquals([open, doing, done, closed].map((t) => matchesFilter(t, "progress")), [false, true, false, false]);
  assertEquals([open, doing, done, closed].map((t) => matchesFilter(t, "done")), [false, false, true, true]);
});

Deno.test("priorities and order", () => {
  const urgent = task({ id: "u", priority: { id: "1", priority: "urgent", color: "#f50000" } });
  const low = task({ id: "l", priority: { id: "4", priority: "low", color: "#d8d8d8" } });
  const none = task({ id: "n" });
  const doing = task({ id: "d", status: { status: "in progress", color: "#4194f6", type: "custom", orderindex: 1 } });
  assertEquals(priorityOf(urgent)?.name, "Urgent");
  assertEquals(priorityOf(none), undefined);
  assertEquals(sortTasks([none, low, urgent, doing]).map((t) => t.id), ["d", "u", "l", "n"]);
});

Deno.test("dates: ms strings, day-only dues, estimates", () => {
  assertEquals(hasTime(new Date(2026, 9, 28, 4, 0)), false);
  assertEquals(hasTime(new Date(2026, 9, 28, 15, 30)), true);
  const late = task({ due_date: ms(new Date(2026, 9, 26, 4, 0)) });
  assertEquals(dueColor(late, NOW), "red");
  assertEquals(dueColor(task({ due_date: ms(new Date(2026, 9, 27, 4, 0)) }), NOW), "orange");
  assertEquals(dueColor(task({ due_date: ms(new Date(2026, 10, 27)) }), NOW), undefined);
  assertEquals(estimate(9_000_000), "2h 30m");
  assertEquals(estimate(null), undefined);
  assertEquals(dueFields(undefined), { due_date: null });
  assertEquals(dueFields(parseWhen("friday", NOW)), {
    due_date: new Date(2026, 9, 30, 4).getTime(),
    due_date_time: false,
  });
  assertEquals(dueFields(parseWhen("friday 3pm", NOW)), {
    due_date: new Date(2026, 9, 30, 15).getTime(),
    due_date_time: true,
  });
});

Deno.test("metadata, place and avatars", () => {
  const t = task({
    custom_id: "ENG-42",
    due_date: ms(new Date(2026, 9, 28, 17, 0)),
    priority: { id: "2", priority: "high", color: "#ffcc00" },
    assignees: [
      { id: 1, username: "Ada", profilePicture: "https://attachments.clickup.com/profilePictures/1_abc.jpg" },
      { id: 2, username: "Grace", profilePicture: "https://elsewhere.example/x.jpg" },
    ],
    tags: [{ name: "backend", tag_bg: "#4194f6" }],
    time_estimate: 3_600_000,
  });
  const lines = taskMetadata(t, { team: "Acme" }, NOW);
  const by = (label: string) => lines.find((l) => l.label === label);
  assertEquals(by("Status")?.value, "To Do");
  assertEquals(by("Priority")?.value, "High");
  assertEquals(by("Due")?.value, "tomorrow 17:00");
  assertEquals(by("Assignees")?.avatar, "https://attachments.clickup.com/profilePictures/1_abc.jpg");
  assertEquals(by("Tags")?.tags, [{ text: "backend", color: "blue" }]);
  assertEquals(by("Estimate")?.value, "1h");
  assertEquals(by("ID")?.value, "ENG-42");
  assertEquals(by("Workspace")?.value, "Acme");
  assertEquals(avatarOf({ id: 2, username: "Grace", profilePicture: "https://elsewhere.example/x.jpg" }), "Grace");
  assertEquals(whereOf(t), "Engineering › Sprint 12");
  assertEquals(whereOf(task({ folder: { id: "f", name: "hidden", hidden: true } })), "Sprint 12");
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
