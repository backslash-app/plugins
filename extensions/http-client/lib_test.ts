import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  addHistory,
  ago,
  formatBytes,
  formatMs,
  hasSecret,
  type HistoryEntry,
  htmlTitle,
  isTextual,
  looksLikeUrl,
  normalizeUrl,
  parseCurl,
  parseHeaders,
  parseInput,
  prettyBody,
  reason,
  send,
  shellWords,
  shortUrl,
  statusTint,
  toCurl,
  validate,
} from "./lib.ts";

Deno.test("what the user types", () => {
  assertEquals(parseInput("https://api.github.com/zen"), {
    method: "GET",
    url: "https://api.github.com/zen",
    headers: [],
    body: undefined,
  });
  assertEquals(parseInput("delete api.example.com/items/3")?.method, "DELETE");
  assertEquals(parseInput("localhost:8000/health")?.url, "http://localhost:8000/health");
  assertEquals(parseInput('POST api.example.com/items {"name": "Ada"}'), {
    method: "POST",
    url: "https://api.example.com/items",
    headers: [["Content-Type", "application/json"]],
    body: '{"name": "Ada"}',
  });
  // A body without a method is a POST.
  assertEquals(parseInput("api.example.com/form a=1&b=2")?.method, "POST");
  assertEquals(parseInput("192.168.1.10:8080")?.url, "http://192.168.1.10:8080");
  assertEquals([parseInput(""), parseInput("hello"), parseInput("FETCH https://x.com"), parseInput("what is http")], [
    undefined,
    undefined,
    undefined,
    undefined,
  ]);
  assertEquals([looksLikeUrl("example.com"), looksLikeUrl("example"), looksLikeUrl("[::1]:3000/x")], [
    true,
    false,
    true,
  ]);
  assertEquals([normalizeUrl("printer.local/status"), normalizeUrl("HTTP://x.y")], [
    "http://printer.local/status",
    "HTTP://x.y",
  ]);
});

Deno.test("shell words", () => {
  assertEquals(shellWords(`curl -H 'A: b c' -d "{\\"x\\": 1}" $'a\\nb' plain\\ word`), [
    "curl",
    "-H",
    "A: b c",
    "-d",
    '{"x": 1}',
    "a\nb",
    "plain word",
  ]);
  assertEquals(shellWords("curl \\\n  https://x.com"), ["curl", "https://x.com"]);
  assertEquals(shellWords("it''s \"\""), ["its", ""]);
  assertThrows(() => shellWords("curl 'oops"), Error, "Unterminated");
});

Deno.test("pasted curl commands", () => {
  const r = parseInput(
    `curl -fsSL -X PATCH 'https://api.example.com/users/1' -H 'Authorization: Bearer abc' -H "Accept: application/json" --data-raw '{"name":"Ada"}' --compressed`,
  );
  assertEquals(r, {
    method: "PATCH",
    url: "https://api.example.com/users/1",
    headers: [["Authorization", "Bearer abc"], ["Accept", "application/json"], [
      "Content-Type",
      "application/x-www-form-urlencoded",
    ]],
    body: '{"name":"Ada"}',
  });
  assertEquals(parseCurl(shellWords("curl -d a=1 -d b=2 example.com")), {
    method: "POST",
    url: "https://example.com",
    headers: [["Content-Type", "application/x-www-form-urlencoded"]],
    body: "a=1&b=2",
  });
  assertEquals(parseCurl(shellWords("curl -G -d q=deno example.com/search")).url, "https://example.com/search?q=deno");
  assertEquals(parseCurl(shellWords("curl --json '{\"a\":1}' example.com")).headers, [
    ["Content-Type", "application/json"],
    ["Accept", "application/json"],
  ]);
  assertEquals(parseCurl(shellWords("curl -u ada:secret example.com")).headers, [[
    "Authorization",
    "Basic YWRhOnNlY3JldA==",
  ]]);
  assertEquals(parseCurl(shellWords("curl -I example.com")).method, "HEAD");
  assertEquals(parseCurl(shellWords("curl --data-urlencode 'q=a b' example.com")).body, "q=a%20b");
  assertEquals(parseCurl(shellWords("curl -o out.html -m 10 example.com")).url, "https://example.com");
  assertThrows(() => parseCurl(shellWords("curl --foo example.com")), Error, "--foo isn't supported");
  assertThrows(() => parseCurl(shellWords("curl -d @file.json example.com")), Error, "@file");
  assertThrows(() => parseCurl(shellWords("curl -s")), Error, "No URL");
});

Deno.test("copy as curl reads back the same request", () => {
  const r = {
    method: "PUT",
    url: "https://api.example.com/items/1?x=a b",
    headers: [["Content-Type", "application/json"], ["X-Note", "it's"]] as [string, string][],
    body: '{"name": "Ada"}',
  };
  const line = toCurl(r);
  assertEquals(
    line,
    `curl -X PUT 'https://api.example.com/items/1?x=a b' -H 'Content-Type: application/json' -H 'X-Note: it'\\''s' --data-raw '{"name": "Ada"}'`,
  );
  assertEquals(parseCurl(shellWords(line)), r);
  assertEquals(toCurl({ method: "GET", url: "https://x.com", headers: [] }), "curl https://x.com");
  assertEquals(toCurl({ method: "HEAD", url: "https://x.com", headers: [] }), "curl -I https://x.com");
  assertEquals(
    toCurl({ method: "POST", url: "https://x.com", headers: [], body: "a" }),
    "curl https://x.com --data-raw a",
  );
});

Deno.test("headers and validation", () => {
  assertEquals(parseHeaders("Accept: application/json\n\n# note\nX-Url: https://a.b/c"), [
    ["Accept", "application/json"],
    ["X-Url", "https://a.b/c"],
  ]);
  assertThrows(() => parseHeaders("no colon here"), Error, "is not a header");
  assertThrows(
    () => validate({ method: "GET", url: "https://x.com", headers: [], body: "x" }),
    Error,
    "can't have a body",
  );
  assertThrows(() => validate({ method: "GET", url: "ftp://x.com", headers: [] }), Error, "Only http");
  assertThrows(() => validate({ method: "GET", url: "nope", headers: [] }), Error, "not a valid URL");
  assertThrows(() => validate({ method: "BREW", url: "https://x.com", headers: [] }), Error, "Unknown method");
});

Deno.test("send with a fake fetch", async () => {
  let seen: RequestInit | undefined;
  const fetchFn = ((_url: string, init: RequestInit) => {
    seen = init;
    return Promise.resolve(
      new Response(JSON.stringify({ id: 1, name: "Ada" }), {
        status: 201,
        headers: { "content-type": "application/json; charset=utf-8", "x-request-id": "abc" },
      }),
    );
  }) as unknown as typeof fetch;
  let t = 1000;
  const res = await send(
    {
      method: "POST",
      url: "https://api.example.com/users",
      headers: [["Content-Type", "application/json"]],
      body: "{}",
    },
    { fetchFn, now: () => (t += 42) },
  );
  assertEquals(seen?.method, "POST");
  assertEquals(seen?.body, "{}");
  assertEquals([res.status, res.ms, res.size, res.contentType, res.text], [
    201,
    42,
    21,
    "application/json; charset=utf-8",
    '{"id":1,"name":"Ada"}',
  ]);
  assertEquals(res.headers.find(([k]) => k === "x-request-id"), ["x-request-id", "abc"]);
  const binary = await send({ method: "GET", url: "https://x.com/a.png", headers: [] }, {
    fetchFn: (() =>
      Promise.resolve(
        new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
      )) as unknown as typeof fetch,
  });
  assertEquals([binary.text, binary.size], [undefined, 3]);
  await assertRejects(() => send({ method: "GET", url: "ftp://x", headers: [] }, { fetchFn }), Error, "Only http");
});

Deno.test("bodies are shown readably", () => {
  assertEquals(prettyBody("application/json", '{"a":[1,2]}'), {
    lang: "json",
    text: '{\n  "a": [\n    1,\n    2\n  ]\n}',
  });
  assertEquals(prettyBody("application/problem+json", '{"title":"x"}').lang, "json");
  assertEquals(prettyBody("", ' {"a":1}').text, '{\n  "a": 1\n}');
  assertEquals(prettyBody("application/json", "not json"), { lang: "", text: "not json" });
  assertEquals(prettyBody("text/html", "<p>"), { lang: "html", text: "<p>" });
  assertEquals(prettyBody("application/x-www-form-urlencoded", "a=1&b=x%20y").text, "a = 1\nb = x y");
  assertEquals(prettyBody("application/x-ndjson", '{"a":1}\n{"b":2}').text, '{\n  "a": 1\n}\n{\n  "b": 2\n}');
  assertEquals(htmlTitle("<html><title>\n Deno  docs </title>"), "Deno docs");
  assertEquals([
    isTextual("text/plain"),
    isTextual("application/vnd.api+json"),
    isTextual("image/svg+xml"),
    isTextual("image/png"),
  ], [
    true,
    true,
    true,
    false,
  ]);
});

Deno.test("formatting and history", () => {
  assertEquals([formatBytes(512), formatBytes(2048), formatBytes(50_000), formatBytes(3_500_000)], [
    "512 B",
    "2.0 KB",
    "49 KB",
    "3.3 MB",
  ]);
  assertEquals([formatMs(87), formatMs(1534)], ["87 ms", "1.53 s"]);
  assertEquals([statusTint(101), statusTint(204), statusTint(304), statusTint(404), statusTint(503)], [
    "blue",
    "green",
    "purple",
    "orange",
    "red",
  ]);
  assertEquals([reason(404, ""), reason(200, "Fine"), reason(299, "")], ["Not Found", "Fine", ""]);
  assertEquals(shortUrl("https://api.example.com/v1/items?page=2"), "api.example.com/v1/items?page=2");
  assertEquals(shortUrl("https://example.com/"), "example.com");
  const now = Date.UTC(2026, 9, 28, 12);
  assertEquals(
    [ago(now - 5_000, now), ago(now - 300_000, now), ago(now - 7_200_000, now), ago(now - 100_000_000, now)],
    [
      "just now",
      "5 min ago",
      "2 h ago",
      "yesterday",
    ],
  );
  const h = (url: string, at: number): HistoryEntry => ({ method: "GET", url, headers: [], status: 200, ms: 10, at });
  const list = addHistory([h("https://a", 1), h("https://b", 2)], h("https://a", 3), 2);
  assertEquals(list.map((e) => [e.url, e.at]), [["https://a", 3], ["https://b", 2]]);
  assertEquals(addHistory([h("https://a", 1), h("https://b", 2)], h("https://c", 3), 2).map((e) => e.url), [
    "https://c",
    "https://a",
  ]);
});

Deno.test("requests with credentials are flagged", () => {
  assertEquals(hasSecret({ method: "GET", url: "https://x.com", headers: [["Authorization", "Bearer x"]] }), true);
  assertEquals(hasSecret({ method: "GET", url: "https://x.com", headers: [["Accept", "*/*"]] }), false);
});
