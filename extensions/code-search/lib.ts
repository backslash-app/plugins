// Public code search: grep.app (default) and Sourcegraph. Query syntax, answers, and snippets.

// ---------------------------------------------------------------------------
// Query

export interface Query {
  /** What to look for, without the filters. */
  pattern: string;
  regexp: boolean;
  caseSensitive: boolean;
  /** Whole words only (grep.app). */
  words: boolean;
  languages: string[];
  repos: string[];
  paths: string[];
}

/** Canonical language names, as both engines spell them. */
const LANGUAGES: Record<string, string> = {
  rust: "Rust",
  rs: "Rust",
  go: "Go",
  golang: "Go",
  python: "Python",
  py: "Python",
  js: "JavaScript",
  javascript: "JavaScript",
  ts: "TypeScript",
  typescript: "TypeScript",
  tsx: "TSX",
  jsx: "JavaScript",
  java: "Java",
  kotlin: "Kotlin",
  kt: "Kotlin",
  c: "C",
  "c++": "C++",
  cpp: "C++",
  cxx: "C++",
  "c#": "C#",
  csharp: "C#",
  cs: "C#",
  ruby: "Ruby",
  rb: "Ruby",
  php: "PHP",
  swift: "Swift",
  scala: "Scala",
  shell: "Shell",
  sh: "Shell",
  bash: "Shell",
  zig: "Zig",
  nix: "Nix",
  lua: "Lua",
  elixir: "Elixir",
  ex: "Elixir",
  haskell: "Haskell",
  hs: "Haskell",
  ocaml: "OCaml",
  dart: "Dart",
  html: "HTML",
  css: "CSS",
  scss: "SCSS",
  vue: "Vue",
  svelte: "Svelte",
  markdown: "Markdown",
  md: "Markdown",
  yaml: "YAML",
  yml: "YAML",
  json: "JSON",
  toml: "TOML",
  dockerfile: "Dockerfile",
  docker: "Dockerfile",
  makefile: "Makefile",
  make: "Makefile",
  sql: "SQL",
  r: "R",
  julia: "Julia",
  perl: "Perl",
  erlang: "Erlang",
  clojure: "Clojure",
  terraform: "HCL",
  hcl: "HCL",
  proto: "Protocol Buffer",
  protobuf: "Protocol Buffer",
};

export const languageName = (text: string) => LANGUAGES[text.toLowerCase()] ?? text;

const unquote = (s: string) => /^"(.*)"$/.test(s) ? s.slice(1, -1).replace(/\\"/g, '"') : s;

/**
 * `useState lang:ts repo:facebook/react`, `/fn \w+_test/ lang:rust`, `"exact phrase" path:src/ case:yes`.
 * Filters can be anywhere; `-` before nothing else is part of the pattern.
 */
export function parseQuery(text: string): Query {
  const q: Query = {
    pattern: "",
    regexp: false,
    caseSensitive: false,
    words: false,
    languages: [],
    repos: [],
    paths: [],
  };
  const rest: string[] = [];
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
  for (const token of tokens) {
    const m = /^(lang|language|repo|r|path|file|f|case|regex|regexp|words|word):(.+)$/i.exec(token);
    if (!m) {
      rest.push(token);
      continue;
    }
    const key = m[1].toLowerCase();
    const value = unquote(m[2]);
    if (key === "lang" || key === "language") q.languages.push(...value.split(",").filter(Boolean).map(languageName));
    else if (key === "repo" || key === "r") q.repos.push(value.replace(/^(https?:\/\/)?(www\.)?github\.com\//, ""));
    else if (key === "path" || key === "file" || key === "f") q.paths.push(value);
    else if (key === "case") q.caseSensitive = /^(yes|y|true|on|1)$/i.test(value);
    else if (key === "regex" || key === "regexp") q.regexp = /^(yes|y|true|on|1)$/i.test(value);
    else q.words = /^(yes|y|true|on|1)$/i.test(value);
  }
  let pattern = rest.join(" ");
  const slashed = /^\/(.+)\/(i?)$/.exec(pattern);
  if (slashed) {
    q.regexp = true;
    pattern = slashed[1];
    if (slashed[2]) q.caseSensitive = false;
  } else if (rest.length === 1) pattern = unquote(pattern);
  q.pattern = pattern;
  return q;
}

/** The query in words, for the status line: `"useState" in TypeScript, facebook/react`. */
export function describeQuery(q: Query): string {
  const parts = [q.regexp ? `/${q.pattern}/` : `“${q.pattern}”`];
  if (q.languages.length) parts.push(`in ${q.languages.join(", ")}`);
  if (q.repos.length) parts.push(`repo ${q.repos.join(", ")}`);
  if (q.paths.length) parts.push(`path ${q.paths.join(", ")}`);
  if (q.caseSensitive) parts.push("case-sensitive");
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// Results, whichever engine

export interface Line {
  /** 1-based. */
  number: number;
  text: string;
  /** Has a match. */
  match: boolean;
}

export interface Hit {
  engine: "grep.app" | "Sourcegraph";
  /** `owner/name` for GitHub, else the full host/path. */
  repo: string;
  /** Where the code is hosted: `github.com`, `gitlab.com`… */
  host: string;
  path: string;
  /** Branch (grep.app) or commit (Sourcegraph). */
  ref: string;
  /** A full commit hash: links are permanent. */
  commit?: string;
  lines: Line[];
  matches: number;
  language?: string;
  stars?: number;
}

export interface Results {
  hits: Hit[];
  /** How many files match in all (grep.app's estimate, Sourcegraph's count). */
  total?: number;
  /** Top languages and repositories. */
  languages: { name: string; count: number }[];
  repos: { name: string; count: number }[];
  /** Sourcegraph's alerts and grep.app's errors. */
  notes: string[];
}

export const firstMatch = (h: Hit) => h.lines.find((l) => l.match)?.number ?? h.lines[0]?.number;

/** The file's page on its forge, at its first matching line. */
export function fileUrl(h: Hit, line: number | null = firstMatch(h) ?? null): string {
  const path = h.path.split("/").map(encodeURIComponent).join("/");
  const ref = encodeURIComponent(h.commit ?? h.ref);
  if (h.host === "github.com") return `https://github.com/${h.repo}/blob/${ref}/${path}${line ? `#L${line}` : ""}`;
  if (h.host === "gitlab.com") return `https://gitlab.com/${h.repo}/-/blob/${ref}/${path}${line ? `#L${line}` : ""}`;
  if (h.host === "codeberg.org") {
    return `https://codeberg.org/${h.repo}/src/commit/${ref}/${path}${line ? `#L${line}` : ""}`;
  }
  return sourcegraphFileUrl(h, line);
}

/** With the lines of the snippet: `#L40-L46`. */
export function rangeUrl(h: Hit): string {
  const base = fileUrl(h, null);
  const nums = h.lines.map((l) => l.number);
  if (!nums.length) return base;
  const [a, b] = [Math.min(...nums), Math.max(...nums)];
  if (h.host === "github.com") return `${base}#L${a}${b > a ? `-L${b}` : ""}`;
  return `${base}#L${a}${b > a ? `-${b}` : ""}`;
}

export function sourcegraphFileUrl(h: Hit, line: number | null = firstMatch(h) ?? null): string {
  const repo = h.host ? `${h.host}/${h.repo}` : h.repo;
  const rev = h.commit ?? h.ref;
  return `https://sourcegraph.com/${repo}${rev ? `@${rev}` : ""}/-/blob/${h.path}${line ? `?L${line}` : ""}`;
}

export const repoUrl = (h: Hit) => h.host ? `https://${h.host}/${h.repo}` : `https://sourcegraph.com/${h.repo}`;

const EXTENSIONS: Record<string, string> = {
  rs: "rust",
  go: "go",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  java: "java",
  kt: "kotlin",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  lua: "lua",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  ml: "ocaml",
  dart: "dart",
  html: "html",
  css: "css",
  scss: "scss",
  vue: "vue",
  svelte: "svelte",
  md: "markdown",
  yml: "yaml",
  yaml: "yaml",
  json: "json",
  toml: "toml",
  sql: "sql",
  nix: "nix",
  zig: "zig",
  tf: "hcl",
};

/** The code fence language for a path. */
export function fenceLanguage(path: string): string {
  const name = path.split("/").pop() ?? "";
  if (/^Dockerfile/i.test(name)) return "dockerfile";
  if (/^Makefile$/i.test(name)) return "makefile";
  return EXTENSIONS[name.split(".").pop()?.toLowerCase() ?? ""] ?? "";
}

/** A language name for display when the engine doesn't say. */
export function languageOf(h: Hit): string {
  if (h.language) return h.language;
  const fence = fenceLanguage(h.path);
  const byFence: Record<string, string> = {
    cpp: "C++",
    csharp: "C#",
    javascript: "JavaScript",
    typescript: "TypeScript",
    tsx: "TSX",
  };
  return byFence[fence] ?? (fence ? fence[0].toUpperCase() + fence.slice(1) : "");
}

/** The snippet's lines, as copied: no numbers, `…` between distant parts. */
export function snippetText(h: Hit): string {
  const out: string[] = [];
  h.lines.forEach((l, i) => {
    if (i && l.number > h.lines[i - 1].number + 1) out.push("…");
    out.push(l.text);
  });
  return out.join("\n");
}

/** The snippet as a markdown code block with line numbers, matching lines marked with ▶. */
export function snippetMarkdown(h: Hit): string {
  const width = String(Math.max(0, ...h.lines.map((l) => l.number))).length;
  const body: string[] = [];
  h.lines.forEach((l, i) => {
    if (i && l.number > h.lines[i - 1].number + 1) body.push(`${" ".repeat(width)}  ⋮`);
    body.push(`${String(l.number).padStart(width)}${l.match ? "▶" : " "} ${l.text}`.trimEnd());
  });
  const text = body.join("\n");
  const ticks = "`".repeat(Math.max(3, ...[...text.matchAll(/`{3,}/g)].map((m) => m[0].length + 1)));
  return `${ticks}${fenceLanguage(h.path)}\n${text}\n${ticks}`;
}

// ---------------------------------------------------------------------------
// grep.app

export const GREP_APP = "https://grep.app";

/** `GET /api/search` parameters for a query and page. */
export function grepAppParams(q: Query, page = 1): URLSearchParams {
  const p = new URLSearchParams({ q: q.pattern, page: String(page) });
  if (q.regexp) p.set("regexp", "true");
  if (q.caseSensitive) p.set("case", "true");
  if (q.words) p.set("words", "true");
  for (const l of q.languages) p.append("f.lang", l);
  for (const r of q.repos) p.append(r.includes("/") ? "f.repo" : "f.repo.pattern", r.includes("/") ? r : `${r}/`);
  for (const path of q.paths) p.append("f.path.pattern", path);
  return p;
}

/** The grep.app search page for the same query. */
export function grepAppWebUrl(q: Query): string {
  const p = new URLSearchParams({ q: q.pattern });
  if (q.regexp) p.set("regexp", "true");
  if (q.caseSensitive) p.set("case", "true");
  if (q.words) p.set("words", "true");
  q.languages.forEach((l, i) => p.set(`filter[lang][${i}]`, l));
  q.repos.forEach((r, i) => p.set(`filter[repo][${i}]`, r));
  q.paths.forEach((path, i) => p.set(`filter[path][${i}]`, path));
  return `${GREP_APP}/search?${p}`;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

const stripTags = (html: string) => decodeEntities(html.replace(/<[^>]*>/g, ""));

/**
 * grep.app's highlighted snippet, a table of rows
 * `<tr data-line="12"><td><div class="lineno">12</div></td><td><div class="highlight"><pre>…<mark>x</mark>…</pre></div></td></tr>`.
 */
export function parseSnippet(html: string): Line[] {
  const rows = [...html.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi)];
  if (!rows.length) {
    return stripTags(html).split("\n").map((text, i) => ({ number: i + 1, text, match: /<mark\b/i.test(html) }));
  }
  const lines: Line[] = [];
  for (const [, attrs, inner] of rows) {
    const n = /data-line="(\d+)"/.exec(attrs)?.[1] ?? /class="lineno"[^>]*>\s*(\d+)/.exec(inner)?.[1];
    const pre = /<pre\b[^>]*>([\s\S]*?)<\/pre>/i.exec(inner)?.[1];
    if (!n || pre === undefined) continue;
    lines.push({ number: Number(n), text: stripTags(pre).replace(/\n$/, ""), match: /<mark\b/i.test(pre) });
  }
  return lines;
}

const raw = (v: unknown): string => {
  if (v && typeof v === "object" && "raw" in v) return String((v as { raw: unknown }).raw ?? "");
  return v === undefined || v === null ? "" : String(v);
};

interface GrepAppBucket {
  val: string;
  count: number;
}

export interface GrepAppAnswer {
  time?: number;
  facets?: {
    count?: number;
    lang?: { buckets?: GrepAppBucket[] };
    repo?: { buckets?: GrepAppBucket[] };
  };
  hits?: {
    total?: number;
    hits?: {
      repo: unknown;
      branch?: unknown;
      path: unknown;
      total_matches?: unknown;
      content?: { snippet?: string };
    }[];
  };
  error?: string;
}

export function parseGrepApp(answer: GrepAppAnswer): Results {
  const hits: Hit[] = (answer.hits?.hits ?? []).map((h) => {
    const lines = parseSnippet(h.content?.snippet ?? "");
    return {
      engine: "grep.app",
      repo: raw(h.repo),
      host: "github.com",
      path: raw(h.path),
      ref: raw(h.branch) || "HEAD",
      lines,
      matches: Number(raw(h.total_matches)) || lines.filter((l) => l.match).length,
    };
  });
  const buckets = (b?: { buckets?: GrepAppBucket[] }) =>
    (b?.buckets ?? []).map((x) => ({ name: x.val, count: x.count }));
  return {
    hits,
    total: answer.hits?.total,
    languages: buckets(answer.facets?.lang),
    repos: buckets(answer.facets?.repo),
    notes: answer.error ? [answer.error] : [],
  };
}

// ---------------------------------------------------------------------------
// Sourcegraph

export const SOURCEGRAPH = "https://sourcegraph.com";

/** The query in Sourcegraph's syntax. */
export function sourcegraphQuery(q: Query, count = 40): string {
  const quote = (s: string) => /[\s"]/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
  const parts = [
    ...q.repos.map((r) => `repo:${quote(r.includes("/") && !/^[\w.-]+\.\w+\//.test(r) ? `github.com/${r}` : r)}`),
    ...q.languages.map((l) => `lang:${quote(l)}`),
    ...q.paths.map((p) => `file:${quote(p)}`),
    ...(q.caseSensitive ? ["case:yes"] : []),
    `count:${count}`,
    q.regexp ? `/${q.pattern}/` : q.pattern.includes(" ") ? quote(q.pattern) : q.pattern,
  ];
  return parts.join(" ");
}

export function sourcegraphStreamUrl(q: Query, count = 40): string {
  const p = new URLSearchParams({
    q: sourcegraphQuery(q, count),
    v: "V3",
    t: q.regexp ? "regexp" : "keyword",
    display: String(count),
    cm: "t",
  });
  return `${SOURCEGRAPH}/.api/search/stream?${p}`;
}

export function sourcegraphWebUrl(q: Query): string {
  const p = new URLSearchParams({
    q: sourcegraphQuery(q).replace(/\s*count:\d+/, ""),
    patternType: q.regexp ? "regexp" : "keyword",
  });
  return `${SOURCEGRAPH}/search?${p}`;
}

export interface SseEvent {
  event: string;
  data: string;
}

/** Server-sent events, as `text/event-stream` writes them. */
export function parseSse(text: string): SseEvent[] {
  const events: SseEvent[] = [];
  for (const block of text.replace(/\r\n/g, "\n").split(/\n\n+/)) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      const i = line.indexOf(":");
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? "" : line.slice(i + 1).replace(/^ /, "");
      if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    if (data.length) events.push({ event, data: data.join("\n") });
  }
  return events;
}

interface SgPosition {
  offset: number;
  line: number;
  column: number;
}

interface SgContentMatch {
  type: string;
  repository: string;
  repoStars?: number;
  path: string;
  branches?: string[];
  commit?: string;
  language?: string;
  chunkMatches?: { content: string; contentStart: SgPosition; ranges: { start: SgPosition; end: SgPosition }[] }[];
  lineMatches?: { line: string; lineNumber: number; offsetAndLengths: number[][] }[];
}

/** `github.com/owner/name` → host and repo. */
export function splitRepository(full: string): { host: string; repo: string } {
  const m = /^([\w.-]+\.[a-z]{2,})\/(.+)$/i.exec(full);
  return m ? { host: m[1], repo: m[2] } : { host: "", repo: full };
}

export function sourcegraphHit(m: SgContentMatch): Hit | undefined {
  if (m.type !== "content" && m.type !== "path") return undefined;
  const lines: Line[] = [];
  for (const chunk of m.chunkMatches ?? []) {
    const matched = new Set(chunk.ranges.flatMap((r) => {
      const out: number[] = [];
      for (let l = r.start.line; l <= r.end.line; l++) out.push(l);
      return out;
    }));
    chunk.content.replace(/\n$/, "").split("\n").forEach((text, i) => {
      const line = chunk.contentStart.line + i;
      lines.push({ number: line + 1, text, match: matched.has(line) });
    });
  }
  for (const lm of m.lineMatches ?? []) lines.push({ number: lm.lineNumber + 1, text: lm.line, match: true });
  lines.sort((a, b) => a.number - b.number);
  const unique = lines.filter((l, i) => i === 0 || l.number !== lines[i - 1].number);
  const { host, repo } = splitRepository(m.repository);
  const branch = m.branches?.find((b) => b) ?? "";
  return {
    engine: "Sourcegraph",
    repo,
    host,
    path: m.path,
    ref: branch || m.commit || "HEAD",
    ...(m.commit && /^[0-9a-f]{40}$/.test(m.commit) ? { commit: m.commit } : {}),
    lines: unique,
    matches: (m.chunkMatches ?? []).reduce((n, c) => n + c.ranges.length, 0) || (m.lineMatches?.length ?? 0),
    ...(m.language ? { language: m.language } : {}),
    ...(m.repoStars ? { stars: m.repoStars } : {}),
  };
}

/** The events of `/.api/search/stream` turned into results. */
export function parseSourcegraph(events: SseEvent[]): Results {
  const hits: Hit[] = [];
  const notes: string[] = [];
  let total: number | undefined;
  const langs = new Map<string, number>();
  const repos = new Map<string, number>();
  for (const e of events) {
    let data: unknown;
    try {
      data = JSON.parse(e.data);
    } catch {
      continue;
    }
    if (e.event === "matches" && Array.isArray(data)) {
      for (const m of data as SgContentMatch[]) {
        const hit = sourcegraphHit(m);
        if (hit) hits.push(hit);
      }
    } else if (e.event === "progress") {
      const p = data as { matchCount?: number };
      if (typeof p.matchCount === "number") total = p.matchCount;
    } else if (e.event === "filters" && Array.isArray(data)) {
      for (const f of data as { value: string; label: string; count: number; kind: string }[]) {
        if (f.kind === "lang") langs.set(f.label, f.count);
        if (f.kind === "repo") repos.set(f.label, f.count);
      }
    } else if (e.event === "alert") {
      const a = data as { title?: string; description?: string };
      notes.push([a.title, a.description].filter(Boolean).join(": "));
    } else if (e.event === "error") {
      notes.push((data as { message?: string }).message ?? "Sourcegraph reported an error");
    }
  }
  const top = (m: Map<string, number>) =>
    [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  return { hits, total, languages: top(langs), repos: top(repos), notes };
}

// ---------------------------------------------------------------------------
// Formatting

/** 1234 → "1.2k". */
export function compactNumber(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, "")}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}

/** "12.3k files · TypeScript 41%, JavaScript 22%". */
export function summary(r: Results): string {
  const parts: string[] = [];
  if (r.total !== undefined) parts.push(`${compactNumber(r.total)} file${r.total === 1 ? "" : "s"}`);
  const sum = r.languages.reduce((n, l) => n + l.count, 0);
  if (sum) {
    parts.push(
      r.languages.slice(0, 3).map((l) => `${l.name} ${Math.round((l.count / sum) * 100)}%`).join(", "),
    );
  }
  return parts.join(" · ");
}
