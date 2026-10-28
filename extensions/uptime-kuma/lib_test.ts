import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { config, HOSTS, isAllowedHost, normalizeUrl, SetupError } from "./api.ts";
import {
  beatBar,
  betterStackStatus,
  certColor,
  fromBetterStack,
  kumaFromMetrics,
  kumaTime,
  latestResponseTime,
  mergeStatusPages,
  ms,
  outages,
  parseHeartbeats,
  parsePrometheus,
  parseSlugs,
  parseStatusPage,
  percent,
  sortMonitors,
} from "./lib.ts";

// Uptime Kuma 1.23 /metrics (abridged).
const METRICS = `# HELP process_cpu_user_seconds_total Total user CPU time spent in seconds.
# TYPE process_cpu_user_seconds_total counter
process_cpu_user_seconds_total 12.34
# HELP monitor_cert_days_remaining The number of days remaining until the certificate expires
# TYPE monitor_cert_days_remaining gauge
monitor_cert_days_remaining{monitor_name="Blog",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 64
monitor_cert_days_remaining{monitor_name="Shop",monitor_type="keyword",monitor_url="https://shop.example.com",monitor_hostname="null",monitor_port="null"} 5
# HELP monitor_cert_is_valid Is the certificate still valid? (1 = Yes, 0= No)
# TYPE monitor_cert_is_valid gauge
monitor_cert_is_valid{monitor_name="Blog",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 1
monitor_cert_is_valid{monitor_name="Shop",monitor_type="keyword",monitor_url="https://shop.example.com",monitor_hostname="null",monitor_port="null"} 1
# HELP monitor_response_time Monitor Response Time (ms)
# TYPE monitor_response_time gauge
monitor_response_time{monitor_name="Blog",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 182
monitor_response_time{monitor_name="NAS \\"main\\"",monitor_type="ping",monitor_url="https://",monitor_hostname="nas.lan",monitor_port="null"} 3
monitor_response_time{monitor_name="Postgres",monitor_type="port",monitor_url="https://",monitor_hostname="10.0.0.5",monitor_port="5432"} -1
# HELP monitor_status Monitor Status (1 = UP, 0= DOWN, 2= PENDING, 3= MAINTENANCE)
# TYPE monitor_status gauge
monitor_status{monitor_name="Blog",monitor_type="http",monitor_url="https://blog.example.com",monitor_hostname="null",monitor_port="null"} 1
monitor_status{monitor_name="Shop",monitor_type="keyword",monitor_url="https://shop.example.com",monitor_hostname="null",monitor_port="null"} 2
monitor_status{monitor_name="NAS \\"main\\"",monitor_type="ping",monitor_url="https://",monitor_hostname="nas.lan",monitor_port="null"} 1
monitor_status{monitor_name="Postgres",monitor_type="port",monitor_url="https://",monitor_hostname="10.0.0.5",monitor_port="5432"} 0
`;

const PAGE = {
  config: { slug: "home", title: "Home Lab", description: null, icon: "/icon.svg", theme: "auto" },
  incident: null,
  publicGroupList: [
    {
      id: 1,
      name: "Services",
      weight: 1,
      monitorList: [{ id: 4, name: "Postgres", sendUrl: 0, type: "port" }, { id: 7, name: "Jellyfin", type: "http" }],
    },
  ],
  maintenanceList: [],
};

const BEATS = {
  heartbeatList: {
    "4": [
      { status: 1, time: "2026-10-28 08:00:00.123", msg: "", ping: 2 },
      { status: 0, time: "2026-10-28 08:01:00.456", msg: "connect ECONNREFUSED 10.0.0.5:5432", ping: null },
      { status: 0, time: "2026-10-28 08:02:00.000", msg: "connect ECONNREFUSED 10.0.0.5:5432", ping: null },
      { status: 1, time: "2026-10-28 08:03:00.000", msg: "", ping: 3 },
      { status: 0, time: "2026-10-28 08:04:00.000", msg: "timeout", ping: null },
    ],
    "7": [{ status: 1, time: "2026-10-28 08:04:30.000", msg: "200 - OK", ping: 41 }],
  },
  uptimeList: { "4_24": 0.9861, "7_24": 1 },
};

Deno.test("Prometheus text format", () => {
  const samples = parsePrometheus(METRICS);
  assertEquals(samples.length, 12);
  assertEquals(samples[0], { name: "process_cpu_user_seconds_total", labels: {}, value: 12.34 });
  assertEquals(samples.find((s) => s.labels.monitor_hostname === "nas.lan")?.labels.monitor_name, 'NAS "main"');
  assertEquals(parsePrometheus('up{job="a"} 1 1700000000000')[0].value, 1);
});

Deno.test("Kuma monitors from /metrics", () => {
  const list = kumaFromMetrics(parsePrometheus(METRICS));
  const by = Object.fromEntries(list.map((m) => [m.name, m]));
  assertEquals(by.Blog.status, "up");
  assertEquals(by.Blog.responseTime, 182);
  assertEquals(by.Blog.certDays, 64);
  assertEquals(by.Blog.certValid, true);
  assertEquals(by.Blog.target, "https://blog.example.com");
  assertEquals(by.Shop.status, "pending");
  assertEquals(by['NAS "main"'].target, "nas.lan");
  assertEquals(by.Postgres.status, "down");
  assertEquals(by.Postgres.target, "10.0.0.5:5432");
  assertEquals(by.Postgres.responseTime, undefined);
  assertEquals(sortMonitors(list).map((m) => m.name), ["Postgres", "Shop", "Blog", 'NAS "main"']);
});

Deno.test("status pages and heartbeats", () => {
  const page = parseStatusPage("home", PAGE);
  assertEquals(page.title, "Home Lab");
  assertEquals(page.groups[0].monitors.map((m) => m.id), [4, 7]);
  const hb = parseHeartbeats(BEATS);
  assertEquals(hb.uptime, { "4": 0.9861, "7": 1 });
  assertEquals(hb.beats["4"][0].time, Date.UTC(2026, 9, 28, 8, 0, 0, 123));
  assertEquals(beatBar(hb.beats["4"]), "🟩🟥🟥🟩🟥");
  const o = outages(hb.beats["4"]);
  assertEquals(o.length, 2);
  assertEquals(o[0].end! - o[0].start, 119_544);
  assertEquals(o[1].end, undefined);
  const merged = mergeStatusPages(kumaFromMetrics(parsePrometheus(METRICS)), [{ page, ...hb }]);
  const pg = merged.find((m) => m.name === "Postgres")!;
  assertEquals([pg.id, pg.uptime24, pg.group, pg.pages], ["4", 0.9861, "Services", ["home"]]);
  const jelly = merged.find((m) => m.name === "Jellyfin")!;
  assertEquals([jelly.status, jelly.responseTime, jelly.uptime24], ["up", 41, 1]);
  assertEquals(merged.length, 5);
});

Deno.test("Kuma times", () => {
  assertEquals(kumaTime("2026-10-28 08:00:00"), Date.UTC(2026, 9, 28, 8));
  assertEquals(kumaTime("2026-10-28T08:00:00+01:00"), Date.UTC(2026, 9, 28, 7));
});

Deno.test("Better Stack monitors", () => {
  const m = fromBetterStack({
    id: "2203394",
    type: "monitor",
    attributes: {
      url: "https://example.com",
      pronounceable_name: "Example site",
      monitor_type: "status",
      status: "up",
      paused: false,
      last_checked_at: "2026-10-28T08:59:03.000Z",
      check_frequency: 180,
    },
  });
  assertEquals([m.name, m.status, m.checkEvery, m.lastChecked], [
    "Example site",
    "up",
    180,
    Date.parse("2026-10-28T08:59:03Z"),
  ]);
  assertEquals(betterStackStatus("paused"), "paused");
  assertEquals(betterStackStatus("up", true), "paused");
  assertEquals(betterStackStatus("validating"), "pending");
  const rt = latestResponseTime({
    data: {
      attributes: {
        regions: [
          {
            region: "us",
            response_times: [{ at: "2026-10-28T08:00:00Z", response_time: 0.4 }, {
              at: "2026-10-28T08:03:00Z",
              response_time: 0.21,
            }],
          },
          { region: "eu", response_times: [{ at: "2026-10-28T08:03:00Z", response_time: 0.09 }] },
        ],
      },
    },
  });
  assertEquals(rt, { ms: 150, regions: [{ region: "us", ms: 210 }, { region: "eu", ms: 90 }] });
});

Deno.test("formatting", () => {
  assertEquals(ms(182), "182 ms");
  assertEquals(ms(1520), "1.5 s");
  assertEquals(percent(0.9861), "98.6 %");
  assertEquals(percent(0.99912), "99.91 %");
  assertEquals(percent(1), "100 %");
  assertEquals(certColor(5), "red");
  assertEquals(certColor(15), "orange");
  assertEquals(certColor(60), undefined);
  assertEquals(certColor(60, false), "red");
  assertEquals(parseSlugs("home, https://kuma.lan/status/work  bad slug!"), ["home", "work", "bad"]);
});

Deno.test("configuration", () => {
  assertEquals(normalizeUrl("kuma.lan:3001/dashboard"), "http://kuma.lan:3001");
  assertEquals(config({ url: "kuma.lan:3001", apiKey: "uk1_x" }).kuma, "http://kuma.lan:3001");
  let error: unknown;
  try {
    config({ url: "https://status.example.com", apiKey: "k" });
  } catch (e) {
    error = e;
  }
  assert(error instanceof SetupError);
  try {
    config({});
  } catch (e) {
    error = e;
  }
  assert(error instanceof SetupError && error.message.includes("Connect"));
  assertEquals(config({ betterstackToken: "t" }).betterstack, "t");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("kuma.home.arpa"));
  assert(isAllowedHost("192.168.1.10"));
  assert(!isAllowedHost("status.example.com"));
});
