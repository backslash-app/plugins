// Espanso match files: parsing, variables, previews, and editing the YAML text in place.

// deno-lint-ignore no-import-prefix
import { parse, stringify } from "jsr:@std/yaml@^1";

export type Var = { name: string; type: string; params?: Record<string, any> };

export type FormField = { type?: string; multiline?: boolean; values?: unknown; default?: string };

export type Match = {
  triggers: string[];
  regex?: string;
  replace?: string;
  markdown?: string;
  html?: string;
  imagePath?: string;
  form?: string;
  formFields: Record<string, FormField>;
  label?: string;
  vars: Var[];
  word: boolean;
  propagateCase: boolean;
  searchTerms: string[];
  /** File it comes from, and its position in that file's `matches`. */
  file: string;
  index: number;
  /** Package name, for matches of installed packages. */
  package?: string;
};

export type MatchFile = { matches: Match[]; globalVars: Var[]; imports: string[] };

const str = (v: unknown) => typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;

function varsOf(v: unknown): Var[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => x && typeof x === "object" && typeof x.name === "string").map((x) => ({
    name: x.name,
    type: String(x.type ?? "echo"),
    params: x.params && typeof x.params === "object" ? x.params : undefined,
  }));
}

/** The matches and global variables of one YAML file. */
export function parseMatchFile(text: string, file: string, pkg?: string): MatchFile {
  const doc = (text.trim() ? parse(text) : {}) as Record<string, unknown> | null;
  if (doc !== null && typeof doc !== "object") throw new Error(`${file} isn't a match file`);
  const raw = Array.isArray(doc?.matches) ? doc.matches : [];
  const matches: Match[] = raw.map((m: any, index: number) => {
    const triggers = Array.isArray(m?.triggers)
      ? m.triggers.map(String)
      : str(m?.trigger) !== undefined
      ? [str(m.trigger)!]
      : [];
    return {
      triggers,
      regex: str(m?.regex),
      replace: str(m?.replace),
      markdown: str(m?.markdown),
      html: str(m?.html),
      imagePath: str(m?.image_path),
      form: str(m?.form),
      formFields: m?.form_fields && typeof m.form_fields === "object" ? m.form_fields : {},
      label: str(m?.label),
      vars: varsOf(m?.vars),
      word: m?.word === true,
      propagateCase: m?.propagate_case === true,
      searchTerms: Array.isArray(m?.search_terms) ? m.search_terms.map(String) : [],
      file,
      index,
      package: pkg,
    };
  });
  return {
    matches,
    globalVars: varsOf(doc?.global_vars),
    imports: Array.isArray(doc?.imports) ? doc.imports.map(String) : [],
  };
}

/** `espanso path` output → its folders. */
export function parsePaths(out: string): { config?: string; packages?: string; runtime?: string } {
  const get = (label: string) => new RegExp(`^${label}:\\s*(.+)$`, "mi").exec(out)?.[1].trim();
  return { config: get("Config"), packages: get("Packages"), runtime: get("Runtime") };
}

/** `espanso status` output → running or not. */
export function parseStatus(out: string): boolean {
  return /\bis running\b/i.test(out) && !/not running/i.test(out);
}

// ---------------------------------------------------------------------------
// Variables

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const pad = (n: number, w = 2, c = "0") => String(n).padStart(w, c);

/** A chrono (strftime) format, as espanso's date variable uses: `%d/%m/%Y %H:%M`. */
export function formatDate(format: string, d: Date): string {
  const offset = -d.getTimezoneOffset();
  const start = new Date(d.getFullYear(), 0, 1);
  const yday =
    Math.floor((new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - start.getTime()) / 86_400_000) + 1;
  const h12 = d.getHours() % 12 || 12;
  const map: Record<string, () => string> = {
    Y: () => String(d.getFullYear()),
    y: () => pad(d.getFullYear() % 100),
    C: () => pad(Math.floor(d.getFullYear() / 100)),
    m: () => pad(d.getMonth() + 1),
    d: () => pad(d.getDate()),
    e: () => pad(d.getDate(), 2, " "),
    b: () => MONTHS[d.getMonth()].slice(0, 3),
    h: () => MONTHS[d.getMonth()].slice(0, 3),
    B: () => MONTHS[d.getMonth()],
    a: () => DAYS[d.getDay()].slice(0, 3),
    A: () => DAYS[d.getDay()],
    u: () => String(d.getDay() || 7),
    w: () => String(d.getDay()),
    j: () => pad(yday, 3),
    H: () => pad(d.getHours()),
    k: () => pad(d.getHours(), 2, " "),
    I: () => pad(h12),
    l: () => pad(h12, 2, " "),
    M: () => pad(d.getMinutes()),
    S: () => pad(d.getSeconds()),
    p: () => d.getHours() < 12 ? "AM" : "PM",
    P: () => d.getHours() < 12 ? "am" : "pm",
    z: () => `${offset >= 0 ? "+" : "-"}${pad(Math.floor(Math.abs(offset) / 60))}${pad(Math.abs(offset) % 60)}`,
    s: () => String(Math.floor(d.getTime() / 1000)),
    F: () => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    D: () => `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${pad(d.getFullYear() % 100)}`,
    T: () => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
    R: () => `${pad(d.getHours())}:${pad(d.getMinutes())}`,
    n: () => "\n",
    t: () => "\t",
    "%": () => "%",
  };
  // Flags like %-d (no padding) are chrono's too.
  return format.replace(/%([-_0]?)([a-zA-Z%])/g, (all, flag: string, c: string) => {
    const f = map[c];
    if (!f) return all;
    const v = f();
    return flag === "-" ? v.replace(/^[0 ]+(?=\d)/, "") : flag === "_" ? v.replace(/^0/, " ") : v;
  });
}

export type Resolved = { text: string; unresolved: string[] };

/**
 * The replacement with the variables Backslash can compute (date, echo,
 * random, choice: its first value), the others left out and listed.
 * `values` holds what a form gave (`name` or `form1.name`).
 */
export function resolve(
  m: Match,
  globals: Var[] = [],
  options: { now?: Date; values?: Record<string, string>; random?: () => number; preview?: boolean } = {},
): Resolved {
  const now = options.now ?? new Date();
  const random = options.random ?? Math.random;
  const values = options.values ?? {};
  const unresolved: string[] = [];
  const vars = new Map<string, Var>();
  for (const v of [...globals, ...m.vars]) vars.set(v.name, v);
  const cache = new Map<string, string>();
  const valueOf = (name: string, depth = 0): string | undefined => {
    if (name in values) return values[name];
    if (cache.has(name)) return cache.get(name);
    const v = vars.get(name);
    if (!v) return undefined;
    const p = v.params ?? {};
    let out: string | undefined;
    switch (v.type) {
      case "date": {
        const d = new Date(now.getTime() + Number(p.offset ?? 0) * 1000);
        out = formatDate(String(p.format ?? "%Y-%m-%d"), d);
        break;
      }
      case "echo":
        out = String(p.echo ?? "");
        break;
      case "random": {
        const choices = Array.isArray(p.choices) ? p.choices.map(String) : [];
        out = choices.length ? choices[Math.floor(random() * choices.length)] : "";
        break;
      }
      case "choice": {
        const first = Array.isArray(p.values) ? p.values[0] : undefined;
        out = first === undefined
          ? ""
          : typeof first === "object"
          ? String(first.id ?? first.label ?? "")
          : String(first);
        break;
      }
      case "match":
        out = undefined;
        break;
    }
    if (out !== undefined && depth < 5) {
      out = out.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (all, n: string) => valueOf(n, depth + 1) ?? all);
    }
    if (out !== undefined) cache.set(name, out);
    return out;
  };
  const template = m.replace ?? m.markdown ?? m.html ?? m.form?.replace(/\[\[\s*([\w-]+)\s*\]\]/g, "{{$1}}") ?? "";
  const text = template.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_all, name: string) => {
    const v = valueOf(name);
    if (v !== undefined) return v;
    const type = vars.get(name)?.type ?? vars.get(name.split(".")[0])?.type ?? "unknown";
    unresolved.push(`${name} (${type})`);
    return options.preview ? `⟨${name}: ${type}⟩` : "";
  });
  return { text: text.replace(/\$\|\$/g, ""), unresolved: [...new Set(unresolved)] };
}

/** Fields of a form match, or of the `form` variables of a match, with their ids as used in the template. */
export function formFields(
  m: Match,
): { id: string; title: string; kind: "text" | "textArea" | "dropdown"; options: string[]; value?: string }[] {
  const out: {
    id: string;
    title: string;
    kind: "text" | "textArea" | "dropdown";
    options: string[];
    value?: string;
  }[] = [];
  const add = (prefix: string, layout: string, fields: Record<string, FormField>) => {
    for (const [, name] of layout.matchAll(/\[\[\s*([\w-]+)\s*\]\]/g)) {
      const id = prefix ? `${prefix}.${name}` : name;
      if (out.some((f) => f.id === id)) continue;
      const f = fields[name] ?? {};
      const options = Array.isArray(f.values)
        ? f.values.map(String)
        : typeof f.values === "string"
        ? f.values.split("\n").map((s) => s.trim()).filter(Boolean)
        : [];
      out.push({
        id,
        title: name.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase()),
        kind: (f.type === "choice" || f.type === "list") && options.length
          ? "dropdown"
          : f.multiline
          ? "textArea"
          : "text",
        options,
        value: f.default,
      });
    }
  };
  if (m.form) add("", m.form, m.formFields);
  for (const v of m.vars.filter((v) => v.type === "form")) {
    add(v.name, String(v.params?.layout ?? ""), (v.params?.fields ?? {}) as Record<string, FormField>);
  }
  return out;
}

/** What the match is called in a list: its triggers, or its regex. */
export function matchTitle(m: Match): string {
  if (m.triggers.length) return m.triggers.join("  ");
  if (m.regex) return `/${m.regex}/`;
  return m.label ?? "(no trigger)";
}

export function matchKind(m: Match): "text" | "form" | "image" | "markdown" | "html" {
  if (m.imagePath) return "image";
  if (m.form || m.vars.some((v) => v.type === "form")) return "form";
  if (m.markdown !== undefined) return "markdown";
  if (m.html !== undefined) return "html";
  return "text";
}

/** One line of a replacement, for a subtitle. */
export function oneLine(text: string, max = 80): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------------------
// Editing the YAML text (keeping its comments and layout)

type Block = { header: number; end: number; indent: string; items: number[] };

/** Where the `matches:` list is in the text, and where each of its items starts. */
export function matchesBlock(lines: string[]): Block | undefined {
  const header = lines.findIndex((l) => /^matches\s*:\s*(#.*)?$/.test(l));
  if (header < 0) return undefined;
  let end = header + 1;
  while (end < lines.length && (/^\s*(#.*)?$/.test(lines[end]) || /^[\s-]/.test(lines[end]))) end++;
  const first = lines.slice(header + 1, end).find((l) => /^\s*- /.test(l) || /^\s*-$/.test(l));
  const indent = first ? /^(\s*)-/.exec(first)![1] : "  ";
  const items: number[] = [];
  for (let i = header + 1; i < end; i++) {
    const item = /^(\s*)-(\s|$)/.exec(lines[i]);
    if (item && item[1] === indent) items.push(i);
  }
  return { header, end, indent, items };
}

export type NewMatch = { trigger: string; replace: string; label?: string; word?: boolean };

/** The YAML lines of a new match, as an item of the list. */
export function matchYaml(m: NewMatch, indent = "  "): string[] {
  const entry: Record<string, unknown> = { trigger: m.trigger, replace: m.replace };
  if (m.label) entry.label = m.label;
  if (m.word) entry.word = true;
  return stringify([entry]).trimEnd().split("\n").map((l) => `${indent}${l}`);
}

/** The file's text with `m` added at the end of its `matches`; checked by parsing it again. */
export function appendMatch(text: string, m: NewMatch): string {
  if (!m.trigger.trim()) throw new Error("A match needs a trigger");
  const before = text.trim() ? parseMatchFile(text, "").matches.length : 0;
  let out: string;
  if (!text.trim()) {
    out = ["matches:", ...matchYaml(m), ""].join("\n");
  } else {
    let lines = text.replace(/\r\n/g, "\n").split("\n");
    // `matches: []` becomes a block list.
    lines = lines.map((l) => /^matches\s*:\s*\[\s*\]\s*(#.*)?$/.test(l) ? "matches:" : l);
    const block = matchesBlock(lines);
    if (!block) {
      if (/^matches\s*:/m.test(text)) throw new Error("This file's matches are written inline: add the match by hand");
      const trimmed = lines.join("\n").replace(/\s*$/, "");
      out = `${trimmed}\n\nmatches:\n${matchYaml(m).join("\n")}\n`;
    } else {
      let last = block.end - 1;
      while (last > block.header && /^\s*(#.*)?$/.test(lines[last])) last--;
      lines.splice(last + 1, 0, ...matchYaml(m, block.indent));
      out = lines.join("\n");
      if (!out.endsWith("\n")) out += "\n";
    }
  }
  const after = parseMatchFile(out, "").matches;
  if (after.length !== before + 1 || after[after.length - 1].triggers[0] !== m.trigger) {
    throw new Error("Couldn't add the match without breaking the file: add it by hand");
  }
  return out;
}

/** The file's text without its `index`-th match; checked by parsing it again. */
export function removeMatch(text: string, index: number): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const original = parse(text) as { matches?: unknown[] };
  const block = matchesBlock(lines);
  if (!block || !Array.isArray(original?.matches) || block.items.length !== original.matches.length) {
    throw new Error("Couldn't find the match in the file: open it to delete it by hand");
  }
  const start = block.items[index];
  if (start === undefined) throw new Error("This match is no longer in the file");
  let end = block.items[index + 1] ?? block.end;
  // Comments and blank lines right above the next item stay with it.
  while (end - 1 > start && /^\s*(#.*)?$/.test(lines[end - 1])) end--;
  lines.splice(start, end - start);
  const out = lines.join("\n");
  const after = (parse(out) as { matches?: unknown[] } | null)?.matches ?? [];
  const expected = original.matches.filter((_, i) => i !== index);
  if (JSON.stringify(after) !== JSON.stringify(expected)) {
    throw new Error("Couldn't delete the match without changing others: open the file to delete it by hand");
  }
  return out;
}
