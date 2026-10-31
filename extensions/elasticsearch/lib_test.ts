import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { authHeader, config, curlCommand, HOSTS, isAllowedHost, normalizeUrl, SetupError } from "./api.ts";
import {
  bytes,
  count,
  dataStreamOf,
  errorReason,
  flattenMapping,
  getPath,
  type Hit,
  hitFields,
  hitTime,
  hitTitle,
  mappingMarkdown,
  parseAliases,
  parseIndices,
  product,
  searchBody,
  totalText,
  visibleIndices,
  when,
} from "./lib.ts";

// GET _cat/indices?format=json&bytes=b&expand_wildcards=all&h=… (Elasticsearch 8.15).
const INDICES = [
  {
    health: "yellow",
    status: "open",
    index: "products",
    uuid: "Xq1",
    pri: "1",
    rep: "1",
    "docs.count": "12873",
    "docs.deleted": "41",
    "store.size": "8421376",
    "pri.store.size": "8421376",
    "creation.date": "1761900000000",
  },
  {
    health: "green",
    status: "open",
    index: ".ds-logs-nginx-default-2026.10.31-000004",
    uuid: "Ab2",
    pri: "1",
    rep: "0",
    "docs.count": "2400311",
    "docs.deleted": "0",
    "store.size": "1288490188",
    "pri.store.size": "1288490188",
    "creation.date": "1761868800000",
  },
  {
    health: "green",
    status: "open",
    index: ".kibana_8.15.0_001",
    pri: "1",
    rep: "0",
    "docs.count": "512",
    "store.size": "2097152",
    "pri.store.size": "2097152",
  },
  {
    health: "red",
    status: "open",
    index: "orders-2025",
    pri: "3",
    rep: "1",
    "docs.count": null,
    "store.size": null,
    "pri.store.size": null,
  },
  { health: null, status: "close", index: "archive-2019", uuid: "Zz9", pri: "1", rep: "1" },
];

Deno.test("indices: numbers, data streams, closed and red ones", () => {
  const all = parseIndices(INDICES);
  assertEquals(all[0].docs, 12873);
  assertEquals(all[0].size, 8421376);
  assertEquals(all[0].created, 1761900000000);
  assertEquals(all[1].dataStream, "logs-nginx-default");
  assertEquals(all[2].hidden, true);
  assertEquals(all[3].docs, undefined);
  assertEquals(all[4].health, undefined);
  assertEquals(visibleIndices(all, false).map((i) => i.name), [
    "orders-2025",
    ".ds-logs-nginx-default-2026.10.31-000004",
    "products",
    "archive-2019",
  ]);
  assert(visibleIndices(all, true).some((i) => i.name.startsWith(".kibana")));
  const ilm = parseIndices([{ index: ".ds-ilm-history-7-2026.10.31-000001", health: "green", status: "open" }]);
  assertEquals(visibleIndices(ilm, false), []);
  assertEquals(dataStreamOf(".ds-metrics-system.cpu-default-2026.01.02-000123"), "metrics-system.cpu-default");
  assertEquals(dataStreamOf(".kibana"), undefined);
});

Deno.test("aliases grouped, write index and filters", () => {
  const rows = [
    {
      alias: "logs",
      index: "logs-000002",
      filter: "-",
      "routing.index": "-",
      "routing.search": "-",
      is_write_index: "true",
    },
    {
      alias: "logs",
      index: "logs-000001",
      filter: "-",
      "routing.index": "-",
      "routing.search": "-",
      is_write_index: "false",
    },
    {
      alias: "eu-orders",
      index: "orders",
      filter: "*",
      "routing.index": "eu",
      "routing.search": "eu",
      is_write_index: "-",
    },
    { alias: ".kibana", index: ".kibana_8.15.0_001", filter: "-", is_write_index: "true" },
  ];
  assertEquals(parseAliases(rows, false), [
    { name: "eu-orders", indices: ["orders"], filtered: false, routing: "eu" },
    { name: "logs", indices: ["logs-000001", "logs-000002"], filtered: false, writeIndex: "logs-000002" },
  ]);
  assertEquals(parseAliases([{ alias: "f", index: "x", filter: '{"term":{"a":1}}' }], false)[0].filtered, true);
  assertEquals(parseAliases(rows, true).length, 3);
});

Deno.test("search bodies", () => {
  assertEquals(searchBody(""), {
    size: 25,
    track_total_hits: true,
    query: { match_all: {} },
    sort: [{ "@timestamp": { order: "desc", unmapped_type: "date" } }],
  });
  const b = searchBody(" status:500 ") as any;
  assertEquals(b.query.query_string.query, "status:500");
  assertEquals(b.sort[0], "_score");
  assertEquals(totalText({ value: 10000, relation: "gte" }), "10,000+ hits");
  assertEquals(totalText({ value: 1, relation: "eq" }), "1 hit");
  assertEquals(totalText(1234), "1,234 hits");
});

Deno.test("hits: title, time and fields", () => {
  const log: Hit = {
    _index: ".ds-logs-nginx-default-2026.10.31-000004",
    _id: "Kq8x0ZIB",
    _score: null,
    _source: {
      "@timestamp": "2026-10-31T11:58:03.120Z",
      message: "GET /api/orders 500 12ms\n  upstream timed out",
      http: { response: { status_code: 500 } },
      "log.level": "error",
    },
  };
  assertEquals(hitTitle(log), "GET /api/orders 500 12ms upstream timed out");
  assertEquals(hitTime(log), Date.parse("2026-10-31T11:58:03.120Z"));
  assertEquals(getPath(log._source, "http.response.status_code"), 500);
  assertEquals(getPath(log._source, "log.level"), "error");
  assertEquals(hitFields(log)[2], { key: "http", value: '{"response":{"status_code":500}}' });

  const product: Hit = { _index: "products", _id: "42", _source: { sku: "A-1", product_id: "p42", label: "Blue mug" } };
  assertEquals(hitTitle(product), "A-1");
  assertEquals(hitTitle({ _index: "x", _id: "only-id", _source: { n: 1 } }), "only-id");
  assertEquals(hitTime({ _index: "x", _id: "1", _source: { timestamp: 1761912000 } }), 1761912000000);
  assertEquals(hitTime(product), undefined);
});

Deno.test("mapping: nested objects, multi-fields, Elasticsearch 6 types", () => {
  const es8 = {
    products: {
      mappings: {
        properties: {
          title: { type: "text", fields: { keyword: { type: "keyword", ignore_above: 256 } } },
          price: { type: "scaled_float", scaling_factor: 100 },
          vendor: { properties: { name: { type: "keyword" }, country: { type: "keyword" } } },
          tags: { type: "nested", properties: { name: { type: "keyword" } } },
        },
      },
    },
  };
  assertEquals(flattenMapping(es8).map((f) => `${f.path}:${f.type}`), [
    "price:scaled_float",
    "tags:nested",
    "tags.name:keyword",
    "title:text",
    "title.keyword:keyword",
    "vendor.country:keyword",
    "vendor.name:keyword",
  ]);
  const es6 = { old: { mappings: { _doc: { properties: { a: { type: "long" } } } } } };
  assertEquals(flattenMapping(es6), [{ path: "a", type: "long" }]);
  assert(mappingMarkdown("products", flattenMapping(es8)).includes("| `title.keyword` | keyword |"));
  assert(mappingMarkdown("empty", []).includes("No mapped fields"));
});

Deno.test("error reasons", () => {
  assertEquals(
    errorReason({
      error: {
        root_cause: [{ type: "query_shard_exception", reason: "Failed to parse query [status:(]" }],
        type: "search_phase_execution_exception",
        reason: "all shards failed",
        caused_by: { type: "parse_exception", reason: "Cannot parse 'status:(': Encountered \"<EOF>\"" },
      },
      status: 400,
    }),
    "all shards failed: Cannot parse 'status:(': Encountered \"<EOF>\"",
  );
  assertEquals(
    errorReason({ error: { type: "index_not_found_exception", reason: "no such index [nope]" } }),
    "no such index [nope]",
  );
  assertEquals(errorReason({ error: "Unauthorized" }), "Unauthorized");
  assertEquals(errorReason("oops"), undefined);
});

Deno.test("product names", () => {
  assertEquals(product({ version: { number: "8.15.0", build_flavor: "default" } }), "Elasticsearch 8.15.0");
  assertEquals(product({ version: { number: "2.17.1", distribution: "opensearch" } }), "OpenSearch 2.17.1");
  assertEquals(product(undefined), "Elasticsearch");
});

Deno.test("credentials and configuration", () => {
  assertEquals(
    authHeader({ apiKey: "VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==" }),
    "ApiKey VnVhQ2ZHY0JDZGJrUW0tZTVhT3g6dWkybHAyYXhUTm1zeWFrdzl0dk5udw==",
  );
  assertEquals(authHeader({ apiKey: "id1:key1" }), `ApiKey ${btoa("id1:key1")}`);
  assertEquals(authHeader({ username: "elastic", password: "pässword" }), `Basic ZWxhc3RpYzpww6Rzc3dvcmQ=`);
  assertEquals(authHeader({}), undefined);
  assertEquals(normalizeUrl(""), "http://localhost:9200");
  assertEquals(normalizeUrl("search.lan:9200/"), "http://search.lan:9200");
  const c = config({ address: "https://my-deploy.es.europe-west1.gcp.cloud.es.io", apiKey: "a:b" });
  assertEquals([c.url, c.defaultIndex, c.showSystem], [
    "https://my-deploy.es.europe-west1.gcp.cloud.es.io",
    "*",
    false,
  ]);
  assertEquals(
    curlCommand(c, "/logs/_search?pretty"),
    `curl -s -H "Authorization: ApiKey $ES_API_KEY" "https://my-deploy.es.europe-west1.gcp.cloud.es.io/logs/_search?pretty"`,
  );
  assertEquals(config({ showSystem: true, defaultIndex: "logs-*" }).defaultIndex, "logs-*");
  assertThrows(() => config({ address: "search.example.com" }), SetupError, "outside the networks");
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(isAllowedHost("search-logs-abc.eu-west-1.es.amazonaws.com"));
  assert(isAllowedHost("10.1.2.3"));
  assert(!isAllowedHost("es.example.com"));
});

Deno.test("formatting", () => {
  assertEquals(bytes(0), "0 B");
  assertEquals(bytes(1536), "1.5 KB");
  assertEquals(bytes(1288490188), "1.2 GB");
  assertEquals(bytes(undefined), "–");
  assertEquals(count(999), "999");
  assertEquals(count(12873), "13k");
  assertEquals(count(2400311), "2.4M");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(when(now - 5 * 60_000, now), "5 min");
  assertEquals(when(Date.parse("2026-10-12T08:00:00Z"), now), "12 Oct 2026");
});
