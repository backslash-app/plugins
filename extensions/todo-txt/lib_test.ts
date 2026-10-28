import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  addBusinessDays,
  addMonths,
  applyEdit,
  completeTask,
  daysBetween,
  describeRecurrence,
  dueSummary,
  editValues,
  formatTask,
  keyValue,
  matchesFilter,
  normalizeNewTask,
  parseDateInput,
  parseFile,
  parseRecurrence,
  parseTask,
  relativeDay,
  replaceLine,
  sectionOf,
  setDue,
  setPriority,
  setTag,
  sortTasks,
  topLabels,
  uncompleteTask,
} from "./lib.ts";

const TODAY = "2026-10-28"; // a Wednesday

Deno.test("parses a full open task", () => {
  const t = parseTask("(A) 2026-10-01 Call Mom +Family @phone due:2026-10-30 t:2026-10-29 rec:+1w id:42");
  assertEquals(t.done, false);
  assertEquals(t.priority, "A");
  assertEquals(t.created, "2026-10-01");
  assertEquals(t.title, "Call Mom");
  assertEquals(t.projects, ["Family"]);
  assertEquals(t.contexts, ["phone"]);
  assertEquals(t.due, "2026-10-30");
  assertEquals(t.threshold, "2026-10-29");
  assertEquals(t.rec, "+1w");
  assertEquals(t.tags.id, "42");
  assertEquals(t.text, "Call Mom +Family @phone due:2026-10-30 t:2026-10-29 rec:+1w id:42");
});

Deno.test("parses completed tasks, with or without dates and pri:", () => {
  const a = parseTask("x 2026-10-27 2026-10-01 Pay rent +Home pri:B");
  assertEquals([a.done, a.completed, a.created, a.priority, a.title], [
    true,
    "2026-10-27",
    "2026-10-01",
    "B",
    "Pay rent",
  ]);
  const b = parseTask("x Buy milk");
  assertEquals([b.done, b.completed, b.created, b.title], [true, undefined, undefined, "Buy milk"]);
  const c = parseTask("x 2026-10-27 (A) Lenient app");
  assertEquals([c.completed, c.priority, c.title], ["2026-10-27", "A", "Lenient app"]);
});

Deno.test("what is not a priority, a date, a project or a tag", () => {
  // Priority must be first, uppercase, followed by a space.
  assertEquals(parseTask("Really (A) not first").priority, undefined);
  assertEquals(parseTask("(a) lowercase").priority, undefined);
  assertEquals(parseTask("(A)->arrow").priority, undefined);
  // "x" must be followed by a space and be lowercase.
  assertEquals(parseTask("xylophone lessons").done, false);
  assertEquals(parseTask("X 2026-10-01 shout").done, false);
  // Mid-text dates are text; e-mail addresses are not contexts; URLs and times are not tags.
  const t = parseTask("Email bob@example.com about https://x.org/a?b=c at 10:30 on 2026-11-01 C++");
  assertEquals(t.contexts, []);
  assertEquals(t.projects, []);
  assertEquals(t.tags, {});
  assertEquals(t.created, undefined);
  assertEquals(keyValue("due:2026-01-01"), ["due", "2026-01-01"]);
  assertEquals(keyValue("DUE:x"), ["due", "x"]);
  assertEquals(keyValue("a:b:c"), undefined);
  assertEquals(keyValue("10:30"), undefined);
  // An invalid date is kept as a tag but not as the due date.
  const bad = parseTask("Thing due:2026-13-45");
  assertEquals([bad.due, bad.tags.due], [undefined, "2026-13-45"]);
});

Deno.test("a task made only of tags keeps them as its title", () => {
  assertEquals(parseTask("+Garden @home").title, "+Garden @home");
  assertEquals(parseTask("(B) 2026-01-01").title, "");
});

Deno.test("parseFile skips blank lines and Windows line breaks", () => {
  const tasks = parseFile("(A) One\r\n\r\n  \nTwo +p\r\n");
  assertEquals(tasks.map((t) => t.title), ["One", "Two"]);
  assertEquals(tasks[0].raw, "(A) One");
});

Deno.test("formatTask round-trips and moves the priority of done tasks to pri:", () => {
  const lines = [
    "(A) 2026-10-01 Call Mom +Family @phone due:2026-10-30",
    "x 2026-10-27 2026-10-01 Pay rent pri:B",
    "Plain task",
  ];
  for (const l of lines) assertEquals(formatTask(parseTask(l)), l);
  assertEquals(
    formatTask({ done: true, completed: "2026-10-28", created: "2026-10-01", priority: "A", text: "Do it" }),
    "x 2026-10-28 2026-10-01 Do it pri:A",
  );
  // A creation date needs a completion date on a done task.
  assertEquals(formatTask({ done: true, created: "2026-10-01", text: "Do it" }), "x Do it");
});

Deno.test("setTag replaces, adds and removes", () => {
  assertEquals(setTag("Pay due:2026-01-01 +Home", "due", "2026-02-01"), "Pay due:2026-02-01 +Home");
  assertEquals(setTag("Pay +Home", "due", "2026-02-01"), "Pay +Home due:2026-02-01");
  assertEquals(setTag("Pay due:x due:y", "due", undefined), "Pay");
  assertEquals(setTag("See https://a.b/c", "https", undefined), "See https://a.b/c");
});

Deno.test("calendar arithmetic", () => {
  assertEquals(daysBetween("2026-03-28", "2026-03-30"), 2); // across a DST change in Europe
  assertEquals(daysBetween("2024-02-28", "2024-03-01"), 2); // leap year
  assertEquals(addMonths("2026-01-31", 1), "2026-02-28");
  assertEquals(addMonths("2024-01-31", 1), "2024-02-29");
  assertEquals(addMonths("2026-11-15", 3), "2027-02-15");
  assertEquals(addMonths("2024-02-29", 12), "2025-02-28");
  assertEquals(addBusinessDays("2026-10-30", 1), "2026-11-02"); // Friday → Monday
  assertEquals(addBusinessDays("2026-10-28", 3), "2026-11-02");
});

Deno.test("recurrence values", () => {
  assertEquals(parseRecurrence("1w"), { strict: false, amount: 1, unit: "w" });
  assertEquals(parseRecurrence("+2m"), { strict: true, amount: 2, unit: "m" });
  assertEquals(parseRecurrence("d"), { strict: false, amount: 1, unit: "d" });
  assertEquals(parseRecurrence("5B"), { strict: false, amount: 5, unit: "b" });
  assertEquals(parseRecurrence("0d"), undefined);
  assertEquals(parseRecurrence("weekly"), undefined);
  assertEquals(describeRecurrence("+2w"), "Every 2 weeks, from the due date");
  assertEquals(describeRecurrence("1d"), "Every day, from completion");
});

Deno.test("completing a plain task", () => {
  const t = parseTask("(A) 2026-10-01 Call Mom +Family");
  assertEquals(completeTask(t, TODAY), { done: "x 2026-10-28 2026-10-01 Call Mom +Family pri:A" });
});

Deno.test("completing a recurring task: from completion or strictly from the due date", () => {
  const loose = parseTask("(B) 2026-10-01 Water plants due:2026-10-20 rec:1w");
  assertEquals(completeTask(loose, TODAY), {
    done: "x 2026-10-28 2026-10-01 Water plants due:2026-10-20 rec:1w pri:B",
    next: "(B) 2026-10-28 Water plants due:2026-11-04 rec:1w",
  });
  const strict = parseTask("Pay rent due:2026-10-01 rec:+1m");
  assertEquals(completeTask(strict, TODAY).next, "Pay rent due:2026-11-01 rec:+1m");
  // Month ends are kept sensible.
  assertEquals(
    completeTask(parseTask("Report due:2026-01-31 rec:+1m"), "2026-01-31").next,
    "Report due:2026-02-28 rec:+1m",
  );
  // Yearly, across a leap day.
  assertEquals(
    completeTask(parseTask("Birthday due:2024-02-29 rec:+1y"), TODAY).next,
    "Birthday due:2025-02-28 rec:+1y",
  );
});

Deno.test("recurrence keeps the threshold's distance and handles tasks without dates", () => {
  const t = parseTask("Invoice due:2026-10-31 t:2026-10-25 rec:+1m");
  assertEquals(completeTask(t, TODAY).next, "Invoice due:2026-11-30 t:2026-11-24 rec:+1m");
  assertEquals(completeTask(parseTask("Stretch t:2026-10-28 rec:2d"), TODAY).next, "Stretch t:2026-10-30 rec:2d");
  assertEquals(completeTask(parseTask("Backup rec:1w"), TODAY).next, "Backup rec:1w due:2026-11-04");
  assertEquals(completeTask(parseTask("Standup due:2026-10-30 rec:+1b"), TODAY).next, "Standup due:2026-11-02 rec:+1b");
  // An invalid rec: is just completed.
  assertEquals(completeTask(parseTask("Oops rec:often"), TODAY).next, undefined);
});

Deno.test("reopening a task restores its priority", () => {
  assertEquals(uncompleteTask(parseTask("x 2026-10-27 2026-10-01 Pay rent pri:B")), "(B) 2026-10-01 Pay rent");
  assertEquals(uncompleteTask(parseTask("x Buy milk")), "Buy milk");
});

Deno.test("priority and due date changes", () => {
  const t = parseTask("(C) 2026-10-01 Read +Books");
  assertEquals(setPriority(t, "A"), "(A) 2026-10-01 Read +Books");
  assertEquals(setPriority(t, undefined), "2026-10-01 Read +Books");
  assertEquals(setPriority(parseTask("x 2026-10-27 Done thing pri:C"), "A"), "x 2026-10-27 Done thing pri:A");
  assertEquals(setDue(t, "2026-11-01"), "(C) 2026-10-01 Read +Books due:2026-11-01");
  assertEquals(setDue(parseTask("Read due:2026-11-01"), undefined), "Read");
});

Deno.test("dates typed by a person", () => {
  assertEquals(parseDateInput("2026-11-03", TODAY), "2026-11-03");
  assertEquals(parseDateInput("today", TODAY), TODAY);
  assertEquals(parseDateInput("Tomorrow", TODAY), "2026-10-29");
  assertEquals(parseDateInput("fri", TODAY), "2026-10-30");
  assertEquals(parseDateInput("wednesday", TODAY), "2026-11-04"); // never today
  assertEquals(parseDateInput("mon", TODAY), "2026-11-02");
  assertEquals(parseDateInput("3d", TODAY), "2026-10-31");
  assertEquals(parseDateInput("+2w", TODAY), "2026-11-11");
  assertEquals(parseDateInput("1m", TODAY), "2026-11-28");
  assertEquals(parseDateInput("next week", TODAY), "2026-11-04");
  assertEquals(parseDateInput("someday", TODAY), undefined);
  assertEquals(parseDateInput("mo", TODAY), undefined);
  assertEquals(parseDateInput("2026-02-30", TODAY), undefined);
});

Deno.test("new tasks get today's date and absolute due dates", () => {
  assertEquals(
    normalizeNewTask("(A) Call Bob +Work due:fri", TODAY, true),
    "(A) 2026-10-28 Call Bob +Work due:2026-10-30",
  );
  assertEquals(normalizeNewTask("Call Bob t:tomorrow", TODAY, false), "Call Bob t:2026-10-29");
  assertEquals(normalizeNewTask("2026-01-01 Old idea due:soon", TODAY, true), "2026-01-01 Old idea due:soon");
  assertEquals(normalizeNewTask("x Already done", TODAY, true), "x 2026-10-28 Already done");
});

Deno.test("the edit form splits dates out and puts them back", () => {
  const t = parseTask("(B) 2026-10-01 Call Mom +Family due:2026-10-30 rec:1w note:x");
  const v = editValues(t);
  assertEquals(v, {
    description: "Call Mom +Family note:x",
    priority: "B",
    due: "2026-10-30",
    threshold: "",
    rec: "1w",
  });
  assertEquals(applyEdit(t, v, TODAY, true), "(B) 2026-10-01 Call Mom +Family note:x due:2026-10-30 rec:1w");
  assertEquals(
    applyEdit(t, { ...v, priority: "", due: "tomorrow", rec: "" }, TODAY, true),
    "2026-10-01 Call Mom +Family note:x due:2026-10-29",
  );
  assertEquals(
    applyEdit(
      undefined,
      { description: "New one due:fri", priority: "a", due: "", threshold: "", rec: "" },
      TODAY,
      true,
    ),
    "(A) 2026-10-28 New one due:2026-10-30",
  );
  assertThrows(() => applyEdit(t, { ...v, due: "whenever" }, TODAY, true), Error, "not a date");
  assertThrows(() => applyEdit(t, { ...v, rec: "often" }, TODAY, true), Error, "Recurrence");
  assertThrows(() => applyEdit(t, { ...v, description: "  " }, TODAY, true), Error, "description");
  // Editing a done task keeps it done.
  const done = parseTask("x 2026-10-27 2026-10-01 Pay rent pri:B");
  assertEquals(applyEdit(done, editValues(done), TODAY, true), "x 2026-10-27 2026-10-01 Pay rent pri:B");
});

Deno.test("sections and sorting", () => {
  const lines = [
    "Someday",
    "(C) Later due:2026-11-20",
    "x 2026-10-20 Old",
    "(A) Late due:2026-10-01",
    "(B) Now due:2026-10-28",
    "(A) Now first due:2026-10-28",
    "Hidden for now t:2026-11-01",
    "(A) No date but urgent",
  ];
  const rows = parseFile(lines.join("\n")).map((task, index) => ({ task, index }));
  assertEquals(rows.map((r) => sectionOf(r.task, TODAY)), [
    "No Date",
    "Upcoming",
    "Completed",
    "Overdue",
    "Today",
    "Today",
    "Upcoming",
    "No Date",
  ]);
  assertEquals(sortTasks(rows, TODAY).map((r) => r.task.title), [
    "Late",
    "Now first",
    "Now",
    "Hidden for now",
    "Later",
    "No date but urgent",
    "Someday",
    "Old",
  ]);
  assertEquals(dueSummary(rows.map((r) => r.task), TODAY), "1 overdue · 2 due today");
  assertEquals(dueSummary([parseTask("Nothing due")], TODAY), undefined);
});

Deno.test("filters and the labels offered as chips", () => {
  const tasks = parseFile([
    "(A) Call +Work @phone due:2026-10-30",
    "Mail +Work @computer",
    "Garden +Home due:2026-12-01",
    "x Done +Work",
  ].join("\n"));
  const pick = (f: string) => tasks.filter((t) => matchesFilter(t, f, TODAY)).map((t) => t.title);
  assertEquals(pick("all"), ["Call", "Mail", "Garden"]);
  assertEquals(pick("due"), ["Call"]);
  assertEquals(pick("pri"), ["Call"]);
  assertEquals(pick("+work"), ["Call", "Mail"]);
  assertEquals(pick("@phone"), ["Call"]);
  assertEquals(pick("done"), ["Done"]);
  assertEquals(topLabels(tasks), { projects: ["Work", "Home"], contexts: ["computer", "phone"] });
});

Deno.test("relative days", () => {
  assertEquals(relativeDay(TODAY, TODAY), "today");
  assertEquals(relativeDay("2026-10-29", TODAY), "tomorrow");
  assertEquals(relativeDay("2026-10-27", TODAY), "yesterday");
  assertEquals(relativeDay("2026-11-01", TODAY), "in 4 days");
  assertEquals(relativeDay("2026-10-20", TODAY), "8 days ago");
  assertEquals(relativeDay("2026-12-25", TODAY), "Dec 25");
  assertEquals(relativeDay("2027-01-02", TODAY), "Jan 2, 2027");
});

Deno.test("replaceLine keeps line endings and detects concurrent edits", () => {
  assertEquals(replaceLine("a\nb\nc\n", "b", ["B"]), "a\nB\nc\n");
  assertEquals(replaceLine("a\r\nb\r\n", "b", []), "a\r\n");
  assertEquals(replaceLine("a\nb", "b", ["x", "y"]), "a\nx\ny\n"); // a final line break is added
  assertEquals(replaceLine("", undefined, ["first"]), "first\n");
  assertEquals(replaceLine("a\n", undefined, ["b"]), "a\nb\n");
  assertEquals(replaceLine("a\n", "a", []), "");
  assertEquals(replaceLine("a\n", "gone", ["x"]), undefined);
  assert(replaceLine("a  \n", "a", ["b"]) === "b\n");
});

Deno.test("completing on disk archives to done.txt and adds the next occurrence", async () => {
  const { complete, loadTasks, locate, changeLine } = await import("./todo.ts");
  const dir = await Deno.makeTempDir();
  try {
    await Deno.writeTextFile(`${dir}/todo.txt`, "(B) 2026-10-01 Water plants due:2026-10-28 rec:+1w\nBuy milk\n");
    const files = await locate({ preferences: { file: `${dir}/todo.txt` } });
    assertEquals(files.done, `${dir}/done.txt`);
    const [water] = (await loadTasks(files)).map((r) => r.task);
    const message = await complete(files, water, true);
    assert(message.startsWith("Done; next one"));
    const todo = await Deno.readTextFile(`${dir}/todo.txt`);
    assert(todo.startsWith("(B) "));
    assert(todo.includes("Water plants due:2026-11-04 rec:+1w"));
    assert(todo.endsWith("Buy milk\n"));
    assert(
      (await Deno.readTextFile(`${dir}/done.txt`)).match(/^x \d{4}-\d{2}-\d{2} 2026-10-01 Water plants .* pri:B\n$/),
    );
    // A line changed elsewhere meanwhile is not overwritten.
    let error = "";
    await changeLine(files, "Not there", ["x"]).catch((e) => (error = e.message));
    assert(error.includes("changed"));
    const withDone = await loadTasks(files, true);
    assertEquals(withDone.filter((r) => r.archived).length, 1);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
