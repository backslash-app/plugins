import { assertEquals, assertStringIncludes } from "@std/assert";
import type { Context } from "@backslash/api";
import { account, AuthError, guarded, normalizeOrg, normalizeRegion } from "./api.ts";
import {
  compact,
  eventMarkdown,
  eventMetadata,
  exceptions,
  frameLine,
  type Issue,
  issueItem,
  issueMetadata,
  levelLook,
  type SentryEvent,
  since,
  substatusLook,
  topFrames,
} from "./lib.ts";

const ctx: Context = {
  args: {},
  preferences: { organization: "acme", token: "sntryu_x", region: "de.sentry.io" },
  query: "",
  signal: new AbortController().signal,
};

const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

// Shaped like `GET /api/0/organizations/{org}/issues/`.
const issue: Issue = {
  id: "4505897812",
  shortId: "WEB-3F",
  title: "TypeError: Cannot read properties of undefined (reading 'total')",
  culprit: "renderTotal(app/components/Cart)",
  permalink: "https://acme.sentry.io/issues/4505897812/",
  level: "error",
  status: "unresolved",
  substatus: "regressed",
  priority: "high",
  platform: "javascript",
  project: { id: "11", name: "web", slug: "web", platform: "javascript-react" },
  type: "error",
  metadata: {
    type: "TypeError",
    value: "Cannot read properties of undefined (reading 'total')",
    filename: "app/components/Cart.tsx",
  },
  numComments: 0,
  assignedTo: { type: "user", id: "7", name: "Ada Lovelace", email: "ada@acme.dev" },
  isUnhandled: true,
  count: "1834",
  userCount: 312,
  firstSeen: hoursAgo(24 * 9),
  lastSeen: hoursAgo(2),
};

// Shaped like `GET /api/0/organizations/{org}/issues/{id}/events/latest/`.
const event: SentryEvent = {
  id: "9fac2ceed9344f2bbfdd1fdacb0ed9b1",
  eventID: "9fac2ceed9344f2bbfdd1fdacb0ed9b1",
  dateCreated: hoursAgo(2),
  platform: "javascript",
  tags: [
    { key: "environment", value: "production" },
    { key: "release", value: "web@2.14.0" },
    { key: "browser", value: "Firefox 131.0" },
    { key: "handled", value: "no" },
    { key: "url", value: "https://shop.acme.dev/cart" },
  ],
  user: { id: "u-91", email: "buyer@example.com", ip_address: "203.0.113.4" },
  entries: [
    {
      type: "exception",
      data: {
        values: [{
          type: "TypeError",
          value: "Cannot read properties of undefined (reading 'total')",
          stacktrace: {
            frames: [
              {
                filename: "node_modules/react-dom/cjs/react-dom.development.js",
                function: "renderWithHooks",
                lineNo: 16305,
                colNo: 18,
                inApp: false,
              },
              { filename: "app/pages/Checkout.tsx", function: "Checkout", lineNo: 12, colNo: 5, inApp: true },
              {
                filename: "app/components/Cart.tsx",
                function: "renderTotal",
                lineNo: 42,
                colNo: 13,
                inApp: true,
                context: [[41, "  const cart = useCart();"], [42, "  return format(cart.summary.total);"], [43, "}"]],
              },
            ],
          },
        }],
      },
    },
    { type: "breadcrumbs", data: { values: [] } },
  ],
};

Deno.test("settings: org slug, region", () => {
  assertEquals([
    normalizeOrg("acme"),
    normalizeOrg("https://acme.sentry.io/issues/"),
    normalizeOrg("https://sentry.io/organizations/acme/"),
  ], [
    "acme",
    "acme",
    "acme",
  ]);
  assertEquals([normalizeRegion(""), normalizeRegion("https://de.sentry.io/")], ["sentry.io", "de.sentry.io"]);
  assertEquals(account(ctx.preferences).host, "de.sentry.io");
  let error: unknown;
  try {
    account({ organization: "acme", token: "t", region: "sentry.acme.internal" });
  } catch (e) {
    error = e;
  }
  assertEquals(error instanceof AuthError, true);
});

Deno.test("formatting", () => {
  const now = new Date("2026-10-27T12:00:00Z");
  assertEquals(
    [
      since("2026-10-27T11:59:30Z", now),
      since("2026-10-27T11:15:00Z", now),
      since("2026-10-27T07:00:00Z", now),
      since("2026-10-24T07:00:00Z", now),
    ],
    ["just now", "45m", "5h", "3d"],
  );
  assertEquals([compact("1834"), compact(312), compact(45_600)], ["1.8k", "312", "46k"]);
  assertEquals(levelLook("warning"), { icon: "bs-alert", tint: "orange", text: "Warning" });
  assertEquals(levelLook("error").icon, "bs-bug");
  assertEquals(substatusLook(issue), { text: "Regressed", color: "purple" });
});

Deno.test("issue item and panel", () => {
  const item = issueItem(issue, ctx);
  assertEquals(item.section, "web");
  assertEquals(item.subtitle, "renderTotal(app/components/Cart)");
  assertEquals(item.icon, { source: "bs-bug", tint: "red" });
  assertEquals(item.accessories?.slice(0, 4), [
    { tag: "Regressed", color: "purple" },
    { tag: "Unhandled", color: "red" },
    { icon: "bs-activity", text: "1.8k", tooltip: "1834 events" },
    { icon: "bs-user", text: "312", tooltip: "312 users" },
  ]);
  assertEquals(item.accessories?.[5].text, "2h");
  assertEquals(item.detail?.stats?.map((s) => s.value), ["1.8k", "312", "9d", "2h"]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 7), [
    "Open in Sentry",
    "Show Latest Event",
    "Resolve",
    "Resolve in Next Release",
    "Ignore",
    "Assign To",
    "Assign to Me",
  ]);
  assertEquals(issueMetadata(issue).map((m) => m.label).slice(0, 6), [
    "Level",
    "Status",
    "State",
    "Priority",
    "Assignee",
    "Handled",
  ]);
  const resolved = issueItem({ ...issue, status: "resolved" }, ctx);
  assertEquals(resolved.actions?.[2].title, "Unresolve");
});

Deno.test("stack trace: app frames, most recent first, with context", () => {
  const [ex] = exceptions(event);
  assertEquals(ex.type, "TypeError");
  assertEquals(topFrames(ex.frames).map((f) => f.function), ["renderTotal", "Checkout"]);
  assertEquals(frameLine(ex.frames[0]), "renderTotal (app/components/Cart.tsx:42:13)");
  const md = eventMarkdown(issue, event);
  assertStringIncludes(md, "## TypeError: Cannot read properties of undefined (reading 'total')");
  assertStringIncludes(md, "▸ renderTotal (app/components/Cart.tsx:42:13)\n▸ Checkout (app/pages/Checkout.tsx:12:5)");
  assertStringIncludes(md, "→ 42    return format(cart.summary.total);");
  const noTrace = eventMarkdown(issue, {
    ...event,
    entries: [{ type: "message", data: { formatted: "Payment timed out" } }],
  });
  assertStringIncludes(noTrace, "```\nPayment timed out\n```");
});

Deno.test("event tags", () => {
  const lines = eventMetadata(event);
  assertEquals(lines.map((m) => m.label), [
    "Event",
    "When",
    "Environment",
    "Release",
    "Browser",
    "URL",
    "Handled",
    "User",
  ]);
  assertEquals(lines.find((m) => m.label === "Handled")?.color, "red");
  assertEquals(lines.find((m) => m.label === "URL")?.link, "https://shop.acme.dev/cart");
});

Deno.test("a missing token becomes a setup row", async () => {
  const items = await guarded(() => Promise.reject(new AuthError("Sentry rejected the auth token")));
  assertEquals([items[0].id, items[0].actions?.[0].title], ["setup", "Create Auth Token"]);
});
