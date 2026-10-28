// JSON Explorer: validation with line/column, paths, a small jq/JSONPath-like query language and
// converters to YAML, TOML and CSV. Pure, tested in lib_test.ts.

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Key = string | number;
export type Path = Key[];
export type JsonType = "object" | "array" | "string" | "number" | "boolean" | "null";

// ---------------------------------------------------------------------------
// Validation

export interface ParseError {
  message: string;
  /** 0-based offset in the text. */
  offset: number;
  /** 1-based. */
  line: number;
  /** 1-based, in characters. */
  column: number;
  /** What probably went wrong, when we can tell. */
  hint?: string;
}

export type Parsed = { ok: true; value: Json } | { ok: false; error: ParseError };

/** 1-based line and column of an offset. */
export function locate(text: string, offset: number): { line: number; column: number } {
  const before = text.slice(0, Math.max(0, Math.min(offset, text.length)));
  const lines = before.split("\n");
  return { line: lines.length, column: lines[lines.length - 1].length + 1 };
}

class Failure extends Error {
  constructor(message: string, public offset: number, public hint?: string) {
    super(message);
  }
}

/** A strict JSON parser that says where and why it fails. Used to explain what JSON.parse rejects. */
function strictParse(text: string): Json {
  let i = 0;
  const ws = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else if (c === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
        throw new Failure("Comments are not allowed in JSON", i, "Remove the comment (this looks like JSONC or JSON5)");
      } else break;
    }
  };
  const describe = (c: string | undefined) => c === undefined ? "end of input" : `“${c}”`;
  const value = (): Json => {
    ws();
    const c = text[i];
    if (c === "{") return object();
    if (c === "[") return array();
    if (c === '"') return string();
    if (c === "'") throw new Failure("Strings must use double quotes", i, 'Replace the single quotes with "');
    if (c === "-" || (c >= "0" && c <= "9")) return number();
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    for (const word of ["undefined", "NaN", "Infinity"]) {
      if (text.startsWith(word, i)) throw new Failure(`${word} is not a JSON value`, i, "Use null instead");
    }
    if (c === undefined) throw new Failure("Unexpected end of input: a value is missing", i);
    throw new Failure(`Unexpected ${describe(c)}: expected a value`, i);
  };
  const object = (): Json => {
    const out: Record<string, Json> = {};
    let comma = -1;
    i++;
    ws();
    if (text[i] === "}") {
      i++;
      return out;
    }
    while (true) {
      ws();
      if (text[i] === "}") throw new Failure("Trailing comma before }", comma, "Remove the last comma");
      if (text[i] !== '"') {
        if (text[i] === "'") throw new Failure("Property names must use double quotes", i);
        if (text[i] === undefined) throw new Failure("Unexpected end of input: the object is not closed", i);
        throw new Failure(
          `Unexpected ${describe(text[i])}: expected a property name in double quotes`,
          i,
          /[A-Za-z_$]/.test(text[i]) ? "Quote the property name" : undefined,
        );
      }
      const key = string();
      ws();
      if (text[i] !== ":") throw new Failure(`Unexpected ${describe(text[i])}: expected “:” after the name`, i);
      i++;
      out[key] = value();
      ws();
      if (text[i] === ",") {
        comma = i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      if (text[i] === undefined) throw new Failure("Unexpected end of input: the object is not closed", i);
      throw new Failure(`Unexpected ${describe(text[i])}: expected “,” or “}”`, i, "A comma may be missing");
    }
  };
  const array = (): Json => {
    const out: Json[] = [];
    let comma = -1;
    i++;
    ws();
    if (text[i] === "]") {
      i++;
      return out;
    }
    while (true) {
      ws();
      if (text[i] === "]") throw new Failure("Trailing comma before ]", comma, "Remove the last comma");
      out.push(value());
      ws();
      if (text[i] === ",") {
        comma = i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return out;
      }
      if (text[i] === undefined) throw new Failure("Unexpected end of input: the array is not closed", i);
      throw new Failure(`Unexpected ${describe(text[i])}: expected “,” or “]”`, i, "A comma may be missing");
    }
  };
  const string = (): string => {
    const start = i;
    i++;
    while (i < text.length) {
      const c = text[i];
      if (c === '"') {
        i++;
        return JSON.parse(text.slice(start, i));
      }
      if (c === "\\") {
        const e = text[i + 1];
        if (e === "u") {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) throw new Failure("Invalid \\u escape", i);
          i += 6;
          continue;
        }
        if (!e || !'"\\/bfnrt'.includes(e)) throw new Failure(`Invalid escape \\${e ?? ""}`, i);
        i += 2;
        continue;
      }
      if (c === "\n") throw new Failure("Unterminated string: line breaks must be written \\n", i);
      if (c < " ") throw new Failure("Control characters must be escaped in strings", i);
      i++;
    }
    throw new Failure("Unterminated string", start);
  };
  const number = (): number => {
    const m = text.slice(i).match(/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/);
    if (!m) throw new Failure("Invalid number", i);
    if (/^-?0\d/.test(text.slice(i))) throw new Failure("Numbers can't have leading zeros", i);
    i += m[0].length;
    return Number(m[0]);
  };
  const result = value();
  ws();
  if (i < text.length) {
    throw new Failure(
      `Unexpected ${describe(text[i])} after the end of the JSON value`,
      i,
      text[i] === "{" || text[i] === "["
        ? "Several values: is this JSON Lines? Wrap them in [ ] with commas"
        : undefined,
    );
  }
  return result;
}

/** Parses JSON; on failure, says where (line, column) and why. A leading BOM is ignored. */
export function parseJson(input: string): Parsed {
  const text = input.replace(/^﻿/, "");
  if (!text.trim()) {
    return { ok: false, error: { message: "The text is empty", offset: 0, line: 1, column: 1 } };
  }
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    try {
      strictParse(text);
    } catch (f) {
      if (f instanceof Failure) {
        return { ok: false, error: { message: f.message, offset: f.offset, ...locate(text, f.offset), hint: f.hint } };
      }
    }
    // JSON.parse disagrees with us: use its own message and position.
    const message = e instanceof Error ? e.message : String(e);
    const offset = Number(message.match(/position (\d+)/)?.[1] ?? 0);
    return { ok: false, error: { message, offset, ...locate(text, offset) } };
  }
}

/** The lines around an error, with a caret under the column. */
export function excerpt(text: string, line: number, column: number, around = 2): string {
  const lines = text.replace(/^﻿/, "").split("\n");
  const first = Math.max(1, line - around);
  const last = Math.min(lines.length, line + around);
  const width = String(last).length;
  const out: string[] = [];
  for (let n = first; n <= last; n++) {
    let content = lines[n - 1].replace(/\r$/, "").replace(/\t/g, " ");
    let caretAt = column;
    // Long minified lines: show a window around the column.
    if (content.length > 100) {
      const start = n === line ? Math.max(0, column - 50) : 0;
      content = (start ? "…" : "") + content.slice(start, start + 100) + (content.length > start + 100 ? "…" : "");
      if (n === line) caretAt = column - start + (start ? 1 : 0);
    }
    out.push(`${String(n).padStart(width)} │ ${content}`);
    if (n === line) out.push(`${" ".repeat(width)} │ ${" ".repeat(Math.max(0, caretAt - 1))}^`);
  }
  return out.join("\n");
}

/** Whether a text looks like it was meant to be JSON (to use the query as input). */
export const looksLikeJson = (text: string) => /^\s*[[{]/.test(text);

// ---------------------------------------------------------------------------
// Types, sizes, children

export function typeOf(v: Json): JsonType {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v as JsonType;
}

export const isContainer = (v: Json): v is Json[] | Record<string, Json> => v !== null && typeof v === "object";

const plural = (n: number, word: string) => `${n.toLocaleString("en")} ${word}${n === 1 ? "" : "s"}`;

/** "3 keys", "12 items", "42 chars", or the value of a number or boolean. */
export function sizeLabel(v: Json): string {
  if (Array.isArray(v)) return plural(v.length, "item");
  if (v !== null && typeof v === "object") return plural(Object.keys(v).length, "key");
  if (typeof v === "string") return plural([...v].length, "char");
  return String(v);
}

export function children(v: Json): { key: Key; value: Json }[] {
  if (Array.isArray(v)) return v.map((value, key) => ({ key, value }));
  if (v !== null && typeof v === "object") return Object.entries(v).map(([key, value]) => ({ key, value }));
  return [];
}

export function getAt(root: Json, path: Path): Json | undefined {
  let cur: Json | undefined = root;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = Array.isArray(cur) ? (typeof k === "number" ? cur[k] : undefined) : (cur as Record<string, Json>)[k];
  }
  return cur;
}

/** Counts every value in the document (containers included) and the deepest nesting. */
export function stats(v: Json): { values: number; depth: number } {
  let values = 0;
  let depth = 0;
  const walk = (x: Json, d: number) => {
    values++;
    depth = Math.max(depth, d);
    if (isContainer(x)) { for (const c of Object.values(x)) walk(c, d + 1); }
  };
  walk(v, 0);
  return { values, depth };
}

// ---------------------------------------------------------------------------
// Paths

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/** jq style: `.users[0].name`, `.["a b"]`; the root is `.`. */
export function formatPath(path: Path): string {
  const s = path.map((k) => typeof k === "number" ? `[${k}]` : IDENT.test(k) ? `.${k}` : `.${JSON.stringify(k)}`)
    .join("");
  return s.startsWith(".") ? s : `.${s}`;
}

/** JSONPath: `$.users[0].name`, `$['a b']`. */
export function jsonPath(path: Path): string {
  return "$" +
    path.map((k) =>
      typeof k === "number"
        ? `[${k}]`
        : IDENT.test(k)
        ? `.${k}`
        : `['${k.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}']`
    ).join("");
}

/** JavaScript access: `data.users[0]["a b"]`. */
export function jsPath(path: Path, root = "data"): string {
  return root + path.map((k) => typeof k === "number" ? `[${k}]` : IDENT.test(k) ? `.${k}` : `[${JSON.stringify(k)}]`)
    .join("");
}

/** `JSON › users › [0]`, the last parts only when deep. */
export function breadcrumb(path: Path, max = 4): string {
  const parts = path.map((k) => typeof k === "number" ? `[${k}]` : k);
  const shown = parts.length > max ? ["…", ...parts.slice(-max)] : parts;
  return ["JSON", ...shown].join(" › ");
}

export const keyLabel = (k: Key) => typeof k === "number" ? `[${k}]` : k;

// ---------------------------------------------------------------------------
// Query language: a jq / JSONPath subset
//
//   .a.b  ."a b"  ["a b"]  ['a b']  [0]  [-1]  [1:3]  [0,2]  ["a","b"]  []  [*]  .*
//   ..name  ..*  ..[0]                  recursive descent
//   [?(@.price < 10)]  [?(@.tags)]      JSONPath filters (==, !=, <, <=, >, >=, =~ /regex/i)
//   | keys | length | type | first | last | reverse | sort | unique | flatten | values
//   | select(.age >= 18)  | .name       jq pipes, applied to each result
//
// A leading `$` (JSONPath) or `.` is optional.

export interface Result {
  /** Where the value is, or null for a computed value (`| length`). */
  path: Path | null;
  value: Json;
}

type Selector =
  | { kind: "key"; key: string }
  | { kind: "index"; index: number }
  | { kind: "slice"; start?: number; end?: number }
  | { kind: "union"; keys: Key[] }
  | { kind: "all" }
  | { kind: "filter"; cond: Condition };

type Step = { selector: Selector; deep: boolean };

type Operator = "==" | "!=" | "<" | "<=" | ">" | ">=" | "=~";

interface Condition {
  path: Step[];
  op?: Operator;
  value?: Json | RegExp;
}

type Stage = { kind: "path"; steps: Step[] } | { kind: "fn"; name: string } | { kind: "select"; cond: Condition };

const FUNCTIONS = ["keys", "length", "type", "first", "last", "reverse", "sort", "unique", "flatten", "values"];

export class QueryError extends Error {
  constructor(message: string, public offset: number) {
    super(message);
  }
}

/** Whether the search text is a query rather than words to filter keys with. */
export const isQuery = (text: string) => /^\s*[.$[]/.test(text) || /^\s*\|/.test(text);

class Lexer {
  i = 0;
  constructor(public s: string) {}
  ws() {
    while (this.s[this.i] === " " || this.s[this.i] === "\t") this.i++;
  }
  peek(n = 0) {
    return this.s[this.i + n];
  }
  eat(str: string) {
    this.ws();
    if (this.s.startsWith(str, this.i)) {
      this.i += str.length;
      return true;
    }
    return false;
  }
  expect(str: string) {
    if (!this.eat(str)) throw new QueryError(`Expected “${str}”`, this.i);
  }
  done() {
    this.ws();
    return this.i >= this.s.length;
  }
  ident(): string | undefined {
    const m = this.s.slice(this.i).match(/^[A-Za-z_$][A-Za-z0-9_$-]*/);
    if (!m) return undefined;
    this.i += m[0].length;
    return m[0];
  }
  quoted(): string | undefined {
    this.ws();
    const q = this.peek();
    if (q !== '"' && q !== "'") return undefined;
    let j = this.i + 1;
    let out = "";
    while (j < this.s.length && this.s[j] !== q) {
      if (this.s[j] === "\\" && j + 1 < this.s.length) {
        const e = this.s[j + 1];
        out += ({ n: "\n", t: "\t", r: "\r" } as Record<string, string>)[e] ?? e;
        j += 2;
      } else out += this.s[j++];
    }
    if (this.s[j] !== q) throw new QueryError("Unterminated string", this.i);
    this.i = j + 1;
    return out;
  }
  integer(): number | undefined {
    this.ws();
    const m = this.s.slice(this.i).match(/^-?\d+/);
    if (!m) return undefined;
    this.i += m[0].length;
    return Number(m[0]);
  }
  literal(): Json | RegExp {
    this.ws();
    const q = this.quoted();
    if (q !== undefined) return q;
    const re = this.s.slice(this.i).match(/^\/((?:\\.|[^/\\])*)\/([a-z]*)/);
    if (re) {
      this.i += re[0].length;
      try {
        return new RegExp(re[1], re[2]);
      } catch {
        throw new QueryError("Invalid regular expression", this.i - re[0].length);
      }
    }
    const num = this.s.slice(this.i).match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/);
    if (num) {
      this.i += num[0].length;
      return Number(num[0]);
    }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.s.startsWith(word, this.i)) {
        this.i += word.length;
        return v;
      }
    }
    throw new QueryError('Expected a value: a number, a "string", true, false or null', this.i);
  }
}

function parseSteps(lx: Lexer, stopAt: string[]): Step[] {
  const steps: Step[] = [];
  lx.ws();
  if (lx.peek() === "$" || lx.peek() === "@") lx.i++;
  while (!lx.done()) {
    lx.ws();
    const c = lx.peek();
    if (stopAt.some((s) => lx.s.startsWith(s, lx.i))) break;
    if (c === ".") {
      const deep = lx.peek(1) === ".";
      lx.i += deep ? 2 : 1;
      if (lx.peek() === "[") {
        steps.push({ selector: bracket(lx), deep });
        continue;
      }
      if (lx.peek() === "*") {
        lx.i++;
        steps.push({ selector: { kind: "all" }, deep });
        continue;
      }
      const name = lx.peek() === '"' || lx.peek() === "'" ? lx.quoted() : lx.ident();
      if (name === undefined) {
        if (deep) throw new QueryError("Expected a name after “..”", lx.i);
        // A lone `.` is the current value.
        continue;
      }
      steps.push({ selector: { kind: "key", key: name }, deep });
      continue;
    }
    if (c === "[") {
      steps.push({ selector: bracket(lx), deep: false });
      continue;
    }
    throw new QueryError(`Unexpected “${c}”`, lx.i);
  }
  return steps;
}

function bracket(lx: Lexer): Selector {
  lx.expect("[");
  lx.ws();
  if (lx.eat("]")) return { kind: "all" };
  if (lx.eat("*")) {
    lx.expect("]");
    return { kind: "all" };
  }
  if (lx.eat("?")) {
    const paren = lx.eat("(");
    const cond = condition(lx, paren ? [")"] : ["]"]);
    if (paren) lx.expect(")");
    lx.expect("]");
    return { kind: "filter", cond };
  }
  const keys: Key[] = [];
  let slice: { start?: number; end?: number } | undefined;
  while (true) {
    lx.ws();
    const q = lx.quoted();
    if (q !== undefined) keys.push(q);
    else {
      const n = lx.integer();
      lx.ws();
      if (lx.peek() === ":") {
        lx.i++;
        const end = lx.integer();
        slice = { start: n, end };
      } else if (n !== undefined) keys.push(n);
      else throw new QueryError("Expected an index, a slice or a quoted name", lx.i);
    }
    if (lx.eat(",")) continue;
    lx.expect("]");
    break;
  }
  if (slice) {
    if (keys.length) throw new QueryError("A slice can't be combined with other indexes", lx.i);
    return { kind: "slice", ...slice };
  }
  if (keys.length === 1) {
    return typeof keys[0] === "number" ? { kind: "index", index: keys[0] } : { kind: "key", key: keys[0] };
  }
  return { kind: "union", keys };
}

function condition(lx: Lexer, stopAt: string[]): Condition {
  const ops: Operator[] = ["==", "!=", "<=", ">=", "=~", "<", ">"];
  const path = parseSteps(lx, [...stopAt, ...ops]);
  lx.ws();
  const op = ops.find((o) => lx.s.startsWith(o, lx.i));
  if (!op) return { path };
  lx.i += op.length;
  const value = lx.literal();
  if (op === "=~" && !(value instanceof RegExp)) throw new QueryError("=~ expects a /regex/", lx.i);
  return { path, op, value };
}

export function parseQuery(src: string): Stage[] {
  // A bare name first is JSONPath without the `$`: `store.book` is `.store.book`.
  const bare = src.match(/^\s*([A-Za-z_][\w$-]*)/)?.[1];
  if (bare && bare !== "select" && !FUNCTIONS.includes(bare)) src = `.${src.trimStart()}`;
  const lx = new Lexer(src);
  const stages: Stage[] = [];
  lx.ws();
  if (lx.peek() === "|") lx.i++;
  while (true) {
    lx.ws();
    const name = lx.s.slice(lx.i).match(/^[a-z]+/)?.[0];
    if (name === "select") {
      lx.i += name.length;
      lx.expect("(");
      stages.push({ kind: "select", cond: condition(lx, [")"]) });
      lx.expect(")");
    } else if (name && FUNCTIONS.includes(name)) {
      lx.i += name.length;
      stages.push({ kind: "fn", name });
    } else if (name) {
      throw new QueryError(`Unknown function “${name}”: try ${FUNCTIONS.join(", ")} or select(…)`, lx.i);
    } else {
      stages.push({ kind: "path", steps: parseSteps(lx, ["|"]) });
    }
    if (lx.done()) break;
    lx.expect("|");
  }
  return stages;
}

function* descendants(r: Result): Generator<Result> {
  yield r;
  if (isContainer(r.value)) {
    for (const c of children(r.value)) yield* descendants({ path: r.path && [...r.path, c.key], value: c.value });
  }
}

function select(r: Result, sel: Selector): Result[] {
  const v = r.value;
  const at = (key: Key, value: Json): Result => ({ path: r.path && [...r.path, key], value });
  switch (sel.kind) {
    case "key":
      return v !== null && typeof v === "object" && !Array.isArray(v) && Object.hasOwn(v, sel.key)
        ? [at(sel.key, v[sel.key])]
        : [];
    case "index": {
      if (!Array.isArray(v)) return [];
      const i = sel.index < 0 ? v.length + sel.index : sel.index;
      return i >= 0 && i < v.length ? [at(i, v[i])] : [];
    }
    case "slice": {
      if (!Array.isArray(v)) return [];
      const norm = (n: number | undefined, d: number) =>
        n === undefined ? d : n < 0 ? Math.max(0, v.length + n) : Math.min(n, v.length);
      const start = norm(sel.start, 0);
      const end = norm(sel.end, v.length);
      const out: Result[] = [];
      for (let i = start; i < end; i++) out.push(at(i, v[i]));
      return out;
    }
    case "union":
      return sel.keys.flatMap((k) =>
        select(r, typeof k === "number" ? { kind: "index", index: k } : { kind: "key", key: k })
      );
    case "all":
      return children(v).map((c) => at(c.key, c.value));
    case "filter":
      return children(v).filter((c) => test(c.value, sel.cond)).map((c) => at(c.key, c.value));
  }
}

function runSteps(input: Result[], steps: Step[]): Result[] {
  let cur = input;
  for (const step of steps) {
    const next: Result[] = [];
    for (const r of cur) {
      if (step.deep) { for (const d of descendants(r)) next.push(...select(d, step.selector)); }
      else next.push(...select(r, step.selector));
    }
    cur = next;
  }
  return cur;
}

function compare(a: Json, b: Json): number {
  const order = ["null", "boolean", "number", "string", "array", "object"];
  const ta = typeOf(a);
  const tb = typeOf(b);
  if (ta !== tb) return order.indexOf(ta) - order.indexOf(tb);
  if (ta === "number" || ta === "boolean") return Number(a) - Number(b);
  if (ta === "string") return (a as string) < (b as string) ? -1 : (a as string) > (b as string) ? 1 : 0;
  const sa = JSON.stringify(a);
  const sb = JSON.stringify(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
}

function test(value: Json, cond: Condition): boolean {
  const found = runSteps([{ path: null, value }], cond.path);
  if (!cond.op) return found.some((f) => f.value !== null && f.value !== false);
  return found.some(({ value: v }) => {
    const want = cond.value;
    if (want instanceof RegExp) return typeof v === "string" && want.test(v);
    switch (cond.op) {
      case "==":
        return JSON.stringify(v) === JSON.stringify(want);
      case "!=":
        return JSON.stringify(v) !== JSON.stringify(want);
      default: {
        if (typeOf(v) !== typeOf(want as Json)) return false;
        const c = compare(v, want as Json);
        return cond.op === "<" ? c < 0 : cond.op === "<=" ? c <= 0 : cond.op === ">" ? c > 0 : c >= 0;
      }
    }
  });
}

function applyFn(r: Result, name: string): Result[] {
  const v = r.value;
  const computed = (value: Json): Result[] => [{ path: null, value }];
  switch (name) {
    case "keys":
      if (Array.isArray(v)) return computed(v.map((_, i) => i));
      if (isContainer(v)) return computed(Object.keys(v).sort());
      throw new QueryError(`${typeOf(v)} has no keys`, 0);
    case "length":
      if (isContainer(v)) return computed(Object.keys(v).length);
      if (typeof v === "string") return computed([...v].length);
      if (typeof v === "number") return computed(Math.abs(v));
      if (v === null) return computed(0);
      throw new QueryError("boolean has no length", 0);
    case "type":
      return computed(typeOf(v));
    case "values":
      return isContainer(v) ? computed(Object.values(v)) : [];
    case "first":
      return Array.isArray(v) && v.length ? [{ path: r.path && [...r.path, 0], value: v[0] }] : [];
    case "last":
      return Array.isArray(v) && v.length
        ? [{ path: r.path && [...r.path, v.length - 1], value: v[v.length - 1] }]
        : [];
    case "reverse":
      return Array.isArray(v)
        ? computed([...v].reverse())
        : typeof v === "string"
        ? computed([...v].reverse().join(""))
        : [r];
    case "sort":
      if (!Array.isArray(v)) throw new QueryError(`${typeOf(v)} can't be sorted`, 0);
      return computed([...v].sort(compare));
    case "unique": {
      if (!Array.isArray(v)) throw new QueryError(`${typeOf(v)} can't be made unique`, 0);
      const seen = new Map<string, Json>();
      for (const x of v) seen.set(JSON.stringify(x), x);
      return computed([...seen.values()].sort(compare));
    }
    case "flatten":
      if (!Array.isArray(v)) throw new QueryError(`${typeOf(v)} can't be flattened`, 0);
      return computed(v.flatMap((x) => Array.isArray(x) ? x : [x]));
  }
  return [];
}

/** Runs a query; throws QueryError on a syntax error. */
export function query(root: Json, src: string, base: Path = []): Result[] {
  const stages = parseQuery(src);
  let cur: Result[] = [{ path: base, value: root }];
  for (const stage of stages) {
    if (stage.kind === "path") cur = runSteps(cur, stage.steps);
    else if (stage.kind === "select") cur = cur.filter((r) => test(r.value, stage.cond));
    else cur = cur.flatMap((r) => applyFn(r, stage.name));
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Previews

/** One line: `"text"`, `42`, `{ 3 keys }`, `[ 12 items ]`. */
export function inlinePreview(v: Json, max = 80): string {
  let s: string;
  if (Array.isArray(v)) s = v.length ? `[ ${sizeLabel(v)} ]` : "[]";
  else if (v !== null && typeof v === "object") {
    const keys = Object.keys(v);
    s = keys.length ? `{ ${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""} }` : "{}";
  } else s = JSON.stringify(v);
  s = s.replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Pretty JSON stopping after `maxLines`, without serializing the rest of a big value. */
export function previewJson(v: Json, maxLines = 40): { text: string; truncated: boolean } {
  const lines: string[] = [];
  let truncated = false;
  const full = new Error("full");
  const push = (line: string) => {
    if (lines.length >= maxLines) {
      truncated = true;
      throw full;
    }
    lines.push(line);
  };
  const walk = (x: Json, indent: string, prefix: string, comma: string) => {
    if (!isContainer(x) || Object.keys(x).length === 0) {
      push(`${indent}${prefix}${JSON.stringify(x)}${comma}`);
      return;
    }
    const arr = Array.isArray(x);
    push(`${indent}${prefix}${arr ? "[" : "{"}`);
    const entries = children(x);
    entries.forEach((c, i) => {
      const p = arr ? "" : `${JSON.stringify(c.key)}: `;
      walk(c.value, indent + "  ", p, i < entries.length - 1 ? "," : "");
    });
    push(`${indent}${arr ? "]" : "}"}${comma}`);
  };
  try {
    walk(v, "", "", "");
  } catch (e) {
    if (e !== full) throw e;
  }
  if (truncated) lines.push("…");
  return { text: lines.join("\n"), truncated };
}

/** The text to copy for a value: strings without quotes, the rest as pretty JSON. */
export const copyText = (v: Json) => typeof v === "string" ? v : JSON.stringify(v, null, 2);

/** What a string or number might be: a date, a URL, a color. */
export function insight(v: Json): string | undefined {
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return `Date: ${d.toUTCString()}`;
    }
    if (/^https?:\/\/\S+$/.test(v)) return "URL";
    if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v)) return "Color";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) return "UUID";
    if (/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(v)) return "Email address";
  }
  if (typeof v === "number" && Number.isInteger(v)) {
    // Unix time between 2001 and 2100, in seconds or milliseconds.
    if (v > 1e9 && v < 4.1e9) return `Unix time: ${new Date(v * 1000).toUTCString()}`;
    if (v > 1e12 && v < 4.1e12) return `Unix time (ms): ${new Date(v).toUTCString()}`;
  }
  return undefined;
}

export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Converters

/** Control characters other than tab and line feed (which YAML can't show unquoted). */
const hasControl = (s: string) =>
  [...s].some((c) => {
    const n = c.charCodeAt(0);
    return (n < 32 && n !== 9 && n !== 10) || n === 127;
  });

const YAML_RESERVED = /^(true|false|yes|no|on|off|y|n|null|~|-?\.inf|\.nan)$/i;
const YAML_NUMBER = /^[-+]?(\d[\d_]*(\.\d*)?|\.\d+)([eE][-+]?\d+)?$|^0x[0-9a-f]+$|^0o[0-7]+$/i;

function yamlScalar(s: string): string {
  if (
    s === "" || YAML_RESERVED.test(s) || YAML_NUMBER.test(s) || /^[\s\-?:,[\]{}#&*!|>'"%@`]/.test(s) ||
    /\s$/.test(s) || /: |\s#|\n|\t/.test(s) || hasControl(s) || s.endsWith(":")
  ) {
    return JSON.stringify(s);
  }
  return s;
}

function yamlKey(k: string): string {
  return yamlScalar(k);
}

/** YAML 1.2 block style. Multiline strings become `|` blocks. */
export function toYaml(v: Json): string {
  const out: string[] = [];
  const scalar = (x: Json, indent: string): string => {
    if (x === null) return "null";
    if (typeof x === "string") {
      if (x.includes("\n") && !hasControl(x) && !/^\s/.test(x)) {
        const chomp = x.endsWith("\n") ? (x.endsWith("\n\n") ? "+" : "") : "-";
        const body = (chomp === "-" ? x : x.replace(/\n$/, "")).split("\n");
        return `|${chomp}\n${body.map((l) => (l ? `${indent}  ${l}` : "")).join("\n")}`;
      }
      return yamlScalar(x);
    }
    return String(x);
  };
  const emptyOf = (x: Json) => Array.isArray(x) ? "[]" : "{}";
  const block = (x: Json, indent: string) => {
    if (Array.isArray(x)) {
      for (const item of x) {
        if (isContainer(item) && Object.keys(item).length) {
          // `- key: v` with the rest aligned under the first key.
          const sub: string[] = [];
          const saved = out.length;
          block(item, indent + "  ");
          sub.push(...out.splice(saved));
          out.push(`${indent}- ${sub[0].slice(indent.length + 2)}`, ...sub.slice(1));
        } else {
          out.push(`${indent}- ${isContainer(item) ? emptyOf(item) : scalar(item, indent + "  ")}`);
        }
      }
    } else if (x !== null && typeof x === "object") {
      for (const [k, val] of Object.entries(x)) {
        if (isContainer(val) && Object.keys(val).length) {
          out.push(`${indent}${yamlKey(k)}:`);
          block(val, Array.isArray(val) ? indent : indent + "  ");
        } else {
          out.push(`${indent}${yamlKey(k)}: ${isContainer(val) ? emptyOf(val) : scalar(val, indent)}`);
        }
      }
    }
  };
  if (!isContainer(v) || Object.keys(v).length === 0) return `${isContainer(v) ? emptyOf(v) : scalar(v, "")}\n`;
  block(v, "");
  return out.join("\n") + "\n";
}

const TOML_BARE = /^[A-Za-z0-9_-]+$/;

function tomlString(s: string): string {
  // JSON escapes are valid TOML basic-string escapes; TOML also wants DEL escaped.
  return JSON.stringify(s).replace(/\x7f/g, "\\u007F");
}

const tomlKey = (k: string) => TOML_BARE.test(k) ? k : tomlString(k);

const isTable = (x: Json): x is Record<string, Json> => x !== null && typeof x === "object" && !Array.isArray(x);
const isTableArray = (x: Json): x is Record<string, Json>[] => Array.isArray(x) && x.length > 0 && x.every(isTable);

function tomlInline(x: Json): string {
  if (typeof x === "string") return tomlString(x);
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  if (Array.isArray(x)) return `[${x.map(tomlInline).join(", ")}]`;
  if (isTable(x)) {
    const parts = Object.entries(x).map(([k, v]) => `${tomlKey(k)} = ${tomlInline(v)}`);
    return parts.length ? `{ ${parts.join(", ")} }` : "{}";
  }
  return '""';
}

/** TOML needs a table at the top and has no null: nulls are dropped, and counted. */
export function toToml(v: Json): { text: string; droppedNulls: number } {
  if (!isTable(v)) throw new Error("TOML needs an object at the top level");
  let droppedNulls = 0;
  const strip = (x: Json): Json | undefined => {
    if (x === null) {
      droppedNulls++;
      return undefined;
    }
    if (Array.isArray(x)) return x.map(strip).filter((e) => e !== undefined) as Json[];
    if (typeof x === "object") {
      const o: Record<string, Json> = {};
      for (const [k, val] of Object.entries(x)) {
        const s = strip(val);
        if (s !== undefined) o[k] = s;
      }
      return o;
    }
    return x;
  };
  const blocks: string[] = [];
  const table = (t: Record<string, Json>, path: string[], header: string | undefined) => {
    const lines = header ? [header] : [];
    const later: [string, Json][] = [];
    for (const [k, val] of Object.entries(t)) {
      if (isTable(val) || isTableArray(val)) later.push([k, val]);
      else lines.push(`${tomlKey(k)} = ${tomlInline(val)}`);
    }
    if (lines.length) blocks.push(lines.join("\n"));
    for (const [k, val] of later) {
      const sub = [...path, tomlKey(k)];
      if (isTableArray(val)) { for (const item of val) table(item, sub, `[[${sub.join(".")}]]`); }
      else {
        const t2 = val as Record<string, Json>;
        // A table holding only tables needs no header of its own.
        const onlyTables = Object.values(t2).length > 0 &&
          Object.values(t2).every((x) => isTable(x) || isTableArray(x));
        table(t2, sub, onlyTables ? undefined : `[${sub.join(".")}]`);
      }
    }
  };
  table(strip(v) as Record<string, Json>, [], undefined);
  return { text: blocks.join("\n\n") + "\n", droppedNulls };
}

function csvCell(x: Json | undefined): string {
  if (x === undefined || x === null) return "";
  const s = typeof x === "string" ? x : isContainer(x) ? JSON.stringify(x) : String(x);
  return /[",\n\r]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Arrays of objects (columns = every key, in order of appearance), of arrays, or of values. */
export function toCsv(v: Json): string {
  if (!Array.isArray(v)) {
    if (v !== null && typeof v === "object") {
      // One object: a key/value table.
      return ["key,value", ...Object.entries(v).map(([k, x]) => `${csvCell(k)},${csvCell(x)}`)].join("\n") + "\n";
    }
    throw new Error("CSV needs an array or an object");
  }
  if (!v.length) return "";
  if (v.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
    const columns: string[] = [];
    const seen = new Set<string>();
    for (const row of v as Record<string, Json>[]) {
      for (const k of Object.keys(row)) if (!seen.has(k)) seen.add(k), columns.push(k);
    }
    const rows = (v as Record<string, Json>[]).map((row) => columns.map((c) => csvCell(row[c])).join(","));
    return [columns.map((c) => csvCell(c)).join(","), ...rows].join("\n") + "\n";
  }
  if (v.every(Array.isArray)) return (v as Json[][]).map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  return ["value", ...v.map(csvCell)].join("\n") + "\n";
}

/** Whether CSV makes sense for a value (to offer it). */
export const csvFriendly = (v: Json) =>
  (Array.isArray(v) && v.length > 0 && v.every((r) => isContainer(r))) ||
  (v !== null && typeof v === "object" && !Array.isArray(v) && Object.values(v).every((x) => !isContainer(x)));
