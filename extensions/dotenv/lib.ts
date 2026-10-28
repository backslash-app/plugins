// Parsing .env files, comparing them with their example, and the folder scan rules. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Parsing

export type Quote = "" | '"' | "'" | "`";

export interface Entry {
  key: string;
  /** The value as the program reads it, before `${VAR}` expansion: quotes removed, escapes applied. */
  value: string;
  quote: Quote;
  /** Written `export KEY=…`. */
  exported: boolean;
  /** 1-based line of the key. */
  line: number;
  /** Lines the value spans (1 unless a quoted value goes on). */
  lines: number;
  /** The text of the assignment as written, every line of it. */
  raw: string;
  /** `# comment` after an unquoted or closed value. */
  comment?: string;
  /** Variables it references with `$VAR`, `${VAR}` or `${VAR:-default}` (not in single quotes). */
  refs: string[];
}

export interface Issue {
  line: number;
  message: string;
}

export interface EnvFile {
  entries: Entry[];
  issues: Issue[];
}

const KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
/** `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`; `\$` is not a reference. */
const REF = /(\\?)\$(?:\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-=+?])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g;

/** The variables a value references. */
export function references(value: string): string[] {
  const refs: string[] = [];
  for (const m of value.matchAll(REF)) {
    if (m[1]) continue;
    const name = m[2] ?? m[5];
    if (!refs.includes(name)) refs.push(name);
  }
  return refs;
}

function unescapeDouble(s: string): string {
  return s.replace(
    /\\([nrt"\\])/g,
    (_m, c: string) => ({ n: "\n", r: "\r", t: "\t" } as Record<string, string>)[c] ?? c,
  );
}

/**
 * Parses a .env file the way the dotenv libraries (Node dotenv, python-dotenv,
 * godotenv, Docker Compose) agree on: `KEY=value`, optional `export`, `#`
 * comments, single quotes literal, double quotes with `\n` escapes, quoted
 * values over several lines, and `${VAR}` references kept for expansion.
 */
export function parseEnv(text: string): EnvFile {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const entries: Entry[] = [];
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const m = trimmed.match(/^(export\s+)?([^=\s:]+)\s*[=:]\s?(.*)$/s);
    // `KEY: value` is YAML-style; dotenv reads it, most tools don't: accept `=` and `:` alike.
    if (!m || !KEY.test(m[2])) {
      if (/^export\s+[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed)) continue; // `export KEY` alone exports a shell variable
      issues.push({ line: i + 1, message: `Not a KEY=value line: ${trimmed.slice(0, 60)}` });
      continue;
    }
    const exported = !!m[1];
    const key = m[2];
    let rest = m[3].trimStart();
    let quote: Quote = "";
    let value: string;
    let comment: string | undefined;
    const start = i;
    const q = rest[0];
    if (q === '"' || q === "'" || q === "`") {
      quote = q as Quote;
      // Find the closing quote, on this line or a following one.
      let body = rest.slice(1);
      let close = closingQuote(body, quote);
      while (close === -1 && i + 1 < lines.length) {
        i++;
        body += "\n" + lines[i];
        close = closingQuote(body, quote);
      }
      if (close === -1) {
        issues.push({ line: start + 1, message: `${key}: the ${quote} quote is never closed` });
        i = start; // read the rest of the file normally
        value = rest.slice(1);
      } else {
        value = body.slice(0, close);
        const after = body.slice(close + 1).trim();
        if (after.startsWith("#")) comment = after.slice(1).trim();
        else if (after) issues.push({ line: i + 1, message: `${key}: unexpected text after the closing quote` });
      }
      if (quote === '"') value = unescapeDouble(value);
      rest = "";
    } else {
      // Unquoted: an inline comment starts at " #".
      const hash = rest.search(/\s#/);
      if (hash !== -1) {
        comment = rest.slice(hash).trim().slice(1).trim();
        rest = rest.slice(0, hash);
      } else if (rest.startsWith("#")) {
        comment = rest.slice(1).trim();
        rest = "";
      }
      value = rest.trim();
    }
    const entry: Entry = {
      key,
      value,
      quote,
      exported,
      line: start + 1,
      lines: i - start + 1,
      raw: lines.slice(start, i + 1).join("\n"),
      refs: quote === "'" || quote === "`" ? [] : references(value),
    };
    if (comment) entry.comment = comment;
    const dup = seen.get(key);
    if (dup !== undefined) {
      issues.push({
        line: start + 1,
        message: `${key} is set again (first on line ${entries[dup].line}): this one wins`,
      });
      entries[dup] = entry; // the last assignment is the one programs see
    } else {
      seen.set(key, entries.length);
      entries.push(entry);
    }
  }
  return { entries, issues };
}

/** Index of the unescaped closing quote in `s`, or -1. */
function closingQuote(s: string, quote: Quote): number {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && quote === '"') i++;
    else if (s[i] === quote) return i;
  }
  return -1;
}

/**
 * Values with their `${VAR}` references expanded from the file itself
 * (as dotenv-expand does). Unknown references are left as written; the
 * default of `${VAR:-default}` is used when VAR is unset or empty.
 */
export function expand(entries: Entry[]): Map<string, { value: string; unresolved: string[] }> {
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const done = new Map<string, { value: string; unresolved: string[] }>();
  const resolve = (key: string, stack: string[]): { value: string; unresolved: string[] } => {
    const cached = done.get(key);
    if (cached) return cached;
    const e = byKey.get(key)!;
    if (e.quote === "'" || e.quote === "`" || !e.value.includes("$")) {
      const plain = { value: e.value, unresolved: [] };
      done.set(key, plain);
      return plain;
    }
    const unresolved: string[] = [];
    const value = e.value.replace(
      REF,
      (all, esc: string, braced?: string, op?: string, def?: string, bare?: string) => {
        if (esc) return all.slice(1);
        const name = (braced ?? bare)!;
        let found: string | undefined;
        if (byKey.has(name) && !stack.includes(name)) {
          const r = resolve(name, [...stack, name]);
          unresolved.push(...r.unresolved.filter((u) => !unresolved.includes(u)));
          found = r.value;
        }
        if (op === ":-" || op === ":=") return found ? found : def ?? "";
        if (op === "-" || op === "=") return found !== undefined ? found : def ?? "";
        if (op === ":+" || op === "+") return found ? def ?? "" : "";
        if (found === undefined) {
          if (!unresolved.includes(name)) unresolved.push(name);
          return all;
        }
        return found;
      },
    );
    const r = { value: value.replace(/\\\$(?![A-Za-z_{])/g, "$"), unresolved };
    done.set(key, r);
    return r;
  };
  for (const e of entries) resolve(e.key, [e.key]);
  return done;
}

// ---------------------------------------------------------------------------
// Showing values

/** Never shows the value: its length, roughly, so an empty or a one-character value stands out. */
export function mask(value: string): string {
  if (!value) return "(empty)";
  return "•".repeat(Math.min(12, Math.max(4, value.length)));
}

/** A value for a shell: `'it'\''s'`. */
export function shellQuote(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** `export KEY='value'` lines, values expanded, ready to paste in a shell. */
export function exportLines(entries: Entry[]): string {
  const values = expand(entries);
  return entries.map((e) => `export ${e.key}=${shellQuote(values.get(e.key)?.value ?? e.value)}`).join("\n");
}

/** `KEY=value` written back with the quoting it needs. */
export function assignment(key: string, value: string): string {
  if (/^[\w@%+=:,./-]*$/.test(value)) return `${key}=${value}`;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
  return `${key}="${escaped}"`;
}

/** What a value looks like, for the row: quoted, multi-line, references… */
export function describe(e: Entry): string[] {
  const tags: string[] = [];
  if (e.exported) tags.push("export");
  if (e.lines > 1 || e.value.includes("\n")) tags.push("multi-line");
  if (e.refs.length) tags.push(`uses ${e.refs.slice(0, 2).join(", ")}${e.refs.length > 2 ? "…" : ""}`);
  return tags;
}

// ---------------------------------------------------------------------------
// Files and their example

/** Templates committed to the repository, listing the keys a .env needs. */
export const EXAMPLE_NAMES = [".env.example", ".env.sample", ".env.template", ".env.dist", ".env.defaults"];

/** `.env`, `.env.local`, `.env.production`…, but not `.envrc` (a direnv script) or `.env.vault` (encrypted). */
export function isEnvFile(name: string): boolean {
  if (name === ".env") return true;
  if (!name.startsWith(".env.")) return false;
  return !/^\.env\.(vault|swp|bak|orig|lock)$|~$/.test(name);
}

export const isExample = (name: string) => EXAMPLE_NAMES.includes(name);

/** The example file of a folder, in order of preference. */
export function exampleOf(names: string[]): string | undefined {
  return EXAMPLE_NAMES.find((n) => names.includes(n));
}

/** Keys of the example missing from the file, in the example's order. */
export function missingKeys(file: Entry[], example: Entry[]): string[] {
  const have = new Set(file.map((e) => e.key));
  return example.map((e) => e.key).filter((k) => !have.has(k));
}

/** Keys of the file that the example doesn't list. */
export function extraKeys(file: Entry[], example: Entry[]): string[] {
  const listed = new Set(example.map((e) => e.key));
  return file.map((e) => e.key).filter((k) => !listed.has(k));
}

/**
 * The file's text with the missing keys appended, as the example writes them
 * (its placeholder values), under a comment saying where they come from.
 */
export function appendMissing(text: string, missing: Entry[], exampleName: string, date: string): string {
  if (!missing.length) return text;
  const lines = missing.map((e) => e.raw.trim());
  const sep = !text ? "" : text.endsWith("\n\n") ? "" : text.endsWith("\n") ? "\n" : "\n\n";
  return `${text}${sep}# Added from ${exampleName} on ${date}\n${lines.join("\n")}\n`;
}

/** Order in a folder: `.env` first, then the others by name, examples last. */
export function compareFiles(a: string, b: string): number {
  const rank = (n: string) => n === ".env" ? 0 : isExample(n) ? 2 : 1;
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** What a file is for, from its name: "local overrides", "production"… */
export function purpose(name: string): string | undefined {
  if (name === ".env") return "Default";
  if (isExample(name)) return "Example";
  const suffix = name.slice(5).toLowerCase();
  const parts = suffix.split(".");
  const env: Record<string, string> = {
    local: "Local overrides",
    development: "Development",
    dev: "Development",
    production: "Production",
    prod: "Production",
    staging: "Staging",
    test: "Test",
    testing: "Test",
    ci: "CI",
    docker: "Docker",
    keys: "Decryption keys",
  };
  const words = parts.map((p) => env[p] ?? p);
  if (parts.length === 2 && parts[1] === "local") return `${env[parts[0]] ?? parts[0]}, local overrides`;
  return words.join(", ");
}

// ---------------------------------------------------------------------------
// Folders

export const DEFAULT_FOLDERS =
  "~/Projects, ~/projects, ~/code, ~/Code, ~/src, ~/dev, ~/git, ~/repos, ~/workspace, ~/work";

/** The folders preference: commas, colons or new lines; `~` expanded; duplicates dropped. */
export function parseFolders(pref: string | undefined, home: string): string[] {
  const raw = (pref?.trim() || DEFAULT_FOLDERS).split(/[,:\n]/).map((f) => f.trim()).filter(Boolean);
  const expanded = raw.map((f) => f.replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/");
  return [...new Set(expanded)].filter((f) => f.startsWith("/"));
}

/** Folders never worth descending into. */
export const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  "out",
  "venv",
  ".venv",
  "__pycache__",
  ".git",
  ".hg",
  ".svn",
  ".next",
  ".nuxt",
  ".cache",
  ".terraform",
  "coverage",
]);

/** `/home/me/Projects/app` → `~/Projects/app`. */
export const tilde = (path: string, home: string) =>
  home && (path === home || path.startsWith(`${home}/`)) ? `~${path.slice(home.length)}` : path;

/** "today", "3d", "2mo", "1y". */
export function age(ms: number, now: number): string {
  const days = Math.floor((now - ms) / 86_400_000);
  if (days < 1) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}
