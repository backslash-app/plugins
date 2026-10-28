import { assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  chooseBackend,
  clockifyBody,
  clockifyProjects,
  dayKey,
  decimalHours,
  type Entry,
  formatClock,
  formatDuration,
  fromClockify,
  fromKimai,
  fromToggl,
  groupByDay,
  HOSTS,
  isAllowedHost,
  kimaiBody,
  kimaiChoices,
  localIso,
  normalizeUrl,
  parseTimew,
  recentEntries,
  startOfWeek,
  summaryText,
  timewDate,
  timewStartArgs,
  timewTags,
  tintOf,
  togglBody,
  togglProjects,
  totalToday,
  utcIso,
} from "./lib.ts";

const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const entry = (id: string, start: string, stop: string | undefined, description = "Work", project?: string): Entry => ({
  id,
  description,
  project: project ? { id: project, name: project } : undefined,
  tags: [],
  start,
  stop,
});

Deno.test("durations", () => {
  assertEquals(formatDuration(20), "0m");
  assertEquals(formatDuration(300), "5m");
  assertEquals(formatDuration(4500), "1h 15m");
  assertEquals(formatDuration(36000), "10h 00m");
  assertEquals(formatClock(4505), "1:15:05");
  assertEquals(decimalHours(4500), "1.25");
  assertEquals(decimalHours(1200), "0.33");
});

Deno.test("dates", () => {
  const wed = new Date(2026, 9, 28, 15, 30);
  assertEquals(dayKey(wed), "2026-10-28");
  assertEquals(dayKey(startOfWeek(wed)), "2026-10-26");
  assertEquals(dayKey(startOfWeek(new Date(2026, 10, 1, 10))), "2026-10-26"); // a Sunday
  assertEquals(localIso(new Date(2026, 9, 28, 9, 5, 7)), "2026-10-28T09:05:07");
  assertEquals(utcIso(new Date("2026-10-28T08:15:00.123Z")), "2026-10-28T08:15:00Z");
});

Deno.test("backend choice", () => {
  assertEquals(chooseBackend({ backend: "Toggl Track" }), "toggl");
  assertEquals(chooseBackend({ backend: "timew" }), "timewarrior");
  assertEquals(chooseBackend({ backend: "harvest" }), undefined);
  assertEquals(chooseBackend({ clockifyKey: "abc" }), "clockify");
  assertEquals(chooseBackend({ kimaiUrl: "https://k.lan", kimaiToken: "t" }), "kimai");
  assertEquals(chooseBackend({ kimaiUrl: "https://k.lan" }, true), "timewarrior");
  assertEquals(chooseBackend({}, false), undefined);
});

Deno.test("grouping by day, totals and summary", () => {
  const now = new Date(2026, 9, 28, 12, 0).getTime();
  const entries = [
    entry("1", at(2026, 10, 27, 9), at(2026, 10, 27, 10, 30), "Review", "Acme"),
    entry("2", at(2026, 10, 28, 8), at(2026, 10, 28, 9), "Write report", "Acme"),
    entry("3", at(2026, 10, 28, 9), at(2026, 10, 28, 9, 30), "Write report", "Acme"),
    entry("4", at(2026, 10, 28, 11, 30), undefined, "Standup"),
  ];
  const days = groupByDay(entries, now);
  assertEquals(days.map((d) => d.key), ["2026-10-28", "2026-10-27"]);
  assertEquals(days[0].entries.map((e) => e.id), ["4", "3", "2"]);
  assertEquals(days[0].seconds, 7200);
  assertEquals(totalToday(entries, now), 7200);
  assertEquals(
    summaryText(days, now),
    [
      "2026-10-27 (Yesterday): 1h 30m",
      "  - Review · Acme: 1h 30m (1.50 h)",
      "2026-10-28 (Today): 2h 00m",
      "  - Write report · Acme: 1h 30m (1.50 h)",
      "  - Standup: 30m (0.50 h)",
      "Total: 3h 30m",
    ].join("\n"),
  );
  assertEquals(recentEntries(entries).map((e) => e.id), ["4", "3", "1"]);
});

Deno.test("Toggl entries and bodies", () => {
  const projects = togglProjects(
    [
      { id: 11, workspace_id: 1, name: "Website", color: "#0b83d9", client_id: 5, active: true },
      { id: 12, workspace_id: 1, name: "Old", active: false },
    ],
    [{ id: 5, name: "Acme" }],
  );
  assertEquals(projects, [{ id: "11", name: "Website", color: "#0b83d9", client: "Acme" }]);
  const running = fromToggl({
    id: 3_456_789_012,
    workspace_id: 1,
    project_id: 11,
    description: "Landing page",
    start: "2026-10-28T08:00:00+00:00",
    stop: null,
    duration: -1,
    tags: ["design"],
    billable: true,
  }, projects);
  assertEquals(running.stop, undefined);
  assertEquals(running.project?.client, "Acme");
  const done = fromToggl({
    id: 1,
    workspace_id: 1,
    project_id: 99,
    project_name: "Internal",
    project_color: "#c7af14",
    description: null,
    start: "2026-10-28T06:00:00+00:00",
    stop: "2026-10-28T07:00:00+00:00",
    duration: 3600,
  });
  assertEquals(done.project?.name, "Internal");
  assertEquals(done.description, "");
  assertEquals(done.stop, "2026-10-28T07:00:00+00:00");
  assertEquals(
    togglBody({ description: "x", project: projects[0], tags: ["a"] }, 1, new Date("2026-10-28T08:00:00Z")),
    {
      created_with: "Backslash",
      description: "x",
      workspace_id: 1,
      project_id: 11,
      tags: ["a"],
      start: "2026-10-28T08:00:00Z",
      duration: -1,
    },
  );
});

Deno.test("Clockify entries and bodies", () => {
  const projects = clockifyProjects([
    { id: "p1", name: "Website", color: "#03A9F4", clientName: "Acme" },
    { id: "p2", name: "Archived", archived: true },
  ]);
  assertEquals(projects.length, 1);
  const e = fromClockify({
    id: "e1",
    description: "Landing page",
    project: { id: "p1", name: "Website", color: "#03A9F4", clientName: "Acme" },
    tags: [{ id: "t1", name: "design" }],
    billable: false,
    timeInterval: { start: "2026-10-28T08:00:00Z", end: null, duration: null },
  });
  assertEquals(e.project?.name, "Website");
  assertEquals(e.tags, ["design"]);
  assertEquals(e.stop, undefined);
  assertEquals(
    clockifyBody({ description: "x", project: projects[0], tagIds: ["t1"] }, new Date("2026-10-28T08:00:00Z")),
    {
      start: "2026-10-28T08:00:00Z",
      description: "x",
      projectId: "p1",
      tagIds: ["t1"],
      billable: false,
    },
  );
});

Deno.test("Timewarrior export", () => {
  const json = `[
{"id":3,"start":"20261027T080000Z","end":"20261027T093000Z","tags":["Review","acme"]},
{"id":2,"start":"20261028T070000Z","end":"20261028T080000Z","tags":["Write report","acme"],"annotation":"Write report"},
{"id":1,"start":"20261028T090000Z","tags":["standup"]}
]`;
  const entries = parseTimew(json);
  assertEquals(entries.map((e) => e.id), ["@3", "@2", "@1"]);
  assertEquals(entries[0].description, "Review acme");
  assertEquals(entries[1].description, "Write report");
  assertEquals(entries[2].stop, undefined);
  assertEquals(entries[0].start, "2026-10-27T08:00:00Z");
  assertEquals(timewDate("20261028T090000Z"), "2026-10-28T09:00:00Z");
  // Without ids (old Timewarrior), numbered from the newest.
  assertEquals(
    parseTimew(`[{"start":"20261028T070000Z","end":"20261028T080000Z"},{"start":"20261028T090000Z"}]`)
      .map((e) => e.id),
    ["@2", "@1"],
  );
  assertEquals(parseTimew(""), []);
  assertEquals(timewTags(entries).map((t) => t.id), ["acme", "Review", "standup", "Write report"]);
  assertEquals(timewStartArgs({ description: "Write report", project: { id: "acme", name: "acme" } }), [
    "start",
    "Write report",
    "acme",
  ]);
  assertEquals(timewStartArgs({ description: "" }), ["start"]);
});

Deno.test("Kimai timesheets, choices and bodies", () => {
  const choices = kimaiChoices(
    [{ id: 1, name: "Website", parentTitle: "Acme", color: "#5319e7" }, { id: 2, name: "Hidden", visible: false }],
    [
      { id: 10, name: "Design", project: 1 },
      { id: 11, name: "Meeting", project: null },
      { id: 12, name: "Other project's", project: 3 },
    ],
  );
  assertEquals(choices.map((c) => c.id), ["1:10", "1:11"]);
  assertEquals(choices[1].name, "Website › Meeting");
  const t = fromKimai({
    id: 77,
    begin: "2026-10-28T09:00:00+0100",
    end: null,
    description: "Landing page",
    tags: ["design"],
    project: { id: 1, name: "Website", color: "#5319e7", customer: { name: "Acme" } },
    activity: { id: 10, name: "Design" },
  });
  assertEquals(t.project?.id, "1:10");
  assertEquals(t.project?.name, "Website › Design");
  assertEquals(t.project?.client, "Acme");
  assertEquals(t.stop, undefined);
  assertEquals(fromKimai({ id: 1, begin: "x", project: 1, activity: 11 }, choices).project?.name, "Website › Meeting");
  assertEquals(kimaiBody({ description: "x", project: choices[0], tags: ["a", "b"] }, new Date(2026, 9, 28, 9)), {
    begin: "2026-10-28T09:00:00",
    project: 1,
    activity: 10,
    description: "x",
    tags: "a,b",
  });
  assertThrows(() => kimaiBody({ description: "x" }));
});

Deno.test("project colors to tints", () => {
  assertEquals(tintOf("#0b83d9"), "blue");
  assertEquals(tintOf("#d92b2b"), "red");
  assertEquals(tintOf("#2da608"), "green");
  assertEquals(tintOf("#999999"), "gray");
  assertEquals(tintOf(undefined), "gray");
});

Deno.test("Kimai addresses and hosts match the manifest", async () => {
  assertEquals(normalizeUrl("kimai.home.lan/api/"), "https://kimai.home.lan");
  assertEquals(normalizeUrl("http://192.168.1.5:8001/"), "http://192.168.1.5:8001");
  assertEquals(isAllowedHost("acme.kimai.cloud"), true);
  assertEquals(isAllowedHost("192.168.1.5"), true);
  assertEquals(isAllowedHost("kimai.example.com"), false);
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});
