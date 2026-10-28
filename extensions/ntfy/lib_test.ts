import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { config, defaultTarget, HOSTS, isAllowedHost, SetupError } from "./api.ts";
import {
  clip,
  fromGotify,
  fromNtfy,
  gotifyBody,
  gotifyPriority,
  normalizeServer,
  notificationMarkdown,
  ntfyAuth,
  parseNdjson,
  parsePriority,
  parseTags,
  publishBody,
  sinceParam,
  soleUrl,
  splitTags,
  splitTopicUrl,
  validTopic,
} from "./lib.ts";

// GET https://ntfy.sh/backslash-test/json?poll=1&since=24h
const POLL = [
  `{"id":"sPs71M8A2T","time":1761645600,"expires":1761688800,"event":"message","topic":"backslash-test","message":"Backup finished in 4 min"}`,
  `{"id":"x2Lg9QmYzA","time":1761649200,"expires":1761692400,"event":"message","topic":"backslash-test","title":"Disk almost full","message":"/ is 95% full on nas","priority":5,"tags":["warning","nas"],"click":"https://nas.lan:5001","actions":[{"id":"a1","action":"view","label":"Open DSM","url":"https://nas.lan:5001","clear":false},{"id":"a2","action":"http","label":"Clean up","url":"https://nas.lan/api/clean","method":"POST","clear":true}]}`,
  `{"id":"keepalive1","time":1761649300,"event":"keepalive","topic":"backslash-test"}`,
  `{"id":"att1","time":1761640000,"event":"message","topic":"backslash-test","message":"You received a file: report.pdf","attachment":{"name":"report.pdf","type":"application/pdf","size":183402,"expires":1761650000,"url":"https://ntfy.sh/file/att1.pdf"}}`,
  `{"id":"broken`,
].join("\n");

Deno.test("ntfy poll: messages only, newest first", () => {
  const list = parseNdjson(POLL);
  assertEquals(list.map((m) => m.id), ["x2Lg9QmYzA", "sPs71M8A2T", "att1"]);
  const n = fromNtfy(list[0]);
  assertEquals(n.priority, 5);
  assertEquals(n.time, 1761649200000);
  assertEquals(n.click, "https://nas.lan:5001");
  assertEquals(n.actions.map((a) => a.action), ["view", "http"]);
  assertEquals(fromNtfy(list[1]).priority, 3);
  const md = notificationMarkdown(n);
  assert(md.startsWith("⚠️ **Disk almost full**\n\n/ is 95% full on nas"));
  assert(md.includes("- Open DSM: https://nas.lan:5001 (view)"));
  assert(notificationMarkdown(fromNtfy(list[2])).includes("📎 [report.pdf](https://ntfy.sh/file/att1.pdf) (179 kB)"));
});

Deno.test("Gotify messages", () => {
  const m = fromGotify({
    id: 25,
    appid: 3,
    message: "**Watchtower** updated 2 containers",
    title: "Updates",
    priority: 8,
    date: "2026-10-28T09:12:44.213937+01:00",
    extras: {
      "client::display": { contentType: "text/markdown" },
      "client::notification": { click: { url: "https://portainer.lan" } },
    },
  }, { 3: "Watchtower" });
  assertEquals(m.source, "Watchtower");
  assertEquals(m.priority, 5);
  assertEquals(m.click, "https://portainer.lan");
  assertEquals(m.time, Date.parse("2026-10-28T08:12:44.213Z"));
  assert(notificationMarkdown(m).includes("**Watchtower**"));
  const plain = fromGotify({ id: 1, appid: 9, message: "a_b*c", date: "2026-10-28T09:00:00Z" }, {});
  assertEquals(plain.source, "App 9");
  assertEquals(notificationMarkdown(plain), "a\\_b\\*c");
  assertEquals([0, 2, 5, 9].map(gotifyPriority), [2, 3, 4, 5]);
});

Deno.test("priorities and tags", () => {
  assertEquals(parsePriority("urgent"), 5);
  assertEquals(parsePriority("max"), 5);
  assertEquals(parsePriority("2"), 2);
  assertEquals(parsePriority(""), undefined);
  assertThrows(() => parsePriority("9"));
  assertEquals(parseTags("warning, backup  ,cron"), ["warning", "backup", "cron"]);
  assertEquals(splitTags(["warning", "nas", "+1", "Tada"]), { emojis: ["⚠️", "👍", "🎉"], words: ["nas"] });
});

Deno.test("what is sent", () => {
  assertEquals(publishBody({ topic: "alerts", message: "hi", priority: 3, tags: [] }), {
    topic: "alerts",
    message: "hi",
  });
  assertEquals(
    publishBody({ topic: "alerts", message: "hi", title: "T", priority: 5, tags: ["x"], click: "https://a" }),
    {
      topic: "alerts",
      message: "hi",
      title: "T",
      priority: 5,
      tags: ["x"],
      click: "https://a",
    },
  );
  assertEquals(gotifyBody({ message: "hi", priority: 4, click: "https://a" }), {
    message: "hi",
    priority: 7,
    extras: { "client::notification": { click: { url: "https://a" } } },
  });
  assertEquals(soleUrl(" https://example.com/x?y=1 "), "https://example.com/x?y=1");
  assertEquals(soleUrl("see https://example.com"), undefined);
  assertEquals(clip("short"), "short");
  const long = clip("é".repeat(5000));
  assert(new TextEncoder().encode(long).length <= 4000);
  assert(long.endsWith("…"));
});

Deno.test("servers, topics, auth", () => {
  assertEquals(normalizeServer("ntfy.lan/", "x"), "https://ntfy.lan");
  assertEquals(normalizeServer("", "https://ntfy.sh"), "https://ntfy.sh");
  assertEquals(normalizeServer("http://192.168.1.5:8080"), "http://192.168.1.5:8080");
  assertEquals(validTopic("alerts-k3j9x"), undefined);
  assert(validTopic("bad topic"));
  assert(validTopic("x".repeat(65)));
  assertEquals(splitTopicUrl("ntfy.sh/alerts"), { server: "https://ntfy.sh", topic: "alerts" });
  assertEquals(splitTopicUrl("alerts"), { topic: "alerts" });
  assertEquals(sinceParam("12h"), "12h");
  assertEquals(sinceParam("all"), "all");
  assertEquals(sinceParam("yesterday"), "24h");
  assertEquals(ntfyAuth("tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2"), "Bearer tk_AgQdq7mVBoFD37zQVN29RhuMzNIz2");
  assertEquals(ntfyAuth("phil:mypass"), `Basic ${btoa("phil:mypass")}`);
  assertEquals(ntfyAuth(""), undefined);
});

Deno.test("configuration and default target", () => {
  const c = config({ topic: "alerts", gotifyUrl: "gotify.lan", gotifyAppToken: "A" });
  assertEquals(c.ntfy, "https://ntfy.sh");
  assertEquals(c.gotify, "https://gotify.lan");
  assertEquals(defaultTarget(c), { kind: "ntfy", topic: "alerts" });
  assertEquals(defaultTarget(config({ gotifyUrl: "http://10.0.0.4", gotifyAppToken: "A" })), { kind: "gotify" });
  assertThrows(() => defaultTarget(config({})), SetupError);
  assertThrows(() => config({ server: "https://ntfy.example.com" }), SetupError, "outside");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("ntfy.sh"));
  assert(isAllowedHost("gotify.home.arpa"));
  assert(isAllowedHost("100.101.1.2"));
  assert(!isAllowedHost("ntfy.example.com"));
  assert(!isAllowedHost("8.8.8.8"));
});
