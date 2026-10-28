import { assert, assertEquals, assertMatch } from "@std/assert";
import {
  base64Decode,
  base64Encode,
  cases,
  counts,
  decodeJwt,
  entropy,
  formatInteger,
  generatorQuery,
  humanBytes,
  jsonUnescape,
  loremParagraph,
  loremSentence,
  md5,
  parseDate,
  parseInteger,
  parseTimestamp,
  password,
  relative,
  sha,
  SYMBOLS,
  transforms,
  urlDecode,
  uuidTime,
  uuidV7,
  words,
} from "./lib.ts";

const NOW = new Date("2026-10-28T12:00:00Z");

/** A deterministic PRNG (mulberry32) for generators. */
function seeded(seed = 42) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

Deno.test("base64 round trips UTF-8 and refuses binary or plain words", () => {
  assertEquals(base64Encode("héllo wörld ✓"), "aMOpbGxvIHfDtnJsZCDinJM=");
  assertEquals(base64Decode("aMOpbGxvIHfDtnJsZCDinJM="), "héllo wörld ✓");
  assertEquals(base64Decode("aGVsbG8"), "hello"); // no padding
  assertEquals(base64Decode("PDw_Pz4-"), "<<??>>"); // URL-safe alphabet
  assertEquals(base64Decode("/w=="), undefined); // 0xff is not UTF-8
  assertEquals(base64Decode("AAECAwQF"), undefined); // control characters
  assertEquals(base64Decode("hi"), undefined);
  assertEquals(base64Decode("not base64!"), undefined);
});

Deno.test("URL and JSON string escaping", () => {
  assertEquals(urlDecode("a%20b%26c%3Dd"), "a b&c=d");
  assertEquals(urlDecode("q=hello+world"), "q=hello world");
  assertEquals(urlDecode("plain"), undefined);
  assertEquals(urlDecode("%E0%A4%A"), undefined);
  assertEquals(jsonUnescape('"line\\nnext \\"quoted\\""'), 'line\nnext "quoted"');
  assertEquals(jsonUnescape("no quotes"), undefined);
});

Deno.test("md5 and SHA digests match the reference vectors", async () => {
  assertEquals(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assertEquals(md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
  assertEquals(md5("a".repeat(1000)), "cabe45dcc9ae5b66ba86600cca6b8ba8");
  assertEquals(md5("héllo"), "be50e8478cf24ff3595bc7307fb91b50");
  assertEquals(await sha("SHA-1", "abc"), "a9993e364706816aba3e25717850c26c9cd0d89d");
  assertEquals(
    await sha("SHA-256", "abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assertEquals((await sha("SHA-512", "abc")).slice(0, 16), "ddaf35a193617aba");
});

Deno.test("relative times", () => {
  assertEquals(relative(new Date("2026-10-28T11:59:58Z"), NOW), "just now");
  assertEquals(relative(new Date("2026-10-28T09:00:00Z"), NOW), "3 hours ago");
  assertEquals(relative(new Date("2026-10-30T12:00:00Z"), NOW), "in 2 days");
  assertEquals(relative(new Date("2023-11-14T22:13:20Z"), NOW), "2 years ago");
  assertEquals(relative(new Date("2026-10-28T12:01:30Z"), NOW), "in 1 minute");
});

Deno.test("timestamps by number of digits, and dates", () => {
  assertEquals(parseTimestamp("1700000000")?.date.toISOString(), "2023-11-14T22:13:20.000Z");
  assertEquals(parseTimestamp("1700000000")?.unit, "s");
  assertEquals(parseTimestamp("1700000000123")?.date.toISOString(), "2023-11-14T22:13:20.123Z");
  assertEquals(parseTimestamp("1700000000123")?.unit, "ms");
  assertEquals(parseTimestamp("1700000000123456")?.unit, "µs");
  assertEquals(parseTimestamp("1700000000123456789")?.date.toISOString(), "2023-11-14T22:13:20.123Z");
  assertEquals(parseTimestamp("1700000000.5")?.date.getTime(), 1700000000500);
  assertEquals(parseTimestamp("12345"), undefined);
  assertEquals(parseDate("2024-02-29T10:00:00Z")?.getTime(), Date.UTC(2024, 1, 29, 10));
  assertEquals(parseDate("Tue, 14 Nov 2023 22:13:20 GMT")?.getTime(), 1700000000000);
  assertEquals(parseDate("2024"), undefined);
  assertEquals(parseDate("hello world"), undefined);
});

// {"alg":"HS256","typ":"JWT"} . {"sub":"1234567890","name":"John Doe","iat":1516239022,"exp":1893456000}
const JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9." +
  "eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE4OTM0NTYwMDB9." +
  "SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

Deno.test("JWT decoding", () => {
  const jwt = decodeJwt(JWT)!;
  assertEquals(jwt.header, { alg: "HS256", typ: "JWT" });
  assertEquals(jwt.payload.sub, "1234567890");
  assertEquals(jwt.payload.exp, 1893456000);
  assertEquals(decodeJwt(`Bearer ${JWT}`)?.payload.name, "John Doe");
  assertEquals(decodeJwt("a.b.c"), undefined);
  assertEquals(decodeJwt("eyJhbGciOiJIUzI1NiJ9.bm90IGpzb24.x"), undefined);
});

Deno.test("integers in any base", () => {
  assertEquals(parseInteger("255"), { value: 255n, base: 10 });
  assertEquals(parseInteger("0xFF"), { value: 255n, base: 16 });
  assertEquals(parseInteger("deadbeef"), { value: 3735928559n, base: 16 });
  assertEquals(parseInteger("0b1010_1010"), { value: 170n, base: 2 });
  assertEquals(parseInteger("0o755"), { value: 493n, base: 8 });
  assertEquals(parseInteger("-42"), { value: -42n, base: 10 });
  assertEquals(parseInteger("123456789012345678901234567890")?.value, 123456789012345678901234567890n);
  assertEquals(parseInteger("hello"), undefined);
  assertEquals(parseInteger("a"), undefined);
  assertEquals(formatInteger(255n, 16), "0xff");
  assertEquals(formatInteger(-5n, 2), "-0b101");
  assertEquals(humanBytes(1536), "1.5 KiB");
  assertEquals(humanBytes(1048576), "1 MiB");
  assertEquals(humanBytes(512), "512 B");
});

Deno.test("words and case conversions", () => {
  assertEquals(words("getHTTPResponse_code-v2"), ["get", "HTTP", "Response", "code", "v2"]);
  assertEquals(words("  hello   wörld "), ["hello", "wörld"]);
  const convert = (id: string, text: string) => cases.find((c) => c.id === id)!.convert(text);
  assertEquals(convert("camel", "user_profile id"), "userProfileId");
  assertEquals(convert("pascal", "user-profile-id"), "UserProfileId");
  assertEquals(convert("snake", "userProfileID"), "user_profile_id");
  assertEquals(convert("constant", "max retry count"), "MAX_RETRY_COUNT");
  assertEquals(convert("kebab", "XMLHttpRequest"), "xml-http-request");
  assertEquals(convert("title", "the_quick-brownFox"), "The Quick Brown Fox");
  assertEquals(convert("upper", "Straße"), "STRASSE");
});

Deno.test("counts", () => {
  assertEquals(counts("Hello, world! 👋🏽\nSecond line."), {
    characters: 28,
    withoutSpaces: 24,
    words: 4,
    lines: 2,
    bytes: 35,
    sentences: 2,
  });
  assertEquals(counts("").lines, 0);
});

Deno.test("UUID v7 encodes its creation time", () => {
  const id = uuidV7(1700000000123, new Uint8Array(10).fill(0xff));
  assertEquals(id, "018bcfe5-687b-7fff-bfff-ffffffffffff");
  assertMatch(uuidV7(), /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assertEquals(uuidTime(id)?.getTime(), 1700000000123);
  assertEquals(uuidTime(crypto.randomUUID()), undefined);
});

Deno.test("passwords use every character class", () => {
  const rand = seeded(7);
  const int = (n: number) => Math.floor(rand() * n);
  for (const length of [8, 16, 64]) {
    const p = password(length, true, int);
    assertEquals(p.length, length);
    assert(/[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), p);
    assert([...p].some((c) => SYMBOLS.includes(c)), p);
  }
  assert(/^[A-Za-z0-9]{24}$/.test(password(24, false)));
  assertEquals(entropy(20, true), 129);
  assertEquals(entropy(20, false), 119);
});

Deno.test("lorem ipsum", () => {
  const rand = seeded(1);
  const s = loremSentence(rand);
  assertMatch(s, /^[A-Z][a-z, ]+\.$/);
  assert(loremParagraph(rand).startsWith("Lorem ipsum dolor sit amet, consectetur adipiscing elit. "));
  assert(!loremParagraph(rand, false).startsWith("Lorem ipsum dolor sit amet, consectetur"));
});

Deno.test("generator queries", () => {
  assertEquals(generatorQuery("password 32"), { kind: "password", n: 32 });
  assertEquals(generatorQuery("UUID"), { kind: "uuid", n: undefined });
  assertEquals(generatorQuery("mot de passe"), { kind: "password", n: undefined });
  assertEquals(generatorQuery("lorem 3"), { kind: "lorem", n: 3 });
  assertEquals(generatorQuery("now")?.kind, "now");
  assertEquals(generatorQuery("hello"), undefined);
});

const ids = async (input: string) => (await transforms(input, NOW)).map((r) => r.id);

Deno.test("transforms: a timestamp", async () => {
  const results = await transforms("1700000000", NOW);
  const iso = results.find((r) => r.id === "iso");
  assertEquals(iso?.value, "2023-11-14T22:13:20.000Z");
  assertEquals(iso?.label, "ISO 8601 (UTC) · Unix seconds");
  assertEquals(results.find((r) => r.id === "relative")?.value, "2 years ago");
  assertEquals(results.find((r) => r.id === "unix-ms")?.value, "1700000000000");
  // It is a number too.
  assertEquals(results.find((r) => r.id === "base-16")?.value, "0x6553f100");
  // Date sections come first.
  assertEquals(results[0].section, "Date & Time");
});

Deno.test("transforms: a date string", async () => {
  const results = await transforms("2024-01-01T00:00:00Z", NOW);
  assertEquals(results.find((r) => r.id === "unix-s")?.value, "1704067200");
  assertEquals(results.find((r) => r.id === "unix-ms")?.value, "1704067200000");
});

Deno.test("transforms: a JWT", async () => {
  const [jwt] = await transforms(JWT, NOW);
  assertEquals(jwt.id, "jwt");
  assertEquals(jwt.title, "JWT · HS256 · 1234567890");
  assertEquals(jwt.subtitle, "Expires in 3 years");
  assertEquals(jwt.tags, [{ tag: "Valid", color: "green" }]);
  assert(jwt.markdown?.includes('"name": "John Doe"'));
  const labels = jwt.metadata!.map((m) => m.label);
  assert(labels.includes("Expires") && labels.includes("Issued") && labels.includes("Subject"));
  const expired = await transforms(JWT, new Date("2031-01-01T00:00:00Z"));
  assertEquals(expired[0].tags, [{ tag: "Expired", color: "red" }]);
  assertEquals(expired[0].tint, "red");
  // Its parts are not offered as base64 or case conversions.
  assert(!(await ids(JWT)).some((id) => id === "b64-decode" || id.startsWith("case-")));
});

Deno.test("transforms: JSON", async () => {
  const results = await transforms('{"name":"backslash","tags":["a","b"],"nested":{"ok":true}}', NOW);
  const pretty = results.find((r) => r.id === "json-pretty")!;
  assert(pretty.value.startsWith('{\n  "name": "backslash"'));
  assertEquals(pretty.stats, [{ label: "keys", value: 3 }, { label: "values", value: 6 }, {
    label: "depth",
    value: 2,
  }]);
  assertEquals(
    results.find((r) => r.id === "json-min")?.value,
    '{"name":"backslash","tags":["a","b"],"nested":{"ok":true}}',
  );
  assert(!(await ids("{not json")).includes("json-pretty"));
});

Deno.test("transforms: numbers", async () => {
  const results = await transforms("0x41", NOW);
  assertEquals(results.find((r) => r.id === "base-10")?.value, "65");
  assertEquals(results.find((r) => r.id === "base-2")?.value, "0b1000001");
  assertEquals(results.find((r) => r.id === "base-8")?.value, "0o101");
  assertEquals(results.find((r) => r.id === "char")?.value, "A");
  assert(!results.some((r) => r.id === "base-16"));
  assertEquals((await transforms("1048576", NOW)).find((r) => r.id === "bytes")?.value, "1 MiB");
});

Deno.test("transforms: encodings, hashes, case and counts", async () => {
  const results = await transforms("hello world", NOW);
  const value = (id: string) => results.find((r) => r.id === id)?.value;
  assertEquals(value("b64-encode"), "aGVsbG8gd29ybGQ=");
  assertEquals(value("url-encode"), "hello%20world");
  assertEquals(value("hash-MD5"), "5eb63bbbe01eeed093cb22bb8f5acdc3");
  assertEquals(value("hash-SHA-256"), "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  assertEquals(value("case-camel"), "helloWorld");
  assertEquals(value("case-snake"), "hello_world");
  assertEquals(value("case-title"), "Hello World");
  assertEquals(value("case-upper"), "HELLO WORLD");
  assert(!results.some((r) => r.id === "case-lower")); // same as the input
  assertEquals(results.find((r) => r.id === "counts")?.title, "11 characters · 2 words · 1 line");
  assertEquals(value("b64-decode"), undefined);
  // Decoding a base64 value and a URL-encoded one.
  assertEquals((await transforms("aGVsbG8gd29ybGQ=", NOW)).find((r) => r.id === "b64-decode")?.value, "hello world");
  assertEquals((await transforms("a%2Fb%3Fc", NOW)).find((r) => r.id === "url-decode")?.value, "a/b?c");
  // Sections come in a stable order: specific first, counts last.
  const sections = [...new Set(results.map((r) => r.section))];
  assertEquals(sections, ["Encode", "Hashes", "Case", "Text"]);
  assertEquals(await transforms("   ", NOW), []);
});
