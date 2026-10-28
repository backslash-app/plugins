// Regular expressions: query parsing, matching, highlighting and a short explanation. Pure, tested in lib_test.ts.

export interface Query {
  pattern: string;
  flags: string;
  /** Text typed after the pattern, if any. */
  text?: string;
  /** From `s/pattern/replacement/flags`. */
  replacement?: string;
  /** Typed between slashes (flags respected as typed). */
  literal: boolean;
}

/** Index of the next unescaped `/` from `start`, outside character classes; -1 if none. */
export function closingSlash(s: string, start: number): number {
  let inClass = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "/") return i;
  }
  return -1;
}

function afterFlags(rest: string): { flags: string; text?: string } {
  const m = rest.match(/^([a-z]*)(?:\s([\s\S]*))?$/);
  if (!m) throw new Error(`Flags go right after the closing slash: “${rest.split(/\s/)[0]}”`);
  return { flags: m[1], text: m[2] || undefined };
}

/**
 * `/pattern/flags test text`, `s/pattern/replacement/flags text`, or a bare
 * pattern (tested with the global flag against the saved text).
 */
export function parseQuery(input: string): Query | undefined {
  const q = input.replace(/^\s+/, "");
  if (!q.trim()) return undefined;
  if (q.startsWith("s/")) {
    const end = closingSlash(q, 2);
    const repEnd = end < 0 ? -1 : closingSlash(q, end + 1);
    if (end > 0 && repEnd > 0) {
      const { flags, text } = afterFlags(q.slice(repEnd + 1));
      return { pattern: q.slice(2, end), replacement: q.slice(end + 1, repEnd), flags, text, literal: true };
    }
  }
  if (q.startsWith("/")) {
    const end = closingSlash(q, 1);
    if (end > 0) return { pattern: q.slice(1, end), ...afterFlags(q.slice(end + 1)), literal: true };
    // Still typing: `/abc` is the pattern so far.
    return { pattern: q.slice(1), flags: "g", literal: true };
  }
  return { pattern: q.trimEnd(), flags: "g", literal: false };
}

/** "Invalid regular expression: /(/: Unterminated group" → "Unterminated group". */
export function compile(pattern: string, flags: string): RegExp {
  const bad = [...flags].find((f) => !"dgimsuyv".includes(f));
  if (bad) throw new Error(`Unknown flag “${bad}”: use d, g, i, m, s, u, v or y`);
  try {
    return new RegExp(pattern, flags.includes("d") ? flags : `${flags}d`);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new Error(
      message.replace(/^Invalid regular expression: \/.*\/[a-z]*: /s, "").replace(/^Invalid flags.*/, "Invalid flags"),
    );
  }
}

export interface Group {
  /** 1-based. */
  number: number;
  name?: string;
  /** Undefined when the group did not take part in the match. */
  value?: string;
  start?: number;
  end?: number;
}

export interface Match {
  index: number;
  end: number;
  text: string;
  groups: Group[];
}

/** Every match (or just the first without `g`/`y`), at most `limit`. */
export function findMatches(re: RegExp, text: string, limit = 500): { matches: Match[]; truncated: boolean } {
  const names = groupNames(re.source);
  const matches: Match[] = [];
  const all = re.global || re.sticky;
  re.lastIndex = 0;
  while (matches.length < limit) {
    const m = re.exec(text) as (RegExpExecArray & { indices?: [number, number][] }) | null;
    if (!m) break;
    const groups: Group[] = [];
    for (let i = 1; i < m.length; i++) {
      const at = m.indices?.[i];
      groups.push({ number: i, name: names[i - 1], value: m[i], start: at?.[0], end: at?.[1] });
    }
    matches.push({ index: m.index, end: m.index + m[0].length, text: m[0], groups });
    if (!all) break;
    // Empty matches would loop forever.
    if (m[0] === "") {
      const cp = text.codePointAt(re.lastIndex) ?? 0;
      re.lastIndex += (re.unicode || re.unicodeSets) && cp > 0xffff ? 2 : 1;
    }
    if (re.lastIndex > text.length) break;
  }
  const truncated = matches.length === limit && all && re.exec(text) !== null;
  re.lastIndex = 0;
  return { matches, truncated };
}

/** Names of the capture groups in order, `undefined` for numbered ones. */
export function groupNames(source: string): (string | undefined)[] {
  const names: (string | undefined)[] = [];
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === "\\") i++;
    else if (inClass) inClass = c !== "]";
    else if (c === "[") inClass = true;
    else if (c === "(") {
      if (source[i + 1] !== "?") names.push(undefined);
      else {
        const named = source.slice(i).match(/^\(\?<([A-Za-z_$][\w$]*)>/);
        if (named) names.push(named[1]);
      }
    }
  }
  return names;
}

export const OPEN = "⟦";
export const CLOSE = "⟧";

/** The text with every match wrapped in ⟦…⟧. */
export function highlight(text: string, matches: { index: number; end: number }[]): string {
  let out = "";
  let at = 0;
  for (const m of matches) {
    if (m.index < at) continue;
    out += text.slice(at, m.index) + OPEN + text.slice(m.index, m.end) + CLOSE;
    at = m.end;
  }
  return out + text.slice(at);
}

/** A few characters around one match, on one line, for the side panel. */
export function context(text: string, m: { index: number; end: number }, around = 40): string {
  const start = Math.max(0, m.index - around), end = Math.min(text.length, m.end + around);
  return `${start > 0 ? "…" : ""}${
    highlight(text.slice(start, end), [{ index: m.index - start, end: m.end - start }])
  }${end < text.length ? "…" : ""}`;
}

export function replacePreview(re: RegExp, text: string, replacement: string): string {
  re.lastIndex = 0;
  const out = text.replace(re, replacement);
  re.lastIndex = 0;
  return out;
}

/** `/a\/b/gi` as a JavaScript literal. */
export const literal = (pattern: string, flags: string) => `/${pattern.replace(/(^|[^\\])\//g, "$1\\/")}/${flags}`;

/** `new RegExp("\\d+", "g")`. */
export const constructor = (pattern: string, flags: string) =>
  `new RegExp(${JSON.stringify(pattern)}${flags ? `, ${JSON.stringify(flags)}` : ""})`;

// ---------------------------------------------------------------------------
// Explanation

export interface Token {
  text: string;
  description: string;
  kind: "literal" | "class" | "escape" | "group" | "anchor" | "quantifier" | "alternation" | "backreference";
}

const ESCAPES: Record<string, string> = {
  d: "a digit (0–9)",
  D: "any character except a digit",
  w: "a word character (letter, digit or _)",
  W: "any character except a word character",
  s: "a whitespace character",
  S: "any character except whitespace",
  b: "a word boundary",
  B: "not a word boundary",
  n: "a line feed",
  r: "a carriage return",
  t: "a tab",
  v: "a vertical tab",
  f: "a form feed",
  "0": "a NUL character",
};

const CLASS_ESCAPES: Record<string, string> = {
  d: "digits",
  D: "non-digits",
  w: "word characters",
  W: "non-word characters",
  s: "whitespace",
  S: "non-whitespace",
  n: "line feed",
  r: "carriage return",
  t: "tab",
};

function describeClass(body: string): string {
  const items: string[] = [];
  let i = 0;
  const one = (): string => {
    if (body[i] === "\\") {
      const c = body[i + 1];
      i += 2;
      return CLASS_ESCAPES[c] ?? `“${c}”`;
    }
    return `“${body[i++]}”`;
  };
  while (i < body.length) {
    const start = i;
    const a = one();
    if (body[i] === "-" && i + 1 < body.length && body[start] !== "\\") {
      i++;
      const b = one();
      items.push(`${a.replace(/[“”]/g, "")}–${b.replace(/[“”]/g, "")}`);
    } else items.push(a);
  }
  return items.join(", ");
}

function quantifier(q: string): string {
  const lazy = q.length > 1 && q.endsWith("?") ? ", as few as possible" : "";
  const base = lazy ? q.slice(0, -1) : q;
  let text: string;
  if (base === "*") text = "zero or more times";
  else if (base === "+") text = "one or more times";
  else if (base === "?") text = "optional";
  else {
    const [, n, comma, m] = base.match(/^\{(\d+)(,)?(\d+)?\}$/) ?? [];
    if (!comma) text = `exactly ${n} time${n === "1" ? "" : "s"}`;
    else if (m === undefined) text = `${n} or more times`;
    else text = `between ${n} and ${m} times`;
  }
  return text + lazy;
}

/** Splits a pattern into tokens with a short English description each. */
export function explainTokens(pattern: string, flags = ""): Token[] {
  const tokens: Token[] = [];
  let group = 0;
  const open: string[] = [];
  let i = 0;
  const push = (t: Token) => {
    // A quantifier right after: attach it.
    const q = pattern.slice(i).match(/^(?:[*+?]|\{\d+(?:,\d*)?\})\??/);
    if (q && t.kind !== "anchor" && t.kind !== "alternation" && !(t.kind === "group" && t.text !== ")")) {
      i += q[0].length;
      t = { ...t, text: t.text + q[0], description: `${t.description}, ${quantifier(q[0])}` };
    }
    const prev = tokens[tokens.length - 1];
    // Merge runs of plain characters into one literal.
    if (t.kind === "literal" && prev?.kind === "literal" && t.text.length === 1 && !/[*+?}]$/.test(prev.text)) {
      prev.text += t.text;
      prev.description = `the text “${prev.text}”`;
    } else tokens.push(t);
  };
  while (i < pattern.length) {
    const c = pattern[i];
    if (c === "\\") {
      const rest = pattern.slice(i + 1);
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^k<([^>]+)>/))) {
        i += 1 + m[0].length;
        push({ text: `\\${m[0]}`, description: `the same text as group “${m[1]}”`, kind: "backreference" });
      } else if ((m = rest.match(/^[1-9]\d*/))) {
        i += 1 + m[0].length;
        push({ text: `\\${m[0]}`, description: `the same text as group ${m[0]}`, kind: "backreference" });
      } else if ((m = rest.match(/^([pP])\{([^}]+)\}/))) {
        i += 1 + m[0].length;
        const not = m[1] === "P" ? "not " : "";
        push({ text: `\\${m[0]}`, description: `a character ${not}in Unicode category ${m[2]}`, kind: "escape" });
      } else if ((m = rest.match(/^x[0-9a-fA-F]{2}|^u[0-9a-fA-F]{4}|^u\{[0-9a-fA-F]+\}/))) {
        i += 1 + m[0].length;
        const hex = m[0].replace(/^[xu]\{?|\}$/g, "").toUpperCase().padStart(4, "0");
        push({ text: `\\${m[0]}`, description: `the character U+${hex}`, kind: "escape" });
      } else if ((m = rest.match(/^c[A-Za-z]/))) {
        i += 3;
        push({ text: `\\${m[0]}`, description: `Ctrl+${m[0][1].toUpperCase()}`, kind: "escape" });
      } else {
        const e = rest[0] ?? "";
        i += 2;
        if (ESCAPES[e]) {
          push({ text: `\\${e}`, description: ESCAPES[e], kind: e === "b" || e === "B" ? "anchor" : "escape" });
        } else push({ text: `\\${e}`, description: `the character “${e}”`, kind: "literal" });
      }
    } else if (c === "[") {
      let j = i + 1;
      if (pattern[j] === "^") j++;
      if (pattern[j] === "]") j++;
      while (j < pattern.length && pattern[j] !== "]") j += pattern[j] === "\\" ? 2 : 1;
      const text = pattern.slice(i, j + 1);
      const negated = text.startsWith("[^");
      const body = text.slice(negated ? 2 : 1, -1);
      i = j + 1;
      push({
        text,
        description: body
          ? `${negated ? "any character except" : "one of"} ${describeClass(body)}`
          : negated
          ? "any character"
          : "nothing",
        kind: "class",
      });
    } else if (c === "(") {
      const rest = pattern.slice(i);
      let m: RegExpMatchArray | null;
      if ((m = rest.match(/^\(\?<([A-Za-z_$][\w$]*)>/))) {
        group++;
        open.push(`group ${group} “${m[1]}”`);
        i += m[0].length;
        push({ text: m[0], description: `start of capture group ${group}, named “${m[1]}”`, kind: "group" });
      } else if ((m = rest.match(/^\(\?(?:[=!]|<[=!])/))) {
        const what = {
          "(?=": "followed by",
          "(?!": "not followed by",
          "(?<=": "preceded by",
          "(?<!": "not preceded by",
        }[m[0]]!;
        open.push(`the “${what}” check`);
        i += m[0].length;
        push({ text: m[0], description: `only if ${what} (lookaround, not part of the match)`, kind: "group" });
      } else if ((m = rest.match(/^\(\?[a-z-]*:/))) {
        open.push("the group");
        i += m[0].length;
        push({
          text: m[0],
          description: m[0] === "(?:"
            ? "start of a group that doesn't capture"
            : `start of a group with flags ${m[0].slice(2, -1)}`,
          kind: "group",
        });
      } else {
        group++;
        open.push(`group ${group}`);
        i++;
        push({ text: "(", description: `start of capture group ${group}`, kind: "group" });
      }
    } else if (c === ")") {
      i++;
      push({ text: ")", description: `end of ${open.pop() ?? "a group"}`, kind: "group" });
    } else if (c === "|") {
      i++;
      push({ text: "|", description: "or", kind: "alternation" });
    } else if (c === "^" || c === "$") {
      i++;
      const line = flags.includes("m");
      push({
        text: c,
        description: c === "^"
          ? (line ? "start of a line" : "start of the text")
          : line
          ? "end of a line"
          : "end of the text",
        kind: "anchor",
      });
    } else if (c === ".") {
      i++;
      push({
        text: ".",
        description: flags.includes("s") ? "any character" : "any character except a line break",
        kind: "escape",
      });
    } else {
      i++;
      push({ text: c, description: `the character “${c}”`, kind: "literal" });
    }
  }
  return tokens;
}

export const FLAGS: Record<string, string> = {
  g: "global: every match, not just the first",
  i: "ignore case",
  m: "multiline: ^ and $ match at line breaks",
  s: "dotAll: . matches line breaks too",
  u: "unicode: code points and \\p{…}",
  v: "unicodeSets: u with set operations in classes",
  y: "sticky: matches only at lastIndex",
  d: "indices: start and end of each group",
};

// ---------------------------------------------------------------------------
// Library

export interface Recipe {
  id: string;
  name: string;
  pattern: string;
  flags: string;
  description: string;
  examples: string;
  keywords?: string[];
}

export const LIBRARY: Recipe[] = [
  {
    id: "email",
    name: "Email address",
    pattern: String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`,
    flags: "g",
    description: "A practical address check, not the full RFC 5322 grammar",
    examples: "Write to ada@example.com or grace.hopper+navy@mail.example.org, not to @nobody.",
    keywords: ["mail", "courriel"],
  },
  {
    id: "url",
    name: "URL (http, https)",
    pattern: String.raw`https?:\/\/[\w-]+(?:\.[\w-]+)+(?::\d+)?(?:[/?#][^\s"'<>]*[^\s"'<>.,;:!?)]|[/?#])?`,
    flags: "gi",
    description: "Web links with an optional port, path, query and fragment",
    examples: "See https://deno.com/blog?tag=release#top and http://localhost.example:8080/api, not ftp://old.",
    keywords: ["link", "lien", "web"],
  },
  {
    id: "ipv4",
    name: "IPv4 address",
    pattern: String.raw`\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b`,
    flags: "g",
    description: "Four numbers from 0 to 255 separated by dots",
    examples: "Gateway 192.168.1.1, DNS 1.1.1.1, invalid 256.1.1.1",
    keywords: ["ip", "address", "adresse"],
  },
  {
    id: "ipv6",
    name: "IPv6 address",
    pattern: String
      .raw`(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,6}:[0-9A-Fa-f]{1,4}|(?:[0-9A-Fa-f]{1,4}:){1,5}(?::[0-9A-Fa-f]{1,4}){1,2}|(?:[0-9A-Fa-f]{1,4}:){1,4}(?::[0-9A-Fa-f]{1,4}){1,3}|(?:[0-9A-Fa-f]{1,4}:){1,3}(?::[0-9A-Fa-f]{1,4}){1,4}|(?:[0-9A-Fa-f]{1,4}:){1,2}(?::[0-9A-Fa-f]{1,4}){1,5}|[0-9A-Fa-f]{1,4}:(?::[0-9A-Fa-f]{1,4}){1,6}|(?:[0-9A-Fa-f]{1,4}:){1,7}:|:(?:(?::[0-9A-Fa-f]{1,4}){1,7}|:)`,
    flags: "g",
    description: "Full and compressed (::) forms, without zone IDs or embedded IPv4",
    examples: "2001:0db8:85a3:0000:0000:8a2e:0370:7334, fe80::1 and ::1",
    keywords: ["ip", "address", "adresse"],
  },
  {
    id: "uuid",
    name: "UUID",
    pattern: String.raw`\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b`,
    flags: "gi",
    description: "Versions 1 to 8 with the RFC 9562 variant",
    examples: "id=f47ac10b-58cc-4372-a567-0e02b2c3d479 and 01890a5d-ac96-774b-bcce-b302099a8057",
    keywords: ["guid", "identifier"],
  },
  {
    id: "date",
    name: "Date (ISO 8601)",
    pattern: String.raw`\b(?<year>\d{4})-(?<month>0[1-9]|1[0-2])-(?<day>0[1-9]|[12]\d|3[01])\b`,
    flags: "g",
    description: "YYYY-MM-DD, with year, month and day as named groups",
    examples: "Released 2026-10-28, patched 2026-11-02; 2026-13-01 is not a date.",
    keywords: ["iso", "yyyy-mm-dd"],
  },
  {
    id: "datetime",
    name: "Date and time (ISO 8601)",
    pattern: String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?`,
    flags: "g",
    description: "Timestamps like 2026-10-28T09:30:00Z or with an offset",
    examples: "created_at: 2026-10-28T09:30:00Z, updated_at: 2026-10-28T11:45:12.250+02:00",
    keywords: ["timestamp", "iso", "rfc3339"],
  },
  {
    id: "time",
    name: "Time (24-hour)",
    pattern: String.raw`\b(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\b`,
    flags: "g",
    description: "HH:MM or HH:MM:SS",
    examples: "Opens 08:30, closes 18:00:00; 24:00 is not valid.",
    keywords: ["hour", "heure"],
  },
  {
    id: "semver",
    name: "Semantic version",
    pattern: String
      .raw`\bv?(?<major>0|[1-9]\d*)\.(?<minor>0|[1-9]\d*)\.(?<patch>0|[1-9]\d*)(?:-(?<pre>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+(?<build>[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?\b`,
    flags: "g",
    description: "MAJOR.MINOR.PATCH with optional pre-release and build metadata",
    examples: "Upgrade from v1.4.2 to 2.0.0-rc.1+build.42",
    keywords: ["version", "semver"],
  },
  {
    id: "hex",
    name: "Hex color",
    pattern: String.raw`#(?:[0-9a-fA-F]{3,4}){1,2}\b`,
    flags: "g",
    description: "#rgb, #rgba, #rrggbb and #rrggbbaa",
    examples: "color: #fff; background: #1e1e2e; border: #ff000080;",
    keywords: ["colour", "couleur", "css"],
  },
  {
    id: "mac",
    name: "MAC address",
    pattern: String.raw`\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b`,
    flags: "g",
    description: "Six hex pairs separated by colons or dashes",
    examples: "eth0 at 3c:52:82:4f:aa:01, wlan0 at 3C-52-82-4F-AA-02",
    keywords: ["ethernet", "hardware"],
  },
  {
    id: "domain",
    name: "Domain name",
    pattern: String.raw`\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}\b`,
    flags: "gi",
    description: "Host names with at least one dot",
    examples: "Point api.example.com and www.backslash.dev at the new server.",
    keywords: ["host", "hostname", "domaine"],
  },
  {
    id: "phone",
    name: "Phone number (E.164)",
    pattern: String.raw`\+[1-9]\d{6,14}\b`,
    flags: "g",
    description: "International format: + and up to 15 digits",
    examples: "Call +33612345678 or +14155550123.",
    keywords: ["telephone", "téléphone"],
  },
  {
    id: "number",
    name: "Number",
    pattern: String.raw`[-+]?\d+(?:[.,]\d+)?`,
    flags: "g",
    description: "Integers and decimals, with a dot or a comma",
    examples: "Total: 42 items, -3.5 °C, 12,75 €",
    keywords: ["integer", "decimal", "nombre"],
  },
  {
    id: "slug",
    name: "Slug",
    pattern: String.raw`^[a-z0-9]+(?:-[a-z0-9]+)*$`,
    flags: "gm",
    description: "Lowercase words joined by dashes, one per line",
    examples: "hello-world\nHello World\nmy-post-2026",
    keywords: ["url", "permalink"],
  },
  {
    id: "password",
    name: "Strong password",
    pattern: String.raw`^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{12,}$`,
    flags: "gm",
    description: "12+ characters with lower and upper case, a digit and a symbol (lookaheads)",
    examples: "password123\nCorrect-Horse-42!\nShort1!",
    keywords: ["mot de passe", "lookahead"],
  },
  {
    id: "duplicate",
    name: "Repeated word",
    pattern: String.raw`\b(\w+)\s+\1\b`,
    flags: "gi",
    description: "The same word twice in a row (a back-reference)",
    examples: "This is is a test of the the regex.",
    keywords: ["typo", "doublon"],
  },
  {
    id: "html",
    name: "HTML tag",
    pattern: String.raw`<\/?(?<tag>[a-z][a-z0-9-]*)\b[^>]*>`,
    flags: "gi",
    description: "Opening and closing tags, with the tag name as a group",
    examples: '<p class="lead">Hello <strong>world</strong></p>',
    keywords: ["xml", "markup"],
  },
  {
    id: "markdown-link",
    name: "Markdown link",
    pattern: String.raw`\[(?<label>[^\]]+)\]\((?<url>[^)\s]+)\)`,
    flags: "g",
    description: "[label](url), with both parts as groups",
    examples: "Read the [guide](https://example.com/guide) and the [FAQ](/faq).",
    keywords: ["md"],
  },
  {
    id: "env",
    name: "Environment variable line",
    pattern: String.raw`^(?<name>[A-Z_][A-Z0-9_]*)=(?<value>.*)$`,
    flags: "gm",
    description: "NAME=value lines of a .env file",
    examples: "DATABASE_URL=postgres://localhost/app\n# comment\nDEBUG=true",
    keywords: ["dotenv", ".env"],
  },
  {
    id: "sha",
    name: "Git commit hash",
    pattern: String.raw`\b[0-9a-f]{7,40}\b`,
    flags: "g",
    description: "Short or full SHA-1 hashes",
    examples: "Fixed in 3f2a9c1, reverted by 9b8e7d6c5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d",
    keywords: ["git", "commit", "sha1"],
  },
  {
    id: "jwt",
    name: "JSON Web Token",
    pattern: String.raw`eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+`,
    flags: "g",
    description: "Header, payload and signature in base64url",
    examples: "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.abc123-_xyz",
    keywords: ["token", "bearer"],
  },
  {
    id: "trim",
    name: "Leading and trailing spaces",
    pattern: String.raw`^\s+|\s+$`,
    flags: "gm",
    description: "Whitespace at the start or end of each line",
    examples: "   indented line\ntrailing spaces   ",
    keywords: ["whitespace", "espace"],
  },
];

export const SAMPLE_TEXT = [
  "Ada Lovelace <ada@example.com> released v1.2.0 on 2026-10-28 at 09:30.",
  "Server 192.168.1.20 answered https://status.example.com/api?check=1 with #2ecc71.",
  "Request f47ac10b-58cc-4372-a567-0e02b2c3d479 took 42 ms.",
].join("\n");
