// DevDocs, tldr, Arch Wiki and man pages: parsing, ranking and markdown. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Ranking

/**
 * How well `name` matches `query` (lower is better), undefined when it does
 * not: exact, prefix, word start, substring, then letters in order.
 */
export function score(name: string, query: string): number | undefined {
  const n = name.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 0;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1 + n.length / 1000;
  const at = n.indexOf(q);
  if (at > 0 && /[\s.:#/_\-()<>[\]]/.test(n[at - 1])) return 2 + at / 100 + n.length / 1000;
  if (at > 0) return 3 + at / 100 + n.length / 1000;
  // Every word of the query somewhere in the name.
  const words = q.split(/\s+/);
  if (words.length > 1 && words.every((w) => n.includes(w))) return 4 + n.length / 1000;
  // Letters in order: "arrmap" → "Array.prototype.map".
  let i = 0;
  for (const c of n) if (c === q[i]) i++;
  return i === q.length && q.length >= 3 ? 5 + n.length / 1000 : undefined;
}

export function rank<T>(items: T[], query: string, key: (t: T) => string, limit = 50): T[] {
  return items
    .flatMap((t) => {
      const s = score(key(t), query);
      return s === undefined ? [] : [{ t, s }];
    })
    .sort((a, b) => a.s - b.s)
    .slice(0, limit)
    .map((x) => x.t);
}

// ---------------------------------------------------------------------------
// DevDocs

export interface Doc {
  name: string;
  slug: string;
  type?: string;
  version?: string;
  release?: string;
  mtime?: number;
  db_size?: number;
  links?: { home?: string; code?: string };
}

export interface Entry {
  name: string;
  path: string;
  type: string;
}

/** Fields of docs.json worth keeping in storage. */
export const compactDoc = (d: Doc): Doc => ({
  name: d.name,
  slug: d.slug,
  version: d.version || undefined,
  release: d.release || undefined,
  mtime: d.mtime,
  db_size: d.db_size,
  links: d.links?.home || d.links?.code ? { home: d.links.home, code: d.links.code } : undefined,
});

export const DEFAULT_DOCS = ["javascript", "typescript", "css", "html", "dom", "http", "node", "python", "bash", "git"];

/** Short names DevDocs users type: `js map`. */
export const ALIASES: Record<string, string> = {
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  cpp: "cpp",
  "c++": "cpp",
  k8s: "kubernetes",
  pg: "postgresql",
  postgres: "postgresql",
  tf: "terraform",
};

const base = (slug: string) => slug.split("~")[0];

/** "3.13" > "3.9", "22 LTS" > "20 LTS". */
export function compareVersions(a = "", b = ""): number {
  const pa = a.match(/\d+/g)?.map(Number) ?? [];
  const pb = b.match(/\d+/g)?.map(Number) ?? [];
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? -1) - (pb[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/**
 * Slugs for what the user asked: an exact slug (`python~3.12`), or a name
 * (`python`, `Python`) resolved to the newest version.
 */
export function resolveDocs(wanted: string[], docs: Doc[]): string[] {
  const out: string[] = [];
  for (const raw of wanted) {
    const w = ALIASES[raw.trim().toLowerCase()] ?? raw.trim().toLowerCase();
    if (!w) continue;
    const exact = docs.find((d) => d.slug.toLowerCase() === w);
    const named = docs
      .filter((d) => base(d.slug).toLowerCase() === w || d.name.toLowerCase() === w)
      // An unversioned slug is the current release; otherwise the highest version.
      .sort((a, b) =>
        Number(b.slug === base(b.slug)) - Number(a.slug === base(a.slug)) || compareVersions(b.version, a.version)
      );
    const hit = exact ?? named[0];
    if (hit && !out.includes(hit.slug)) out.push(hit.slug);
  }
  return out;
}

export const splitList = (text: string | undefined) => (text ?? "").split(/[\s,]+/).filter(Boolean);

/** `js map` with JavaScript enabled → search "map" in javascript only. */
export function scopeQuery(query: string, docs: Doc[]): { slug?: string; text: string } {
  const m = query.trim().match(/^(\S+)\s+(.+)$/);
  if (m) {
    const word = (ALIASES[m[1].toLowerCase()] ?? m[1].toLowerCase()).replace(/:$/, "");
    const doc = docs.find((d) => d.slug.toLowerCase() === word || base(d.slug).toLowerCase() === word);
    if (doc) return { slug: doc.slug, text: m[2] };
  }
  return { text: query.trim() };
}

export const devdocsUrl = (slug: string, path = "") => `https://devdocs.io/${slug}/${path}`;

export const docTitle = (d: Doc) => (d.version ? `${d.name} ${d.version}` : d.name);

/** 1536000 → "1.5 MB". */
export function size(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} kB`;
}

// ---------------------------------------------------------------------------
// tldr

export interface TldrCommand {
  name: string;
  platforms: string[];
}

/** tldr.sh/assets/index.json → names and platforms. */
export function parseTldrIndex(json: string): TldrCommand[] {
  return (JSON.parse(json).commands ?? []).map((c: any) => ({ name: c.name, platforms: c.platform ?? [] }));
}

export function platformOrder(os: string): string[] {
  const own = os === "darwin" ? "osx" : os === "windows" ? "windows" : os === "linux" ? "linux" : os;
  return [own, "common", "linux", "osx", "windows", "android", "freebsd", "netbsd", "openbsd", "sunos"]
    .filter((p, i, all) => all.indexOf(p) === i);
}

/** The best platform for a command: the user's own, else common, else any. */
export const bestPlatform = (c: TldrCommand, order: string[]) =>
  order.find((p) => c.platforms.includes(p)) ?? c.platforms[0] ?? "common";

/** `git commit` → `git-commit`. */
export const tldrName = (query: string) => query.trim().toLowerCase().replace(/\s+/g, "-");

export function tldrUrl(name: string, platform: string, language = "en"): string {
  const folder = language && language !== "en" ? `pages.${language}` : "pages";
  return `https://raw.githubusercontent.com/tldr-pages/tldr/main/${folder}/${platform}/${encodeURIComponent(name)}.md`;
}

export const tldrWebUrl = (name: string, platform: string) =>
  `https://github.com/tldr-pages/tldr/blob/main/pages/${platform}/${encodeURIComponent(name)}.md`;

export interface TldrPage {
  title: string;
  description: string[];
  more?: string;
  examples: { description: string; command: string }[];
}

/** `[c]reate` → `create` (mnemonic brackets of recent pages). */
const mnemonics = (text: string) => text.replace(/\[([A-Za-z0-9]{1,3})\]/g, "$1");

export function parseTldrPage(md: string): TldrPage {
  const page: TldrPage = { title: "", description: [], examples: [] };
  let pending: string | undefined;
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("# ")) page.title = line.slice(2).trim();
    else if (line.startsWith("> ")) {
      const text = line.slice(2).trim();
      const more = text.match(/^More information:\s*<(.+)>\.?$/i);
      if (more) page.more = more[1];
      else page.description.push(text);
    } else if (line.startsWith("- ")) pending = mnemonics(line.slice(2).replace(/:$/, "").trim());
    else if (line.startsWith("`") && line.endsWith("`") && pending !== undefined) {
      page.examples.push({ description: pending, command: line.slice(1, -1) });
      pending = undefined;
    }
  }
  return page;
}

/** `{{path/to/file}}` → `path/to/file`, `{{[-v|--verbose]}}` → `--verbose`: ready to edit. */
export function plainCommand(command: string): string {
  return command
    .replace(/\{\{\[([^|\]]+)\|([^\]]+)\]\}\}/g, "$2")
    .replace(/\{\{(.*?)\}\}/g, "$1");
}

/** Placeholders shown as `‹path/to/file›`, so they stand out in the code block. */
export const displayCommand = (command: string) =>
  command.replace(/\{\{\[([^|\]]+)\|([^\]]+)\]\}\}/g, "$2").replace(/\{\{(.*?)\}\}/g, "‹$1›");

export function tldrMarkdown(page: TldrPage): string {
  const out = [`# ${page.title}`, "", ...page.description.map(safeInline), ""];
  for (const ex of page.examples) {
    out.push(`**${safeInline(ex.description)}**`, "```sh", displayCommand(ex.command), "```", "");
  }
  return out.join("\n").trim();
}

// ---------------------------------------------------------------------------
// Arch Wiki

export interface WikiHit {
  title: string;
  snippet: string;
  words?: number;
  size?: number;
  timestamp?: string;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#039": "'" };

export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      if (ENTITIES[e]) return ENTITIES[e];
      if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
      if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
      return m;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** `action=query&list=search` (formatversion 2). */
export function parseWikiSearch(json: string): { total: number; hits: WikiHit[] } {
  const q = JSON.parse(json).query ?? {};
  return {
    total: q.searchinfo?.totalhits ?? 0,
    hits: (q.search ?? []).map((s: any) => ({
      title: s.title,
      snippet: stripHtml(s.snippet ?? ""),
      words: s.wordcount,
      size: s.size,
      timestamp: s.timestamp,
    })),
  };
}

export function wikiUrl(title: string, host = "wiki.archlinux.org"): string {
  const path = encodeURIComponent(title.replace(/ /g, "_")).replace(/%2F/g, "/").replace(/%3A/gi, ":");
  return `https://${host}/title/${path}`;
}

/** A wiki link's target: Wikipedia for `[[Wikipedia:…]]`, the wiki itself otherwise. */
function pageUrl(page: string, host: string): string {
  const wp = page.match(/^(?:wikipedia|w):(.+)$/i);
  if (wp) return `https://en.wikipedia.org/wiki/${encodeURIComponent(wp[1].replace(/ /g, "_"))}`;
  return wikiUrl(page, host);
}

/** Words holding `_` or `*` would toggle italics: shown as code instead. */
export function safeInline(text: string): string {
  return text.split(/(`[^`]*`)/).map((part, i) =>
    i % 2 ? part : part.replace(/[^\s`]*[_*][^\s`]*/g, (w) => /^\*\*.*\*\*$/.test(w) ? w : `\`${w}\``)
  ).join("");
}

/** Templates, innermost first: `{{ic|…}}`, `{{Note|…}}`, `{{Pkg|…}}`… */
function template(body: string): string {
  const [name, ...args] = body.split("|");
  const key = name.trim().toLowerCase();
  const arg = (i: number) => (args[i] ?? "").replace(/^\s*\d+=/, "").trim();
  switch (key) {
    case "ic":
    case "keypress":
      return `\`${args.join("|").replace(/^1=/, "")}\``;
    case "bc":
    case "hc":
      return `\n\`\`\`\n${args.join("|").replace(/^1=/, "").trim()}\n\`\`\`\n`;
    case "pkg":
    case "aur":
    case "grp":
      return `\`${arg(0)}\``;
    case "man":
      return `\`${arg(1)}(${arg(0)})\``;
    case "note":
    case "tip":
    case "warning":
      return `\n> \uE001${name.trim()}:\uE001 ${args.join("|")}\n`;
    case "app":
      return `\uE001${arg(0)}\uE001 — ${arg(1)}`;
    case "lang":
    case "lowercase title":
    case "related articles start":
    case "related articles end":
    case "related":
    case "out of date":
    case "accuracy":
    case "expansion":
    case "style":
    case "merge":
    case "move":
      return "";
    default:
      return args.length ? args[args.length - 1] : "";
  }
}

/** Arch Wiki wikitext → the launcher's markdown subset. */
export function wikitextToMarkdown(wikitext: string, host = "wiki.archlinux.org"): string {
  let text = wikitext.replace(/<!--[\s\S]*?-->/g, "").replace(/__\w+__/g, "");
  // Code first, so nothing inside is touched.
  const codes: string[] = [];
  const keep = (code: string) => `\uE000${codes.push(code) - 1}\uE000`;
  text = text.replace(
    /<(pre|syntaxhighlight)[^>]*>([\s\S]*?)<\/\1>/gi,
    (_, __, code) => keep(`\n\`\`\`\n${code.trim()}\n\`\`\`\n`),
  );
  text = text.replace(/<(code|kbd|tt)>([\s\S]*?)<\/\1>/gi, (_, __, code) => keep(`\`${code}\``));
  text = text.replace(
    /\{\{(ic|bc|hc)\|(?:1=)?([^{}]*(?:\{\{[^{}]*\}\}[^{}]*)*)\}\}/gi,
    (_, name, code) => keep(name.toLowerCase() === "ic" ? `\`${code}\`` : `\n\`\`\`\n${code.trim()}\n\`\`\`\n`),
  );
  for (let i = 0; i < 10 && /\{\{[^{}]*\}\}/.test(text); i++) {
    text = text.replace(/\{\{([^{}]*)\}\}/g, (_, body) => template(body));
  }
  text = text
    .replace(/\[\[(?:Category|[a-z]{2}(?:-[a-z]+)?|File|Image):[^\]]*\]\]\n?/g, "")
    // Links are kept whole: their URLs often hold underscores.
    .replace(
      /\[\[([^\]|#]*)(#[^\]|]*)?\|([^\]]+)\]\]/g,
      (_, page, _a, label) => page ? keep(`[${label}](${pageUrl(page, host)})`) : label,
    )
    .replace(/\[\[([^\]|#]+)(#[^\]]*)?\]\]/g, (_, page) => keep(`[${page}](${pageUrl(page, host)})`))
    .replace(/\[\[#([^\]]+)\]\]/g, "$1")
    .replace(/\[(https?:\/\/[^\s\]]+) ([^\]]+)\]/g, (_, url, label) => keep(`[${label}](${url})`))
    .replace(/\[(https?:\/\/[^\s\]]+)\]/g, (_, url) => keep(url))
    .replace(/'''(.+?)'''/g, "\uE001$1\uE001")
    .replace(/''(.+?)''/g, "\uE002$1\uE002")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/&nbsp;/g, " ");
  const out: string[] = [];
  let pre: string[] = [];
  const flush = () => {
    if (pre.length) out.push("```", ...pre, "```");
    pre = [];
  };
  for (const line of text.split("\n")) {
    if (/^ \S/.test(line) && !/^\s*\uE000/.test(line)) {
      pre.push(line.slice(1));
      continue;
    }
    flush();
    const h = line.match(/^(={2,5})\s*(.+?)\s*\1\s*$/);
    if (h) {
      out.push("", `${"#".repeat(Math.min(h[1].length, 4))} ${h[2]}`, "");
      continue;
    }
    const list = line.match(/^([*#:;]+)\s*(.*)$/);
    if (list) {
      const depth = list[1].length - 1;
      const marker = list[1].endsWith("#") ? "1." : list[1].endsWith("*") ? "-" : "";
      out.push(`${"  ".repeat(depth)}${marker ? `${marker} ` : ""}${list[2]}`);
      continue;
    }
    if (/^\{\||^\|\}|^\|-/.test(line)) continue;
    const cell = line.match(/^[|!]\s*(.*)$/);
    if (cell) {
      const cells = cell[1].split(/\s*(?:\|\||!!)\s*/).map((c) => c.replace(/^[^|]*\|(?!\|)/, "").trim());
      out.push(`- ${cells.filter(Boolean).join(" · ")}`);
      continue;
    }
    out.push(line);
  }
  flush();
  const md = out.join("\n")
    .split(/(\uE000\d+\uE000)/)
    .map((
      part,
      i,
    ) => (i % 2 ? part : part.split("\n").map((l) => (l.startsWith("```") ? l : safeInline(l))).join("\n")))
    .join("")
    .replace(/\uE000(\d+)\uE000/g, (_, n) => codes[Number(n)])
    .replace(/\uE001/g, "**")
    .replace(/\uE002/g, "*");
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// Man pages

export interface ManEntry {
  name: string;
  section: string;
  description: string;
}

/** `apropos` / `man -k`: `tar (1)              - an archiving utility`. */
export function parseApropos(out: string): ManEntry[] {
  const seen = new Set<string>();
  return out.split("\n").flatMap((line) => {
    const m = line.match(/^(.+?)\s+-\s+(.*)$/);
    if (!m) return [];
    return [...m[1].matchAll(/([^\s,]+)\s*\(([^)]+)\)/g)].flatMap((n) => {
      const key = `${n[1]}(${n[2]})`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ name: n[1], section: n[2], description: m[2].trim() }];
    });
  });
}

export const SECTIONS: Record<string, string> = {
  "1": "User commands",
  "2": "System calls",
  "3": "Library functions",
  "4": "Devices",
  "5": "File formats",
  "6": "Games",
  "7": "Overviews",
  "8": "Administration",
  "9": "Kernel routines",
};

export const sectionName = (s: string) => SECTIONS[s[0]] ?? `Section ${s}`;

/** Bold and underline of a terminal (`N\bN`, `_\bx`) removed. */
// Backspace and escape, built from strings: control characters in regex literals are easy to misread.
const OVERSTRIKE = new RegExp(".\b", "g");
const ANSI = new RegExp("\u001b\\[[0-9;]*m", "g");
export const stripOverstrike = (text: string) => text.replace(OVERSTRIKE, "").replace(ANSI, "");

const HEADING = /^[A-Z][A-Z0-9 ,/()&'-]*$/;

/** `man -P cat` output → markdown: headings, options as terms, paragraphs, SYNOPSIS as code. */
export function manToMarkdown(raw: string): string {
  const lines = stripOverstrike(raw).split("\n");
  // Header and footer lines: "TAR(1)   General Commands Manual   TAR(1)".
  const banner = /^\S.*\(\w+\)\s*$/;
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines.length && banner.test(lines[0]) && /\s{3,}/.test(lines[0])) lines.shift();
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length && banner.test(lines[lines.length - 1]) && /\s{3,}/.test(lines[lines.length - 1])) lines.pop();

  const out: string[] = [];
  let section = "";
  let block: string[] = [];
  const indent = (l: string) => l.length - l.trimStart().length;
  const flush = () => {
    if (!block.length) return;
    const min = Math.min(...block.map(indent));
    // Leading short lines at the base indent: "-D tablespace" then "--tablespace=tablespace".
    let terms = 0;
    while (terms < block.length && indent(block[terms]) === min && block[terms].trim().length < 60) terms++;
    if (terms > 1 && !block.slice(0, terms).every((l) => /^\s*-/.test(l))) terms = 1;
    if (section === "SYNOPSIS") {
      out.push("```", ...block.map((l) => l.slice(min)), "```", "");
    } else if (terms > 0 && terms < block.length && block.slice(terms).every((l) => indent(l) > min)) {
      // A term (option, possibly spelled on several lines) and its definition.
      out.push(
        `**\`${block.slice(0, terms).map((l) => l.trim()).join(", ").replace(/`/g, "'")}\`**`,
        safeInline(block.slice(terms).map((l) => l.trim()).join(" ")),
        "",
      );
    } else if (block.length === 1 && /^-\S.*?\s{2,}\S/.test(block[0].trim())) {
      // Term and definition on one line: "-v, --verbose     Explain what is done".
      const [, term, text] = block[0].trim().match(/^(-\S.*?)\s{2,}(\S.*)$/)!;
      out.push(`**\`${term}\`** ${safeInline(text)}`, "");
    } else if (block.length === 1 && block[0].trim().length < 40 && /^\s*-/.test(block[0])) {
      out.push(`**\`${block[0].trim()}\`**`, "");
    } else {
      out.push(safeInline(block.map((l) => l.trim()).join(" ").replace(/(\w)- (\w)/g, "$1-$2")), "");
    }
    block = [];
  };
  for (const line of lines) {
    if (HEADING.test(line) && line.trim().length > 1) {
      flush();
      section = line.trim();
      out.push(`## ${section.charAt(0)}${section.slice(1).toLowerCase()}`, "");
    } else if (!line.trim()) flush();
    else {
      // A deeper line after a term line opens its definition; a line back at the term level starts a new block.
      if (block.length && indent(line) < indent(block[block.length - 1]) && indent(line) <= indent(block[0])) {
        flush();
      }
      block.push(line);
    }
  }
  flush();
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
