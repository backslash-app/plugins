// The text, XML and date helpers of extensions/hacker-news (lib.ts), copied
// as they are: a forgiving parser for feeds found in the wild. Pure, tested in
// lib_test.ts.

// ---------------------------------------------------------------------------
// Text

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  copy: "©",
  reg: "®",
  trade: "™",
  euro: "€",
  pound: "£",
  deg: "°",
  times: "×",
  eacute: "é",
  egrave: "è",
  ecirc: "ê",
  agrave: "à",
  acirc: "â",
  ccedil: "ç",
  ocirc: "ô",
  ucirc: "û",
  icirc: "î",
  ouml: "ö",
  uuml: "ü",
  auml: "ä",
  szlig: "ß",
  thinsp: " ",
  zwnj: "",
  shy: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e] ?? ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** HTML → one line of plain text. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>|<\/p>/gi, " ").replace(/<[^>]+>/g, ""),
  ).replace(/\s+/g, " ").trim();
}

/**
 * HTML (HN comments, feed articles) → the launcher's markdown subset:
 * paragraphs, links, emphasis, code blocks, lists, quotes, headings.
 */
export function htmlToMarkdown(html: string): string {
  const blocks: string[] = [];
  // Code blocks first, so their content is kept as is.
  let s = html.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code: string) => {
    blocks.push(decodeEntities(code.replace(/<\/?code[^>]*>/gi, "").replace(/<[^>]+>/g, "")).replace(/\n+$/, ""));
    return `\n\n\uE000${blocks.length - 1}\uE000\n\n`;
  });
  s = s
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_, l: string, t: string) => `\n\n${"#".repeat(Math.min(3, Number(l) + 1))} ${t}\n\n`,
    )
    .replace(/<a\s[^>]*?href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, label: string) => {
      const text = htmlToText(label).replace(/[[\]]/g, "") || href;
      const url = decodeEntities(href).replace(/ /g, "%20");
      return /^https?:/i.test(url) ? `[${text}](${url})` : text;
    })
    .replace(/<(b|strong)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _t, _a, t: string) => t.trim() ? `**${t.trim()}**` : "")
    .replace(/<(i|em)(\s[^>]*)?>([\s\S]*?)<\/\1>/gi, (_, _t, _a, t: string) => t.trim() ? `*${t.trim()}*` : "")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(ul|ol)[^>]*>/gi, "\n\n")
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, q: string) => `\n\n> ${htmlToText(q)}\n\n`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|section|article|figure|figcaption|header|footer|table|tr)[^>]*>/gi, "\n\n")
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<[^>]+>/g, "");
  const text = decodeEntities(s)
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.replace(/\uE000(\d+)\uE000/g, (_, i: string) => "```\n" + blocks[Number(i)] + "\n```");
}

/** "https://www.example.com/a" → "example.com". */
export function domain(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** "5 min", "3 h", "2 d", then a date. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  if (s < 30 * 86400) return `${Math.floor(s / 86400)} d`;
  return new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function fullDate(ms: number): string {
  return new Date(ms).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// XML

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Text and CDATA directly inside, decoded. */
  text: string;
  /** Text and children in document order. */
  content: (string | XmlNode)[];
}

const node = (name: string, attrs: Record<string, string> = {}): XmlNode => ({
  name,
  attrs,
  children: [],
  text: "",
  content: [],
});

function addText(n: XmlNode, text: string) {
  if (!text) return;
  n.text += text;
  n.content.push(text);
}

function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of s.matchAll(/([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return attrs;
}

/**
 * A forgiving XML parser: enough for feeds found in the wild (CDATA,
 * entities, comments, doctype, unclosed or mismatched tags).
 */
export function parseXml(xml: string): XmlNode {
  const root = node("#document");
  const stack: XmlNode[] = [root];
  const top = () => stack[stack.length - 1];
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) {
      addText(top(), decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) addText(top(), decodeEntities(xml.slice(i, lt)));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      addText(top(), xml.slice(lt + 9, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end < 0 ? n : end + 2;
    } else if (xml.startsWith("<!", lt)) {
      // Doctype, possibly with an internal subset.
      const bracket = xml.indexOf("[", lt);
      const close = xml.indexOf(">", lt);
      const end = bracket >= 0 && bracket < close ? xml.indexOf("]>", bracket) + 1 : close;
      i = end <= 0 ? n : end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      const name = xml.slice(lt + 2, end < 0 ? n : end).trim();
      const at = stack.map((s) => s.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end < 0 ? n : end + 1;
    } else {
      // Find the end of the tag, skipping quoted attribute values.
      let j = lt + 1;
      let quote = "";
      while (j < n) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      const inner = xml.slice(lt + 1, j);
      const selfClosing = inner.endsWith("/");
      const m = /^([^\s/>]+)([\s\S]*)$/.exec(selfClosing ? inner.slice(0, -1) : inner);
      i = j + 1;
      if (!m) {
        addText(top(), "<");
        i = lt + 1;
        continue;
      }
      const el = node(m[1], parseAttrs(m[2]));
      top().children.push(el);
      top().content.push(el);
      if (!selfClosing) stack.push(el);
    }
  }
  return root;
}

/** The first child named `name` (qualified like `dc:creator`, or local like `link`). */
export function child(n: XmlNode | undefined, ...names: string[]): XmlNode | undefined {
  if (!n) return undefined;
  for (const name of names) {
    const found = name.includes(":")
      ? n.children.find((c) => c.name.toLowerCase() === name.toLowerCase())
      : n.children.find((c) => !c.name.includes(":") && c.name.toLowerCase() === name.toLowerCase());
    if (found) return found;
  }
  return undefined;
}

export function children(n: XmlNode | undefined, name: string): XmlNode[] {
  return n?.children.filter((c) => c.name.toLowerCase() === name.toLowerCase()) ?? [];
}

/** Serializes the content of a node back to markup (Atom `type="xhtml"`). */
export function innerXml(n: XmlNode): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return n.content.map((c) => {
    if (typeof c === "string") return esc(c);
    const attrs = Object.entries(c.attrs).map(([k, v]) => ` ${k}="${v.replace(/"/g, "&quot;")}"`).join("");
    return `<${c.name}${attrs}>${innerXml(c)}</${c.name}>`;
  }).join("");
}

export function allText(n: XmlNode): string {
  return n.content.map((c) => typeof c === "string" ? c : allText(c)).join("");
}

export const textOf = (n: XmlNode | undefined): string => n ? allText(n).trim() : "";

// ---------------------------------------------------------------------------
// Dates

const ZONES: Record<string, string> = {
  UT: "+0000",
  UTC: "+0000",
  GMT: "+0000",
  Z: "+0000",
  EST: "-0500",
  EDT: "-0400",
  CST: "-0600",
  CDT: "-0500",
  MST: "-0700",
  MDT: "-0600",
  PST: "-0800",
  PDT: "-0700",
  AKST: "-0900",
  AKDT: "-0800",
  HST: "-1000",
  WET: "+0000",
  WEST: "+0100",
  BST: "+0100",
  CET: "+0100",
  CEST: "+0200",
  MET: "+0100",
  MEST: "+0200",
  EET: "+0200",
  EEST: "+0300",
  MSK: "+0300",
  IST: "+0530",
  SGT: "+0800",
  HKT: "+0800",
  JST: "+0900",
  KST: "+0900",
  AEST: "+1000",
  AEDT: "+1100",
  NZST: "+1200",
  NZDT: "+1300",
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** RFC 822 (RSS), ISO 8601 (Atom) and the usual variations; milliseconds. */
export function parseDate(raw: string | undefined): number | undefined {
  const s = (raw ?? "").trim();
  if (!s) return undefined;
  // ISO 8601, possibly with a space instead of "T".
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i.exec(
    s,
  );
  if (iso) {
    const [, y, mo, d, h = "00", mi = "00", se = "00", z] = iso;
    const zone = !z || z.toUpperCase() === "Z" ? "Z" : z.length === 5 ? `${z.slice(0, 3)}:${z.slice(3)}` : z;
    const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${zone}`);
    return Number.isFinite(t) ? t : undefined;
  }
  // RFC 822: "Tue, 27 Oct 2026 14:03:00 +0100", weekday optional, zone names.
  const rfc =
    /^(?:[a-z]+,?\s*)?(\d{1,2})\s+([a-z]+)\.?\s+(\d{2,4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*([a-z]+|[+-]\d{4}|[+-]\d{2}:\d{2})?/i
      .exec(s);
  if (rfc) {
    const [, d, monName, yRaw, h = "0", mi = "0", se = "0", zRaw] = rfc;
    const mo = MONTHS.indexOf(monName.slice(0, 3).toLowerCase());
    if (mo >= 0) {
      const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
      const z = !zRaw ? "+0000" : /^[+-]/.test(zRaw) ? zRaw.replace(":", "") : ZONES[zRaw.toUpperCase()] ?? "+0000";
      const sign = z[0] === "-" ? -1 : 1;
      const offset = sign * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)));
      const t = Date.UTC(y, mo, Number(d), Number(h), Number(mi), Number(se)) - offset * 60_000;
      return Number.isFinite(t) ? t : undefined;
    }
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}
