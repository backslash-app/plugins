import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { config, HOSTS, isAllowedHost, normalizeOrg, normalizeUrl, SetupError } from "./api.ts";
import {
  compact,
  fromBugsnag,
  fromGlitchtip,
  fromHoneybadger,
  fromRollbar,
  isRecent,
  issueMarkdown,
  levelLook,
  normalizeLevel,
  rollbarUrl,
  since,
  sortIssues,
} from "./lib.ts";

// GET /api/0/organizations/acme/issues/?query=is:unresolved (GlitchTip 4.1)
const GLITCHTIP = [
  {
    id: "1287",
    title: "TypeError: Cannot read properties of undefined (reading 'id')",
    culprit: "src/cart/checkout.ts in submitOrder",
    level: "error",
    status: "unresolved",
    count: "142",
    userCount: 37,
    firstSeen: "2024-10-20T08:00:00.000000Z",
    lastSeen: "2024-10-30T09:55:00.000000Z",
    project: { id: "4", name: "Shop frontend", slug: "shop-frontend", platform: "javascript" },
    shortId: "SHOP-FRONTEND-2A",
    type: "error",
    metadata: { type: "TypeError", value: "Cannot read properties of undefined (reading 'id')" },
    numComments: 0,
  },
  {
    id: 1290,
    title: "Slow query",
    culprit: "",
    level: "warning",
    count: 3,
    firstSeen: "2024-10-29T08:00:00Z",
    lastSeen: "2024-10-29T08:00:00Z",
    project: { id: 5, slug: "api" },
  },
  { title: "no id" },
];

Deno.test("fromGlitchtip", () => {
  const [a, b] = fromGlitchtip(GLITCHTIP, "https://app.glitchtip.com", "acme");
  assertEquals(fromGlitchtip(GLITCHTIP, "x", "y").length, 2);
  assertEquals(a.id, "1287");
  assertEquals(a.project, "Shop frontend");
  assertEquals(a.events, 142);
  assertEquals(a.users, 37);
  assertEquals(a.url, "https://app.glitchtip.com/acme/issues/1287");
  assertEquals(a.shortId, "SHOP-FRONTEND-2A");
  assertEquals(a.message, "Cannot read properties of undefined (reading 'id')");
  assertEquals([b.id, b.project, b.level, b.culprit], ["1290", "api", "warning", undefined]);
  assertEquals(fromGlitchtip({ detail: "Not found" }, "x", "y"), []);
});

// GET https://api.rollbar.com/api/1/items?status=active
const ROLLBAR = {
  err: 0,
  result: {
    items: [
      {
        id: 272505123,
        counter: 87,
        environment: "production",
        framework: "flask",
        hash: "c3e8f6…",
        level: "critical",
        project_id: 90210,
        status: "active",
        title: "KeyError: 'user_id'",
        total_occurrences: 1520,
        unique_occurrences: 211,
        first_occurrence_timestamp: 1729900000,
        last_occurrence_timestamp: 1730281800,
      },
      {
        id: 272505124,
        counter: 88,
        environment: "staging",
        level: 30,
        title: "Deprecated call",
        total_occurrences: 4,
        last_occurrence_timestamp: 1730200000,
      },
    ],
    page: 1,
    total_count: 2,
  },
};

Deno.test("fromRollbar and rollbarUrl", () => {
  const [a, b] = fromRollbar(ROLLBAR, "acme/website");
  assertEquals(a.level, "fatal");
  assertEquals(a.project, "website");
  assertEquals(a.events, 1520);
  assertEquals(a.lastSeen, new Date(1730281800 * 1000).toISOString());
  assertEquals(a.url, "https://app.rollbar.com/a/acme/fix/item/website/87");
  assertEquals(a.shortId, "#87");
  assertEquals(b.level, "warning");
  assertEquals(fromRollbar(ROLLBAR)[0].url, undefined);
  assertEquals(fromRollbar(ROLLBAR)[0].project, "Rollbar");
  assertEquals(rollbarUrl("not a path", 3), undefined);
  assertEquals(fromRollbar({ err: 1, message: "invalid access token" }), []);
});

// GET https://app.honeybadger.io/v2/projects/123/faults
const HONEYBADGER = {
  results: [
    {
      id: 98765,
      project_id: 123,
      klass: "ActiveRecord::RecordNotFound",
      component: "orders",
      action: "show",
      environment: "production",
      resolved: false,
      ignored: false,
      created_at: "2024-10-25T10:00:00.000000Z",
      comments_count: 1,
      message: "Couldn't find Order with 'id'=42",
      notices_count: 58,
      last_notice_at: "2024-10-30T09:00:00.000000Z",
      tags: [],
      url: "https://app.honeybadger.io/projects/123/faults/98765",
      assignee: { id: 1, email: "ada@acme.dev", name: "Ada Lovelace" },
    },
    { id: 98766, klass: "Resolved", resolved: true },
  ],
  links: { self: "…" },
};

Deno.test("fromHoneybadger", () => {
  const issues = fromHoneybadger(HONEYBADGER, { id: 123, name: "Shop API" });
  assertEquals(issues.length, 1);
  const [a] = issues;
  assertEquals(a.title, "ActiveRecord::RecordNotFound");
  assertEquals(a.culprit, "orders#show");
  assertEquals(a.projectId, "123");
  assertEquals(a.events, 58);
  assertEquals(a.assignee, "Ada Lovelace");
  assertEquals(a.url, "https://app.honeybadger.io/projects/123/faults/98765");
});

// GET https://api.bugsnag.com/projects/5f…/errors
const BUGSNAG = [
  {
    id: "6721a0b2c3d4e5f6a7b8c9d0",
    error_class: "NullPointerException",
    message: "Attempt to invoke virtual method on a null object reference",
    context: "CheckoutActivity",
    severity: "error",
    status: "open",
    events: 3021,
    users: 840,
    first_seen: "2024-10-01T12:00:00.000Z",
    last_seen: "2024-10-30T09:59:00.000Z",
    release_stages: ["production"],
  },
  { id: "x", error_class: "Fixed", status: "fixed" },
];

Deno.test("fromBugsnag", () => {
  const project = { id: "5f1", name: "Android", html_url: "https://app.bugsnag.com/acme/android" };
  const issues = fromBugsnag(BUGSNAG, project);
  assertEquals(issues.length, 1);
  assertEquals(issues[0].url, "https://app.bugsnag.com/acme/android/errors/6721a0b2c3d4e5f6a7b8c9d0");
  assertEquals(issues[0].environment, "production");
  assertEquals([issues[0].events, issues[0].users], [3021, 840]);
  assertEquals(fromBugsnag(BUGSNAG, { id: "1", name: "x" })[0].url, undefined);
});

Deno.test("normalizeLevel and levelLook", () => {
  assertEquals(normalizeLevel("critical"), "fatal");
  assertEquals(normalizeLevel(40), "error");
  assertEquals(normalizeLevel(10), "debug");
  assertEquals(normalizeLevel("warn"), "warning");
  assertEquals(normalizeLevel(undefined), "error");
  assertEquals(levelLook("warning").tint, "orange");
  assertEquals(levelLook("fatal").text, "Fatal");
});

Deno.test("sortIssues, isRecent, since, compact", () => {
  const all = [
    ...fromGlitchtip(GLITCHTIP, "https://app.glitchtip.com", "acme"),
    ...fromRollbar(ROLLBAR, "acme/website"),
    ...fromBugsnag(BUGSNAG, { id: "1", name: "Android" }),
  ];
  assertEquals(sortIssues(all).map((i) => i.id).slice(0, 3), ["6721a0b2c3d4e5f6a7b8c9d0", "1287", "272505123"]);
  const now = Date.parse("2024-10-30T10:00:00Z");
  assert(isRecent(all[0], 24, now));
  assert(!isRecent(all[1], 24, now));
  assertEquals(since("2024-10-30T09:55:00Z", new Date(now)), "5m");
  assertEquals(compact(1520), "1.5k");
  assertEquals(compact(12_345), "12k");
  assertEquals(compact(undefined), "");
});

Deno.test("issueMarkdown", () => {
  const [a] = fromHoneybadger(HONEYBADGER, { id: 123, name: "Shop API" });
  assertEquals(
    issueMarkdown(a),
    "### ActiveRecord::RecordNotFound\n\n```text\nCouldn't find Order with 'id'=42\n```\n\nin `orders#show`",
  );
});

Deno.test("normalizeUrl and normalizeOrg", () => {
  assertEquals(normalizeUrl(""), "https://app.glitchtip.com");
  assertEquals(normalizeUrl("glitchtip.lan:8000/acme/issues"), "http://glitchtip.lan:8000");
  assertEquals(normalizeUrl("192.168.1.20:8000"), "http://192.168.1.20:8000");
  assertEquals(normalizeUrl("http://localhost:8000/"), "http://localhost:8000");
  assertEquals(normalizeUrl("glitchtip.tail1234.ts.net"), "https://glitchtip.tail1234.ts.net");
  assertEquals(normalizeOrg("https://app.glitchtip.com/acme/issues"), "acme");
  assertEquals(normalizeOrg(" acme "), "acme");
});

Deno.test("config needs a service, and a reachable GlitchTip", () => {
  assertThrows(() => config({}), SetupError);
  assertThrows(() => config({ glitchtipToken: "t" }), SetupError, "organization");
  assertThrows(
    () => config({ glitchtipToken: "t", glitchtipOrg: "acme", glitchtipUrl: "https://errors.example.com" }),
    SetupError,
    "outside",
  );
  const c = config({
    glitchtipToken: "t",
    glitchtipOrg: "acme",
    glitchtipUrl: "http://glitchtip.home.arpa:8000",
    honeybadgerToken: "h",
    honeybadgerRegion: "EU",
    bugsnagToken: " ",
  });
  assertEquals(c.glitchtip, { base: "http://glitchtip.home.arpa:8000", org: "acme", token: "t" });
  assertEquals(c.honeybadger?.host, "eu-app.honeybadger.io");
  assertEquals(c.bugsnag, undefined);
  assertEquals(config({ rollbarToken: "r" }).rollbar, { token: "r", project: undefined });
});

Deno.test("the manifest allows the hosts the code reaches", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("app.glitchtip.com"));
  assert(isAllowedHost("glitchtip.tail1234.ts.net"));
  assert(isAllowedHost("172.20.0.5"));
  assert(!isAllowedHost("glitchtip.example.com"));
  assert(!isAllowedHost("172.32.0.1"));
});
