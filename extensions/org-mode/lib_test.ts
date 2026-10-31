import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  agenda,
  agendaSummary,
  appendEntry,
  captureEntry,
  ChangedError,
  DEFAULT_KEYWORDS,
  fileKeywords,
  formatTimestamp,
  inactiveNow,
  isOrgFile,
  markDone,
  occurrences,
  openTodos,
  orgToMarkdown,
  parseHeadingText,
  parseKeywords,
  parseOrg,
  parsePaths,
  parseTimestamp,
  replaceHeading,
  setKeywordLine,
  setPriorityLine,
  shiftRepeater,
  timestampsIn,
} from "./lib.ts";
import { ALLOWED } from "./org.ts";

// Wednesday, Oct 28 2026, 09:30 local time.
const NOW = new Date(2026, 9, 28, 9, 30);
const KW = parseKeywords(DEFAULT_KEYWORDS);

const FILE = `#+TITLE: Work
#+TODO: TODO NEXT STARTED | DONE
* Projects
** TODO [#A] Send the Q3 report :work:report:
   DEADLINE: <2026-10-26 Mon>
   The numbers are in =~/q3.ods=, see [[https://wiki.example.com/q3][the wiki]].
** NEXT Review Alice's PR
SCHEDULED: <2026-10-28 Wed 14:00>
** STARTED Migrate the database
SCHEDULED: <2026-10-25 Sun> DEADLINE: <2026-11-02 Mon -10d>
:PROPERTIES:
:EFFORT: 2h
:END:
** DONE Ship v2
CLOSED: [2026-10-27 Tue 17:02] SCHEDULED: <2026-10-27 Tue>
* Meetings
** Team standup
<2026-10-05 Mon 09:45 +1w>
** Dentist
<2026-10-30 Fri 11:00-11:30>
* Habits
** TODO Water the plants
SCHEDULED: <2026-10-24 Sat .+3d>
** TODO Someday learn Rust
#+BEGIN_SRC rust
* not a heading
<2026-10-28 Wed>
#+END_SRC
`;

const headings = parseOrg(FILE, "/home/me/org/work.org", KW);
const find = (title: string) => headings.find((h) => h.title === title)!;

Deno.test("keywords from preferences and #+TODO lines", () => {
  assertEquals(parseKeywords("TODO(t) NEXT WAIT(w@/!) | DONE(d!) CANCELED(c@)"), {
    todo: ["TODO", "NEXT", "WAIT"],
    done: ["DONE", "CANCELED"],
  });
  assertEquals(parseKeywords("TODO FEEDBACK VERIFY DONE"), { todo: ["TODO", "FEEDBACK", "VERIFY"], done: ["DONE"] });
  assertEquals(fileKeywords("#+SEQ_TODO: OPEN | CLOSED\n#+todo: IDEA | DROPPED\n"), {
    todo: ["OPEN", "IDEA"],
    done: ["CLOSED", "DROPPED"],
  });
  assertEquals(fileKeywords("* nothing"), undefined);
});

Deno.test("heading text: keyword, priority, title, tags", () => {
  assertEquals(parseHeadingText("TODO [#A] Call Bob :work:phone:", KW), {
    keyword: "TODO",
    done: false,
    priority: "A",
    title: "Call Bob",
    tags: ["work", "phone"],
  });
  assertEquals(parseHeadingText("TODOS are not keywords", KW).keyword, undefined);
  assertEquals(parseHeadingText("DONE", KW), { keyword: "DONE", done: true, priority: undefined, title: "", tags: [] });
  assertEquals(parseHeadingText("Time 10:30 is not a tag", KW).tags, []);
});

Deno.test("timestamps: time ranges, repeaters, warnings, inactive", () => {
  const t = parseTimestamp("<2026-11-02 Mon 9:00-10:30 ++1w -2d>")!;
  assertEquals([t.active, t.time, t.end, t.repeater, t.warning], [true, "09:00", "10:30", {
    kind: "++",
    n: 1,
    unit: "w",
  }, 2]);
  assertEquals(t.date.getTime(), new Date(2026, 10, 2).getTime());
  const i = parseTimestamp("[2026-10-27 Tue 17:02]")!;
  assertEquals([i.active, i.time], [false, "17:02"]);
  assertEquals(parseTimestamp("<2026-02-30 Mon>"), undefined);
  assertEquals(parseTimestamp("<2026-10-27 Tue]"), undefined);
  assertEquals(parseTimestamp("<2026-10-28 mer. 10:00>")?.time, "10:00");
  assertEquals(timestampsIn("Range <2026-10-28 Wed>--<2026-10-30 Fri>").length, 2);
});

Deno.test("parses headings with planning, path, body and blocks", () => {
  assertEquals(headings.map((h) => h.title), [
    "Projects",
    "Send the Q3 report",
    "Review Alice's PR",
    "Migrate the database",
    "Ship v2",
    "Meetings",
    "Team standup",
    "Dentist",
    "Habits",
    "Water the plants",
    "Someday learn Rust",
  ]);
  const report = find("Send the Q3 report");
  assertEquals([report.keyword, report.priority, report.tags, report.path, report.line], [
    "TODO",
    "A",
    ["work", "report"],
    ["Projects"],
    3,
  ]);
  assertEquals(report.deadline?.raw, "<2026-10-26 Mon>");
  assertEquals(report.body.length, 1);
  assertEquals(find("Migrate the database").keyword, "STARTED"); // from #+TODO
  assertEquals(find("Migrate the database").deadline?.warning, 10);
  const ship = find("Ship v2");
  assert(ship.done);
  assertEquals(ship.closed?.time, "17:02");
  assertEquals(find("Someday learn Rust").timestamps, []); // inside a src block
  assertEquals(find("Team standup").timestamps[0].repeater, { kind: "+", n: 1, unit: "w" });
});

Deno.test("occurrences of repeating timestamps", () => {
  const standup = parseTimestamp("<2026-10-05 Mon 09:45 +1w>")!;
  assertEquals(occurrences(standup, NOW, 7), [5]); // Monday Nov 2
  assertEquals(occurrences(parseTimestamp("<2026-10-28 Wed>")!, NOW, 0), [0]);
  assertEquals(occurrences(parseTimestamp("<2026-10-20 Tue>")!, NOW, 7), []);
  assertEquals(occurrences(parseTimestamp("<2026-10-01 Thu +1m>")!, NOW, 3), []);
  assertEquals(occurrences(parseTimestamp("<2026-10-01 Thu +1m>")!, NOW, 4), [4]);
});

Deno.test("the agenda: overdue, today, upcoming", () => {
  const entries = agenda(headings, NOW, 7);
  const rows = entries.map((e) => [e.section, e.heading.title, e.label]);
  assertEquals(rows, [
    ["Overdue", "Water the plants", "Sched. 4x"],
    ["Overdue", "Migrate the database", "Sched. 3x"],
    ["Overdue", "Send the Q3 report", "2d past deadline"],
    ["Today", "Review Alice's PR", "14:00"],
    ["Upcoming", "Dentist", "In 2d at 11:00"],
    ["Upcoming", "Team standup", "In 5d at 09:45"],
  ]);
  assertEquals(agendaSummary(entries), "3 overdue · 1 today");
  assertEquals(agendaSummary([]), undefined);
  // A deadline's own warning period wins over the lookahead.
  const late = parseOrg(
    "* TODO Taxes\nDEADLINE: <2026-11-20 Fri -30d>\n* TODO Far\nDEADLINE: <2026-11-20 Fri>",
    "f",
    KW,
  );
  assertEquals(agenda(late, NOW, 7).map((e) => [e.heading.title, e.label]), [["Taxes", "Deadline in 23d"]]);
});

Deno.test("open TODOs by priority, by keyword", () => {
  assertEquals(openTodos(headings).map((h) => h.title), [
    "Send the Q3 report",
    "Review Alice's PR",
    "Migrate the database",
    "Water the plants",
    "Someday learn Rust",
  ]);
  assertEquals(openTodos(headings, "NEXT").map((h) => h.title), ["Review Alice's PR"]);
});

Deno.test("repeaters move as Org moves them", () => {
  const plus = parseTimestamp("<2026-10-20 Tue +1w>")!;
  assertEquals(shiftRepeater(plus, NOW), "<2026-10-27 Tue +1w>");
  const plusplus = parseTimestamp("<2026-10-06 Tue 10:00 ++1w -1d>")!;
  assertEquals(shiftRepeater(plusplus, NOW), "<2026-11-03 Tue 10:00 ++1w -1d>");
  const dot = parseTimestamp("<2026-10-24 Sat .+3d>")!;
  assertEquals(shiftRepeater(dot, NOW), "<2026-10-31 Sat .+3d>");
  const monthly = parseTimestamp("<2026-10-15 Thu +1m>")!;
  assertEquals(shiftRepeater(monthly, NOW), "<2026-11-15 Sun +1m>");
  assertEquals(
    formatTimestamp(parseTimestamp("[2026-10-28 Wed 9:05]")!, new Date(2026, 9, 29)),
    "[2026-10-29 Thu 09:05]",
  );
  assertEquals(inactiveNow(NOW), "[2026-10-28 Wed 09:30]");
});

Deno.test("mark done: keyword, CLOSED, existing planning line kept", () => {
  const report = find("Send the Q3 report");
  const { text, repeatedTo } = markDone(FILE, report, "DONE", NOW);
  assertEquals(repeatedTo, undefined);
  const lines = text.split("\n");
  assertEquals(lines[3], "** DONE [#A] Send the Q3 report :work:report:");
  assertEquals(lines[4], "   CLOSED: [2026-10-28 Wed 09:30] DEADLINE: <2026-10-26 Mon>");
  assertEquals(lines.length, FILE.split("\n").length);
  // Nothing else moved.
  assertEquals(lines.slice(5).join("\n"), FILE.split("\n").slice(5).join("\n"));
});

Deno.test("mark done: adds a planning line, or none without CLOSED", () => {
  const rust = find("Someday learn Rust");
  const done = markDone(FILE, rust, "DONE", NOW).text.split("\n");
  assertEquals(done.slice(rust.line, rust.line + 2), ["** DONE Someday learn Rust", "CLOSED: [2026-10-28 Wed 09:30]"]);
  const quiet = markDone(FILE, rust, "DONE", NOW, { closed: false }).text.split("\n");
  assertEquals(quiet.slice(rust.line, rust.line + 2), ["** DONE Someday learn Rust", "#+BEGIN_SRC rust"]);
});

Deno.test("mark done: a repeating task moves to its next date and stays open", () => {
  const plants = find("Water the plants");
  const r = markDone(FILE, plants, "DONE", NOW);
  assertEquals(r.repeatedTo, "<2026-10-31 Sat .+3d>");
  const lines = r.text.split("\n");
  assertEquals(lines.slice(plants.line, plants.line + 5), [
    "** TODO Water the plants",
    "SCHEDULED: <2026-10-31 Sat .+3d>",
    ":PROPERTIES:",
    ":LAST_REPEAT: [2026-10-28 Wed 09:30]",
    ":END:",
  ]);
  // A second time updates the property instead of adding a drawer.
  const again = markDone(r.text, { ...plants, raw: lines[plants.line] }, "DONE", new Date(2026, 9, 31, 8, 0));
  const l2 = again.text.split("\n");
  assertEquals(l2.slice(plants.line + 1, plants.line + 5), [
    "SCHEDULED: <2026-11-03 Tue .+3d>",
    ":PROPERTIES:",
    ":LAST_REPEAT: [2026-10-31 Sat 08:00]",
    ":END:",
  ]);
});

Deno.test("edits refuse a heading that changed, follow one that moved", () => {
  const report = find("Send the Q3 report");
  assertThrows(() => markDone(FILE.replace("Send the Q3", "Send the Q4"), report, "DONE", NOW), ChangedError);
  const moved = "* Inserted above\n" + FILE;
  const lines = markDone(moved, report, "DONE", NOW).text.split("\n");
  assertEquals(lines[4], "** DONE [#A] Send the Q3 report :work:report:");
  assertThrows(() => replaceHeading("* x\n" + FILE + FILE, report, "x"), ChangedError); // twice: ambiguous
});

Deno.test("keyword and priority changes on the heading line", () => {
  assertEquals(setKeywordLine("** TODO [#A] Call :x:", "TODO", "NEXT"), "** NEXT [#A] Call :x:");
  assertEquals(setKeywordLine("** Call", undefined, "TODO"), "** TODO Call");
  assertEquals(setKeywordLine("** TODO Call", "TODO", undefined), "** Call");
  assertEquals(setKeywordLine("* TODO", "TODO", "DONE"), "* DONE");
  assertEquals(setPriorityLine("** TODO [#A] Call", "TODO", "C"), "** TODO [#C] Call");
  assertEquals(setPriorityLine("** TODO Call", "TODO", "A"), "** TODO [#A] Call");
  assertEquals(setPriorityLine("** [#B] Call", undefined, undefined), "** Call");
});

Deno.test("capture entries", () => {
  assertEquals(captureEntry("Call Bob :phone:", KW, NOW), "* TODO Call Bob :phone:\n[2026-10-28 Wed 09:30]\n");
  assertEquals(captureEntry("NEXT [#A] Call Bob", KW, NOW, { stamp: false }), "* NEXT [#A] Call Bob\n");
  assertEquals(captureEntry("Idea", KW, NOW, { keyword: "", stamp: false }), "* Idea\n");
  assertThrows(() => captureEntry("  ", KW, NOW));
  assertEquals(appendEntry("", "* A\n"), "* A\n");
  assertEquals(appendEntry("* X", "* A\n"), "* X\n* A\n");
  assertEquals(appendEntry("* X\n", "* A\n"), "* X\n* A\n");
});

Deno.test("org markup in the preview", () => {
  const md = orgToMarkdown([
    ":PROPERTIES:",
    ":ID: 123",
    ":END:",
    "Some *bold*, /italic/ and =code= with [[https://example.com][a link]].",
    "- [X] first",
    "+ [ ] second",
    "#+BEGIN_SRC sh",
    "echo hi",
    "#+END_SRC",
  ]);
  assertEquals(
    md,
    "Some **bold**, *italic* and `code` with [a link](https://example.com).\n- ☑ first\n- ☐ second\n```\necho hi\n```",
  );
  assertEquals(orgToMarkdown(["a", "b", "c"], 2), "a\nb\n\n_… 1 more lines_");
});

Deno.test("paths and files", () => {
  assertEquals(parsePaths("~/org, ~/notes/work.org\n~/org", "/home/me"), ["/home/me/org", "/home/me/notes/work.org"]);
  assert(isOrgFile("inbox.org"));
  assert(!isOrgFile("inbox.org_archive"));
  assert(!isOrgFile(".#inbox.org"));
  assert(!isOrgFile("#inbox.org#"));
});

Deno.test("manifest: read and write the same folders as ALLOWED", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.read, ALLOWED);
  assertEquals(manifest.permissions.write, ALLOWED);
  assertEquals(manifest.permissions.run, ["emacsclient", "emacs"]);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
