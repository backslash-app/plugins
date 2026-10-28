import { assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  absolute,
  alertName,
  duration,
  hostAllowed,
  HOSTS,
  matchersFor,
  matcherText,
  normalizeUrl,
  panelUrl,
  parseAlerts,
  parseDashboards,
  parseSilences,
  severityOf,
  silenceBody,
  sortAlerts,
  sortDashboards,
  sortSilences,
  visibleLabels,
} from "./lib.ts";

Deno.test("URLs", () => {
  assertEquals(normalizeUrl("acme.grafana.net/"), "https://acme.grafana.net");
  assertEquals(normalizeUrl("https://acme.grafana.net/d/abc/node?orgId=1"), "https://acme.grafana.net");
  assertEquals(normalizeUrl("grafana.local:3000"), "http://grafana.local:3000");
  assertEquals(normalizeUrl("192.168.1.20:3000/alerting/list"), "http://192.168.1.20:3000");
  assertEquals(normalizeUrl("grafana:3000"), "http://grafana:3000");
  assertEquals(normalizeUrl("https://nas.tail1234.ts.net/grafana/d/x"), "https://nas.tail1234.ts.net/grafana");
  assertEquals(normalizeUrl(""), "");
  assertEquals(absolute("https://acme.grafana.net", "/d/abc/node"), "https://acme.grafana.net/d/abc/node");
  assertEquals(absolute("https://h.ts.net/grafana", "/grafana/d/abc/node"), "https://h.ts.net/grafana/d/abc/node");
  assertEquals(absolute("https://h.ts.net/grafana", "/d/abc"), "https://h.ts.net/grafana/d/abc");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.net, HOSTS);
  assertEquals(hostAllowed("acme.grafana.net"), true);
  assertEquals(hostAllowed("grafana.local"), true);
  assertEquals(hostAllowed("192.168.1.20"), true);
  assertEquals(hostAllowed("172.20.0.4"), true);
  assertEquals(hostAllowed("172.32.0.4"), false);
  assertEquals(hostAllowed("100.101.102.103"), true);
  assertEquals(hostAllowed("grafana.acme.com"), false);
  assertEquals(hostAllowed("8.8.8.8"), false);
});

Deno.test("dashboards: starred first, then folders, General last", () => {
  const dashboards = parseDashboards([
    {
      uid: "a",
      title: "Node Exporter",
      url: "/d/a/node",
      type: "dash-db",
      tags: ["linux"],
      folderTitle: "Infra",
      folderUid: "f1",
      isStarred: false,
    },
    { uid: "b", title: "Home", url: "/d/b/home", type: "dash-db", tags: [], isStarred: false },
    {
      uid: "c",
      title: "API latency",
      url: "/d/c/api",
      type: "dash-db",
      tags: ["slo"],
      folderTitle: "Shop",
      isStarred: true,
    },
    { uid: "d", title: "Postgres", url: "/d/d/pg", type: "dash-db", tags: [], folderTitle: "Infra", isStarred: false },
    { uid: "f1", title: "Infra", url: "/dashboards/f/f1", type: "dash-folder" },
  ]);
  assertEquals(sortDashboards(dashboards).map((d) => d.title), ["API latency", "Node Exporter", "Postgres", "Home"]);
  assertEquals(parseDashboards({ message: "x" }), []);
});

const ALERTS = [
  {
    annotations: {
      summary: "CPU above 90% on web-1",
      description: "The 5 min average is 97%.",
      runbook_url: "https://wiki.acme.dev/runbooks/cpu",
      __dashboardUid__: "node",
      __panelId__: "4",
    },
    endsAt: "2026-10-28T12:04:00Z",
    fingerprint: "f1",
    receivers: [{ name: "oncall-pagerduty" }],
    startsAt: "2026-10-28T11:15:00Z",
    status: { inhibitedBy: [], silencedBy: [], state: "active" },
    updatedAt: "2026-10-28T12:00:00Z",
    generatorURL: "https://acme.grafana.net/alerting/grafana/rule1/view",
    labels: {
      __alert_rule_uid__: "rule1",
      alertname: "HighCPU",
      grafana_folder: "Infra",
      instance: "web-1",
      severity: "critical",
    },
  },
  {
    annotations: {},
    fingerprint: "f2",
    receivers: [{ name: "slack" }],
    startsAt: "2026-10-28T11:50:00Z",
    endsAt: "0001-01-01T00:00:00Z",
    status: { inhibitedBy: [], silencedBy: ["s1"], state: "suppressed" },
    labels: { alertname: "DiskFilling", severity: "warning", mountpoint: "/var" },
  },
  {
    annotations: { summary: "Errors" },
    fingerprint: "f3",
    startsAt: "2026-10-28T10:00:00Z",
    status: { state: "active" },
    labels: { alertname: "5xx", priority: "P2" },
  },
];

Deno.test("alerts", () => {
  const alerts = parseAlerts(ALERTS);
  assertEquals(alerts[1].endsAt, undefined);
  assertEquals(alerts[1].silencedBy, ["s1"]);
  assertEquals(alerts[0].receivers, ["oncall-pagerduty"]);
  assertEquals(alerts.map(severityOf), ["critical", "warning", "high"]);
  assertEquals(sortAlerts(alerts).map(alertName), ["HighCPU", "5xx", "DiskFilling"]);
  assertEquals(visibleLabels(alerts[0]), [["grafana_folder", "Infra"], ["instance", "web-1"], [
    "severity",
    "critical",
  ]]);
  assertEquals(panelUrl("https://acme.grafana.net", alerts[0]), "https://acme.grafana.net/d/node?viewPanel=4");
  assertEquals(panelUrl("https://acme.grafana.net", alerts[1]), undefined);
  assertEquals(parseAlerts(null), []);
});

Deno.test("silence bodies", () => {
  const [alert] = parseAlerts(ALERTS);
  const body = silenceBody(alert, 4, "sa-backslash", new Date("2026-10-28T12:00:00Z"));
  assertEquals(body.startsAt, "2026-10-28T12:00:00.000Z");
  assertEquals(body.endsAt, "2026-10-28T16:00:00.000Z");
  assertEquals(body.createdBy, "sa-backslash");
  assertEquals(body.comment, "Silenced from Backslash for 4 h: HighCPU");
  assertEquals(body.matchers.map((m) => m.name), [
    "__alert_rule_uid__",
    "alertname",
    "grafana_folder",
    "instance",
    "severity",
  ]);
  assertEquals(matchersFor(alert)[1], { name: "alertname", value: "HighCPU", isRegex: false, isEqual: true });
  assertEquals(silenceBody(alert, 24, "x").comment.includes("1 day"), true);
});

Deno.test("silences", () => {
  const silences = parseSilences([
    {
      id: "old",
      status: { state: "expired" },
      matchers: [{ name: "alertname", value: "X", isRegex: false, isEqual: true }],
      startsAt: "2026-10-01T00:00:00Z",
      endsAt: "2026-10-02T00:00:00Z",
      createdBy: "ada",
      comment: "maintenance",
    },
    {
      id: "s1",
      status: { state: "active" },
      matchers: [{ name: "alertname", value: "DiskFilling", isRegex: false, isEqual: true }, {
        name: "instance",
        value: "web-.*",
        isRegex: true,
        isEqual: false,
      }],
      startsAt: "2026-10-28T11:00:00Z",
      endsAt: "2026-10-28T15:00:00Z",
      createdBy: "bob",
      comment: "known",
    },
    {
      id: "p1",
      status: { state: "pending" },
      matchers: [],
      startsAt: "2026-10-29T00:00:00Z",
      endsAt: "2026-10-29T02:00:00Z",
    },
  ]);
  assertEquals(sortSilences(silences).map((s) => s.id), ["s1", "p1", "old"]);
  assertEquals(matcherText(silences[1].matchers[1]), "instance!=~web-.*");
  assertEquals(matcherText(silences[1].matchers[0]), "alertname=DiskFilling");
});

Deno.test("durations", () => {
  assertEquals(duration(45_000), "45 s");
  assertEquals(duration(12 * 60_000), "12 min");
  assertEquals(duration(200 * 60_000), "3 h 20 min");
  assertEquals(duration(52 * 3600_000), "2 d 4 h");
  assertEquals(duration(48 * 3600_000), "2 d");
});
