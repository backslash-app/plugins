// A small XML reader for BoardGameGeek's XML API: elements, attributes, text,
// CDATA, comments and entities. No namespaces, no DTDs: BGG uses neither.

export interface Node {
  name: string;
  attrs: Record<string, string>;
  children: Node[];
  text: string;
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  bull: "•",
  middot: "·",
  times: "×",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  uuml: "ü",
  ouml: "ö",
  auml: "ä",
  szlig: "ß",
  deg: "°",
  copy: "©",
  reg: "®",
  trade: "™",
};

/** `&amp;` → `&`, `&#10;` → newline, `&eacute;` → `é`. Unknown entities are kept. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[e] ?? NAMED[e.toLowerCase()] ?? whole;
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** Parses a document and returns its root element. Throws on text that isn't XML. */
export function parseXml(xml: string): Node {
  const root: Node = { name: "#document", attrs: {}, children: [], text: "" };
  const stack: Node[] = [root];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const top = stack[stack.length - 1];
    if (lt === -1) {
      top.text += decodeEntities(xml.slice(i));
      break;
    }
    if (lt > i) top.text += decodeEntities(xml.slice(i, lt));
    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4);
      i = end === -1 ? xml.length : end + 3;
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9);
      top.text += xml.slice(lt + 9, end === -1 ? xml.length : end);
      i = end === -1 ? xml.length : end + 3;
    } else if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2);
      i = end === -1 ? xml.length : end + 2;
    } else if (xml.startsWith("<!", lt)) {
      const end = xml.indexOf(">", lt + 2);
      i = end === -1 ? xml.length : end + 1;
    } else if (xml[lt + 1] === "/") {
      const end = xml.indexOf(">", lt);
      const name = xml.slice(lt + 2, end).trim();
      // Close up to the matching element; a stray closing tag is ignored.
      const at = stack.map((n) => n.name).lastIndexOf(name);
      if (at > 0) stack.length = at;
      i = end === -1 ? xml.length : end + 1;
    } else {
      // Find the end of the tag, skipping ">" inside quoted attribute values.
      let j = lt + 1, quote = "";
      while (j < xml.length) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = "";
        } else if (c === '"' || c === "'") quote = c;
        else if (c === ">") break;
        j++;
      }
      if (j >= xml.length) throw new Error("Not XML: a tag is never closed");
      let body = xml.slice(lt + 1, j);
      const selfClosing = body.endsWith("/");
      if (selfClosing) body = body.slice(0, -1);
      const name = /^[^\s/>]+/.exec(body)?.[0];
      if (!name) throw new Error("Not XML: a tag has no name");
      const node: Node = { name, attrs: {}, children: [], text: "" };
      for (const m of body.slice(name.length).matchAll(ATTR)) node.attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? "");
      top.children.push(node);
      if (!selfClosing) stack.push(node);
      i = j + 1;
    }
  }
  const first = root.children[0];
  if (!first) throw new Error("Not XML: no element");
  return first;
}

/** Direct children named `name`. */
export function all(node: Node | undefined, name: string): Node[] {
  return node ? node.children.filter((c) => c.name === name) : [];
}

/** The first direct child named `name`. */
export function child(node: Node | undefined, name: string): Node | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Every descendant named `name`, depth first. */
export function find(node: Node | undefined, name: string): Node[] {
  if (!node) return [];
  return node.children.flatMap((c) => [...(c.name === name ? [c] : []), ...find(c, name)]);
}

/** `<minplayers value="3"/>` → "3"; `<name>Catan</name>` → "Catan". */
export function value(node: Node | undefined, name: string): string | undefined {
  const c = child(node, name);
  if (!c) return undefined;
  return c.attrs.value ?? (c.text.trim() || undefined);
}

/** A number from `value()`, or undefined for missing, empty, "N/A" or 0 when `zeroIsMissing`. */
export function num(node: Node | undefined, name: string, zeroIsMissing = true): number | undefined {
  const v = value(node, name);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || (zeroIsMissing && n === 0)) return undefined;
  return n;
}
