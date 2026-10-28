import { assertEquals, assertThrows } from "@std/assert";
import {
  apiError,
  chunks,
  deployState,
  filterRecords,
  hasNextPage,
  mapDeployment,
  mapProject,
  mapRecord,
  mapZone,
  purgeUrls,
  recordBody,
  shortName,
  sortRecords,
  ttlLabel,
  zoneColor,
  zoneDashboardUrl,
  zoneFileLine,
  zoneStatusLabel,
} from "./lib.ts";

const ZONE = {
  id: "023e105f4ecef8ad9ca31a8372d0c353",
  name: "acme.io",
  status: "active",
  paused: false,
  type: "full",
  development_mode: 0,
  name_servers: ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
  original_registrar: "gandi sas",
  account: { id: "a1b2", name: "Acme" },
  plan: { id: "x", name: "Pro Website" },
  activated_on: "2023-04-01T10:00:00Z",
};

Deno.test("zones", () => {
  const z = mapZone(ZONE);
  assertEquals(z.plan, "Pro Website");
  assertEquals(z.nameServers.length, 2);
  assertEquals(zoneColor(z), "green");
  assertEquals(zoneStatusLabel(z), "Active");
  assertEquals(zoneDashboardUrl(z), "https://dash.cloudflare.com/a1b2/acme.io");
  const paused = mapZone({ ...ZONE, paused: true });
  assertEquals([zoneColor(paused), zoneStatusLabel(paused)], ["orange", "Paused"]);
  assertEquals(zoneColor(mapZone({ ...ZONE, status: "pending" })), "yellow");
});

Deno.test("pagination and errors", () => {
  assertEquals(hasNextPage({ page: 1, per_page: 50, count: 50, total_pages: 2 }), true);
  assertEquals(hasNextPage({ page: 2, per_page: 50, count: 3, total_pages: 2 }), false);
  // Cursor-style endpoints give no total: a full page means there may be more.
  assertEquals(hasNextPage({ page: 1, per_page: 10, count: 10 }), true);
  assertEquals(hasNextPage(undefined), false);
  assertEquals(
    apiError({ errors: [{ code: 81057, message: "Record already exists." }] }, 400),
    "Record already exists. (81057)",
  );
  assertEquals(apiError(undefined, 502), "Cloudflare answered 502");
});

const zone = { id: "z1", name: "acme.io" };
const RECORDS = [
  {
    id: "r3",
    name: "acme.io",
    type: "MX",
    content: "mx2.mail.example",
    priority: 20,
    proxiable: false,
    proxied: false,
    ttl: 3600,
  },
  { id: "r1", name: "acme.io", type: "A", content: "203.0.113.10", proxiable: true, proxied: true, ttl: 1 },
  { id: "r2", name: "www.acme.io", type: "CNAME", content: "acme.io", proxiable: true, proxied: true, ttl: 1 },
  {
    id: "r5",
    name: "acme.io",
    type: "MX",
    content: "mx1.mail.example",
    priority: 10,
    proxiable: false,
    proxied: false,
    ttl: 3600,
  },
  {
    id: "r4",
    name: "acme.io",
    type: "TXT",
    content: "v=spf1 -all",
    proxiable: false,
    proxied: false,
    ttl: 1,
    comment: "SPF",
  },
  { id: "r6", name: "ssh.acme.io", type: "A", content: "203.0.113.22", proxiable: true, proxied: false, ttl: 300 },
].map((r) => mapRecord(r, zone));

Deno.test("DNS records: mapping, sort and filters", () => {
  assertEquals(RECORDS[0].zoneName, "acme.io");
  assertEquals(RECORDS[4].comment, "SPF");
  assertEquals(sortRecords(RECORDS).map((r) => r.id), ["r1", "r5", "r3", "r4", "r6", "r2"]);
  assertEquals(filterRecords(RECORDS, "address").map((r) => r.id), ["r1", "r6"]);
  assertEquals(filterRecords(RECORDS, "proxied").map((r) => r.id), ["r1", "r2"]);
  assertEquals(filterRecords(RECORDS, "dns-only").map((r) => r.id), ["r6"]);
  assertEquals(filterRecords(RECORDS, "mx").length, 2);
  assertEquals(shortName("www.acme.io", "acme.io"), "www");
  assertEquals(shortName("acme.io", "acme.io"), "@");
  assertEquals(shortName("other.dev", "acme.io"), "other.dev");
  assertEquals([ttlLabel(1), ttlLabel(300), ttlLabel(3600), ttlLabel(86400), ttlLabel(90)], [
    "Auto",
    "5 min",
    "1 h",
    "1 d",
    "90 s",
  ]);
});

Deno.test("DNS records: zone file lines", () => {
  const [mx, a, cname, , txt] = RECORDS;
  assertEquals(zoneFileLine(mx), "acme.io.\t3600\tIN\tMX\t20\tmx2.mail.example.");
  assertEquals(zoneFileLine(a), "acme.io.\t300\tIN\tA\t203.0.113.10");
  assertEquals(zoneFileLine(cname), "www.acme.io.\t300\tIN\tCNAME\tacme.io.");
  assertEquals(zoneFileLine(txt), 'acme.io.\t300\tIN\tTXT\t"v=spf1 -all"');
});

Deno.test("DNS records: form validation", () => {
  assertEquals(recordBody({ type: "A", name: "api", content: "198.51.100.7", proxied: true }, "acme.io"), {
    type: "A",
    name: "api.acme.io",
    content: "198.51.100.7",
    ttl: 1,
    proxied: true,
  });
  assertEquals(recordBody({ type: "MX", name: "@", content: "mx.example", proxied: true, ttl: "3600" }, "acme.io"), {
    type: "MX",
    name: "acme.io",
    content: "mx.example",
    ttl: 3600,
    proxied: false,
    priority: 10,
  });
  assertEquals(
    recordBody({ type: "TXT", name: "_dmarc.acme.io.", content: "v=DMARC1; p=none", comment: " x " }, "acme.io"),
    {
      type: "TXT",
      name: "_dmarc.acme.io",
      content: "v=DMARC1; p=none",
      ttl: 1,
      proxied: false,
      comment: "x",
    },
  );
  assertThrows(() => recordBody({ type: "A", name: "x", content: "not-an-ip" }, "acme.io"), Error, "IPv4");
  assertThrows(() => recordBody({ type: "A", name: "x", content: "" }, "acme.io"), Error, "Content");
  assertThrows(() => recordBody({ type: "CNAME", name: "x", content: "y", ttl: "5" }, "acme.io"), Error, "TTL");
  assertThrows(() => recordBody({ type: "MX", name: "x", content: "y", priority: "-1" }, "acme.io"), Error, "Priority");
});

Deno.test("cache purge URLs", () => {
  assertEquals(purgeUrls("/index.html\nwww.acme.io/a.css https://acme.io/b.js /index.html", "acme.io"), [
    "https://acme.io/index.html",
    "https://www.acme.io/a.css",
    "https://acme.io/b.js",
  ]);
  assertThrows(() => purgeUrls("https://evil.com/x", "acme.io"), Error, "not in acme.io");
  assertThrows(() => purgeUrls("  ", "acme.io"), Error, "at least one");
  assertEquals(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

const dep = (status: string, stage: string) => ({
  id: "4d1a6f0e-0000-4000-8000-1234567890ab",
  short_id: "4d1a6f0e",
  url: "https://4d1a6f0e.marketing.pages.dev",
  environment: "production",
  created_on: "2026-10-28T09:00:00Z",
  latest_stage: { name: stage, status },
  deployment_trigger: {
    type: "github:push",
    metadata: { branch: "main", commit_hash: "abcdef1234567890", commit_message: "Update pricing\n\nbody" },
  },
});

Deno.test("Pages projects and deployment states", () => {
  const p = mapProject({
    name: "marketing",
    subdomain: "marketing-7x.pages.dev",
    domains: ["marketing-7x.pages.dev", "www.acme.io"],
    production_branch: "main",
    source: { type: "github", config: { owner: "acme", repo_name: "marketing" } },
    latest_deployment: dep("success", "deploy"),
  }, "a1b2");
  assertEquals(p.domains, ["www.acme.io"]);
  assertEquals(p.repo, "acme/marketing");
  assertEquals(p.latest?.commit, "abcdef1");
  assertEquals(p.latest?.message, "Update pricing");
  assertEquals(deployState(p.latest), "success");
  assertEquals(deployState(mapDeployment(dep("failure", "build"))), "failure");
  assertEquals(deployState(mapDeployment(dep("active", "build"))), "building");
  assertEquals(deployState(mapDeployment(dep("success", "build"))), "building");
  assertEquals(deployState(mapDeployment(dep("idle", "queued"))), "queued");
  assertEquals(deployState(mapDeployment(dep("canceled", "build"))), "canceled");
  assertEquals(deployState(undefined), "unknown");
});
