import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  authHeader,
  commonLabels,
  formatMetric,
  formatValue,
  groupTitle,
  hostAllowed,
  HOSTS,
  matchersOf,
  matcherText,
  mergeAlerts,
  mergeGroups,
  mergeSilences,
  normalizeUrl,
  parseAlerts,
  parseDuration,
  parseGroups,
  parseMatchers,
  parseQueryResult,
  parseRules,
  parseSilences,
  parseTargets,
  parseUrls,
  remember,
  severityOf,
  silenceBody,
  sortAlerts,
  sortGroups,
  sortRules,
  sortSeries,
  sortSilences,
  sortTargets,
  sparkline,
  targetCounts,
  worstSeverity,
} from "./lib.ts";

Deno.test("URLs: scheme, UI pages and sub-paths", () => {
  assertEquals(normalizeUrl("prometheus.local:9090/graph"), "http://prometheus.local:9090");
  assertEquals(normalizeUrl("http://alertmanager.local:9093/#/alerts"), "http://alertmanager.local:9093");
  assertEquals(normalizeUrl("192.168.1.5:9090/targets?search=x"), "http://192.168.1.5:9090");
  assertEquals(normalizeUrl("alertmanager:9093"), "http://alertmanager:9093");
  assertEquals(
    normalizeUrl("https://prometheus-prod-01-eu-west-0.grafana.net/api/prom/"),
    "https://prometheus-prod-01-eu-west-0.grafana.net/api/prom",
  );
  assertEquals(normalizeUrl("https://mon.tail1.ts.net/prometheus/api/v1"), "https://mon.tail1.ts.net/prometheus");
  assertEquals(normalizeUrl(""), "");
  assertEquals(parseUrls("http://am1:9093, am2:9093\nhttp://am1:9093/"), ["http://am1:9093", "http://am2:9093"]);
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(manifest.permissions.net, HOSTS);
  assert(hostAllowed("prometheus.local"));
  assert(hostAllowed("alertmanager"));
  assert(hostAllowed("10.1.2.3"));
  assert(hostAllowed("172.31.255.1"));
  assert(!hostAllowed("172.32.0.1"));
  assert(hostAllowed("prometheus-prod-01-eu-west-0.grafana.net"));
  assert(!hostAllowed("prometheus.example.com"));
});

Deno.test("auth: basic with a user, else bearer", () => {
  assertEquals(authHeader("admin", "s3cret"), `Basic ${btoa("admin:s3cret")}`);
  assertEquals(authHeader("", "", " tok "), "Bearer tok");
  assertEquals(authHeader("", "", ""), undefined);
  assertEquals(authHeader("élise", "pw"), "Basic w6lsaXNlOnB3");
});

const ALERTS = [
  {
    fingerprint: "a1",
    labels: { alertname: "HostDown", severity: "critical", instance: "web-1:9100", job: "node" },
    annotations: { summary: "web-1 is down" },
    startsAt: "2026-10-29T08:00:00Z",
    endsAt: "2026-10-29T12:00:00Z",
    generatorURL: "http://prometheus:9090/graph?g0.expr=up",
    receivers: [{ name: "pager" }],
    status: { state: "active", silencedBy: [], inhibitedBy: [] },
  },
  {
    fingerprint: "a2",
    labels: { alertname: "DiskFull", severity: "warning", instance: "db-1:9100", job: "node" },
    annotations: {},
    startsAt: "2026-10-29T09:00:00Z",
    endsAt: "0001-01-01T00:00:00Z",
    receivers: [{ name: "mail" }],
    status: { state: "suppressed", silencedBy: ["s1"], inhibitedBy: [] },
  },
];

Deno.test("alerts: parse, merge HA pairs, sort by severity", () => {
  const a = parseAlerts(ALERTS, "http://am1");
  const b = parseAlerts(ALERTS.slice(0, 1), "http://am2");
  assertEquals(a[1].endsAt, undefined);
  assertEquals(a[0].receivers, ["pager"]);
  const merged = mergeAlerts([a, b]);
  assertEquals(merged.length, 2);
  assertEquals(merged.find((x) => x.fingerprint === "a1")!.sources, ["http://am1", "http://am2"]);
  assertEquals(sortAlerts(merged.reverse()).map((x) => x.fingerprint), ["a1", "a2"]);
  assertEquals(severityOf({ labels: { severity: "P2" } }), "high");
  assertEquals(severityOf({ labels: {} }), "none");
  assertEquals(worstSeverity(merged), "critical");
  assertEquals(commonLabels(merged), { job: "node" });
  assertEquals(parseAlerts({ not: "an array" }), []);
});

Deno.test("groups: title, merge and sort", () => {
  const data = [
    { labels: { alertname: "DiskFull" }, receiver: { name: "mail" }, alerts: ALERTS.slice(1) },
    { labels: { alertname: "HostDown", job: "node" }, receiver: { name: "pager" }, alerts: ALERTS.slice(0, 1) },
    { labels: {}, receiver: { name: "x" }, alerts: [] },
  ];
  const groups = parseGroups(data, "http://am1");
  assertEquals(groups.length, 2);
  assertEquals(groupTitle(groups[1]), "HostDown · job=node");
  assertEquals(groupTitle({ labels: {}, receiver: "", alerts: [] }), "All alerts");
  const merged = mergeGroups([groups, parseGroups(data, "http://am2")]);
  assertEquals(merged.length, 2);
  assertEquals(merged[0].alerts[0].sources, ["http://am1", "http://am2"]);
  assertEquals(sortGroups(merged).map(groupTitle), ["HostDown · job=node", "DiskFull"]);
});

Deno.test("silences: parse, dedupe, sort", () => {
  const data = [
    {
      id: "s1",
      status: { state: "active" },
      matchers: [{ name: "alertname", value: "DiskFull", isRegex: false }],
      endsAt: "2026-10-29T14:00:00Z",
      createdBy: "ada",
      comment: "disk swap",
    },
    { id: "s2", status: { state: "expired" }, matchers: [], endsAt: "2026-10-28T14:00:00Z" },
    { id: "s3", status: { state: "pending" }, matchers: [], endsAt: "2026-10-30T14:00:00Z" },
  ];
  const merged = mergeSilences([parseSilences(data, "http://am1"), parseSilences(data, "http://am2")]);
  assertEquals(merged.length, 3);
  assertEquals(merged[0].sources, ["http://am1", "http://am2"]);
  assertEquals(merged[0].matchers[0].isEqual, true);
  assertEquals(sortSilences(merged).map((s) => s.id), ["s1", "s3", "s2"]);
});

Deno.test("matchers: text, parsing and labels", () => {
  assertEquals(matcherText({ name: "env", value: "dev", isRegex: false, isEqual: false }), 'env!="dev"');
  assertEquals(matcherText({ name: "i", value: "web-.*", isRegex: true, isEqual: true }), 'i=~"web-.*"');
  assertEquals(parseMatchers('{alertname="HighCPU", instance=~"web-.*"}\nenv!=dev\njob!~"a,b"'), [
    { name: "alertname", value: "HighCPU", isRegex: false, isEqual: true },
    { name: "instance", value: "web-.*", isRegex: true, isEqual: true },
    { name: "env", value: "dev", isRegex: false, isEqual: false },
    { name: "job", value: "a,b", isRegex: true, isEqual: false },
  ]);
  assertEquals(parseMatchers('msg="say \\"hi\\""')[0].value, 'say "hi"');
  assertThrows(() => parseMatchers("not a matcher"), Error, "is not a matcher");
  assertThrows(() => parseMatchers('a="open'), Error, "unclosed quote");
  assertEquals(matchersOf({ job: "node", alertname: "X", __name__: "ALERTS" }).map((m) => m.name), [
    "alertname",
    "job",
  ]);
});

Deno.test("durations", () => {
  const now = Date.parse("2026-10-29T10:00:00Z");
  assertEquals(parseDuration("90m"), 90 * 60_000);
  assertEquals(parseDuration("2h30m"), 2.5 * 3600_000);
  assertEquals(parseDuration("1d"), 86400_000);
  assertEquals(parseDuration("1w"), 7 * 86400_000);
  assertEquals(parseDuration("3 days"), 3 * 86400_000);
  assertEquals(parseDuration("2 hours 15 minutes"), 2.25 * 3600_000);
  assertEquals(parseDuration("4"), 4 * 3600_000);
  assertEquals(parseDuration("2026-10-29T12:00:00Z".slice(0, 16).replace("T", " "), now) > 0, true);
  assertThrows(() => parseDuration("2020-01-01", now), Error, "past");
  assertThrows(() => parseDuration("soon"), Error, "not a duration");
  assertThrows(() => parseDuration(""), Error);
});

Deno.test("silence body", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  const m = matchersOf({ alertname: "HostDown", instance: "web-1" });
  const body = silenceBody(m, 3600_000, "ada", "", now);
  assertEquals(body.startsAt, "2026-10-29T10:00:00.000Z");
  assertEquals(body.endsAt, "2026-10-29T11:00:00.000Z");
  assertEquals(body.createdBy, "ada");
  assertEquals(body.comment, "Silenced from Backslash for 1 h");
  assertEquals(silenceBody(m, 60_000, " ", "x", now).createdBy, "Backslash");
  assertThrows(() => silenceBody([], 1, "a", "", now), Error, "at least one");
  assertThrows(
    () => silenceBody([{ name: "alertname", value: ".*", isRegex: true, isEqual: true }], 1, "a", "", now),
    Error,
    "every alert",
  );
});

Deno.test("query results: vector, scalar, matrix, formatting", () => {
  const vector = parseQueryResult({
    resultType: "vector",
    result: [
      { metric: { __name__: "up", job: "node", instance: "a:9100" }, value: [1761732000, "1"] },
      { metric: { __name__: "up", job: "node", instance: "b:9100" }, value: [1761732000, "0"] },
      { metric: { job: "x" }, value: [1761732000, "NaN"] },
    ],
  }, ["w"]);
  assert(vector.type === "vector");
  assertEquals(vector.warnings, ["w"]);
  assertEquals(sortSeries(vector.series).map((s) => s.metric.instance ?? "nan"), ["a:9100", "b:9100", "nan"]);
  assertEquals(formatMetric(vector.series[0].metric), 'up{instance="a:9100", job="node"}');
  assertEquals(formatMetric({}), "{}");
  assertEquals(formatMetric({ job: "x" }), '{job="x"}');
  const scalar = parseQueryResult({ resultType: "scalar", result: [1761732000, "42"] });
  assertEquals(scalar.type === "scalar" && scalar.value, [1761732000, "42"]);
  const matrix = parseQueryResult({
    resultType: "matrix",
    result: [{ metric: { job: "a" }, values: [[1, "1"], [2, "5"], [3, "3"]] }],
  });
  assert(matrix.type === "matrix");
  assertEquals(matrix.series[0].values.length, 3);
  assertEquals(sparkline(matrix.series[0].values), "▁█▅");
  assertThrows(() => parseQueryResult({ resultType: "nope" }));
  assertEquals(formatValue("1234567.891"), "1,234,567.891");
  assertEquals(formatValue("0.5"), "0.5");
  assertEquals(formatValue("0.0001234"), "0.000123");
  assertEquals(formatValue("+Inf"), "+Inf");
  assertEquals(formatValue("NaN"), "NaN");
});

Deno.test("history drops the beginnings of what was typed", () => {
  assertEquals(remember(["up", "rate(x[5m])"], "up == 0"), ["up == 0", "rate(x[5m])"]);
  assertEquals(remember(["a"], "a"), ["a"]);
  assertEquals(remember(["a"], "  "), ["a"]);
});

Deno.test("targets: down first, counts", () => {
  const targets = parseTargets({
    activeTargets: [
      {
        scrapePool: "node",
        scrapeUrl: "http://a:9100/metrics",
        labels: { job: "node", instance: "a:9100" },
        health: "up",
        lastScrape: "2026-10-29T10:00:00Z",
        lastScrapeDuration: 0.012,
      },
      {
        scrapePool: "node",
        scrapeUrl: "http://b:9100/metrics",
        labels: { job: "node", instance: "b:9100" },
        health: "down",
        lastError: "connection refused",
      },
      { scrapePool: "app", scrapeUrl: "http://c/metrics", labels: { job: "app", instance: "c" }, health: "unknown" },
    ],
    droppedTargets: [],
  });
  assertEquals(sortTargets(targets).map((t) => t.instance), ["b:9100", "c", "a:9100"]);
  assertEquals(targetCounts(targets), { total: 3, up: 1, down: 1, unknown: 1 });
  assertEquals(targets[1].lastError, "connection refused");
  assertEquals(parseTargets(undefined), []);
});

Deno.test("rules: flattened, firing first, broken before inactive", () => {
  const rules = parseRules({
    groups: [{
      name: "node",
      file: "/etc/prometheus/rules.yml",
      rules: [
        { type: "alerting", name: "Quiet", query: "x > 1", state: "inactive", health: "ok", alerts: [] },
        { type: "recording", name: "job:up:sum", query: "sum by (job) (up)", health: "ok" },
        { type: "alerting", name: "Broken", query: "y >", state: "inactive", health: "err", lastError: "parse" },
        {
          type: "alerting",
          name: "HostDown",
          query: "up == 0",
          state: "firing",
          health: "ok",
          duration: 300,
          alerts: [{}, {}],
        },
        { type: "alerting", name: "Slow", query: "z", state: "pending", health: "ok", alerts: [{}] },
      ],
    }],
  });
  assertEquals(sortRules(rules).map((r) => r.name), ["HostDown", "Slow", "Broken", "Quiet", "job:up:sum"]);
  assertEquals(rules.find((r) => r.name === "HostDown")!.active, 2);
  assertEquals(rules.find((r) => r.name === "job:up:sum")!.state, "recording");
});
