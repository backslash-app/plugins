import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS, isAllowedHost, SetupError, setupItems } from "./api.ts";
import {
  adminUrl,
  agOverview,
  type AgStats,
  cleanDomain,
  compact,
  countdown,
  normalizeUrl,
  pauseSeconds,
  pauseText,
  percentText,
  piOverview,
  ruleFor,
  sparkline,
  summaryLine,
  withRule,
} from "./lib.ts";

// Shaped like Pi-hole v6's /api/stats/summary, /api/dns/blocking and /api/stats/top_domains.
const PI_SUMMARY = {
  queries: {
    total: 48213,
    blocked: 6231,
    percent_blocked: 12.923899,
    unique_domains: 2311,
    forwarded: 30000,
    cached: 11982,
    types: { A: 30000, AAAA: 15000 },
    status: { GRAVITY: 6000 },
    replies: { IP: 40000 },
  },
  clients: { active: 14, total: 22 },
  gravity: { domains_being_blocked: 874211, last_update: 1792483200 },
  took: 0.0031,
};

// Shaped like AdGuard Home's /control/status and /control/stats.
const AG_STATUS = {
  dns_addresses: ["192.168.1.2"],
  dns_port: 53,
  http_port: 3000,
  protection_enabled: false,
  protection_disabled_duration: 254_000,
  dhcp_available: true,
  running: true,
  version: "v0.107.52",
  language: "en",
};
const AG_STATS: AgStats = {
  time_units: "hours",
  num_dns_queries: 92311,
  num_blocked_filtering: 15022,
  num_replaced_safebrowsing: 3,
  num_replaced_safesearch: 0,
  num_replaced_parental: 0,
  avg_processing_time: 0.0123,
  top_queried_domains: [{ "www.youtube.com": 4000 }, { "api.spotify.com": 2000 }],
  top_blocked_domains: [{ "ads.tiktok.com": 900 }, { "googleads.g.doubleclick.net": 700 }],
  top_clients: [{ "192.168.1.10": 50000 }],
  dns_queries: [10, 20, 40, 80],
};

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("pi.hole"));
  assert(isAllowedHost("adguard.lan"));
  assert(isAllowedHost("192.168.1.2"));
  assert(!isAllowedHost("dns.example.com"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("pi.hole/admin/"), "http://pi.hole");
  assertEquals(normalizeUrl("http://192.168.1.2:3000/#settings"), "http://192.168.1.2:3000");
  assertEquals(normalizeUrl("https://pi.hole/api/"), "https://pi.hole");
  assertEquals(adminUrl("http://pi.hole", "pihole"), "http://pi.hole/admin/");
  assertEquals(adminUrl("http://adguard.lan:3000", "adguard"), "http://adguard.lan:3000/");
});

Deno.test("Pi-hole overview", () => {
  const o = piOverview(
    PI_SUMMARY,
    { blocking: "disabled", timer: 283.4 },
    { domains: [{ domain: "app-measurement.com", count: 1203 }] },
    { domains: [{ domain: "www.google.com", count: 4102 }] },
    { version: { core: { local: { version: "v6.0.4" } } } },
  );
  assertEquals(o.blocking, "disabled");
  assertEquals(o.timer, 283);
  assertEquals(o.queries, 48213);
  assertEquals(o.listed, 874211);
  assertEquals(o.listUpdated, 1792483200_000);
  assertEquals(o.version, "v6.0.4");
  assertEquals(o.topBlocked[0].domain, "app-measurement.com");
  assertEquals(summaryLine(o), "Paused · 4:43 left");
  assertEquals(summaryLine({ ...o, blocking: "enabled" }), "12.9 % blocked");
  assertEquals(summaryLine({ ...o, timer: undefined }), "Blocking off");
});

Deno.test("AdGuard Home overview", () => {
  const o = agOverview(AG_STATUS, AG_STATS);
  assertEquals(o.blocking, "disabled");
  assertEquals(o.timer, 254);
  assertEquals(o.blocked, 15025);
  assertEquals(o.percent.toFixed(2), "16.28");
  assertEquals(o.period, "4 h");
  assertEquals(o.avgMs, 12.3);
  assertEquals(o.topBlocked, [
    { domain: "ads.tiktok.com", count: 900 },
    { domain: "googleads.g.doubleclick.net", count: 700 },
  ]);
  assertEquals(agOverview({ ...AG_STATUS, protection_enabled: true }, AG_STATS).timer, undefined);
  assertEquals(
    agOverview(AG_STATUS, { ...AG_STATS, time_units: "days", dns_queries: Array(7).fill(1) }).period,
    "7 days",
  );
});

Deno.test("AdGuard user rules", () => {
  assertEquals(ruleFor("ads.example.com", "deny"), "||ads.example.com^");
  assertEquals(ruleFor("cdn.example.com", "allow"), "@@||cdn.example.com^$important");
  assertEquals(withRule(["||a.com^", "! comment"], "a.com", "allow"), ["! comment", "@@||a.com^$important"]);
  assertEquals(withRule(["@@||a.com^$important"], "a.com", "allow"), ["@@||a.com^$important"]);
  assertEquals(withRule([], "b.com", "deny"), ["||b.com^"]);
});

Deno.test("domains typed or pasted", () => {
  assertEquals(cleanDomain("Ads.Example.com"), "ads.example.com");
  assertEquals(cleanDomain("https://tracker.example.net/pixel?x=1"), "tracker.example.net");
  assertEquals(cleanDomain("*.doubleclick.net"), "doubleclick.net");
  assertEquals(cleanDomain("example.com:443"), "example.com");
  assertEquals(cleanDomain("not a domain"), undefined);
  assertEquals(cleanDomain("localhost"), undefined);
});

Deno.test("pause durations", () => {
  assertEquals(pauseSeconds(""), 300);
  assertEquals(pauseSeconds("30s"), 30);
  assertEquals(pauseSeconds("5m"), 300);
  assertEquals(pauseSeconds("10"), 600);
  assertEquals(pauseSeconds("1h"), 3600);
  assertEquals(pauseSeconds("1.5 hours"), 5400);
  assertEquals(pauseSeconds("forever"), 0);
  assertThrows(() => pauseSeconds("soon"));
  assertEquals(pauseText(30), "for 30 s");
  assertEquals(pauseText(300), "for 5 min");
  assertEquals(pauseText(3600), "for 1 h");
  assertEquals(pauseText(0), "until resumed");
});

Deno.test("formatting", () => {
  assertEquals(compact(9_999), "9,999");
  assertEquals(compact(48_213), "48.2k");
  assertEquals(compact(2_400_000), "2.4M");
  assertEquals(percentText(12.92), "12.9 %");
  assertEquals(percentText(3.456), "3.46 %");
  assertEquals(countdown(30), "0:30");
  assertEquals(countdown(3725), "1:02:05");
  assertEquals(sparkline([0, 50, 100]), "▁▄█");
  assertEquals(sparkline([0, 0]), undefined);
});

Deno.test("setup rows", () => {
  const [pi] = setupItems(new SetupError("Pi-hole rejected the password", "password", "http://pi.hole", "pihole"));
  assert(pi.detail?.markdown?.includes("app password"));
  assertEquals(pi.actions?.[0].title, "Open Web Interface");
  const [ag] = setupItems(
    new SetupError("AdGuard Home needs a user name and password", "password", "http://x.lan", "adguard"),
  );
  assertEquals(ag.subtitle, "User name and password");
});
