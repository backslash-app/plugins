// vCard 2.1/3.0/4.0 parsing, CardDAV XML, birthdays and formatting. No I/O here.

// ---------------------------------------------------------------------------
// vCard

export type Typed = { value: string; types: string[] };

export type Address = {
  types: string[];
  poBox: string;
  extended: string;
  street: string;
  locality: string;
  region: string;
  postalCode: string;
  country: string;
};

export type Birthday = { year?: number; month: number; day: number };

export type Contact = {
  /** UID, or the href / file path when the card has none. */
  id: string;
  name: string;
  given: string;
  family: string;
  nickname: string;
  org: string;
  title: string;
  emails: Typed[];
  phones: Typed[];
  addresses: Address[];
  urls: string[];
  birthday?: Birthday;
  note: string;
  /** An http(s) URL of the picture. */
  photoUrl?: string;
  /** A picture embedded in the card: base64 and its type. */
  photoData?: { base64: string; type: string };
  /** The card as text, without an embedded picture. */
  vcard: string;
  /** Address book name or file name. */
  source: string;
};

/** A property line: `item1.EMAIL;TYPE=work,pref:ada@example.com`. */
export type Property = { group?: string; name: string; params: Record<string, string[]>; value: string };

/** Joins folded lines (a line starting with a space or tab continues the previous one). */
export function unfold(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) out[out.length - 1] += line.slice(1);
    else if (out.length && /=$/.test(out[out.length - 1]) && /QUOTED-PRINTABLE/i.test(out[out.length - 1])) {
      // vCard 2.1 quoted-printable soft line breaks
      out[out.length - 1] = out[out.length - 1].slice(0, -1) + line;
    } else out.push(line);
  }
  return out.filter((l) => l.trim() !== "");
}

function splitUnquoted(text: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "", quoted = false;
  for (const ch of text) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

export function parseProperty(line: string): Property | undefined {
  // The value starts at the first colon outside quotes.
  let quoted = false, at = -1;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    if (line[i] === ":" && !quoted) {
      at = i;
      break;
    }
  }
  if (at < 0) return undefined;
  const [head, ...paramParts] = splitUnquoted(line.slice(0, at), ";");
  const dot = head.lastIndexOf(".");
  const params: Record<string, string[]> = {};
  for (const part of paramParts) {
    const eq = part.indexOf("=");
    // vCard 2.1 bare types: TEL;WORK;VOICE:
    const key = (eq < 0 ? "TYPE" : part.slice(0, eq)).toUpperCase().trim();
    const raw = eq < 0 ? part : part.slice(eq + 1);
    const values = splitUnquoted(raw, ",")
      .map((v) => v.replace(/^"|"$/g, ""))
      // TYPE="voice,cell" (vCard 4) is two types.
      .flatMap((v) => key === "TYPE" ? v.split(",") : [v])
      .map((v) => v.trim())
      .filter(Boolean);
    params[key] = [...(params[key] ?? []), ...values];
  }
  return {
    group: dot > 0 ? head.slice(0, dot) : undefined,
    name: (dot > 0 ? head.slice(dot + 1) : head).toUpperCase().trim(),
    params,
    value: line.slice(at + 1),
  };
}

/** `\n`, `\,`, `\;` and `\\` of a text value. */
export function unescapeValue(text: string): string {
  return text.replace(/\\([nN,;\\:])/g, (_, c: string) => c === "n" || c === "N" ? "\n" : c);
}

/** Splits a structured value (N, ADR, ORG) on unescaped semicolons. */
export function components(text: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\" && i + 1 < text.length) {
      cur += text[i] + text[i + 1];
      i++;
    } else if (text[i] === ";") {
      out.push(unescapeValue(cur));
      cur = "";
    } else cur += text[i];
  }
  out.push(unescapeValue(cur));
  return out;
}

function decodeQuotedPrintable(text: string, charset = "utf-8"): string {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "=" && /^[0-9A-F]{2}$/i.test(text.slice(i + 1, i + 3))) {
      bytes.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(text.charCodeAt(i) & 0xff);
  }
  try {
    return new TextDecoder(charset).decode(new Uint8Array(bytes));
  } catch {
    return new TextDecoder().decode(new Uint8Array(bytes));
  }
}

/** The decoded text of a property (quoted-printable of vCard 2.1 included). */
export function textOf(p: Property): string {
  const enc = (p.params.ENCODING ?? []).map((e) => e.toUpperCase());
  if (enc.includes("QUOTED-PRINTABLE")) return decodeQuotedPrintable(p.value, p.params.CHARSET?.[0]);
  return p.value;
}

/** TYPE parameters in lower case, `pref` included (vCard 4 `PREF=1` too). */
function typesOf(p: Property): string[] {
  const types = (p.params.TYPE ?? []).flatMap((t) => t.split(",")).map((t) => t.toLowerCase().trim());
  if (p.params.PREF) types.push("pref");
  return [...new Set(types.filter((t) => t && t !== "internet" && t !== "x400"))];
}

/** "19850412", "1985-04-12", "--0412", "--04-12", "1985-04-12T00:00:00Z"; year 1604 means none (Apple). */
export function parseBirthday(value: string, params: Record<string, string[]> = {}): Birthday | undefined {
  const v = value.trim();
  let m = /^--(\d{2})-?(\d{2})/.exec(v);
  if (m) return { month: Number(m[1]), day: Number(m[2]) };
  m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(v);
  if (!m) return undefined;
  const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const omitted = params["X-APPLE-OMIT-YEAR"]?.[0];
  const noYear = year === 1604 || (omitted !== undefined && Number(omitted) === year) || year < 1800;
  return noYear ? { month, day } : { year, month, day };
}

function photoOf(p: Property): { url?: string; data?: { base64: string; type: string } } {
  const v = p.value.trim();
  const dataUri = /^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/is.exec(v);
  if (dataUri) return { data: { type: (dataUri[1] ?? "image/jpeg").toLowerCase(), base64: dataUri[2] } };
  if (/^https?:\/\//i.test(v)) return { url: v };
  const enc = (p.params.ENCODING ?? []).map((e) => e.toLowerCase());
  if (enc.includes("b") || enc.includes("base64")) {
    const t = (p.params.TYPE?.[0] ?? "jpeg").toLowerCase();
    return { data: { base64: v.replace(/\s+/g, ""), type: t.includes("/") ? t : `image/${t}` } };
  }
  return {};
}

const empty = (): Omit<Contact, "id" | "vcard" | "source"> => ({
  name: "",
  given: "",
  family: "",
  nickname: "",
  org: "",
  title: "",
  emails: [],
  phones: [],
  addresses: [],
  urls: [],
  note: "",
});

/** One card (BEGIN:VCARD … END:VCARD). */
export function parseCard(text: string, source = "", fallbackId = ""): Contact {
  const c = empty();
  let uid = "";
  const kept: string[] = [];
  for (const line of unfold(text)) {
    const p = parseProperty(line);
    if (!p) continue;
    if (p.name !== "PHOTO") kept.push(line);
    const value = textOf(p);
    switch (p.name) {
      case "FN":
        c.name = unescapeValue(value).trim();
        break;
      case "N": {
        const [family = "", given = ""] = components(value);
        c.family = family.trim();
        c.given = given.trim();
        break;
      }
      case "NICKNAME":
        c.nickname = unescapeValue(value).split(",")[0].trim();
        break;
      case "ORG":
        c.org = components(value).map((s) => s.trim()).filter(Boolean).join(" · ");
        break;
      case "TITLE":
        c.title = unescapeValue(value).trim();
        break;
      case "EMAIL": {
        const v = unescapeValue(value).replace(/^mailto:/i, "").trim();
        if (v) c.emails.push({ value: v, types: typesOf(p) });
        break;
      }
      case "TEL": {
        const v = unescapeValue(value).replace(/^tel:/i, "").trim();
        if (v) c.phones.push({ value: v, types: typesOf(p) });
        break;
      }
      case "ADR": {
        const [poBox = "", extended = "", street = "", locality = "", region = "", postalCode = "", country = ""] =
          components(value).map((s) => s.trim());
        if ([poBox, extended, street, locality, region, postalCode, country].some(Boolean)) {
          c.addresses.push({ types: typesOf(p), poBox, extended, street, locality, region, postalCode, country });
        }
        break;
      }
      case "URL": {
        const v = unescapeValue(value).trim();
        if (v) c.urls.push(v);
        break;
      }
      case "BDAY":
        c.birthday = parseBirthday(value, p.params) ?? c.birthday;
        break;
      case "NOTE":
        c.note = unescapeValue(value).trim();
        break;
      case "PHOTO": {
        const photo = photoOf(p);
        if (photo.url) c.photoUrl = photo.url;
        if (photo.data) c.photoData = photo.data;
        break;
      }
      case "UID":
        uid = unescapeValue(value).trim();
        break;
    }
  }
  // Prefer the "pref" ones first.
  const pref = (a: Typed, b: Typed) => Number(b.types.includes("pref")) - Number(a.types.includes("pref"));
  c.emails.sort(pref);
  c.phones.sort(pref);
  if (!c.name) {
    c.name = [c.given, c.family].filter(Boolean).join(" ") || c.org || c.emails[0]?.value || c.phones[0]?.value || "";
  }
  return { ...c, id: uid || fallbackId || c.name, vcard: kept.join("\r\n") + "\r\n", source };
}

/** Every card of a .vcf file (exports hold many). */
export function parseVcf(text: string, source = "", idPrefix = ""): Contact[] {
  const out: Contact[] = [];
  const re = /BEGIN:VCARD[\s\S]*?END:VCARD/gi;
  let m: RegExpExecArray | null, n = 0;
  while ((m = re.exec(text))) {
    const c = parseCard(m[0], source, `${idPrefix}#${n++}`);
    if (c.name) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Formatting

const TYPE_LABELS: Record<string, string> = {
  home: "Home",
  work: "Work",
  cell: "Mobile",
  mobile: "Mobile",
  iphone: "iPhone",
  main: "Main",
  fax: "Fax",
  pager: "Pager",
  voice: "",
  pref: "",
  text: "",
  other: "Other",
};

/** "Work", "Mobile", "Home · Fax"; empty when nothing is said. */
export function typeLabel(types: string[]): string {
  return [...new Set(types.map((t) => TYPE_LABELS[t] ?? (t.startsWith("x-") ? "" : t[0].toUpperCase() + t.slice(1))))]
    .filter(Boolean)
    .join(" · ");
}

/** An address on several lines, as on an envelope. */
export function formatAddress(a: Address): string {
  return [
    a.poBox,
    a.extended,
    ...a.street.split("\n"),
    [a.postalCode, a.locality].filter(Boolean).join(" "),
    a.region,
    a.country,
  ].map((s) => s.trim()).filter(Boolean).join("\n");
}

/** `tel:` URI of a phone number: "+33 6 12 34 56 78" → "tel:+33612345678". */
export function telUri(phone: string): string {
  return `tel:${phone.replace(/[^\d+*#,;]/g, "")}`;
}

/** Initials for an avatar: "Ada Lovelace" → "AL". */
export function initials(name: string): string {
  const words = name.split(/[\s.-]+/).filter((w) => /\p{L}/u.test(w));
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 2)).toUpperCase();
}

/** "Ada Lovelace <ada@example.com>" */
export function emailWithName(c: Contact, email = c.emails[0]?.value): string {
  if (!email) return "";
  return /[",<>@]/.test(c.name) || !c.name ? email : `${c.name} <${email}>`;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatBirthday(b: Birthday): string {
  return `${b.day} ${MONTHS[b.month - 1]}${b.year ? ` ${b.year}` : ""}`;
}

/** The next birthday on or after `today` (local), with how many days until and the age then. */
export function nextBirthday(b: Birthday, today = new Date()): { date: Date; days: number; age?: number } {
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const make = (year: number) => {
    // 29 February is celebrated on 28 February in other years.
    const leap = new Date(year, 1, 29).getMonth() === 1;
    return new Date(year, b.month - 1, b.month === 2 && b.day === 29 && !leap ? 28 : b.day);
  };
  let date = make(start.getFullYear());
  if (date < start) date = make(start.getFullYear() + 1);
  const days = Math.round((date.getTime() - start.getTime()) / 86_400_000);
  return { date, days, age: b.year ? date.getFullYear() - b.year : undefined };
}

/** Contacts whose birthday is in the next `within` days, soonest first. */
export function upcomingBirthdays(contacts: Contact[], today = new Date(), within = 30) {
  return contacts
    .filter((c) => c.birthday)
    .map((c) => ({ contact: c, ...nextBirthday(c.birthday!, today) }))
    .filter((x) => x.days <= within)
    .sort((a, b) => a.days - b.days || a.contact.name.localeCompare(b.contact.name));
}

export function inDays(days: number): string {
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}

/** The whole card as markdown, for the preview panel. */
export function contactMarkdown(c: Contact): string {
  const lines: string[] = [`## ${c.name}`];
  const role = [c.title, c.org].filter(Boolean).join(", ");
  if (role) lines.push("", `_${role}_`);
  if (c.emails.length) {
    lines.push("", "**Email**", "");
    for (const e of c.emails) lines.push(`- ${e.value}${typeLabel(e.types) ? ` · ${typeLabel(e.types)}` : ""}`);
  }
  if (c.phones.length) {
    lines.push("", "**Phone**", "");
    for (const p of c.phones) lines.push(`- ${p.value}${typeLabel(p.types) ? ` · ${typeLabel(p.types)}` : ""}`);
  }
  for (const a of c.addresses) {
    lines.push("", `**Address${typeLabel(a.types) ? ` · ${typeLabel(a.types)}` : ""}**`, "");
    lines.push(...formatAddress(a).split("\n").map((l) => `${l}  `));
  }
  if (c.urls.length) {
    lines.push("", "**Web**", "");
    for (const u of c.urls) lines.push(`- ${u}`);
  }
  if (c.note) lines.push("", "**Note**", "", ...c.note.split("\n").map((l) => `> ${l}`));
  return lines.join("\n");
}

/** Sorted by name, ignoring accents and case. */
export function sortContacts(contacts: Contact[]): Contact[] {
  return [...contacts].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** The same person from two address books (or a file and a server): kept once. */
export function dedupe(contacts: Contact[]): Contact[] {
  const seen = new Map<string, Contact>();
  for (const c of contacts) {
    const key = `${c.name.toLowerCase()}\u0000${c.emails[0]?.value.toLowerCase() ?? c.phones[0]?.value ?? ""}`;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// XML (WebDAV multistatus), without a DOM

export type XmlNode = { name: string; attrs: Record<string, string>; children: XmlNode[]; text: string };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
    if (e[0] === "#") {
      return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e.toLowerCase()] ?? _;
  });
}

/** A small XML parser: elements by local name (namespace prefixes dropped), text, CDATA. */
export function parseXml(xml: string): XmlNode {
  const root: XmlNode = { name: "#root", attrs: {}, children: [], text: "" };
  const stack = [root];
  const re =
    /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([\w:.-]+)((?:\s+[^\s=>/]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decodeEntities(m[6]);
    else if (m[3]) {
      const local = m[3].replace(/^[\w.-]+:/, "").toLowerCase();
      if (m[2]) {
        // closing tag: pop to the matching element
        for (let i = stack.length - 1; i > 0; i--) {
          if (stack[i].name === local) {
            stack.length = i;
            break;
          }
        }
      } else {
        const attrs: Record<string, string> = {};
        for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
          attrs[a[1].replace(/^[\w.-]+:/, "").toLowerCase()] = decodeEntities(a[2] ?? a[3] ?? "");
        }
        const node: XmlNode = { name: local, attrs, children: [], text: "" };
        top.children.push(node);
        if (!m[5]) stack.push(node);
      }
    }
  }
  return root;
}

export function find(node: XmlNode, name: string): XmlNode | undefined {
  for (const c of node.children) {
    if (c.name === name) return c;
    const deep = find(c, name);
    if (deep) return deep;
  }
  return undefined;
}

export function findAll(node: XmlNode, name: string, out: XmlNode[] = []): XmlNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    else findAll(c, name, out);
  }
  return out;
}

export type DavResponse = {
  href: string;
  /** Properties found (status 200), by local name. */
  props: Record<string, XmlNode>;
};

/** The `<response>`s of a 207 Multi-Status, with the properties that were found. */
export function parseMultistatus(xml: string): DavResponse[] {
  return findAll(parseXml(xml), "response").map((r) => {
    const href = (find(r, "href")?.text ?? "").trim();
    const props: Record<string, XmlNode> = {};
    for (const ps of findAll(r, "propstat")) {
      const status = find(ps, "status")?.text ?? "200";
      if (!/\s2\d\d\s|^2\d\d$|HTTP\/[\d.]+ 2/.test(status)) continue;
      const prop = find(ps, "prop");
      for (const p of prop?.children ?? []) props[p.name] = p;
    }
    return { href, props };
  });
}

/** The href inside a property like `current-user-principal` or `addressbook-home-set`. */
export function hrefIn(node: XmlNode | undefined): string | undefined {
  const h = node ? find(node, "href") : undefined;
  return h?.text.trim() || undefined;
}

export function isAddressBook(r: DavResponse): boolean {
  return !!(r.props.resourcetype && find(r.props.resourcetype, "addressbook"));
}

/** Resolves an href against the URL it came from. */
export function resolveHref(href: string, base: string): string {
  return new URL(href, base).toString();
}

export const XML_PRINCIPAL = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/><d:resourcetype/></d:prop></d:propfind>`;

export const XML_HOME = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:prop><card:addressbook-home-set/></d:prop></d:propfind>`;

export const XML_BOOKS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:displayname/></d:prop></d:propfind>`;

export const XML_QUERY = `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-query xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:prop><d:getetag/><card:address-data/></d:prop></card:addressbook-query>`;

export const XML_ETAGS = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/><d:resourcetype/></d:prop></d:propfind>`;

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function multigetXml(hrefs: string[]): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<card:addressbook-multiget xmlns:d="DAV:" xmlns:card="urn:ietf:params:xml:ns:carddav">
<d:prop><d:getetag/><card:address-data/></d:prop>
${hrefs.map((h) => `<d:href>${escapeXml(h)}</d:href>`).join("\n")}
</card:addressbook-multiget>`;
}

/** Cards of a REPORT answer. */
export function cardsOf(xml: string, source: string): Contact[] {
  return parseMultistatus(xml).flatMap((r) => {
    const data = r.props["address-data"]?.text;
    if (!data || !/BEGIN:VCARD/i.test(data)) return [];
    const c = parseCard(data, source, r.href);
    return c.name ? [c] : [];
  });
}

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where an address book can be: the main CardDAV providers, and a Nextcloud,
 * Radicale or Baïkal on this computer, the local network or Tailscale. Same
 * list as `[permissions] net` (a test checks it).
 */
export const HOSTS = [
  "www.googleapis.com",
  "*.icloud.com",
  "carddav.fastmail.com",
  "dav.mailbox.org",
  "posteo.de",
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

/** `cloud.home.lan/remote.php/dav` → `https://cloud.home.lan/remote.php/dav/`. */
export function normalizeServer(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.endsWith("/") ? url : `${url}/`;
}

/** `~/Contacts` → `/home/ada/Contacts`. */
export function expandHome(path: string, home: string | undefined): string {
  const p = path.trim();
  if (p === "~") return home ?? p;
  if (p.startsWith("~/") && home) return `${home}${p.slice(1)}`;
  return p;
}
