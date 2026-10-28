// A small HTML → Markdown converter for the launcher's markdown subset (headings,
// paragraphs, **bold**, *italic*, `code`, fenced code, [links](url), lists,
// > quotes, ---). Enough for Stack Exchange posts and NixOS option docs.

export interface Node {
  tag: string;
  attrs: Record<string, string>;
  children: (Node | string)[];
}

const VOID = new Set(["br", "hr", "img", "input", "meta", "link", "wbr", "source", "col", "area"]);
/** Closing one of these closes an open <p> or <li> left unclosed (HTML's optional end tags). */
const AUTO_CLOSE: Record<string, string[]> = { p: ["p"], li: ["li"], dt: ["dt", "dd"], dd: ["dt", "dd"], tr: ["tr"] };

const ENTITIES: Record<string, string> = {
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
  ldquo: "“",
  rdquo: "”",
  lsquo: "‘",
  rsquo: "’",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  rarr: "→",
  larr: "←",
  bull: "•",
  middot: "·",
  deg: "°",
};

/** `&amp;`, `&#39;`, `&#x27;` → characters. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

function parseAttrs(text: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of text.matchAll(/([a-zA-Z_:][\w:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/** A forgiving parser: unknown or unbalanced tags never throw. */
export function parse(html: string): Node {
  const root: Node = { tag: "#root", attrs: {}, children: [] };
  const stack: Node[] = [root];
  const top = () => stack[stack.length - 1];
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^>]*?)?)\s*(\/?)>/g;
  let last = 0;
  for (const m of html.matchAll(re)) {
    if (m.index! > last) top().children.push(html.slice(last, m.index));
    last = m.index! + m[0].length;
    if (m[0].startsWith("<!--")) continue;
    const [, closing, rawTag, attrs, selfClosing] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      const at = stack.map((n) => n.tag).lastIndexOf(tag);
      if (at > 0) stack.length = at;
      continue;
    }
    const closes = AUTO_CLOSE[tag];
    if (closes && closes.includes(top().tag)) stack.pop();
    const node: Node = { tag, attrs: parseAttrs(attrs ?? ""), children: [] };
    top().children.push(node);
    if (!VOID.has(tag) && !selfClosing) stack.push(node);
  }
  if (last < html.length) top().children.push(html.slice(last));
  return root;
}

/** The text inside a node, as written (for <pre>). */
export function textOf(node: Node | string): string {
  if (typeof node === "string") return decodeEntities(node);
  if (node.tag === "br") return "\n";
  return node.children.map(textOf).join("");
}

/** The language of a code block: `lang-py`, `language-python` or `hljs language-js`. */
function language(node: Node): string {
  const code = node.children.find((c): c is Node => typeof c !== "string" && c.tag === "code");
  const classes = `${code?.attrs.class ?? ""} ${node.attrs.class ?? ""}`;
  const m = classes.match(/\b(?:lang|language)-([\w+#.-]+)/);
  return m && m[1] !== "none" ? m[1] : "";
}

/** Every code block of an HTML text, as written. */
export function codeBlocks(html: string): { code: string; language: string }[] {
  const out: { code: string; language: string }[] = [];
  const walk = (n: Node) => {
    for (const c of n.children) {
      if (typeof c === "string") continue;
      if (c.tag === "pre") out.push({ code: textOf(c).replace(/^\n/, "").replace(/\s+$/, ""), language: language(c) });
      else walk(c);
    }
  };
  walk(parse(html));
  return out;
}

/**
 * The launcher's renderer has no escapes and turns `_x` and `*x` into italics,
 * so words with those characters (snake_case, *args) are shown as code.
 */
function protect(text: string): string {
  return text.replace(/[^\s`]*[_*][^\s`]*/g, (word) => {
    if (!/[_*]\S/.test(word) && !/\S[_*]/.test(word)) return word;
    const m = word.match(/^(.*?)([.,;:!?)]*)$/)!;
    return `\`${m[1]}\`${m[2]}`;
  });
}

interface Options {
  /** Turns relative links into absolute ones. */
  base?: string;
  /** Added to heading levels, for a post shown under a heading of its own. */
  shift?: number;
}

const BLOCK = "\u0000"; // marks a paragraph break while rendering

function inlineCode(text: string): string {
  const t = text.replace(/\s+/g, " ");
  return t.includes("`") ? t.replaceAll("`", "'") : t;
}

function href(url: string, o: Options): string {
  if (!o.base || /^[a-z][\w+.-]*:/i.test(url)) return url;
  try {
    return new URL(url, o.base).href;
  } catch {
    return url;
  }
}

function render(node: Node | string, o: Options, depth: number): string {
  if (typeof node === "string") return protect(decodeEntities(node).replace(/[\s ]+/g, " "));
  const inner = () => node.children.map((c) => render(c, o, depth)).join("");
  switch (node.tag) {
    case "br":
      return "\n";
    case "hr":
      return `${BLOCK}---${BLOCK}`;
    case "p":
    case "div":
    case "section":
    case "article":
    case "header":
    case "footer":
    case "figure":
    case "figcaption":
    case "details":
    case "summary":
    case "center":
      return `${BLOCK}${inner()}${BLOCK}`;
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6": {
      const text = inner().replace(/\s+/g, " ").trim();
      return text ? `${BLOCK}${"#".repeat(Math.min(3, Number(node.tag[1]) + (o.shift ?? 0)))} ${text}${BLOCK}` : "";
    }
    case "strong":
    case "b": {
      const text = inner().trim();
      return text ? `**${text}**` : "";
    }
    case "em":
    case "i":
    case "cite": {
      const text = inner().trim();
      return text && !text.includes("*") ? `*${text}*` : text;
    }
    case "code":
    case "kbd":
    case "samp":
    case "tt": {
      const text = inlineCode(textOf(node));
      return text.trim() ? `\`${text}\`` : "";
    }
    case "pre": {
      const code = textOf(node).replace(/^\n/, "").replace(/\s+$/, "");
      return `${BLOCK}\`\`\`${language(node)}\n${code}\n\`\`\`${BLOCK}`;
    }
    case "a": {
      const text = inner().trim();
      const url = node.attrs.href ? href(node.attrs.href, o) : "";
      if (!url || url.startsWith("#") || url.includes(" ")) return text;
      const label = (text || url).replace(/[[\]]/g, "").replace(/`/g, "");
      return `[${label}](${url.replace(/\)/g, "%29")})`;
    }
    case "img": {
      const src = node.attrs.src ? href(node.attrs.src, o) : "";
      const alt = (node.attrs.alt || "Image").replace(/[[\]]/g, "");
      return src && !src.includes(" ") ? `[${alt}](${src})` : alt;
    }
    case "ul":
    case "ol": {
      let n = Number(node.attrs.start ?? 1) || 1;
      const items = node.children.filter((c): c is Node => typeof c !== "string" && c.tag === "li").map((li) => {
        const marker = node.tag === "ol" ? `${n++}. ` : "- ";
        const body = finish(li.children.map((c) => render(c, o, depth + 1)).join(""));
        const indent = "  ".repeat(depth);
        const lines = body.split("\n").filter((l) => l.trim());
        return lines.map((l, i) =>
          i === 0 ? `${indent}${marker}${l}` : /^\s*(- |\d+\. )/.test(l) || l.startsWith("```") ? l : `${indent}  ${l}`
        ).join("\n");
      });
      return `${BLOCK}${items.join("\n")}${BLOCK}`;
    }
    case "li":
      return `${BLOCK}- ${inner()}${BLOCK}`;
    case "blockquote": {
      const body = finish(inner());
      let fence = false;
      const lines = body.split("\n").flatMap((l) => {
        if (l.startsWith("```")) {
          fence = !fence;
          return [];
        }
        return l.trim() ? [fence ? `> \`${l}\`` : `> ${l}`] : [];
      });
      return `${BLOCK}${lines.join("\n")}${BLOCK}`;
    }
    case "dl":
      return `${BLOCK}${inner()}${BLOCK}`;
    case "dt":
      return `${BLOCK}**${inner().trim()}**\n`;
    case "dd":
      return `${inner().trim()}${BLOCK}`;
    case "table":
      return `${BLOCK}${inner()}${BLOCK}`;
    case "tr": {
      const cells = node.children.filter((c): c is Node => typeof c !== "string" && (c.tag === "td" || c.tag === "th"))
        .map((c) => finish(c.children.map((x) => render(x, o, depth)).join("")).replace(/\n+/g, " "));
      return cells.length ? `- ${cells.join(" · ")}\n` : "";
    }
    case "thead":
    case "tbody":
    case "tfoot":
      return inner().replace(/^\s+/, "");
    case "script":
    case "style":
    case "head":
    case "title":
      return "";
    default:
      return inner();
  }
}

/** Joins the rendered pieces: paragraph marks become blank lines, spaces are tidied outside code. */
function finish(text: string): string {
  const code: string[] = [];
  const parts = text.split(/(```[^\n]*\n[\s\S]*?\n```)/);
  const joined = parts.map((part, i) => {
    if (i % 2) {
      code.push(part);
      return `\n\n\uE001${code.length - 1}\uE001\n\n`;
    }
    return part
      .split(BLOCK).join("\n\n")
      .split("\n").map((l) => l.replace(/^ +(?![ \d-])/, "").replace(/ +$/, "")).join("\n");
  }).join("").replace(/\n{3,}/g, "\n\n").trim();
  // Code blocks go back as they were, blank lines included.
  return joined.replace(/\uE001(\d+)\uE001/g, (_, n) => code[Number(n)]);
}

/** HTML → markdown for the detail views. */
export function htmlToMarkdown(html: string, options: Options = {}): string {
  return finish(render(parse(html), options, 0));
}

/** Plain text of an HTML snippet, whitespace collapsed (subtitles, excerpts). */
export function htmlToText(html: string): string {
  return textOf(parse(html)).replace(/\s+/g, " ").trim();
}
