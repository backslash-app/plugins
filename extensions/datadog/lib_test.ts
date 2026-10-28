import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { account, HOSTS, SetupError } from "./api.ts";
import {
  cleanMessage,
  downtimesOf,
  duration,
  filterMonitors,
  findSite,
  isMuted,
  muteLabel,
  notifiedHandles,
  parseDashboards,
  parseDowntimes,
  parseIncidents,
  type RawMonitor,
  severityColor,
  sortIncidents,
  sortMonitors,
  toMonitor,
  withDowntimes,
} from "./lib.ts";

const NOW = Date.parse("2026-10-28T12:00:00Z");

const MONITORS: RawMonitor[] = [
  {
    id: 1001,
    name: "Disk space low on {{host.name}}",
    type: "metric alert",
    query: "avg(last_5m):avg:system.disk.in_use{env:prod} by {host} > 0.9",
    message: "{{#is_alert}}Disk almost full{{/is_alert}} @slack-ops @pagerduty-Infra\nCheck /var/log",
    tags: ["env:prod", "team:infra"],
    priority: 2,
    overall_state: "Warn",
    overall_state_modified: "2026-10-28T10:00:00+00:00",
    creator: { name: "Alice Martin", email: "alice@example.com" },
    options: { silenced: {} },
    state: {
      groups: {
        "host:web-2": { status: "Warn", last_triggered_ts: 1761645600 },
        "host:web-1": { status: "Alert", last_triggered_ts: 1761645000 },
        "host:web-3": { status: "OK" },
      },
    },
  },
  {
    id: 1002,
    name: "API p99 latency",
    type: "query alert",
    tags: ["service:api"],
    priority: 1,
    overall_state: "Alert",
    options: { silenced: { "*": null } },
  },
  { id: 1003, name: "Heartbeat", type: "service check", overall_state: "No Data", priority: null },
  { id: 1004, name: "Backups", type: "event-v2 alert", overall_state: "OK", tags: ["team:infra", "backup"] },
];

Deno.test("monitors: worst groups first, legacy mute, order", () => {
  const ms = MONITORS.map(toMonitor);
  assertEquals(ms[0].groups.map((g) => [g.name, g.status]), [["host:web-1", "Alert"], ["host:web-2", "Warn"]]);
  assertEquals(ms[0].creator, "Alice Martin");
  assertEquals(ms[0].mutedUntil, undefined);
  assertEquals(ms[1].mutedUntil, Infinity);
  assertEquals(sortMonitors(ms).map((m) => m.id), [1002, 1001, 1003, 1004]);
  assertEquals(filterMonitors(ms, "triggered").length, 3);
  assertEquals(filterMonitors(ms, "muted", NOW).map((m) => m.id), [1002]);
  assertEquals(muteLabel(ms[1], NOW), "Muted");
});

const DOWNTIMES = {
  data: [
    {
      id: "00e000000-0000-1234-0000-000000000000",
      type: "downtime",
      attributes: {
        status: "active",
        scope: "*",
        monitor_identifier: { monitor_id: 1001 },
        schedule: { start: "2026-10-28T11:00:00Z", end: "2026-10-28T13:30:00.000Z" },
      },
    },
    {
      id: "tags-downtime",
      type: "downtime",
      attributes: { status: "active", monitor_identifier: { monitor_tags: ["backup"] }, schedule: null },
    },
    {
      id: "scheduled",
      type: "downtime",
      attributes: { status: "scheduled", monitor_identifier: { monitor_id: 1003 } },
    },
  ],
};

Deno.test("downtimes: by id or by tags, active only", () => {
  const downtimes = parseDowntimes(DOWNTIMES);
  assertEquals(downtimes.map((d) => d.id), ["00e000000-0000-1234-0000-000000000000", "tags-downtime"]);
  const ms = withDowntimes(MONITORS.map(toMonitor), downtimes);
  assert(isMuted(ms[0], NOW));
  assertEquals(muteLabel(ms[0], NOW), "Muted 1h 30m");
  assertEquals(ms[3].mutedUntil, Infinity);
  assertEquals(isMuted(ms[2], NOW), false);
  assertEquals(downtimesOf(ms[3], downtimes).map((d) => d.id), ["tags-downtime"]);
});

Deno.test("messages: templates and handles", () => {
  assertEquals(cleanMessage(MONITORS[0].message), "Disk almost full\nCheck /var/log");
  assertEquals(notifiedHandles(MONITORS[0].message), ["@slack-ops", "@pagerduty-Infra"]);
  assertEquals(notifiedHandles("mail @ops@example.com"), ["@ops@example.com"]);
});

Deno.test("dashboards: newest first", () => {
  const ds = parseDashboards({
    dashboards: [
      {
        id: "abc-def-ghi",
        title: "Old overview",
        url: "/dashboard/abc-def-ghi/old-overview",
        layout_type: "ordered",
        modified_at: "2025-01-01T00:00:00.000000+00:00",
        author_handle: "bob@example.com",
        is_read_only: false,
      },
      {
        id: "xyz-123-456",
        title: "Checkout",
        description: "Checkout funnel\nand errors",
        url: "/dashboard/xyz-123-456/checkout",
        layout_type: "free",
        modified_at: "2026-10-01T00:00:00.000000+00:00",
        is_read_only: true,
      },
    ],
  });
  assertEquals(ds.map((d) => d.id), ["xyz-123-456", "abc-def-ghi"]);
  assertEquals(ds[0].readOnly, true);
  assertEquals(ds[1].author, "bob@example.com");
});

const USERS = [
  { id: "u1", type: "users", attributes: { name: "Carol", handle: "carol@example.com" } },
  { id: "u2", type: "users", attributes: { name: null, handle: "dan@example.com" } },
];

const INCIDENT = (id: string, publicId: number, severity: string, state: string, created: string) => ({
  id,
  type: "incidents",
  attributes: {
    title: `Incident ${publicId}`,
    public_id: publicId,
    created,
    customer_impacted: severity === "SEV-1",
    customer_impact_scope: severity === "SEV-1" ? "Checkout down in EU" : null,
    fields: {
      severity: { type: "dropdown", value: severity },
      state: { type: "dropdown", value: state },
      teams: { type: "autocomplete", value: ["payments", "sre"] },
      root_cause: { type: "textbox", value: null },
    },
  },
  relationships: { commander_user: { data: { id: "u1", type: "users" } }, created_by_user: { data: { id: "u2" } } },
});

Deno.test("incidents: search and list shapes, users, order", () => {
  const list = parseIncidents({
    data: [
      INCIDENT("a", 11, "SEV-3", "active", "2026-10-28T09:00:00Z"),
      INCIDENT("b", 12, "SEV-1", "active", "2026-10-28T08:00:00Z"),
      INCIDENT("c", 9, "SEV-1", "resolved", "2026-10-20T08:00:00Z"),
      INCIDENT("d", 10, "SEV-2", "stable", "2026-10-25T08:00:00Z"),
    ],
    included: USERS,
  });
  assertEquals(list[1].commander, "Carol");
  assertEquals(list[1].createdBy, "dan@example.com");
  assertEquals(list[1].customerImpacted, true);
  assertEquals(list[0].fields, [{ name: "teams", value: "payments, sre" }]);
  assertEquals(sortIncidents(list).map((i) => i.publicId), [12, 11, 10, 9]);
  const search = parseIncidents({
    data: { attributes: { incidents: [{ data: INCIDENT("e", 13, "UNKNOWN", "active", "2026-10-28T10:00:00Z") }] } },
    included: USERS,
  });
  assertEquals(search.map((i) => [i.publicId, i.severity, i.state]), [[13, "UNKNOWN", "active"]]);
  // Older organizations: severity and state as attributes.
  const legacy = parseIncidents({
    data: [{ id: "f", attributes: { title: "x", severity: "SEV-4", state: "Stable" } }],
  });
  assertEquals([legacy[0].severity, legacy[0].state], ["SEV-4", "stable"]);
  assertEquals([severityColor("SEV-1"), severityColor("SEV-4"), severityColor("UNKNOWN")], ["red", "blue", "gray"]);
});

Deno.test("sites: names users paste", () => {
  assertEquals(findSite("")?.api, "api.datadoghq.com");
  assertEquals(findSite("https://app.datadoghq.eu/monitors/manage")?.api, "api.datadoghq.eu");
  assertEquals(findSite("us3")?.app, "us3.datadoghq.com");
  assertEquals(findSite("US5.datadoghq.com")?.api, "api.us5.datadoghq.com");
  assertEquals(findSite("ap1.datadoghq.com")?.api, "api.ap1.datadoghq.com");
  assertEquals(findSite("ddog-gov.com")?.app, "app.ddog-gov.com");
  assertEquals(findSite("EU1")?.id, "datadoghq.eu");
  assertEquals(findSite("example.com"), undefined);
});

Deno.test("account from preferences", () => {
  assertEquals(account({ site: "datadoghq.eu", apiKey: " k ", appKey: "a" }).apiKey, "k");
  let err: unknown;
  try {
    account({ site: "datadoghq.eu", apiKey: "k" });
  } catch (e) {
    err = e;
  }
  assert(err instanceof SetupError);
});

Deno.test("durations", () => {
  assertEquals(duration(45 * 60_000), "45m");
  assertEquals(duration(90 * 60_000), "1h 30m");
  assertEquals(duration(3 * 86_400_000), "3d");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});
