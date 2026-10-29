// Pages of Outline, BookStack, Wiki.js and Confluence Cloud in one shape: which wikis are set
// up, their search results merged, their bodies (Markdown, HTML, Confluence's storage format)
// as the launcher's Markdown, and the hosts the extension may reach. No I/O here.

export type WikiId = "outline" | "bookstack" | "wikijs" | "confluence";

export const WIKIS: Record<WikiId, string> = {
  outline: "Outline",
  bookstack: "BookStack",
  wikijs: "Wiki.js",
  confluence: "Confluence",
};

export const ORDER: WikiId[] = ["outline", "bookstack", "wikijs", "confluence"];

/** Raised when a wiki isn't set up or refuses the credentials. */
export class SetupError extends Error {
  constructor(message: string, readonly wiki?: WikiId) {
    super(message);
  }
}

export type Page = {
  wiki: WikiId;
  /** The wiki's own id (Wiki.js: `locale/path`). */
  id: string;
  title: string;
  url: string;
  /** Markdown, with the matched words in bold. */
  excerpt?: string;
  /** Collection, book, space. */
  container?: string;
  /** ISO 8601. */
  updated?: string;
  author?: string;
  tags: string[];
};

export type Content = { markdown: string; updated?: string; author?: string; tags?: string[] };

// ---------------------------------------------------------------------------
// Preferences

export type Config = {
  outline?: { base: string; token: string };
  bookstack?: { base: string; id: string; secret: string };
  wikijs?: { base: string; token: string };
  confluence?: { base: string; email: string; token: string };
};

const str = (v: unknown) => String(v ?? "").trim();

/** The wikis whose credentials are set; an address alone, or a token alone, is not enough (but Outline's cloud). */
export function configured(prefs: Record<string, unknown>): Config {
  const c: Config = {};
  if (str(prefs.outlineToken)) {
    c.outline = {
      base: normalizeUrl(prefs.outlineUrl || "https://app.getoutline.com"),
      token: str(prefs.outlineToken),
    };
  }
  if (str(prefs.bookstackUrl) && str(prefs.bookstackTokenId) && str(prefs.bookstackTokenSecret)) {
    c.bookstack = {
      base: normalizeUrl(prefs.bookstackUrl),
      id: str(prefs.bookstackTokenId),
      secret: str(prefs.bookstackTokenSecret),
    };
  }
  if (str(prefs.wikijsUrl) && str(prefs.wikijsToken)) {
    c.wikijs = { base: normalizeUrl(prefs.wikijsUrl), token: str(prefs.wikijsToken) };
  }
  if (str(prefs.confluenceUrl) && str(prefs.confluenceEmail) && str(prefs.confluenceToken)) {
    c.confluence = {
      base: confluenceSite(prefs.confluenceUrl),
      email: str(prefs.confluenceEmail),
      token: str(prefs.confluenceToken),
    };
  }
  return c;
}

/** What is half set up, to say so instead of ignoring it. */
export function incomplete(prefs: Record<string, unknown>): string[] {
  const out: string[] = [];
  if (str(prefs.outlineUrl) && !str(prefs.outlineToken)) out.push("Outline needs an API key");
  const bs = [prefs.bookstackUrl, prefs.bookstackTokenId, prefs.bookstackTokenSecret].map(str);
  if (bs.some(Boolean) && !bs.every(Boolean)) out.push("BookStack needs its address, token ID and token secret");
  if (!!str(prefs.wikijsUrl) !== !!str(prefs.wikijsToken)) out.push("Wiki.js needs its address and an API key");
  const cf = [prefs.confluenceUrl, prefs.confluenceEmail, prefs.confluenceToken].map(str);
  if (cf.some(Boolean) && !cf.every(Boolean)) out.push("Confluence needs its site, your email and an API token");
  return out;
}

/** `acme`, `acme.atlassian.net` or `https://acme.atlassian.net/wiki/spaces/…` → `https://acme.atlassian.net`. */
export function confluenceSite(input: unknown): string {
  let host = str(input).replace(/^https?:\/\//i, "").split(/[/?#]/)[0].toLowerCase();
  if (host && !host.includes(".")) host = `${host}.atlassian.net`;
  return host ? `https://${host}` : "";
}

/** Basic authentication, with non-ASCII characters encoded as UTF-8. */
export function basicAuth(user: string, password: string): string {
  const bytes = new TextEncoder().encode(`${user}:${password}`);
  return `Basic ${btoa(String.fromCharCode(...bytes))}`;
}

// ---------------------------------------------------------------------------
// Merging and dates

/** One result of each wiki in turn, in each wiki's own order, so that one wiki doesn't push the others away. */
export function interleave(lists: Page[][]): Page[] {
  const out: Page[] = [];
  const max = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < max; i++) for (const l of lists) if (l[i]) out.push(l[i]);
  return out;
}

/** Newest first, pages without a date last. */
export function byUpdated(pages: Page[]): Page[] {
  return [...pages].sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""));
}

/** "now", "5m", "3h", "2d", "3w", "4mo", "1y". */
export function age(date: string | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.max(0, (now - Date.parse(date)) / 1000);
  if (isNaN(s)) return "";
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  const days = Math.floor(s / 86_400);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** A search snippet with `<b>`/`<em>`/`<mark>`/`<strong>` or Confluence's `@@@hl@@@` marks → one line of Markdown. */
export function snippet(text: string | undefined): string | undefined {
  if (!text) return undefined;
  const marked = text
    .replace(/@@@hl@@@/g, "").replace(/@@@endhl@@@/g, "")
    .replace(/<(b|strong|em|mark|u)(\s[^>]*)?>/gi, "").replace(/<\/(b|strong|em|mark|u)>/gi, "")
    .replace(/<br\s*\/?>/gi, " ");
  const plain = decodeEntities(marked.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
  const md = plain.replace(/([\\`*_[\]])/g, "\\$1")
    .replace(/\s*([^]*?)\s*/g, (_, t: string) => (t ? `**${t}**` : ""))
    .replace(/[]/g, "")
    .replace(/\*\*\s*\*\*/g, " ");
  return md || undefined;
}

// ---------------------------------------------------------------------------
// Outline

export type OutlineDocument = {
  id: string;
  title: string;
  url: string;
  text?: string;
  updatedAt?: string;
  updatedBy?: { name?: string } | null;
  collectionId?: string | null;
};

export type OutlineSearchResult = { ranking?: number; context?: string; document: OutlineDocument };

export function fromOutline(
  d: OutlineDocument,
  base: string,
  collections: Map<string, string>,
  context?: string,
): Page {
  const text = cleanOutline(d.text ?? "");
  return {
    wiki: "outline",
    id: d.id,
    title: d.title?.trim() || "Untitled",
    url: absolute(d.url, base),
    excerpt: snippet(context) ?? (text ? excerpt(text.replace(/^#+\s.*$/gm, "")) : undefined),
    container: d.collectionId ? collections.get(d.collectionId) : undefined,
    updated: d.updatedAt,
    author: d.updatedBy?.name,
    tags: [],
  };
}

/** Outline's Markdown, with its lone backslashes (empty paragraphs) taken out. */
export function cleanOutline(text: string): string {
  return text.replace(/^\\\s*$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

// ---------------------------------------------------------------------------
// BookStack

export type BookStackResult = {
  id: number;
  name: string;
  type: string;
  url: string;
  book_id?: number;
  preview_html?: { name?: string; content?: string };
  tags?: { name: string; value?: string }[];
  updated_at?: string;
};

export type BookStackPage = {
  id: number;
  name: string;
  slug?: string;
  book_id?: number;
  book_slug?: string;
  html?: string;
  markdown?: string;
  updated_at?: string;
  updated_by?: { name?: string } | number | null;
  tags?: { name: string; value?: string }[];
};

const tagText = (t: { name: string; value?: string }) => t.value ? `${t.name}: ${t.value}` : t.name;

export function fromBookStack(r: BookStackResult, books: Map<number, string>): Page {
  return {
    wiki: "bookstack",
    id: String(r.id),
    title: r.name?.trim() || "Untitled",
    url: r.url,
    excerpt: snippet(r.preview_html?.content),
    container: r.book_id ? books.get(r.book_id) : undefined,
    updated: r.updated_at,
    tags: (r.tags ?? []).map(tagText),
  };
}

export function fromBookStackPage(p: BookStackPage, base: string, books: Map<number, string>): Page {
  return {
    wiki: "bookstack",
    id: String(p.id),
    title: p.name?.trim() || "Untitled",
    // /link/{id} is BookStack's permalink to a page.
    url: p.book_slug && p.slug ? `${base}/books/${p.book_slug}/page/${p.slug}` : `${base}/link/${p.id}`,
    container: p.book_id ? books.get(p.book_id) : undefined,
    updated: p.updated_at,
    tags: (p.tags ?? []).map(tagText),
  };
}

export function bookStackContent(p: BookStackPage, base: string): Content {
  return {
    markdown: p.markdown?.trim() ? p.markdown.trim() : htmlToMarkdown(p.html ?? "", base),
    updated: p.updated_at,
    author: typeof p.updated_by === "object" ? p.updated_by?.name : undefined,
    tags: (p.tags ?? []).map(tagText),
  };
}

// ---------------------------------------------------------------------------
// Wiki.js (GraphQL)

export const WIKIJS_SEARCH =
  "query ($q: String!) { pages { search(query: $q) { results { id title description path locale } totalHits } } }";
export const WIKIJS_RECENT =
  "{ pages { list(orderBy: UPDATED, orderByDirection: DESC, limit: 25) { id path locale title description updatedAt tags } } }";
export const WIKIJS_PAGE =
  "query ($path: String!, $locale: String!) { pages { singleByPath(path: $path, locale: $locale) { id title content render editor updatedAt authorName tags { tag } } } }";

export type WikiJsResult = {
  id: string | number;
  title: string;
  description?: string;
  path: string;
  locale: string;
  updatedAt?: string;
  tags?: string[];
};

export type WikiJsPage = {
  content?: string;
  render?: string;
  editor?: string;
  updatedAt?: string;
  authorName?: string;
  tags?: { tag: string }[];
};

export function fromWikiJs(r: WikiJsResult, base: string): Page {
  return {
    wiki: "wikijs",
    id: `${r.locale}/${r.path}`,
    title: r.title?.trim() || r.path,
    url: `${base}/${r.locale}/${r.path.replace(/^\/+/, "")}`,
    excerpt: r.description?.trim() ? snippet(r.description) : undefined,
    container: r.path.includes("/") ? r.path.split("/").slice(0, -1).join(" › ") : undefined,
    updated: r.updatedAt,
    tags: r.tags ?? [],
  };
}

export function wikiJsContent(p: WikiJsPage, base: string): Content {
  const markdown = p.editor === "markdown" && p.content?.trim()
    ? p.content.trim()
    : htmlToMarkdown(p.render || p.content || "", base);
  return { markdown, updated: p.updatedAt, author: p.authorName, tags: (p.tags ?? []).map((t) => t.tag) };
}

/** The first GraphQL error, worded for the user. */
export function graphqlError(errors: { message?: string }[] | undefined): string | undefined {
  const m = errors?.[0]?.message;
  if (!m) return undefined;
  return /forbidden|unauthorized/i.test(m) ? "Wiki.js refused the API key: does it have read access?" : m;
}

// ---------------------------------------------------------------------------
// Confluence Cloud

export type ConfluenceResult = {
  content?: { id: string; type: string; title: string; _links?: { webui?: string } };
  title?: string;
  excerpt?: string;
  url?: string;
  resultGlobalContainer?: { title?: string };
  lastModified?: string;
};

export type ConfluencePage = {
  title: string;
  body?: { storage?: { value?: string } };
  version?: { when?: string; by?: { displayName?: string } };
  metadata?: { labels?: { results?: { name: string }[] } };
};

/** CQL for a text search among pages, or the recently changed ones. */
export function confluenceCql(query: string): string {
  const q = query.trim().replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return q ? `type = page AND text ~ "${q}"` : "type = page ORDER BY lastmodified DESC";
}

export function fromConfluence(r: ConfluenceResult, base: string): Page | undefined {
  if (!r.content?.id) return undefined;
  const webui = r.content._links?.webui ?? r.url ?? "";
  return {
    wiki: "confluence",
    id: r.content.id,
    title: decodeEntities((r.content.title || r.title || "Untitled").replace(/@@@(end)?hl@@@/g, "")),
    url: webui.startsWith("http") ? webui : `${base}/wiki${webui}`,
    excerpt: snippet(r.excerpt),
    container: r.resultGlobalContainer?.title,
    updated: r.lastModified,
    tags: [],
  };
}

/**
 * Confluence's storage format (XHTML with `ac:` and `ri:` elements) as HTML the
 * converter reads: code blocks, panels, task lists, links to pages and people,
 * attachments; other macros keep their body or go.
 */
export function storageToHtml(xml: string): string {
  const cdata = (s: string) =>
    s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
  const param = (body: string, name: string) =>
    new RegExp(`<ac:parameter[^>]*ac:name="${name}"[^>]*>([\\s\\S]*?)</ac:parameter>`).exec(body)?.[1]?.trim();
  let out = xml;
  // Innermost macros first, until none is left (they nest).
  const macro =
    /<ac:structured-macro\b[^>]*ac:name="([^"]+)"[^>]*>((?:(?!<ac:structured-macro\b)[\s\S])*?)<\/ac:structured-macro>/;
  for (let i = 0; i < 200; i++) {
    const m = macro.exec(out);
    if (!m) break;
    const [all, name, body] = m;
    const plain = /<ac:plain-text-body>([\s\S]*?)<\/ac:plain-text-body>/.exec(body)?.[1];
    const rich = /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/.exec(body)?.[1];
    let html = "";
    if (name === "code" || name === "noformat") {
      const lang = param(body, "language");
      html = `<pre><code${lang ? ` class="language-${lang}"` : ""}>${cdata(plain ?? "")}</code></pre>`;
    } else if (["info", "note", "tip", "warning", "panel", "expand"].includes(name)) {
      const title = param(body, "title") ??
        (name === "panel" || name === "expand" ? "" : name[0].toUpperCase() + name.slice(1));
      html = `<blockquote>${title ? `<p><strong>${title}</strong></p>` : ""}${rich ?? ""}</blockquote>`;
    } else if (name === "status") {
      html = `<code>${param(body, "title") ?? ""}</code>`;
    } else if (rich) {
      html = rich;
    } else if (plain) {
      html = `<pre>${cdata(plain)}</pre>`;
    }
    out = out.slice(0, m.index) + html + out.slice(m.index + all.length);
  }
  return cdata(out)
    .replace(/<ac:structured-macro\b[^>]*\/>/g, "")
    .replace(
      /<ac:task>\s*(?:<ac:task-id>[^<]*<\/ac:task-id>)?\s*(?:<ac:task-uuid>[^<]*<\/ac:task-uuid>)?\s*<ac:task-status>(\w+)<\/ac:task-status>\s*<ac:task-body>([\s\S]*?)<\/ac:task-body>\s*<\/ac:task>/g,
      (_, status: string, body: string) => `<li>${status === "complete" ? "☑" : "☐"} ${body}</li>`,
    )
    .replace(/<ac:task-list>/g, "<ul>").replace(/<\/ac:task-list>/g, "</ul>")
    .replace(
      /<ac:link\b[^>]*>([\s\S]*?)<\/ac:link>/g,
      (_, inner: string) => {
        const text = /<ac:(?:plain-text-)?link-body>([\s\S]*?)<\/ac:(?:plain-text-)?link-body>/.exec(inner)?.[1];
        const page = /ri:content-title="([^"]*)"/.exec(inner)?.[1];
        const user = /<ri:user\b/.test(inner);
        const file = /ri:filename="([^"]*)"/.exec(inner)?.[1];
        const shown = text?.trim() || page || file || (user ? "@someone" : "");
        return shown ? `<em>${shown}</em>` : "";
      },
    )
    .replace(/<ac:image\b[^>]*>([\s\S]*?)<\/ac:image>/g, (_, inner: string) => {
      const url = /ri:value="([^"]*)"/.exec(inner)?.[1];
      const file = /ri:filename="([^"]*)"/.exec(inner)?.[1];
      return url ? `<img src="${url}" alt="${file ?? "Image"}">` : file ? `<em>[${file}]</em>` : "";
    })
    .replace(/<ac:emoticon\b[^>]*ac:emoji-fallback="([^"]*)"[^>]*\/>/g, "$1")
    .replace(/<ac:emoticon\b[^>]*\/>/g, "")
    .replace(/<ac:placeholder>[\s\S]*?<\/ac:placeholder>/g, "")
    .replace(/<time\b[^>]*datetime="([^"]*)"[^>]*\/>/g, "$1");
}

export function confluenceContent(p: ConfluencePage, base: string): Content {
  return {
    markdown: htmlToMarkdown(storageToHtml(p.body?.storage?.value ?? ""), `${base}/wiki/`),
    updated: p.version?.when,
    author: p.version?.by?.displayName,
    tags: (p.metadata?.labels?.results ?? []).map((l) => l.name),
  };
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
 * Where the wikis are, as declared in `[permissions] net` (kept equal by a
 * test): Outline's cloud, Confluence Cloud, and self-hosted Outline,
 * BookStack or Wiki.js on this computer, a container, the local network,
 * Tailscale or DuckDNS.
 */
export const HOSTS = [
  "app.getoutline.com",
  "*.getoutline.com",
  "*.atlassian.net",
  "localhost",
  "127.0.0.1",
  "outline",
  "bookstack",
  "wikijs",
  "wiki",
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

/** `wiki.home.lan/books/x` or `…/api` → the wiki's address: http:// for a local host typed without a scheme. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    const host = url.split(/[/:]/)[0].toLowerCase();
    url = `${isLocal(host) ? "http" : "https"}://${url}`;
  }
  try {
    const u = new URL(url);
    // The address of the wiki is its origin; BookStack and Wiki.js may live under a path, kept when it isn't theirs.
    const path = u.pathname
      .replace(
        /\/(api|graphql|home|books|shelves|search|login|doc|collection|settings|admin|[a-z]{2}\/home)(\/.*)?$/i,
        "",
      )
      .replace(/\/+$/, "");
    return `${u.origin}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}
