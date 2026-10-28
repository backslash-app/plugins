import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  breadcrumb,
  children,
  copyText,
  csvFriendly,
  excerpt,
  formatPath,
  getAt,
  inlinePreview,
  insight,
  isQuery,
  type Json,
  jsonPath,
  jsPath,
  locate,
  looksLikeJson,
  parseJson,
  previewJson,
  query,
  QueryError,
  sizeLabel,
  stats,
  toCsv,
  toToml,
  toYaml,
  typeOf,
} from "./lib.ts";

const STORE: Json = {
  store: {
    book: [
      { category: "reference", author: "Nigel Rees", title: "Sayings of the Century", price: 8.95 },
      { category: "fiction", author: "Evelyn Waugh", title: "Sword of Honour", price: 12.99 },
      { category: "fiction", author: "Herman Melville", title: "Moby Dick", isbn: "0-553-21311-3", price: 8.99 },
      {
        category: "fiction",
        author: "J. R. R. Tolkien",
        title: "The Lord of the Rings",
        isbn: "0-395-19395-8",
        price: 22.99,
      },
    ],
    bicycle: { color: "red", price: 19.95 },
  },
  "content-type": "application/json",
  "with space": { ok: true },
};

const values = (src: string, root: Json = STORE) => query(root, src).map((r) => r.value);
const paths = (src: string, root: Json = STORE) => query(root, src).map((r) => r.path && formatPath(r.path));

Deno.test("parseJson accepts valid JSON and a BOM", () => {
  assertEquals(parseJson('{"a": [1, 2]}'), { ok: true, value: { a: [1, 2] } });
  assertEquals(parseJson("﻿[true]"), { ok: true, value: [true] });
  assertEquals(parseJson(' "x" '), { ok: true, value: "x" });
});

Deno.test("parseJson explains errors with line and column", () => {
  const trailing = parseJson('{\n  "a": 1,\n  "b": 2,\n}');
  assert(!trailing.ok);
  assertEquals(trailing.error.message, "Trailing comma before }");
  assertEquals([trailing.error.line, trailing.error.column], [3, 9]);
  assertEquals(trailing.error.hint, "Remove the last comma");

  const single = parseJson("{'a': 1}");
  assert(!single.ok);
  assertEquals(single.error.message, "Property names must use double quotes");
  assertEquals([single.error.line, single.error.column], [1, 2]);

  const unquoted = parseJson("{\n  name: 1\n}");
  assert(!unquoted.ok);
  assertEquals(unquoted.error.hint, "Quote the property name");
  assertEquals([unquoted.error.line, unquoted.error.column], [2, 3]);

  const missingComma = parseJson("[1, 2\n 3]");
  assert(!missingComma.ok);
  assertEquals(missingComma.error.message, "Unexpected “3”: expected “,” or “]”");
  assertEquals([missingComma.error.line, missingComma.error.column], [2, 2]);

  const comment = parseJson('{\n  // the name\n  "a": 1\n}');
  assert(!comment.ok);
  assertEquals(comment.error.message, "Comments are not allowed in JSON");
  assertEquals(comment.error.line, 2);

  const open = parseJson('{"a": [1, 2');
  assert(!open.ok);
  assertEquals(open.error.message, "Unexpected end of input: the array is not closed");

  const lines = parseJson('{"a": 1}\n{"a": 2}');
  assert(!lines.ok);
  assertEquals(lines.error.line, 2);
  assert(lines.error.hint?.includes("JSON Lines"));

  const nan = parseJson('{"a": NaN}');
  assert(!nan.ok);
  assertEquals(nan.error.message, "NaN is not a JSON value");

  const zeros = parseJson("[012]");
  assert(!zeros.ok);
  assertEquals(zeros.error.message, "Numbers can't have leading zeros");

  const newline = parseJson('["a\nb"]');
  assert(!newline.ok);
  assert(newline.error.message.startsWith("Unterminated string"));

  const empty = parseJson("   ");
  assert(!empty.ok);
  assertEquals(empty.error.message, "The text is empty");
});

Deno.test("locate and excerpt point at the column", () => {
  assertEquals(locate("ab\ncd\nef", 4), { line: 2, column: 2 });
  assertEquals(locate("abc", 0), { line: 1, column: 1 });
  assertEquals(
    excerpt('{\n  "a": 1,\n  "b": 2,\n}', 3, 9, 1),
    ['2 │   "a": 1,', '3 │   "b": 2,', "  │         ^", "4 │ }"].join("\n"),
  );
  // A long minified line is windowed around the column.
  const long = `[${"1,".repeat(200)}x]`;
  const lines = excerpt(long, 1, 402, 0).split("\n");
  assert(lines[0].startsWith("1 │ …"));
  assertEquals(lines[1].indexOf("^") - 4, lines[0].indexOf("x") - 4);
});

Deno.test("types, sizes and children", () => {
  assertEquals([typeOf(null), typeOf([]), typeOf({}), typeOf("a"), typeOf(1), typeOf(false)], [
    "null",
    "array",
    "object",
    "string",
    "number",
    "boolean",
  ]);
  assertEquals(sizeLabel([1, 2, 3]), "3 items");
  assertEquals(sizeLabel({ a: 1 }), "1 key");
  assertEquals(sizeLabel("héllo"), "5 chars");
  assertEquals(sizeLabel(42), "42");
  assertEquals(children({ a: 1, b: [2] }), [{ key: "a", value: 1 }, { key: "b", value: [2] }]);
  assertEquals(children(["x"]), [{ key: 0, value: "x" }]);
  assertEquals(children("x"), []);
  assertEquals(stats(STORE), { values: 31, depth: 4 });
});

Deno.test("paths in jq, JSONPath and JavaScript styles", () => {
  assertEquals(formatPath([]), ".");
  assertEquals(formatPath(["store", "book", 0, "title"]), ".store.book[0].title");
  assertEquals(formatPath([0, "a"]), ".[0].a");
  assertEquals(formatPath(["with space", "content-type"]), '."with space"."content-type"');
  assertEquals(jsonPath(["store", "book", 0]), "$.store.book[0]");
  assertEquals(jsonPath(["it's", "a b"]), "$['it\\'s']['a b']");
  assertEquals(jsPath(["a", 0, "b-c"]), 'data.a[0]["b-c"]');
  assertEquals(breadcrumb([]), "JSON");
  assertEquals(breadcrumb(["store", "book", 2]), "JSON › store › book › [2]");
  assertEquals(breadcrumb(["a", "b", "c", "d", "e", "f"]), "JSON › … › c › d › e › f");
  assertEquals(getAt(STORE, ["store", "book", 1, "author"]), "Evelyn Waugh");
  assertEquals(getAt(STORE, ["store", "nope", 1]), undefined);
  assertEquals(getAt([1, 2], ["0"]), undefined);
});

Deno.test("isQuery and looksLikeJson tell queries from words and JSON", () => {
  assert(isQuery(".a"));
  assert(isQuery("$.a"));
  assert(isQuery("[0]"));
  assert(isQuery("| keys"));
  assert(!isQuery("author"));
  assert(looksLikeJson('  {"a":1}'));
  assert(looksLikeJson("[1]"));
  assert(!looksLikeJson("hello"));
});

Deno.test("query: keys, indexes, quoted names", () => {
  assertEquals(values(".store.bicycle.color"), ["red"]);
  assertEquals(values("$.store.bicycle.color"), ["red"]);
  assertEquals(values("store.bicycle.price"), [19.95]); // JSONPath without the $
  assertEquals(values(".store.book[0].author"), ["Nigel Rees"]);
  assertEquals(values(".store.book[-1].title"), ["The Lord of the Rings"]);
  assertEquals(values('."content-type"'), ["application/json"]);
  assertEquals(values(".content-type"), ["application/json"]);
  assertEquals(values('["with space"].ok'), [true]);
  assertEquals(values("$['with space']['ok']"), [true]);
  assertEquals(values("."), [STORE]);
  assertEquals(values(".nope.deeper"), []);
  assertEquals(paths(".store.book[1]"), [".store.book[1]"]);
});

Deno.test("query: wildcards, slices, unions", () => {
  assertEquals(values(".store.book[*].author"), ["Nigel Rees", "Evelyn Waugh", "Herman Melville", "J. R. R. Tolkien"]);
  assertEquals(values(".store.book[].price"), [8.95, 12.99, 8.99, 22.99]);
  assertEquals(values(".store.bicycle.*"), ["red", 19.95]);
  assertEquals(values(".store.book[1:3].price"), [12.99, 8.99]);
  assertEquals(values(".store.book[:1].price"), [8.95]);
  assertEquals(values(".store.book[-2:].price"), [8.99, 22.99]);
  assertEquals(values(".store.book[0,2].price"), [8.95, 8.99]);
  assertEquals(values('.store.bicycle["color","price"]'), ["red", 19.95]);
  assertEquals(paths(".store.book[1:3]"), [".store.book[1]", ".store.book[2]"]);
});

Deno.test("query: recursive descent", () => {
  assertEquals(values("..author"), ["Nigel Rees", "Evelyn Waugh", "Herman Melville", "J. R. R. Tolkien"]);
  assertEquals(values("$..price"), [8.95, 12.99, 8.99, 22.99, 19.95]);
  assertEquals(paths("..isbn"), [".store.book[2].isbn", ".store.book[3].isbn"]);
  assertEquals(values("..book[2].title"), ["Moby Dick"]);
  assertEquals(values(".store..color"), ["red"]);
  assertEquals(query({ a: { b: 1 } }, "..*").length, 2);
});

Deno.test("query: filters and select", () => {
  assertEquals(values(".store.book[?(@.price < 10)].title"), ["Sayings of the Century", "Moby Dick"]);
  assertEquals(values("$.store.book[?(@.isbn)].title"), ["Moby Dick", "The Lord of the Rings"]);
  assertEquals(values('.store.book[?(@.category == "reference")].author'), ["Nigel Rees"]);
  assertEquals(values(".store.book[?@.price >= 22.99].title"), ["The Lord of the Rings"]);
  assertEquals(values(".store.book[?(@.author =~ /tolkien/i)].price"), [22.99]);
  assertEquals(values(".store.book[] | select(.price > 12) | .author"), ["Evelyn Waugh", "J. R. R. Tolkien"]);
  assertEquals(values('.store.book[] | select(.category != "fiction") | .title'), ["Sayings of the Century"]);
  // Different types never compare as < or >.
  assertEquals(values('.store.book[?(@.price > "1")]'), []);
  assertEquals(values("[?(@ > 1)]", [1, 2, 3]), [2, 3]);
  assertEquals(paths(".store.book[?(@.price < 9)]"), [".store.book[0]", ".store.book[2]"]);
});

Deno.test("query: pipes and functions", () => {
  assertEquals(values(".store | keys"), [["bicycle", "book"]]);
  assertEquals(values(".store.book | length"), [4]);
  assertEquals(values(".store.book[] | .title | length"), [22, 15, 9, 21]);
  assertEquals(values(".store.book[0] | type"), ["object"]);
  assertEquals(values("..price | type"), ["number", "number", "number", "number", "number"]);
  assertEquals(values(".store.book | first | .author"), ["Nigel Rees"]);
  assertEquals(paths(".store.book | last"), [".store.book[3]"]);
  assertEquals(values("sort", [3, 1, "a", null, 2]), [[null, 1, 2, 3, "a"]]);
  assertEquals(values("unique", [2, 1, 2, 1]), [[1, 2]]);
  assertEquals(values("flatten", [[1, 2], 3, [4]]), [[1, 2, 3, 4]]);
  assertEquals(values("reverse", [1, 2, 3]), [[3, 2, 1]]);
  assertEquals(values("| values", { a: 1, b: 2 }), [[1, 2]]);
  assertEquals(query(STORE, ".store | keys")[0].path, null);
});

Deno.test("query: syntax errors say what went wrong", () => {
  assertThrows(() => query(STORE, ".store.book[0"), QueryError, "Expected “]”");
  assertThrows(() => query(STORE, ".store | nope"), QueryError, "Unknown function “nope”");
  assertThrows(() => query(STORE, '.a["x'), QueryError, "Unterminated string");
  assertThrows(() => query(STORE, ".a[?(@.b == )]"), QueryError, "Expected a value");
  assertThrows(() => query(STORE, ".."), /* nothing after .. */ QueryError, "Expected a name");
  assertThrows(() => query(STORE, ".store | sort"), QueryError, "object can't be sorted");
});

Deno.test("previews", () => {
  assertEquals(inlinePreview({ a: 1, b: 2, c: 3, d: 4, e: 5 }), "{ a, b, c, d, … }");
  assertEquals(inlinePreview([1, 2]), "[ 2 items ]");
  assertEquals(inlinePreview([]), "[]");
  assertEquals(inlinePreview("multi\nline"), '"multi\\nline"');
  assertEquals(inlinePreview("x".repeat(100), 10), `"xxxxxxxx…`);
  assertEquals(previewJson({ a: [1, 2], b: {} }), {
    text: '{\n  "a": [\n    1,\n    2\n  ],\n  "b": {}\n}',
    truncated: false,
  });
  assertEquals(previewJson({ a: [1, 2], b: {} }), {
    text: JSON.stringify({ a: [1, 2], b: {} }, null, 2),
    truncated: false,
  });
  const big = previewJson(Array.from({ length: 10000 }, (_, i) => i), 5);
  assertEquals(big, { text: "[\n  0,\n  1,\n  2,\n  3,\n…", truncated: true });
  assertEquals(copyText("raw"), "raw");
  assertEquals(copyText({ a: 1 }), '{\n  "a": 1\n}');
});

Deno.test("insight recognizes dates, URLs and timestamps", () => {
  assertEquals(insight("2026-10-28T12:00:00Z"), "Date: Wed, 28 Oct 2026 12:00:00 GMT");
  assertEquals(insight("2026-10-28"), "Date: Wed, 28 Oct 2026 00:00:00 GMT");
  assertEquals(insight("https://example.com/a"), "URL");
  assertEquals(insight("#ff8800"), "Color");
  assertEquals(insight("6b29fc40-ca47-1067-b31d-00dd010662da"), "UUID");
  assertEquals(insight(1793191076), "Unix time: Wed, 28 Oct 2026 12:37:56 GMT");
  assertEquals(insight(1793191076000), "Unix time (ms): Wed, 28 Oct 2026 12:37:56 GMT");
  assertEquals(insight(42), undefined);
  assertEquals(insight("hello"), undefined);
});

Deno.test("toYaml writes block YAML with quoting where needed", () => {
  assertEquals(
    toYaml({
      name: "backslash",
      version: "1.0",
      count: 3,
      ok: true,
      none: null,
      empty: "",
      word: "yes",
      tags: ["a", "b: c", "#x"],
      nested: { deep: { x: 1 } },
      list: [{ id: 1, v: [1, 2] }, { id: 2 }],
      grid: [[1, 2], [3]],
      blank: [],
      obj: {},
      "key with: colon": 1,
      text: "line 1\nline 2",
      trailing: "end\n",
    }),
    [
      "name: backslash",
      'version: "1.0"',
      "count: 3",
      "ok: true",
      "none: null",
      'empty: ""',
      'word: "yes"',
      "tags:",
      "- a",
      '- "b: c"',
      '- "#x"',
      "nested:",
      "  deep:",
      "    x: 1",
      "list:",
      "- id: 1",
      "  v:",
      "  - 1",
      "  - 2",
      "- id: 2",
      "grid:",
      "- - 1",
      "  - 2",
      "- - 3",
      "blank: []",
      "obj: {}",
      '"key with: colon": 1',
      "text: |-",
      "  line 1",
      "  line 2",
      "trailing: |",
      "  end",
      "",
    ].join("\n"),
  );
  assertEquals(toYaml("plain"), "plain\n");
  assertEquals(toYaml([]), "[]\n");
  assertEquals(toYaml("123"), '"123"\n');
  assertEquals(toYaml({ s: "tab\there" }), 's: "tab\\there"\n');
});

Deno.test("toToml drops nulls and needs a table", () => {
  assertEquals(toToml({ title: "x", owner: { name: "Ada", dob: null }, ports: [80, 443] }), {
    text: 'title = "x"\nports = [80, 443]\n\n[owner]\nname = "Ada"\n',
    droppedNulls: 1,
  });
  assertEquals(
    toToml({
      "a b": 'q"uote',
      mixed: [1, { x: 1 }, [true]],
      servers: { alpha: { ip: "10.0.0.1" }, beta: { ip: "10.0.0.2", tags: [] } },
      products: [{ name: "Hammer" }, { name: "Nail", sizes: { small: 1 } }],
      empty: {},
    }).text,
    [
      '"a b" = "q\\"uote"',
      "mixed = [1, { x = 1 }, [true]]",
      "",
      "[servers.alpha]",
      'ip = "10.0.0.1"',
      "",
      "[servers.beta]",
      'ip = "10.0.0.2"',
      "tags = []",
      "",
      "[[products]]",
      'name = "Hammer"',
      "",
      "[[products]]",
      'name = "Nail"',
      "",
      "[products.sizes]",
      "small = 1",
      "",
      "[empty]",
      "",
    ].join("\n"),
  );
  assertThrows(() => toToml([1, 2]), Error, "TOML needs an object");
  assertThrows(() => toToml("x"), Error, "TOML needs an object");
});

Deno.test("toCsv: arrays of objects, arrays and key/value objects", () => {
  assertEquals(
    toCsv([{ name: "Ada", langs: ["en"], note: 'says "hi", twice' }, { name: "Linus", age: 55 }]),
    'name,langs,note,age\nAda,"[""en""]","says ""hi"", twice",\nLinus,,,55\n',
  );
  assertEquals(toCsv([[1, 2], [3, "a\nb"]]), '1,2\n3,"a\nb"\n');
  assertEquals(toCsv([1, "x", null]), "value\n1\nx\n\n");
  assertEquals(toCsv({ a: 1, b: " pad" }), 'key,value\na,1\nb," pad"\n');
  assertEquals(toCsv([]), "");
  assertThrows(() => toCsv("x"), Error, "CSV needs");
  assert(csvFriendly([{ a: 1 }]));
  assert(csvFriendly({ a: 1 }));
  assert(!csvFriendly({ a: { b: 1 } }));
  assert(!csvFriendly([1, 2]));
});
