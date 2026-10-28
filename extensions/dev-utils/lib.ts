// Transformations and generators of Dev Utils. Pure, tested in lib_test.ts.

import { type Color, Icons, meta, type Metadata, type Stat } from "@backslash/api";

// ---------------------------------------------------------------------------
// Encodings

const utf8 = new TextEncoder();

export function base64Encode(text: string): string {
  let binary = "";
  for (const b of utf8.encode(text)) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** Standard or URL-safe base64, padding optional. Only text that decodes to readable UTF-8. */
export function base64Decode(input: string): string | undefined {
  const s = input.trim();
  if (s.length < 4 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) return undefined;
  const normalized = s.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  if (normalized.length % 4 === 1) return undefined;
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    return undefined;
  }
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  // Binary that happens to be valid UTF-8 is mostly control characters.
  const printable = [...text].filter((c) => !/[\p{Cc}\p{Cs}�]/u.test(c) || c === "\n" || c === "\t" || c === "\r");
  return text && printable.length / [...text].length > 0.95 ? text : undefined;
}

export const urlEncode = (text: string): string => encodeURIComponent(text);

export function urlDecode(text: string): string | undefined {
  if (!/%[0-9A-Fa-f]{2}|\+/.test(text)) return undefined;
  try {
    const decoded = decodeURIComponent(text.replace(/\+/g, " "));
    return decoded === text ? undefined : decoded;
  } catch {
    return undefined;
  }
}

/** `"a\nb"` → `"\"a\\nb\""`, to embed text in JSON or a JS string. */
export const jsonEscape = (text: string): string => JSON.stringify(text);

/** A JSON string literal back to its text. */
export function jsonUnescape(text: string): string | undefined {
  const s = text.trim();
  if (!/^"[\s\S]*"$/.test(s)) return undefined;
  try {
    const value = JSON.parse(s);
    return typeof value === "string" ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Hashes

const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

const S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

/** MD5 (RFC 1321): Web Crypto does not offer it, and it is still everywhere in checksums. */
export function md5(text: string | Uint8Array): string {
  const bytes = typeof text === "string" ? utf8.encode(text) : text;
  const blocks = ((bytes.length + 8) >>> 6) + 1;
  const words = new Uint32Array(blocks * 16);
  for (let i = 0; i < bytes.length; i++) words[i >> 2] |= bytes[i] << ((i % 4) * 8);
  words[bytes.length >> 2] |= 0x80 << ((bytes.length % 4) * 8);
  const bits = bytes.length * 8;
  words[blocks * 16 - 2] = bits >>> 0;
  words[blocks * 16 - 1] = Math.floor(bits / 2 ** 32);
  let [a0, b0, c0, d0] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
  for (let blk = 0; blk < blocks; blk++) {
    let [a, b, c, d] = [a0, b0, c0, d0];
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      f = (f + a + K[i] + words[blk * 16 + g]) >>> 0;
      a = d;
      d = c;
      c = b;
      const s = S[(i >> 4) * 4 + (i % 4)];
      b = (b + ((f << s) | (f >>> (32 - s)))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new Uint8Array(16);
  new DataView(out.buffer).setUint32(0, a0, true);
  new DataView(out.buffer).setUint32(4, b0, true);
  new DataView(out.buffer).setUint32(8, c0, true);
  new DataView(out.buffer).setUint32(12, d0, true);
  return hex(out);
}

export async function sha(algorithm: "SHA-1" | "SHA-256" | "SHA-512", text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest(algorithm, utf8.encode(text))));
}

// ---------------------------------------------------------------------------
// Time

const UNITS: [string, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "3 days ago", "in 2 hours", "just now". */
export function relative(date: Date, now: Date): string {
  const diff = (date.getTime() - now.getTime()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 5) return "just now";
  const [unit, seconds] = UNITS.find(([, s]) => abs >= s) ?? UNITS[UNITS.length - 1];
  const n = Math.floor(abs / seconds);
  const text = `${n} ${unit}${n > 1 ? "s" : ""}`;
  return diff < 0 ? `${text} ago` : `in ${text}`;
}

export type TimestampUnit = "s" | "ms" | "µs" | "ns";

/** `1700000000` (s), `1700000000000` (ms), µs and ns, by number of digits. */
export function parseTimestamp(input: string): { date: Date; unit: TimestampUnit } | undefined {
  const s = input.trim();
  const m = s.match(/^(\d{9,19})(?:\.(\d+))?$/);
  if (!m) return undefined;
  const digits = m[1].length;
  let unit: TimestampUnit;
  let ms: number;
  if (digits <= 11) [unit, ms] = ["s", Number(s) * 1000];
  else if (digits <= 14 && !m[2]) [unit, ms] = ["ms", Number(m[1])];
  else if (digits <= 17 && !m[2]) [unit, ms] = ["µs", Number(m[1]) / 1000];
  else if (!m[2]) [unit, ms] = ["ns", Number(BigInt(m[1]) / 1000000n)];
  else return undefined;
  const date = new Date(ms);
  return isNaN(date.getTime()) ? undefined : { date, unit };
}

/** ISO 8601, RFC 2822 and friends; not bare numbers (see {@link parseTimestamp}). */
export function parseDate(input: string): Date | undefined {
  const s = input.trim();
  if (s.length > 64 || !/\d{4}/.test(s) || !/[-/:,]|\s/.test(s) || /^\d+$/.test(s)) return undefined;
  const ms = Date.parse(s);
  return isNaN(ms) ? undefined : new Date(ms);
}

// ---------------------------------------------------------------------------
// JWT

export interface Jwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
}

export function decodeJwt(token: string): Jwt | undefined {
  const parts = token.trim().replace(/^Bearer\s+/i, "").split(".");
  if (parts.length !== 3 || !parts[0].startsWith("eyJ")) return undefined;
  try {
    const header = JSON.parse(base64Decode(parts[0]) ?? "");
    const payload = JSON.parse(base64Decode(parts[1]) ?? "");
    if (typeof header !== "object" || typeof payload !== "object" || !header || !payload) return undefined;
    return { header, payload, signature: parts[2] };
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Numbers

export type Base = 2 | 8 | 10 | 16;

/** `0x1f`, `0b101`, `0o17`, `-42`, or bare hex with letters (`ff`, `deadbeef`). */
export function parseInteger(input: string): { value: bigint; base: Base } | undefined {
  const s = input.trim().replace(/_/g, "");
  const m = s.match(/^(-?)(0x[0-9a-f]+|0b[01]+|0o[0-7]+|\d{1,30}|[0-9a-f]*[a-f][0-9a-f]*)$/i);
  if (!m || s.length > 40) return undefined;
  const body = m[2];
  const prefix = body.slice(0, 2).toLowerCase();
  let base: Base = 10;
  if (prefix === "0x") base = 16;
  else if (prefix === "0b") base = 2;
  else if (prefix === "0o") base = 8;
  else if (/[a-f]/i.test(body)) {
    if (body.length < 2 || body.length > 16) return undefined;
    base = 16;
  }
  const digits = base === 10 || !/^0[xbo]/i.test(body) ? body : body.slice(2);
  const literal = base === 10 ? digits : `0${({ 2: "b", 8: "o", 16: "x" } as const)[base]}${digits}`;
  const value = BigInt(literal);
  return { value: m[1] ? -value : value, base };
}

export function formatInteger(value: bigint, base: Base): string {
  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const prefix = { 2: "0b", 8: "0o", 10: "", 16: "0x" }[base];
  return `${sign}${prefix}${abs.toString(base)}`;
}

/** 1536 → "1.5 KiB". */
export function humanBytes(n: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB", "PiB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i ? n.toFixed(n < 10 ? 2 : 1).replace(/\.?0+$/, "") : n} ${units[i]}`;
}

// ---------------------------------------------------------------------------
// Case

/** `getHTTPResponse_code-v2` → `["get", "HTTP", "Response", "code", "v2"]`. */
export function words(text: string): string[] {
  return text
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, "$1 $2")
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, "$1 $2")
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export const cases: { id: string; name: string; convert: (text: string) => string }[] = [
  { id: "camel", name: "camelCase", convert: (t) => words(t).map((w, i) => i ? cap(w) : w.toLowerCase()).join("") },
  { id: "pascal", name: "PascalCase", convert: (t) => words(t).map(cap).join("") },
  { id: "snake", name: "snake_case", convert: (t) => words(t).map((w) => w.toLowerCase()).join("_") },
  { id: "constant", name: "CONSTANT_CASE", convert: (t) => words(t).map((w) => w.toUpperCase()).join("_") },
  { id: "kebab", name: "kebab-case", convert: (t) => words(t).map((w) => w.toLowerCase()).join("-") },
  { id: "title", name: "Title Case", convert: (t) => words(t).map(cap).join(" ") },
  { id: "upper", name: "UPPERCASE", convert: (t) => t.toUpperCase() },
  { id: "lower", name: "lowercase", convert: (t) => t.toLowerCase() },
];

// ---------------------------------------------------------------------------
// Counts

export interface Counts {
  characters: number;
  withoutSpaces: number;
  words: number;
  lines: number;
  bytes: number;
  sentences: number;
}

export function counts(text: string): Counts {
  const graphemes = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(text)];
  return {
    characters: graphemes.length,
    withoutSpaces: graphemes.filter((g) => !/^\s+$/.test(g.segment)).length,
    words: text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length,
    lines: text ? text.split(/\r\n|\r|\n/).length : 0,
    bytes: utf8.encode(text).length,
    sentences: (text.match(/[^.!?]*[\p{L}\p{N}][^.!?]*[.!?]+/gu) ?? []).length || (text.trim() ? 1 : 0),
  };
}

const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------------------
// Generators

/** A uniform integer in [0, n) from the system's CSPRNG. */
export function randomInt(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const buf = new Uint32Array(1);
  do crypto.getRandomValues(buf); while (buf[0] >= limit);
  return buf[0] % n;
}

const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

const formatUuid = (b: Uint8Array) => {
  const h = hex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const uuidV4 = (): string => crypto.randomUUID();

/** RFC 9562 UUID v7: 48-bit Unix ms timestamp, then random bits; sorts by creation time. */
export function uuidV7(now = Date.now(), random: Uint8Array = randomBytes(10)): string {
  const b = new Uint8Array(16);
  let ms = BigInt(now);
  for (let i = 5; i >= 0; i--) {
    b[i] = Number(ms & 0xffn);
    ms >>= 8n;
  }
  b.set(random.slice(0, 10), 6);
  b[6] = 0x70 | (b[6] & 0x0f);
  b[8] = 0x80 | (b[8] & 0x3f);
  return formatUuid(b);
}

/** The creation time inside a UUID v7, or undefined for other versions. */
export function uuidTime(uuid: string): Date | undefined {
  const m = uuid.trim().match(/^([0-9a-f]{8})-([0-9a-f]{4})-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  return m ? new Date(parseInt(m[1] + m[2], 16)) : undefined;
}

export const LOWER = "abcdefghijklmnopqrstuvwxyz";
export const UPPER = LOWER.toUpperCase();
export const DIGITS = "0123456789";
export const SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/~";

/** At least one character of each class, from the CSPRNG by default. */
export function password(length: number, symbols: boolean, rand: (n: number) => number = randomInt): string {
  const classes = [LOWER, UPPER, DIGITS, ...(symbols ? [SYMBOLS] : [])];
  const all = classes.join("");
  for (;;) {
    let out = "";
    for (let i = 0; i < length; i++) out += all[rand(all.length)];
    if (length < classes.length || classes.every((c) => [...out].some((ch) => c.includes(ch)))) return out;
  }
}

/** Bits of entropy of a random password. */
export const entropy = (length: number, symbols: boolean) =>
  Math.round(length * Math.log2(LOWER.length * 2 + DIGITS.length + (symbols ? SYMBOLS.length : 0)));

export function strength(bits: number): { text: string; color: Color } {
  if (bits < 50) return { text: "Weak", color: "red" };
  if (bits < 80) return { text: "Fair", color: "orange" };
  if (bits < 120) return { text: "Strong", color: "green" };
  return { text: "Very strong", color: "teal" };
}

const LOREM = (
  "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore " +
  "magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo " +
  "consequat duis aute irure in reprehenderit voluptate velit esse cillum fugiat nulla pariatur excepteur sint " +
  "occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum pellentesque " +
  "habitant morbi tristique senectus netus malesuada fames turpis egestas vestibulum mauris"
).split(" ");

export function loremSentence(rand: () => number = Math.random): string {
  const n = 8 + Math.floor(rand() * 8);
  const ws = Array.from({ length: n }, () => LOREM[Math.floor(rand() * LOREM.length)]);
  if (n > 9) ws[Math.floor(n / 2)] += ",";
  const s = ws.join(" ");
  return `${s.charAt(0).toUpperCase()}${s.slice(1)}.`;
}

/** The first paragraph starts with the classic "Lorem ipsum dolor sit amet…". */
export function loremParagraph(rand: () => number = Math.random, first = true): string {
  const n = 4 + Math.floor(rand() * 4);
  const sentences = Array.from({ length: n }, () => loremSentence(rand));
  if (first) sentences[0] = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
  return sentences.join(" ");
}

export const loremParagraphs = (count: number, rand: () => number = Math.random) =>
  Array.from({ length: count }, (_, i) => loremParagraph(rand, i === 0)).join("\n\n");

// ---------------------------------------------------------------------------
// Everything that applies to an input

export interface Result {
  id: string;
  /** What the transformation is called: "Base64 Encode". */
  label: string;
  /** The output, copied and pasted as is. */
  value: string;
  section: string;
  icon: string;
  tint: Color;
  /** A short title instead of the value (counts, JWT). */
  title?: string;
  /** Replaces the subtitle (the label by default). */
  subtitle?: string;
  tags?: { tag: string; color?: Color }[];
  stats?: Stat[];
  metadata?: Metadata[];
  /** Replaces the output code block in the side panel. */
  markdown?: string;
  /** Other values worth copying: "Copy Payload". */
  extra?: { title: string; value: string }[];
}

const SECTION = {
  detected: "Detected",
  date: "Date & Time",
  number: "Number Bases",
  json: "JSON",
  decode: "Decode",
  encode: "Encode",
  hash: "Hashes",
  case: "Case",
  text: "Text",
};

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

function jsonShape(v: unknown, depth = 1): { depth: number; values: number } {
  if (v && typeof v === "object") {
    const children = Object.values(v as Record<string, unknown>).map((c) => jsonShape(c, depth + 1));
    return {
      depth: Math.max(depth, ...children.map((c) => c.depth)),
      values: children.reduce((n, c) => n + c.values, 0) + children.length,
    };
  }
  return { depth: depth - 1, values: 0 };
}

const fmtDate = (d: Date) => d.toISOString().replace("T", " ").replace(/\.000Z$/, "Z").replace(/\.\d+Z$/, "Z");

function timeMeta(name: string, value: unknown, now: Date, future = false): Metadata[] {
  if (typeof value !== "number") return [];
  const d = new Date(value * 1000);
  const past = d < now;
  return [
    meta.text(name, `${fmtDate(d)} (${relative(d, now)})`, {
      icon: Icons.clock,
      color: future ? (past ? "red" : "green") : undefined,
    }),
  ];
}

function jwtResults(jwt: Jwt, now: Date): Result[] {
  const { header, payload } = jwt;
  const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000) : undefined;
  const expired = exp ? exp < now : false;
  const str = (v: unknown) => Array.isArray(v) ? v.join(", ") : String(v);
  const claims = ["iss", "sub", "aud", "jti", "iat", "nbf", "exp"];
  const custom = Object.keys(payload).filter((k) => !claims.includes(k));
  return [{
    id: "jwt",
    label: "JWT",
    title: `JWT · ${header.alg ?? "?"}${payload.sub ? ` · ${str(payload.sub)}` : ""}`,
    subtitle: exp ? (expired ? `Expired ${relative(exp, now)}` : `Expires ${relative(exp, now)}`) : "No expiry",
    value: pretty(payload),
    section: SECTION.detected,
    icon: Icons.key,
    tint: expired ? "red" : "purple",
    tags: exp ? [{ tag: expired ? "Expired" : "Valid", color: expired ? "red" : "green" }] : [],
    markdown: [
      "## Header",
      "```json",
      pretty(header),
      "```",
      "## Payload",
      "```json",
      pretty(payload),
      "```",
      "## Signature",
      "```",
      jwt.signature || "(unsigned)",
      "```",
    ].join("\n"),
    metadata: [
      meta.text("Algorithm", String(header.alg ?? "none"), { icon: Icons.lock }),
      ...(header.typ ? [meta.text("Type", String(header.typ))] : []),
      ...(header.kid ? [meta.text("Key ID", String(header.kid), { icon: Icons.key })] : []),
      meta.separator(),
      ...(payload.iss ? [meta.text("Issuer", str(payload.iss), { icon: Icons.globe })] : []),
      ...(payload.sub ? [meta.text("Subject", str(payload.sub), { icon: Icons.person })] : []),
      ...(payload.aud ? [meta.text("Audience", str(payload.aud))] : []),
      ...timeMeta("Issued", payload.iat, now),
      ...timeMeta("Not before", payload.nbf, now),
      ...timeMeta("Expires", payload.exp, now, true),
      ...(custom.length ? [meta.tags("Claims", custom.slice(0, 12))] : []),
    ],
    extra: [
      { title: "Copy Payload", value: pretty(payload) },
      { title: "Copy Header", value: pretty(header) },
    ],
  }];
}

function dateResults(date: Date, now: Date, source: string): Result[] {
  const ms = date.getTime();
  const out: Result[] = [];
  const add = (id: string, label: string, value: string, icon: string = Icons.calendar) =>
    out.push({ id, label: `${label} · ${source}`, value, section: SECTION.date, icon, tint: "blue" });
  if (source !== "Unix seconds") add("unix-s", "Unix seconds", String(Math.floor(ms / 1000)), Icons.hash);
  if (source !== "Unix milliseconds") add("unix-ms", "Unix milliseconds", String(ms), Icons.hash);
  add("iso", "ISO 8601 (UTC)", date.toISOString());
  add(
    "local",
    "Local time",
    date.toLocaleString("en-GB", { dateStyle: "full", timeStyle: "long" }),
  );
  add("rfc2822", "RFC 2822", date.toUTCString());
  add("relative", "Relative", relative(date, now), Icons.clock);
  return out;
}

/** Every transformation that makes sense for `input`, the most specific first. */
export async function transforms(input: string, now = new Date()): Promise<Result[]> {
  const text = input;
  const trimmed = input.trim();
  if (!trimmed) return [];
  const out: Result[] = [];
  const singleLine = !/\n/.test(trimmed);

  // What the input is.
  const jwt = decodeJwt(trimmed);
  if (jwt) out.push(...jwtResults(jwt, now));

  const ts = parseTimestamp(trimmed);
  const unitName = { s: "Unix seconds", ms: "Unix milliseconds", "µs": "Unix microseconds", ns: "Unix nanoseconds" };
  if (ts) out.push(...dateResults(ts.date, now, unitName[ts.unit]));
  const date = ts ? undefined : parseDate(trimmed);
  if (date) out.push(...dateResults(date, now, "date"));
  const v7 = uuidTime(trimmed);
  if (v7) out.push(...dateResults(v7, now, "UUID v7 time"));

  if (/^[[{]/.test(trimmed)) {
    try {
      const value = JSON.parse(trimmed);
      const shape = jsonShape(value);
      const stats: Stat[] = [
        {
          label: Array.isArray(value) ? "items" : "keys",
          value: Array.isArray(value) ? value.length : Object.keys(value).length,
        },
        { label: "values", value: shape.values },
        { label: "depth", value: shape.depth },
      ];
      const minified = JSON.stringify(value);
      out.push(
        {
          id: "json-pretty",
          label: "Pretty JSON",
          value: pretty(value),
          section: SECTION.json,
          icon: Icons.braces,
          tint: "yellow",
          stats,
        },
        {
          id: "json-min",
          label: "Minified JSON",
          value: minified,
          section: SECTION.json,
          icon: Icons.braces,
          tint: "yellow",
          stats,
        },
        {
          id: "json-string",
          label: "As a JSON string",
          value: JSON.stringify(minified),
          section: SECTION.json,
          icon: Icons.braces,
          tint: "yellow",
        },
      );
    } catch { /* not JSON */ }
  }

  const int = parseInteger(trimmed);
  if (int) {
    const names = { 2: "Binary", 8: "Octal", 10: "Decimal", 16: "Hexadecimal" };
    for (const base of [10, 16, 2, 8] as Base[]) {
      if (base === int.base) continue;
      out.push({
        id: `base-${base}`,
        label: `${names[base]} · from ${names[int.base].toLowerCase()}`,
        value: formatInteger(int.value, base),
        section: SECTION.number,
        icon: Icons.hash,
        tint: "teal",
      });
    }
    const n = Number(int.value);
    if (n >= 1024 && Number.isSafeInteger(n)) {
      out.push({
        id: "bytes",
        label: "As a size in bytes",
        value: humanBytes(n),
        section: SECTION.number,
        icon: Icons.drive,
        tint: "teal",
      });
    }
    if (n >= 32 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) && n !== 127) {
      const cp = `U+${n.toString(16).toUpperCase().padStart(4, "0")}`;
      out.push({
        id: "char",
        label: `Unicode character ${cp}`,
        value: String.fromCodePoint(n),
        section: SECTION.number,
        icon: Icons.text,
        tint: "teal",
      });
    }
  }

  // Decoding.
  const unescaped = jsonUnescape(trimmed);
  if (unescaped !== undefined) {
    out.push({
      id: "json-unescape",
      label: "JSON String Unescape",
      value: unescaped,
      section: SECTION.decode,
      icon: Icons.braces,
      tint: "green",
    });
  }
  const b64 = jwt ? undefined : base64Decode(trimmed);
  if (b64 !== undefined && b64 !== trimmed) {
    out.push({
      id: "b64-decode",
      label: "Base64 Decode",
      value: b64,
      section: SECTION.decode,
      icon: Icons.code,
      tint: "green",
    });
  }
  const url = urlDecode(trimmed);
  if (url !== undefined) {
    out.push({
      id: "url-decode",
      label: "URL Decode",
      value: url,
      section: SECTION.decode,
      icon: Icons.link,
      tint: "green",
    });
  }

  // Encoding.
  out.push({
    id: "b64-encode",
    label: "Base64 Encode",
    value: base64Encode(text),
    section: SECTION.encode,
    icon: Icons.code,
    tint: "orange",
  });
  const b64url = base64Encode(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  if (b64url !== base64Encode(text)) {
    out.push({
      id: "b64url-encode",
      label: "Base64URL Encode",
      value: b64url,
      section: SECTION.encode,
      icon: Icons.code,
      tint: "orange",
    });
  }
  const encoded = urlEncode(text);
  if (encoded !== text) {
    out.push({
      id: "url-encode",
      label: "URL Encode",
      value: encoded,
      section: SECTION.encode,
      icon: Icons.link,
      tint: "orange",
    });
  }
  if (unescaped === undefined && /["\\\n\t]/.test(text)) {
    out.push({
      id: "json-escape",
      label: "JSON String Escape",
      value: jsonEscape(text),
      section: SECTION.encode,
      icon: Icons.braces,
      tint: "orange",
    });
  }

  // Hashes.
  const hashes: [string, string][] = [
    ["MD5", md5(text)],
    ["SHA-1", await sha("SHA-1", text)],
    ["SHA-256", await sha("SHA-256", text)],
    ["SHA-512", await sha("SHA-512", text)],
  ];
  for (const [name, value] of hashes) {
    out.push({
      id: `hash-${name}`,
      label: name,
      value,
      section: SECTION.hash,
      icon: Icons.hash,
      tint: "purple",
      metadata: [meta.text("Algorithm", name, { icon: Icons.shield }), meta.text("Bits", value.length * 4)],
      extra: [{ title: "Copy Uppercase", value: value.toUpperCase() }],
    });
  }

  // Case.
  if (singleLine && trimmed.length <= 200 && /\p{L}/u.test(trimmed) && !jwt) {
    const seen = new Set([trimmed]);
    for (const c of cases) {
      const value = c.convert(trimmed);
      if (!value || seen.has(value)) continue;
      seen.add(value);
      out.push({ id: `case-${c.id}`, label: c.name, value, section: SECTION.case, icon: Icons.text, tint: "pink" });
    }
  }

  // Counts.
  const c = counts(text);
  const summary = `${plural(c.characters, "character")} · ${plural(c.words, "word")} · ${plural(c.lines, "line")}`;
  out.push({
    id: "counts",
    label: "Counts",
    title: summary,
    subtitle: `${plural(c.bytes, "byte")} in UTF-8`,
    value: summary,
    section: SECTION.text,
    icon: Icons.calculator,
    tint: "gray",
    stats: [
      { label: "characters", value: c.characters },
      { label: "words", value: c.words },
      { label: "lines", value: c.lines },
    ],
    markdown: "",
    metadata: [
      meta.text("Characters", c.characters.toLocaleString("en")),
      meta.text("Without spaces", c.withoutSpaces.toLocaleString("en")),
      meta.text("Words", c.words.toLocaleString("en")),
      meta.text("Sentences", c.sentences.toLocaleString("en")),
      meta.text("Lines", c.lines.toLocaleString("en")),
      meta.text("Bytes (UTF-8)", `${c.bytes.toLocaleString("en")} (${humanBytes(c.bytes)})`),
      meta.text("Reading time", `${Math.max(1, Math.round(c.words / 230))} min`, { icon: Icons.clock }),
    ],
    extra: [
      { title: "Copy Character Count", value: String(c.characters) },
      { title: "Copy Word Count", value: String(c.words) },
    ],
  });
  return out;
}

/** "password 32" → which generator the query asks for, and an optional number. */
export function generatorQuery(query: string): { kind: "uuid" | "password" | "lorem" | "now"; n?: number } | undefined {
  const m = query.trim().toLowerCase().match(/^([a-z][a-z ]*?)\s*(\d{1,3})?$/);
  if (!m) return undefined;
  const word = m[1].trim();
  const n = m[2] ? Number(m[2]) : undefined;
  if (/^(uuid|guid|uid)$/.test(word)) return { kind: "uuid", n };
  if (/^(password|passwd|pwd|pass|mot de passe|mdp)$/.test(word)) return { kind: "password", n };
  if (/^(lorem|lorem ipsum|ipsum|lipsum)$/.test(word)) return { kind: "lorem", n };
  if (/^(now|timestamp|time|date|maintenant)$/.test(word)) return { kind: "now" };
  return undefined;
}
