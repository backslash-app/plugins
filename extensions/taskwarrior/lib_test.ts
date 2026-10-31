import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  addArgs,
  BASE,
  blockedBy,
  cleanReport,
  createdId,
  dueState,
  dueSummary,
  editValues,
  elapsed,
  exportArgs,
  isWaiting,
  matchesFilter,
  modifyArgs,
  parseExport,
  parseReports,
  parseTwDate,
  relativeDay,
  sortByUrgency,
  sortReports,
  splitWords,
  taskArgs,
  taskMarkdown,
  topLabels,
  twDateInput,
} from "./lib.ts";

// Wednesday, Oct 28 2026, 10:00 local time.
const NOW = new Date(2026, 9, 28, 10, 0);
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const EXPORT = `[
{"id":1,"description":"Pay the electricity bill","due":"${
  utc(new Date(2026, 9, 27, 0, 0))
}","entry":"20261001T080000Z","modified":"20261020T080000Z","priority":"H","project":"Home.Bills","status":"pending","tags":["money"],"uuid":"a1a1a1a1-0000-4000-8000-000000000001","urgency":17.4},
{"id":2,"description":"Write the quarterly report","due":"${
  utc(new Date(2026, 9, 28, 23, 59))
}","entry":"20261015T080000Z","project":"Work","start":"${
  utc(new Date(2026, 9, 28, 9, 15))
}","status":"pending","tags":["next","writing"],"uuid":"b2b2b2b2-0000-4000-8000-000000000002","urgency":21.2,
"annotations":[{"entry":"20261020T100000Z","description":"Draft in ~/Documents/q3.odt"}],"estimate":"3h"},
{"id":3,"description":"Book flights","depends":"a1a1a1a1-0000-4000-8000-000000000001","entry":"20261025T080000Z","project":"Travel","status":"pending","uuid":"c3c3c3c3-0000-4000-8000-000000000003","urgency":-3.2},
{"id":4,"description":"Renew passport","wait":"${
  utc(new Date(2026, 11, 1))
}","entry":"20261025T080000Z","status":"pending","uuid":"d4d4d4d4-0000-4000-8000-000000000004","urgency":0.8},
{"id":5,"description":"Old-style waiting","wait":"20260101T000000Z","status":"waiting","uuid":"e5e5e5e5-0000-4000-8000-000000000005","urgency":0.1},
{"id":6,"description":"Water the plants","due":"${
  utc(new Date(2026, 10, 2))
}","recur":"weekly","status":"pending","tags":["next"],"uuid":"f6f6f6f6-0000-4000-8000-000000000006","urgency":8.9,"parent":"f0f0f0f0-0000-4000-8000-00000000000f"}
]`;

const tasks = parseExport(EXPORT);
const byId = (id: number) => tasks.find((t) => t.id === id)!;

Deno.test("Taskwarrior dates", () => {
  assertEquals(parseTwDate("20261031T120000Z")?.toISOString(), "2026-10-31T12:00:00.000Z");
  assertEquals(parseTwDate("2026-10-31T12:00:00Z")?.toISOString(), "2026-10-31T12:00:00.000Z");
  assertEquals(parseTwDate("nonsense"), undefined);
  assertEquals(parseTwDate(undefined), undefined);
});

Deno.test("parses the export: fields, annotations, depends string, UDAs", () => {
  assertEquals(tasks.length, 6);
  const t = byId(2);
  assertEquals(t.project, "Work");
  assertEquals(t.tags, ["next", "writing"]);
  assertEquals(t.urgency, 21.2);
  assertEquals(t.annotations[0].description, "Draft in ~/Documents/q3.odt");
  assertEquals(t.udas, { estimate: "3h" });
  assertEquals(byId(3).depends, ["a1a1a1a1-0000-4000-8000-000000000001"]);
  assertEquals(byId(1).priority, "H");
  assertEquals(byId(6).udas, {}); // parent is known, not a UDA
});

Deno.test("parses depends as an array (2.6+), hook noise and one object per line", () => {
  const t = parseExport(
    'Hook: on-launch ok\n[{"uuid":"x1","description":"A","depends":["u1","u2"],"status":"pending"}]\n',
  );
  assertEquals(t[0].depends, ["u1", "u2"]);
  const lines = parseExport('{"uuid":"x1","description":"A","status":"pending"},\n{"uuid":"x2","description":"B"}');
  assertEquals(lines.map((t) => t.description), ["A", "B"]);
  assertEquals(parseExport(""), []);
  assertEquals(parseExport("[]"), []);
  assertEquals(parseExport('[{"description":"no uuid"}]'), []);
});

Deno.test("waiting: old status and future wait date", () => {
  assert(isWaiting(byId(4), NOW));
  assert(isWaiting(byId(5), NOW));
  assert(!isWaiting(byId(1), NOW));
});

Deno.test("due states and relative days", () => {
  assertEquals(dueState(byId(1), NOW), "overdue");
  assertEquals(dueState(byId(2), NOW), "today");
  assertEquals(dueState(byId(6), NOW), "soon");
  assertEquals(dueState(byId(3), NOW), undefined);
  assertEquals(relativeDay(new Date(2026, 9, 28, 23), NOW), "today");
  assertEquals(relativeDay(new Date(2026, 9, 29), NOW), "tomorrow");
  assertEquals(relativeDay(new Date(2026, 9, 27), NOW), "yesterday");
  assertEquals(relativeDay(new Date(2026, 10, 2), NOW), "in 5d");
  assertEquals(relativeDay(new Date(2026, 9, 20), NOW), "8d ago");
  assertEquals(relativeDay(new Date(2026, 11, 25), NOW), "Dec 25");
  assertEquals(relativeDay(new Date(2027, 0, 5), NOW), "Jan 5, 2027");
});

Deno.test("summary for the root search", () => {
  assertEquals(dueSummary(tasks, NOW), "1 overdue · 1 due today · 1 active");
  assertEquals(dueSummary([byId(3)], NOW), undefined);
});

Deno.test("sorted by urgency, ties by due date", () => {
  assertEquals(sortByUrgency(tasks).map((t) => t.id), [2, 1, 6, 4, 5, 3]);
  const [a, b] = parseExport(
    '[{"id":1,"uuid":"1","urgency":2},{"id":2,"uuid":"2","urgency":2,"due":"20261101T000000Z"}]',
  );
  assertEquals(sortByUrgency([a, b]).map((t) => t.id), [2, 1]);
});

Deno.test("filter chips", () => {
  const ids = (f: string) => tasks.filter((t) => matchesFilter(t, f, NOW)).map((t) => t.id);
  assertEquals(ids("all"), [1, 2, 3, 6]);
  assertEquals(ids("due"), [1, 2, 6]);
  assertEquals(ids("active"), [2]);
  assertEquals(ids("waiting"), [4, 5]);
  assertEquals(ids("project:Home"), [1]);
  assertEquals(ids("project:Hom"), []);
  assertEquals(ids("+next"), [2, 6]);
});

Deno.test("top projects and tags", () => {
  assertEquals(topLabels(tasks), { projects: ["Home", "Travel", "Work"], tags: ["next", "money", "writing"] });
});

Deno.test("blocked by open tasks only", () => {
  const open = new Map(tasks.map((t) => [t.uuid, t]));
  assertEquals(blockedBy(byId(3), open).map((t) => t.id), [1]);
  assertEquals(blockedBy(byId(3), new Map()), []);
});

Deno.test("export arguments", () => {
  assertEquals(
    exportArgs("all", NOW).slice(-6),
    ["(", "status:pending", "or", "status:waiting", ")", "export"],
  );
  const done = exportArgs("done", NOW);
  assert(done.includes("status:completed"));
  assert(done.includes("end.after:2026-10-14"));
  assertEquals(done.at(-1), "export");
  for (const o of BASE) assert(done.includes(o));
});

Deno.test("quick add keeps quoted words together", () => {
  assertEquals(splitWords(`Call "Bob Smith" project:Home  due:fri +phone`), [
    "Call",
    "Bob Smith",
    "project:Home",
    "due:fri",
    "+phone",
  ]);
  assertEquals(splitWords("it's 'a test'"), ["it's", "a test"]);
  const args = addArgs("Buy milk project:Home due:tomorrow");
  assertEquals(args.slice(args.indexOf("add")), ["add", "Buy", "milk", "project:Home", "due:tomorrow"]);
  assert(args.includes("rc.confirmation=off"));
  assertThrows(() => addArgs("   "));
});

Deno.test("created id from task add", () => {
  assertEquals(createdId("Created task 42."), "42");
  assertEquals(createdId("Created task 7 (recurrence template)."), "7");
  assertEquals(createdId("Created task 3f2a5b6c-1111-4222-8333-444455556666."), "3f2a5b6c-1111-4222-8333-444455556666");
  assertEquals(createdId(""), undefined);
});

Deno.test("change arguments keep text literal", () => {
  assertEquals(taskArgs("u1", "annotate", "due:fri is a note").slice(-4), [
    "u1",
    "annotate",
    "--",
    "due:fri is a note",
  ]);
  assertEquals(taskArgs("u1", "done").slice(-2), ["u1", "done"]);
});

Deno.test("modify: only what changed, tags added and removed", () => {
  const t = byId(2);
  const v = editValues(t);
  assertEquals(v.tags, "next writing");
  assertEquals(v.due, "2026-10-28");
  assertEquals(modifyArgs(t, v), []);
  const args = modifyArgs(t, { ...v, project: "", tags: "+next, review", priority: "m", due: "fri" });
  assertEquals(args.slice(args.indexOf("modify")), [
    "modify",
    "project:",
    "priority:M",
    "due:fri",
    "+review",
    "-writing",
  ]);
  const renamed = modifyArgs(t, { ...v, description: "Write the Q3 report" });
  assertEquals(renamed.slice(-2), ["--", "Write the Q3 report"]);
  assertThrows(() => modifyArgs(t, { ...v, priority: "X" }));
  assertThrows(() => modifyArgs(t, { ...v, due: "next friday" }));
  assertThrows(() => modifyArgs(t, { ...v, description: " " }));
});

Deno.test("dates written back for the form", () => {
  assertEquals(twDateInput(new Date(2026, 10, 2, 0, 0)), "2026-11-02");
  assertEquals(twDateInput(new Date(2026, 10, 2, 23, 59)), "2026-11-02");
  assertEquals(twDateInput(new Date(2026, 10, 2, 14, 30)), "2026-11-02T14:30");
});

Deno.test("elapsed time of an active task", () => {
  assertEquals(elapsed(new Date(2026, 9, 28, 9, 15), NOW), "45m");
  assertEquals(elapsed(new Date(2026, 9, 28, 7, 50), NOW), "2h 10m");
  assertEquals(elapsed(new Date(2026, 9, 28, 8, 0), NOW), "2h");
  assertEquals(elapsed(new Date(2026, 9, 25, 8, 0), NOW), "3d");
});

Deno.test("reports table", () => {
  const out = `
Report     Description
---------- ---------------------------------------------------
active     Active tasks
all        All tasks
completed  Completed tasks
list       Most details of tasks
next       Most urgent tasks
overdue    Overdue tasks

6 reports
`;
  const reports = parseReports(out);
  assertEquals(reports.map((r) => r.name), ["active", "all", "completed", "list", "next", "overdue"]);
  assertEquals(reports[4].description, "Most urgent tasks");
  const sorted = sortReports(reports).map((r) => r.name);
  assertEquals(sorted.slice(0, 5), ["next", "active", "overdue", "completed", "summary"]);
  assert(sorted.includes("burndown.weekly"));
  assertEquals(new Set(sorted).size, sorted.length);
});

Deno.test("report text for the preview", () => {
  assertEquals(cleanReport("\n\n\x1b[1mID\x1b[0m Desc   \n1  Pay  \n"), "ID Desc\n1  Pay\n");
  assertEquals(cleanReport("a\nb\nc\nd", 2), "a\nb\n… 2 more lines");
  assertEquals(cleanReport("```"), "'''");
});

Deno.test("preview markdown escapes and lists annotations and blockers", () => {
  const md = taskMarkdown(byId(3), [byId(1)], NOW);
  assert(md.startsWith("### Book flights"));
  assert(md.includes("**Blocked by**\n- 1: Pay the electricity bill"));
  const md2 = taskMarkdown(byId(2), [], NOW);
  assert(md2.includes("- Draft in ~/Documents/q3.odt _(8d ago)_"));
  assertEquals(
    taskMarkdown({ ...byId(3), description: "Fix *all* the #bugs" }, [], NOW),
    "### Fix \\*all\\* the \\#bugs",
  );
});

Deno.test("manifest: only the task program", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions, { run: ["task"] });
  assertEquals(manifest.extension.version, "1.0.0");
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  }
});
