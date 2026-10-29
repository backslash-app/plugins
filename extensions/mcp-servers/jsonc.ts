// A small JSON-with-comments parser that remembers where every value is, so that a setting can be
// changed in place without losing the file's comments, order or indentation. Pure, tested in lib_test.ts.

export type Node =
  | { type: "object"; start: number; end: number; props: Prop[] }
  | { type: "array"; start: number; end: number; items: Node[] }
  | { type: "string"; start: number; end: number; value: string }
  | { type: "number"; start: number; end: number; value: number }
  | { type: "boolean"; start: number; end: number; value: boolean }
  | { type: "null"; start: number; end: number; value: null };

export interface Prop {
  key: string;
  keyStart: number;
  value: Node;
}

export class JsoncError extends Error {
  constructor(message: string, readonly offset: number) {
    super(message);
  }
}

/** Parses JSON, also with `//` and `/* *\/` comments and trailing commas (VS Code, Zed). */
export function parseTree(text: string): Node {
  let i = 0;

  const fail = (what: string): never => {
    const line = text.slice(0, i).split("\n").length;
    throw new JsoncError(`${what} on line ${line}`, i);
  };

  function skip() {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r" || c === "﻿") i++;
      else if (c === "/" && text[i + 1] === "/") {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (c === "/" && text[i + 1] === "*") {
        const close = text.indexOf("*/", i + 2);
        if (close === -1) fail("Unclosed comment");
        i = close + 2;
      } else return;
    }
  }

  function string(): string {
    const start = i;
    i++; // opening quote
    let out = "";
    for (;;) {
      if (i >= text.length) {
        i = start;
        fail("Unclosed string");
      }
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c === "\\") {
        const e = text[i + 1];
        const map: Record<string, string> = {
          '"': '"',
          "\\": "\\",
          "/": "/",
          b: "\b",
          f: "\f",
          n: "\n",
          r: "\r",
          t: "\t",
        };
        if (e === "u") {
          out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
          i += 6;
        } else if (e in map) {
          out += map[e];
          i += 2;
        } else fail("Bad escape");
      } else {
        out += c;
        i++;
      }
    }
  }

  function value(): Node {
    skip();
    const start = i;
    const c = text[i];
    if (c === "{") {
      i++;
      const props: Prop[] = [];
      for (;;) {
        skip();
        if (text[i] === "}") {
          i++;
          return { type: "object", start, end: i, props };
        }
        if (text[i] !== '"') fail("Expected a property name");
        const keyStart = i;
        const key = string();
        skip();
        if (text[i] !== ":") fail("Expected “:”");
        i++;
        props.push({ key, keyStart, value: value() });
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "}") fail("Expected “,” or “}”");
      }
    }
    if (c === "[") {
      i++;
      const items: Node[] = [];
      for (;;) {
        skip();
        if (text[i] === "]") {
          i++;
          return { type: "array", start, end: i, items };
        }
        items.push(value());
        skip();
        if (text[i] === ",") i++;
        else if (text[i] !== "]") fail("Expected “,” or “]”");
      }
    }
    if (c === '"') {
      const v = string();
      return { type: "string", start, end: i, value: v };
    }
    const m = /^(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) fail("Unexpected character");
    i += m![0].length;
    const w = m![0];
    if (w === "true" || w === "false") return { type: "boolean", start, end: i, value: w === "true" };
    if (w === "null") return { type: "null", start, end: i, value: null };
    return { type: "number", start, end: i, value: Number(w) };
  }

  const root = value();
  skip();
  if (i < text.length) fail("Unexpected text after the end");
  return root;
}

/** The plain JavaScript value of a node. */
export function toValue(node: Node): unknown {
  if (node.type === "object") return Object.fromEntries(node.props.map((p) => [p.key, toValue(p.value)]));
  if (node.type === "array") return node.items.map(toValue);
  return node.value;
}

export const parseJsonc = (text: string): unknown => toValue(parseTree(text));

/** The node at `path` (object keys), if every step exists. */
export function find(node: Node, path: string[]): Node | undefined {
  let n: Node | undefined = node;
  for (const key of path) {
    if (n?.type !== "object") return undefined;
    // The last occurrence wins, as with JSON.parse.
    n = n.props.findLast((p) => p.key === key)?.value;
  }
  return n;
}

/** The indentation of the line `offset` is on. */
function indentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  return /^[ \t]*/.exec(text.slice(lineStart))![0];
}

/** JSON for a value, on one line for arrays of scalars (`["a", "b"]`), else indented like the file. */
function stringify(value: unknown, indent: string, unit: string): string {
  if (Array.isArray(value) && value.every((v) => v === null || typeof v !== "object")) {
    return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
  }
  return JSON.stringify(value, null, unit).replace(/\n/g, `\n${indent}`);
}

/**
 * Sets `path` to `value`: replaces the value when the key exists, else adds
 * the key at the end of its object (which must exist), keeping everything
 * else of the text as it was.
 */
export function setProperty(text: string, path: string[], value: unknown): string {
  const root = parseTree(text);
  const parent = find(root, path.slice(0, -1));
  if (parent?.type !== "object") throw new Error(`No “${path.slice(0, -1).join(".")}” object in the file`);
  const key = path[path.length - 1];
  const existing = parent.props.findLast((p) => p.key === key);
  const unit = /\n( +|\t)"/.exec(text)?.[1] ?? "  ";
  if (existing) {
    const indent = indentAt(text, existing.keyStart);
    return text.slice(0, existing.value.start) + stringify(value, indent, unit) + text.slice(existing.value.end);
  }
  if (!parent.props.length) {
    const outer = indentAt(text, parent.start);
    const indent = outer + unit;
    return `${text.slice(0, parent.start)}{\n${indent}${JSON.stringify(key)}: ${
      stringify(value, indent, unit)
    }\n${outer}}${text.slice(parent.end)}`;
  }
  const last = parent.props[parent.props.length - 1];
  const sameLine = !text.slice(parent.start, last.keyStart).includes("\n");
  const indent = sameLine ? "" : indentAt(text, last.keyStart);
  const sep = sameLine ? ", " : `,\n${indent}`;
  return `${text.slice(0, last.value.end)}${sep}${JSON.stringify(key)}: ${stringify(value, indent, unit)}${
    text.slice(last.value.end)
  }`;
}
