// Articles and feeds of Miniflux (REST API) and FreshRSS (Google Reader API) in one shape,
// reading times, an HTML → Markdown converter for reading them in the launcher, and the
// hosts the extension may reach. No I/O here.

export type BackendId = "miniflux" | "freshrss";

export const BACKENDS: Record<BackendId, string> = { miniflux: "Miniflux", freshrss: "FreshRSS" };

/** Raised when the extension isn't set up or the server refuses it: the list shows how to fix it. */
export class SetupError extends Error {}

export type Entry = {
  id: string;
  feedId: string;
  feedTitle: string;
  category?: string;
  title: string;
  url: string;
  author?: string;
  /** ISO 8601. */
  published: string;
  /** Minutes, at least 1. */
  readingTime: number;
  unread: boolean;
  starred: boolean;
  /** The article's HTML as the reader has it. */
  content: string;
  commentsUrl?: string;
};

export type Feed = {
  id: string;
  title: string;
  siteUrl?: string;
  feedUrl?: string;
  category?: string;
  unread: number;
  /** The last fetch error, Miniflux only. */
  error?: string;
  disabled?: boolean;
};

export type View = "unread" | "starred";

/** The backend of the preferences, or the one whose credentials are set. */
export function chooseBackend(prefs: Record<string, unknown>): BackendId | undefined {
  const asked = String(prefs.backend ?? "").trim().toLowerCase();
  if (asked === "miniflux" || asked === "freshrss") return asked;
  if (asked && asked !== "auto") return undefined;
  if (String(prefs.token ?? "").trim()) return "miniflux";
  if (String(prefs.username ?? "").trim()) return "freshrss";
  return undefined;
}

export function domainOf(url: string | undefined): string {
  try {
    return new URL(url ?? "").hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Words of some HTML at 230 words a minute, at least 1 minute. */
export function readingMinutes(html: string): number {
  const words = htmlToText(html).split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / 230));
}

/** "3 min", "1 h 05". */
export function formatReadingTime(minutes: number): string {
  if (!minutes || minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}

/** "now", "5m", "3h", "2d", "3w", "4mo", "1y". */
export function age(date: string, now = Date.now()): string {
  const s = Math.max(0, (now - Date.parse(date)) / 1000);
  if (!(s >= 60)) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86_400);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Newest first. */
export function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => b.published.localeCompare(a.published));
}

/** Feeds with unread articles first (most first), then by title; within categories when `byCategory`. */
export function sortFeeds(feeds: Feed[]): Feed[] {
  return [...feeds].sort((a, b) =>
    Number(b.unread > 0) - Number(a.unread > 0) || b.unread - a.unread ||
    a.title.localeCompare(b.title, "en", { sensitivity: "base" })
  );
}

/** "12 unread · 1 h 20 of reading". */
export function summary(entries: Entry[], view: View): string {
  const minutes = entries.reduce((n, e) => n + e.readingTime, 0);
  const n = entries.length;
  const what = view === "starred" ? `${n} starred` : `${n} unread`;
  return n ? `${what} · ${formatReadingTime(minutes)} of reading` : what;
}

/** Groups the entries by `key`, the groups with the most entries first. */
export function groupEntries(entries: Entry[], key: (e: Entry) => string): [string, Entry[]][] {
  const groups = new Map<string, Entry[]>();
  for (const e of sortEntries(entries)) {
    const k = key(e);
    groups.set(k, [...groups.get(k) ?? [], e]);
  }
  return [...groups].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
}

// ---------------------------------------------------------------------------
// Miniflux (API v1)

export type MinifluxEntry = {
  id: number;
  feed_id: number;
  status: "unread" | "read" | "removed";
  title: string;
  url: string;
  comments_url?: string;
  published_at: string;
  content?: string;
  author?: string;
  starred: boolean;
  reading_time?: number;
  feed?: {
    id: number;
    title: string;
    site_url?: string;
    category?: { id: number; title: string };
  };
};

export type MinifluxFeed = {
  id: number;
  title: string;
  site_url?: string;
  feed_url?: string;
  category?: { id: number; title: string };
  parsing_error_count?: number;
  parsing_error_message?: string;
  disabled?: boolean;
};

export function fromMiniflux(e: MinifluxEntry): Entry {
  const content = e.content ?? "";
  return {
    id: String(e.id),
    feedId: String(e.feed_id),
    feedTitle: e.feed?.title?.trim() || domainOf(e.feed?.site_url ?? e.url) || "Feed",
    category: e.feed?.category?.title,
    title: e.title?.trim() || e.url,
    url: e.url,
    author: e.author?.trim() || undefined,
    published: isoDate(e.published_at),
    // reading_time is 0 when the server doesn't compute it.
    readingTime: e.reading_time && e.reading_time > 0 ? e.reading_time : readingMinutes(content),
    unread: e.status === "unread",
    starred: e.starred,
    content,
    commentsUrl: e.comments_url || undefined,
  };
}

export function fromMinifluxFeed(f: MinifluxFeed, unreads: Record<string, number>): Feed {
  return {
    id: String(f.id),
    title: f.title?.trim() || domainOf(f.site_url) || f.feed_url || "Feed",
    siteUrl: f.site_url || undefined,
    feedUrl: f.feed_url || undefined,
    category: f.category?.title,
    unread: unreads[String(f.id)] ?? 0,
    error: f.parsing_error_count ? f.parsing_error_message || `${f.parsing_error_count} failed fetches` : undefined,
    disabled: f.disabled,
  };
}

/** The query of `GET /v1/entries`, or of a feed's entries. */
export function minifluxQuery(view: View, limit = 150): string {
  const p = new URLSearchParams({ order: "published_at", direction: "desc", limit: String(limit) });
  if (view === "starred") p.set("starred", "true");
  else p.set("status", "unread");
  return p.toString();
}

// ---------------------------------------------------------------------------
// FreshRSS (Google Reader API)

export const READ = "user/-/state/com.google/read";
export const STARRED = "user/-/state/com.google/starred";
export const READING_LIST = "user/-/state/com.google/reading-list";

export type GReaderItem = {
  id: string;
  title?: string;
  published?: number;
  crawlTimeMsec?: string;
  canonical?: { href: string }[];
  alternate?: { href: string; type?: string }[];
  categories?: string[];
  origin?: { streamId: string; title?: string; htmlUrl?: string };
  summary?: { content?: string };
  content?: { content?: string };
  author?: string;
};

export type GReaderSubscription = {
  id: string;
  title: string;
  categories?: { id: string; label: string }[];
  url?: string;
  htmlUrl?: string;
};

/** `user/-/label/Tech` (or `user/1/label/Tech`) → `Tech`. */
export function labelOf(categories: string[] | undefined): string | undefined {
  for (const c of categories ?? []) {
    const m = /^user\/[^/]+\/label\/(.+)$/.exec(c);
    if (m) return m[1];
  }
  return undefined;
}

export function fromGReader(item: GReaderItem, feeds: Map<string, Feed> = new Map()): Entry {
  const categories = item.categories ?? [];
  const has = (state: string) => categories.some((c) => c.replace(/^user\/[^/]+\//, "user/-/") === state);
  const content = item.content?.content ?? item.summary?.content ?? "";
  const url = item.canonical?.[0]?.href ?? item.alternate?.[0]?.href ?? item.origin?.htmlUrl ?? "";
  const feedId = item.origin?.streamId ?? "";
  const feed = feeds.get(feedId);
  const seconds = item.published ?? (item.crawlTimeMsec ? Number(item.crawlTimeMsec) / 1000 : 0);
  return {
    id: item.id,
    feedId,
    feedTitle: item.origin?.title?.trim() || feed?.title || domainOf(item.origin?.htmlUrl) || "Feed",
    category: labelOf(categories) ?? feed?.category,
    title: decodeEntities(item.title?.trim() || "") || url,
    url,
    author: item.author?.trim() || undefined,
    published: new Date(seconds * 1000).toISOString(),
    readingTime: readingMinutes(content),
    unread: !has(READ),
    starred: has(STARRED),
    content,
  };
}

export function fromGReaderSubscription(s: GReaderSubscription, unreads: Record<string, number>): Feed {
  return {
    id: s.id,
    title: s.title?.trim() || domainOf(s.htmlUrl) || s.url || "Feed",
    siteUrl: s.htmlUrl || undefined,
    feedUrl: s.url || undefined,
    category: s.categories?.[0]?.label,
    unread: unreads[s.id] ?? 0,
  };
}

/** The `Auth=` line of a ClientLogin answer. */
export function parseClientLogin(text: string): string | undefined {
  return /^Auth=(.+)$/m.exec(text)?.[1]?.trim() || undefined;
}

/** The path and query of a stream: the reading list, starred, or one feed; unread only unless starred. */
export function streamPath(view: View, feedId?: string, n = 150): string {
  const stream = feedId ?? (view === "starred" ? STARRED : READING_LIST);
  const p = new URLSearchParams({ output: "json", n: String(n), r: "n" });
  if (view === "unread") p.set("xt", READ);
  return `/reader/api/0/stream/contents/${stream.split("/").map(encodeURIComponent).join("/")}?${p}`;
}

/** The body of an `edit-tag` request adding or removing `tag` on items. */
export function editTagBody(ids: string[], tag: string, add: boolean, token: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const id of ids) body.append("i", id);
  body.set(add ? "a" : "r", tag);
  body.set("T", token);
  return body;
}

// ---------------------------------------------------------------------------
// Dates

/** "2026-10-28T09:15:00+0100" or "…+01:00" → ISO; text left alone when unreadable. */
export function isoDate(text: string): string {
  const d = new Date(String(text).replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(d.getTime()) ? text : d.toISOString();
}

export function longDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// HTML → Markdown

type Node = { tag: string; attrs: Record<string, string>; children: (Node | string)[] };

const VOID = new Set([
  "br",
  "hr",
  "img",
  "input",
  "meta",
  "link",
  "source",
  "wbr",
  "col",
  "area",
  "base",
  "embed",
  "param",
  "track",
]);
const DROP = new Set([
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "head",
  "iframe",
  "object",
  "form",
  "button",
  "nav",
  "canvas",
  "select",
  "math",
]);
/** Opening one of these closes an open element of the same kind (lenient HTML). */
const SELF_CLOSING = new Set(["p", "li", "dt", "dd", "tr", "td", "th", "option"]);
const BLOCKS = new Set([
  "p",
  "div",
  "section",
  "article",
  "main",
  "header",
  "footer",
  "aside",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "pre",
  "blockquote",
  "table",
  "tr",
  "hr",
  "dl",
  "dt",
  "dd",
  "figcaption",
  "details",
  "summary",
]);

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ucirc: "û",
  ugrave: "ù",
  icirc: "î",
  iuml: "ï",
  euml: "ë",
  middot: "·",
  bull: "•",
  times: "×",
  euro: "€",
  deg: "°",
  shy: "",
  zwj: "",
  zwnj: "",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? all;
  });
}

export function parseHtml(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Node[] = [root];
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<![^>]*>|<\?[^>]*>|<(\/?)([a-zA-Z][\w:-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>|([^<]+|<)/g;
  let m: RegExpExecArray | null;
  let dropping: string | undefined;
  let depth = 0;
  while ((m = re.exec(html))) {
    if (m[4] !== undefined) {
      if (!dropping) stack[stack.length - 1].children.push(decodeEntities(m[4]));
      continue;
    }
    if (!m[2]) continue;
    const tag = m[2].toLowerCase();
    const closing = m[1] === "/";
    if (dropping) {
      if (tag === dropping) depth += closing ? -1 : 1;
      if (depth === 0) dropping = undefined;
      continue;
    }
    if (DROP.has(tag) && !closing) {
      if (!/\/\s*$/.test(m[3])) {
        dropping = tag;
        depth = 1;
      }
      continue;
    }
    if (closing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of m[3].matchAll(/([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      attrs[a[1].toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? a[4] ?? "");
    }
    if (SELF_CLOSING.has(tag)) {
      // <p>a<p>b, <li>a<li>b: close the previous one (not across lists or tables).
      for (let i = stack.length - 1; i > 0; i--) {
        const t = stack[i].tag;
        if (t === tag) {
          stack.length = i;
          break;
        }
        if (["ul", "ol", "table", "div", "blockquote", "tbody", "thead", "dl"].includes(t)) break;
      }
    }
    const node: Node = { tag, attrs, children: [] };
    stack[stack.length - 1].children.push(node);
    if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) stack.push(node);
  }
  return root;
}

function absolute(href: string, base?: string): string {
  try {
    return base ? new URL(href, base).toString() : href;
  } catch {
    return href;
  }
}

const escapeMd = (s: string) => s.replace(/([\\`*_[\]])/g, "\\$1");

function textContent(n: Node | string): string {
  return typeof n === "string" ? n : n.children.map(textContent).join("");
}

function inline(nodes: (Node | string)[], base?: string): string {
  let out = "";
  for (const n of nodes) {
    if (typeof n === "string") {
      out += escapeMd(n.replace(/\s+/g, " "));
      continue;
    }
    const inner = () => inline(n.children, base);
    switch (n.tag) {
      case "br":
        out += "  \n";
        break;
      case "strong":
      case "b": {
        const t = inner().trim();
        if (t) out += ` **${t}** `;
        break;
      }
      case "em":
      case "i":
      case "cite": {
        const t = inner().trim();
        if (t) out += ` _${t}_ `;
        break;
      }
      case "code":
      case "kbd":
      case "samp": {
        const t = textContent(n).replace(/\s+/g, " ");
        if (t.trim()) out += t.includes("`") ? `\`\` ${t} \`\`` : `\`${t}\``;
        break;
      }
      case "a": {
        const t = inner().trim();
        const href = n.attrs.href;
        if (href && t && !href.startsWith("javascript:") && !href.startsWith("#")) {
          out += `[${t}](${absolute(href, base)})`;
        } else out += t;
        break;
      }
      case "img": {
        const src = n.attrs.src || n.attrs["data-src"];
        if (src && !src.startsWith("data:")) {
          out += `[🖼 ${escapeMd(n.attrs.alt?.trim() || "Image")}](${absolute(src, base)})`;
        }
        break;
      }
      case "sup":
        out += `^${inner()}`;
        break;
      default:
        out += BLOCKS.has(n.tag) ? ` ${blocks(n.children, base).replace(/\n+/g, " ")} ` : inner();
    }
  }
  return out;
}

/** Cleans what inline() made: spaces around emphasis, double spaces. */
function tidy(line: string): string {
  return line
    .replace(/ {2}\n/g, "\uE000")
    .replace(/[ \t]+/g, " ")
    .replace(/ +([,.;:!?)])/g, "$1")
    .replace(/\( +/g, "(")
    .replace(/ *\n */g, "\n")
    .replace(/ *\uE000 */g, "  \n")
    .trim();
}

function list(n: Node, base: string | undefined, level: number): string {
  const ordered = n.tag === "ol";
  let i = Number(n.attrs.start ?? 1) || 1;
  const lines: string[] = [];
  for (const c of n.children) {
    if (typeof c === "string") {
      if (c.trim()) lines.push(`${"  ".repeat(level)}- ${tidy(escapeMd(c))}`);
      continue;
    }
    if (c.tag !== "li") {
      if (c.tag === "ul" || c.tag === "ol") lines.push(list(c, base, level + 1));
      continue;
    }
    const nested = c.children.filter((x): x is Node => typeof x !== "string" && (x.tag === "ul" || x.tag === "ol"));
    const rest = c.children.filter((x) => typeof x === "string" || (x.tag !== "ul" && x.tag !== "ol"));
    const text = tidy(blocks(rest, base).replace(/\n{2,}/g, "\n")).replace(/\n/g, `\n${"  ".repeat(level + 1)}`);
    lines.push(`${"  ".repeat(level)}${ordered ? `${i++}.` : "-"} ${text}`);
    for (const sub of nested) lines.push(list(sub, base, level + 1));
  }
  return lines.join("\n");
}

function table(n: Node, base?: string): string {
  const rows: string[][] = [];
  const walk = (x: Node) => {
    for (const c of x.children) {
      if (typeof c === "string") continue;
      if (c.tag === "tr") {
        rows.push(
          c.children.filter((d): d is Node => typeof d !== "string" && (d.tag === "td" || d.tag === "th"))
            .map((d) => tidy(inline(d.children, base)).replace(/\|/g, "\\|").replace(/\n/g, " ")),
        );
      } else walk(c);
    }
  };
  walk(n);
  if (!rows.length) return "";
  const width = Math.max(...rows.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  return [
    `| ${pad(rows[0]).join(" | ")} |`,
    `|${Array(width).fill("---").join("|")}|`,
    ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
  ].join("\n");
}

function blocks(nodes: (Node | string)[], base?: string): string {
  const out: string[] = [];
  let run: (Node | string)[] = [];
  const flush = () => {
    const t = tidy(inline(run, base));
    if (t) out.push(t);
    run = [];
  };
  for (const n of nodes) {
    if (typeof n === "string" || !BLOCKS.has(n.tag)) {
      run.push(n);
      continue;
    }
    flush();
    switch (n.tag) {
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const t = tidy(inline(n.children, base)).replace(/\n/g, " ");
        if (t) out.push(`${"#".repeat(Math.min(6, Number(n.tag[1]) + 1))} ${t}`);
        break;
      }
      case "pre": {
        const code = textContent(n).replace(/^\n+|\s+$/g, "");
        const lang = /language-([\w+-]+)/.exec(
          (n.children.find((c): c is Node => typeof c !== "string" && c.tag === "code")?.attrs.class ?? "") +
            ` ${n.attrs.class ?? ""}`,
        )?.[1] ?? "";
        if (code) out.push(`\`\`\`${lang}\n${code.replace(/```/g, "ˋˋˋ")}\n\`\`\``);
        break;
      }
      case "blockquote": {
        const t = blocks(n.children, base);
        if (t) out.push(t.split("\n").map((l) => l ? `> ${l}` : ">").join("\n"));
        break;
      }
      case "ul":
      case "ol": {
        const t = list(n, base, 0);
        if (t.trim()) out.push(t);
        break;
      }
      case "table": {
        const t = table(n, base);
        if (t) out.push(t);
        break;
      }
      case "hr":
        out.push("---");
        break;
      case "figcaption": {
        const t = tidy(inline(n.children, base));
        if (t) out.push(`_${t}_`);
        break;
      }
      default: {
        const t = blocks(n.children, base);
        if (t) out.push(t);
      }
    }
  }
  flush();
  return out.join("\n\n");
}

/** An article's HTML as the launcher's Markdown: headings, paragraphs, lists, quotes, code, tables, links. */
export function htmlToMarkdown(html: string, base?: string): string {
  const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return blocks(parseHtml(body).children, base).replace(/\n{3,}/g, "\n\n").trim();
}

/** The text of some HTML, on one line. */
export function htmlToText(html: string): string {
  return textContent(parseHtml(html)).replace(/\s+/g, " ").trim();
}

export function excerpt(text: string, max = 280): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" ") > max * 0.6 ? cut.lastIndexOf(" ") : max)}…`;
}

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where the readers run, as declared in `[permissions] net` (kept equal by a
 * test): Miniflux's hosted service, and a self-hosted Miniflux or FreshRSS on
 * this computer, a container, the local network, Tailscale or DuckDNS.
 */
export const HOSTS = [
  "reader.miniflux.app",
  "localhost",
  "127.0.0.1",
  "miniflux",
  "freshrss",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** A host of the local network, where servers usually speak plain HTTP. */
function isLocal(host: string): boolean {
  return !host.includes(".") || ipv4(host) !== undefined || /\.(local|lan|home|home\.arpa|internal)$/.test(host);
}

/**
 * `rss.home.lan/i/`, `…/api/greader.php` or `reader.miniflux.app/unread` → the
 * server's address: http:// for a local host typed without a scheme, else https://.
 */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:]/)[0].toLowerCase();
    url = `${isLocal(host) ? "http" : "https"}://${url}`;
  }
  return url
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "")
    .replace(/\/(api\/greader\.php|api\/fever\.php|p\/i|i|v1|unread|starred|feeds|categories|history)$/i, "")
    .replace(/\/+$/, "");
}
