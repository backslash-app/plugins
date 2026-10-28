// Articles of Wallabag and Readeck in one shape, an HTML → Markdown converter for reading
// them in the launcher, and the hosts the extension may reach. No I/O here.

export type BackendId = "wallabag" | "readeck" | "instapaper";

export const BACKENDS: Record<BackendId, string> = {
  wallabag: "Wallabag",
  readeck: "Readeck",
  instapaper: "Instapaper",
};

export type Article = {
  id: string;
  url: string;
  title: string;
  domain: string;
  /** Minutes. */
  readingTime?: number;
  tags: string[];
  archived: boolean;
  starred: boolean;
  /** ISO 8601. */
  created: string;
  excerpt?: string;
  authors: string[];
  image?: string;
  words?: number;
  /** 0–100, Readeck. */
  progress?: number;
};

export type Filter = "unread" | "starred" | "archived";

/** The backend of the preferences, or the one whose credentials are set. */
export function chooseBackend(prefs: Record<string, unknown>): BackendId | undefined {
  const asked = String(prefs.backend ?? "").trim().toLowerCase();
  if (asked === "wallabag" || asked === "readeck" || asked === "instapaper") return asked;
  if (asked && asked !== "auto") return undefined;
  if (String(prefs.clientId ?? "").trim()) return "wallabag";
  if (String(prefs.token ?? "").trim()) return "readeck";
  if (String(prefs.username ?? "").trim() && !String(prefs.url ?? "").trim()) return "instapaper";
  return undefined;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The first http(s) link in a text (what the clipboard holds), without trailing punctuation. */
export function linkIn(text: string): string | undefined {
  const m = /https?:\/\/[^\s<>"'`]+/i.exec(text);
  if (m) return m[0].replace(/[),.;:!?\]]+$/, "");
  const bare = /^(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.exec(text.trim());
  return bare ? `https://${bare[0]}` : undefined;
}

/** "3 min", "1 h 05". */
export function formatReadingTime(minutes?: number): string {
  if (!minutes || minutes < 1) return "< 1 min";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  return `${Math.floor(minutes / 60)} h ${String(Math.round(minutes % 60)).padStart(2, "0")}`;
}

/** "today", "3d", "2mo", "1y". */
export function age(date: string, now = Date.now()): string {
  const days = Math.floor((now - Date.parse(date)) / 86_400_000);
  if (!(days >= 1)) return "today";
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** Unread first when mixed, then newest. */
export function sortArticles(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => Number(a.archived) - Number(b.archived) || b.created.localeCompare(a.created));
}

// ---------------------------------------------------------------------------
// Wallabag (API v2)

export type WallabagEntry = {
  id: number;
  url: string;
  title?: string | null;
  domain_name?: string | null;
  reading_time?: number | null;
  tags?: { label: string }[];
  is_archived: number | boolean;
  is_starred: number | boolean;
  created_at: string;
  preview_picture?: string | null;
  published_by?: string[] | null;
  content?: string | null;
};

/** wallabag's dates: "2026-10-28T09:15:00+0100" → ISO with a colon in the offset. */
export function isoDate(text: string): string {
  const d = new Date(text.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return isNaN(d.getTime()) ? text : d.toISOString();
}

export function fromWallabag(e: WallabagEntry): Article {
  const text = e.content ? htmlToText(e.content) : "";
  return {
    id: String(e.id),
    url: e.url,
    title: e.title?.trim() || e.url,
    domain: e.domain_name?.replace(/^www\./, "") || domainOf(e.url),
    readingTime: e.reading_time ?? undefined,
    tags: (e.tags ?? []).map((t) => t.label),
    archived: !!Number(e.is_archived),
    starred: !!Number(e.is_starred),
    created: isoDate(e.created_at),
    excerpt: text ? excerpt(text) : undefined,
    authors: e.published_by ?? [],
    image: e.preview_picture ?? undefined,
  };
}

export function wallabagQuery(filter: Filter, perPage = 100): string {
  const p = new URLSearchParams({ sort: "created", order: "desc", perPage: String(perPage), detail: "metadata" });
  if (filter === "unread") p.set("archive", "0");
  if (filter === "archived") p.set("archive", "1");
  if (filter === "starred") p.set("starred", "1");
  return p.toString();
}

export function wallabagTokenBody(prefs: Record<string, unknown>): URLSearchParams {
  return new URLSearchParams({
    grant_type: "password",
    client_id: String(prefs.clientId ?? "").trim(),
    client_secret: String(prefs.clientSecret ?? "").trim(),
    username: String(prefs.username ?? "").trim(),
    password: String(prefs.password ?? ""),
  });
}

// ---------------------------------------------------------------------------
// Readeck

export type ReadeckBookmark = {
  id: string;
  url: string;
  href?: string;
  title?: string;
  site_name?: string;
  site?: string;
  created: string;
  authors?: string[] | null;
  description?: string;
  is_marked: boolean;
  is_archived: boolean;
  labels?: string[] | null;
  reading_time?: number;
  word_count?: number;
  read_progress?: number;
  resources?: { image?: { src?: string }; thumbnail?: { src?: string } };
};

export function fromReadeck(b: ReadeckBookmark): Article {
  return {
    id: b.id,
    url: b.url,
    title: b.title?.trim() || b.url,
    domain: (b.site || domainOf(b.url)).replace(/^www\./, ""),
    readingTime: b.reading_time,
    tags: b.labels ?? [],
    archived: b.is_archived,
    starred: b.is_marked,
    created: b.created,
    excerpt: b.description?.trim() || undefined,
    authors: b.authors ?? [],
    image: b.resources?.thumbnail?.src ?? b.resources?.image?.src,
    words: b.word_count,
    progress: b.read_progress,
  };
}

export function readeckQuery(filter: Filter, limit = 100): string {
  const p = new URLSearchParams({ limit: String(limit), sort: "-created" });
  if (filter === "unread") p.set("is_archived", "false");
  if (filter === "archived") p.set("is_archived", "true");
  if (filter === "starred") p.set("is_marked", "true");
  return p.toString();
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
 * Where the services are: wallabag.it (hosted Wallabag), Instapaper, and a
 * self-hosted Wallabag or Readeck on this computer, the local network or
 * Tailscale. Same list as `[permissions] net` (a test checks it).
 */
export const HOSTS = [
  "app.wallabag.it",
  "www.instapaper.com",
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
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

/** `wallabag.home.lan/` → `https://wallabag.home.lan`, without `/api`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "").replace(/\/api$/, "");
}
