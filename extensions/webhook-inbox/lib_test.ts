import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { parse as parseToml } from "@std/toml";
import { replay } from "./api.ts";
import {
  addInbox,
  ago,
  currentInbox,
  headerList,
  type Hook,
  hookMarkdown,
  LOCAL_HOSTS,
  parseDate,
  parseTarget,
  prettyBody,
  queryList,
  removeInbox,
  replayHeaders,
  replayRequest,
  replayUrl,
  requestPath,
  senderOf,
  toCurl,
  viewUrl,
  webhookUrl,
} from "./lib.ts";

const UUID = "9981f9f4-657a-4ebf-be7c-1915bedd4775";

const hook = (o: Partial<Hook> = {}): Hook => ({
  uuid: "req-1",
  type: "web",
  ip: "54.187.174.169",
  method: "POST",
  user_agent: "Stripe/1.0 (+https://stripe.com/docs/webhooks)",
  content: '{"id":"evt_1","type":"payment_intent.succeeded"}',
  query: { source: "test", tag: ["a", "b"] },
  headers: {
    host: ["webhook.site"],
    "content-type": ["application/json; charset=utf-8"],
    "content-length": ["49"],
    "stripe-signature": ["t=1,v1=abc"],
    "x-forwarded-for": ["54.187.174.169"],
    "cf-ray": ["123"],
    "user-agent": ["Stripe/1.0 (+https://stripe.com/docs/webhooks)"],
  },
  url: `https://webhook.site/${UUID}/stripe/events?source=test&tag=a&tag=b`,
  size: 49,
  files: [],
  created_at: "2026-10-29 10:12:30",
  ...o,
});

Deno.test("urls and dates", () => {
  assertEquals(webhookUrl(UUID), `https://webhook.site/${UUID}`);
  assertEquals(viewUrl(UUID, "r"), `https://webhook.site/#!/view/${UUID}/r`);
  assertEquals(parseDate("2026-10-29 10:12:30"), Date.parse("2026-10-29T10:12:30Z"));
  assertEquals(parseDate("2026-10-29T10:12:30+02:00"), Date.parse("2026-10-29T08:12:30Z"));
  assertEquals(parseDate("nope"), undefined);
  const now = Date.parse("2026-10-29T12:00:00Z");
  assertEquals(ago(now - 10_000, now), "just now");
  assertEquals(ago(now - 5 * 60_000, now), "5 min ago");
  assertEquals(ago(now - 3 * 3600_000, now), "3 h ago");
});

Deno.test("a request: path, headers, query, sender", () => {
  const h = hook();
  assertEquals(requestPath(h.url, UUID), { path: "/stripe/events", search: "?source=test&tag=a&tag=b" });
  assertEquals(requestPath(`https://webhook.site/${UUID}`, UUID), { path: "/", search: "" });
  assertEquals(requestPath(`https://${UUID}.webhook.site/x/y`, UUID), { path: "/x/y", search: "" });
  assertEquals(headerList(h.headers).length, 7);
  assertEquals(headerList([]), []);
  assertEquals(queryList(h.query), [["source", "test"], ["tag", "a"], ["tag", "b"]]);
  assertEquals(senderOf(h), "Stripe");
  assertEquals(senderOf(hook({ headers: { "x-github-event": ["push"] } })), "GitHub · push");
  assertEquals(senderOf(hook({ headers: {}, user_agent: "curl/8.5.0" })), "curl");
  const md = hookMarkdown(h, UUID);
  assertEquals(md.split("\n")[0], "### POST /stripe/events?source=test&tag=a&tag=b");
  assertEquals(md.includes('"type": "payment_intent.succeeded"'), true);
  assertEquals(hookMarkdown(hook({ content: "" }), UUID).endsWith("_No body._"), true);
});

Deno.test("bodies are formatted", () => {
  assertEquals(prettyBody("application/json", '{"a":1}'), { lang: "json", text: '{\n  "a": 1\n}' });
  assertEquals(prettyBody("application/x-www-form-urlencoded", "a=1&b=hello+world"), {
    lang: "",
    text: "a = 1\nb = hello world",
  });
  assertEquals(prettyBody(undefined, "[1,2]").lang, "json");
  assertEquals(prettyBody("text/plain", "{oops").text, "{oops");
});

Deno.test("replay targets stay on this computer", () => {
  assertEquals(parseTarget("3000"), "http://localhost:3000");
  assertEquals(parseTarget(":8080/hooks/"), "http://localhost:8080/hooks");
  assertEquals(parseTarget("127.0.0.1:4000/api"), "http://127.0.0.1:4000/api");
  assertEquals(parseTarget("https://localhost:8443"), "https://localhost:8443");
  assertThrows(() => parseTarget("https://example.com"), Error, "only be replayed to this computer");
  assertThrows(() => parseTarget(""), Error, "Enter where");
});

Deno.test("replay: url, headers, body", () => {
  const h = hook();
  assertEquals(
    replayUrl("http://localhost:3000", h, UUID, true),
    "http://localhost:3000/stripe/events?source=test&tag=a&tag=b",
  );
  assertEquals(
    replayUrl("localhost:3000/api/webhook?k=1", h, UUID, false),
    "http://localhost:3000/api/webhook?k=1&source=test&tag=a&tag=b",
  );
  assertEquals(replayHeaders(h).map(([k]) => k), ["content-type", "stripe-signature", "user-agent"]);
  const r = replayRequest("3000", h, UUID, true);
  assertEquals(r.method, "POST");
  assertEquals(r.body, h.content);
  assertEquals(replayRequest("3000", hook({ method: "GET", content: "x" }), UUID, true).body, undefined);
  assertEquals(
    toCurl({ method: "PUT", url: "http://localhost:3000/x", headers: [["a", "b c"]], body: "it's" }),
    "curl -X PUT http://localhost:3000/x -H 'a: b c' --data-raw 'it'\\''s'",
  );
});

Deno.test("replay: sends and reads the answer, explains a closed port", async () => {
  const fetchFn = ((url: string, init: RequestInit) => {
    assertEquals(url, "http://localhost:3000/x");
    assertEquals(init.method, "POST");
    return Promise.resolve(new Response("ok", { status: 202, headers: { "content-type": "text/plain" } }));
  }) as unknown as typeof fetch;
  const res = await replay(
    { method: "POST", url: "http://localhost:3000/x", headers: [], body: "{}" },
    undefined,
    fetchFn,
  );
  assertEquals([res.status, res.text, res.size], [202, "ok", 2]);
  const refused = (() => Promise.reject(new TypeError("Connection refused (os error 111)"))) as unknown as typeof fetch;
  await assertRejects(
    () => replay({ method: "GET", url: "http://localhost:3999/", headers: [] }, undefined, refused),
    Error,
    "is your server running?",
  );
});

Deno.test("inboxes", () => {
  const a = { uuid: "a", created: 1 };
  const b = { uuid: "b", created: 2 };
  assertEquals(addInbox([a], b), [b, a]);
  assertEquals(addInbox([b, a], a), [a, b]);
  assertEquals(removeInbox([a, b], "a"), [b]);
  assertEquals(currentInbox([b, a], "a"), a);
  assertEquals(currentInbox([b, a], "gone"), b);
  assertEquals(currentInbox([], undefined), undefined);
});

Deno.test("permissions: webhook.site and the local hosts replays may use", async () => {
  const manifest = parseToml(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, ["webhook.site", ...LOCAL_HOSTS]);
});
