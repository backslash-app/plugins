import { assertEquals } from "@std/assert";
import {
  ago,
  anonKey,
  dashboardUrl,
  formatBytes,
  formatCount,
  formatLogs,
  functionLogsSql,
  functionStatus,
  groupProjects,
  logWindow,
  maskKey,
  parseLogs,
  parseTables,
  postgresVersion,
  type Project,
  regionName,
  statusInfo,
  TABLES_SQL,
  tableUrl,
  toDate,
} from "./lib.ts";

const PROJECTS: Project[] = [
  {
    id: "abcdefghijklmnopqrst",
    ref: "abcdefghijklmnopqrst",
    organization_id: "org-1",
    name: "Shop",
    region: "eu-central-1",
    created_at: "2025-03-01T10:00:00.000Z",
    status: "ACTIVE_HEALTHY",
    database: {
      host: "db.abcdefghijklmnopqrst.supabase.co",
      version: "17.4.1.054",
      postgres_engine: "17",
      release_channel: "ga",
    },
  },
  {
    ref: "pausedpausedpaused00",
    organization_id: "org-1",
    name: "Old demo",
    region: "us-east-1",
    status: "INACTIVE",
    database: { version: "15.1.0.147" },
  },
  {
    ref: "brokenbrokenbroken00",
    organization_slug: "side",
    name: "Analytics",
    region: "ap-south-1",
    status: "ACTIVE_UNHEALTHY",
  },
  { ref: "gonegonegonegonegone", organization_id: "org-1", name: "Deleted", region: "us-east-1", status: "REMOVED" },
];

Deno.test("statuses, regions and versions", () => {
  assertEquals(statusInfo("ACTIVE_HEALTHY"), { label: "Healthy", color: "green", health: "ok" });
  assertEquals(statusInfo("INACTIVE").label, "Paused");
  assertEquals(statusInfo("COMING_UP").health, "busy");
  assertEquals(statusInfo("SOMETHING_NEW").label, "Something new");
  assertEquals(regionName("eu-central-1"), "Central EU (Frankfurt)");
  assertEquals(regionName("mars-1"), "mars-1");
  assertEquals(postgresVersion("17.4.1.054"), "17.4");
  assertEquals(postgresVersion(undefined), undefined);
});

Deno.test("projects grouped by organization, problems first, removed hidden", () => {
  const groups = groupProjects(PROJECTS, [{ id: "org-1", slug: "acme", name: "Acme" }, {
    id: "org-2",
    slug: "side",
    name: "Side Gig",
  }]);
  assertEquals(groups.map(([org, ps]) => [org, ps.map((p) => p.name)]), [
    ["Acme", ["Shop", "Old demo"]],
    ["Side Gig", ["Analytics"]],
  ]);
  assertEquals(groupProjects([PROJECTS[0]], [])[0][0], "org-1");
});

Deno.test("keys", () => {
  const legacy = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig1234";
  assertEquals(anonKey([{ name: "service_role", api_key: "x" }, { name: "anon", api_key: legacy }]), legacy);
  assertEquals(
    anonKey([{ name: "default", api_key: "sb_publishable_abc", type: "publishable" }]),
    "sb_publishable_abc",
  );
  assertEquals(anonKey([]), undefined);
  assertEquals(maskKey(legacy), "eyJhbG…1234");
  assertEquals(maskKey("short"), "••••");
});

Deno.test("tables", () => {
  const tables = parseTables([
    { schema: "public", name: "todos", id: 17321, rows: "1234", bytes: 98304, rls: true, comment: "Tasks" },
    { schema: "public", name: "profiles", id: "17400", rows: -1, bytes: "16384", rls: false, comment: null },
    { schema: "billing", name: "invoices", id: 18000, rows: 5, bytes: 8192, rls: "t" },
  ]);
  assertEquals(tables[0], {
    schema: "public",
    name: "todos",
    id: 17321,
    rows: 1234,
    bytes: 98304,
    rls: true,
    comment: "Tasks",
  });
  assertEquals([tables[1].rows, tables[1].bytes, tables[1].rls, tables[1].comment], [0, 16384, false, undefined]);
  assertEquals(tables[2].rls, true);
  assertEquals(parseTables({ message: "nope" }), []);
  assertEquals(tableUrl("ref", tables[2]), "https://supabase.com/dashboard/project/ref/editor/18000?schema=billing");
  assertEquals(TABLES_SQL.includes("'auth'"), true);
  assertEquals(dashboardUrl("ref", "/sql/new"), "https://supabase.com/dashboard/project/ref/sql/new");
});

Deno.test("functions", () => {
  assertEquals(functionStatus("ACTIVE"), { label: "Active", color: "green" });
  assertEquals(functionStatus("THROTTLED").color, "orange");
  assertEquals(toDate(1761645600000)?.toISOString(), "2025-10-28T10:00:00.000Z");
  assertEquals(toDate("2026-10-28T10:00:00Z")?.toISOString(), "2026-10-28T10:00:00.000Z");
  assertEquals(toDate(null), undefined);
  assertEquals(functionLogsSql("abc-123'; drop").includes("'abc-123drop'"), true);
});

Deno.test("logs", () => {
  const lines = parseLogs({
    result: [
      { id: "1", timestamp: 1761645852000000, event_message: "Booted (time: 21ms)\n", level: "log" },
      { id: "2", timestamp: 1761645853000000, event_message: "TypeError: x is undefined", level: "error" },
      {
        id: "3",
        timestamp: 1761645854000000,
        event_message: "GET | 200 | /rest/v1/todos",
        status_code: 200,
        method: "GET",
        path: "/rest/v1/todos",
      },
    ],
  });
  assertEquals(lines[0].time.toISOString(), "2025-10-28T10:04:12.000Z");
  assertEquals(formatLogs(lines).split("\n"), [
    "10:04:12  LOG    Booted (time: 21ms)",
    "10:04:13  ERROR  TypeError: x is undefined",
    "10:04:14  200  GET /rest/v1/todos",
  ]);
  assertEquals(parseLogs({ error: "bad" }), []);
  assertEquals(logWindow(new Date("2026-10-28T12:00:00Z")), {
    iso_timestamp_start: "2026-10-28T11:00:00.000Z",
    iso_timestamp_end: "2026-10-28T12:00:00.000Z",
  });
});

Deno.test("formatting", () => {
  assertEquals(formatBytes(512), "512 B");
  assertEquals(formatBytes(98304), "96 kB");
  assertEquals(formatBytes(5 * 1024 * 1024), "5.0 MB");
  assertEquals(formatCount(999), "999");
  assertEquals(formatCount(1234), "1.2k");
  assertEquals(formatCount(3_400_000), "3.4M");
  const now = Date.parse("2026-10-28T12:00:00Z");
  assertEquals(ago(new Date("2026-10-28T11:30:00Z"), now), "30 min ago");
  assertEquals(ago(new Date("2026-10-01T12:00:00Z"), now), "27 d ago");
});
