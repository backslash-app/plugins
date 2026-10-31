// Mail Catcher logic: Mailpit's and MailHog's message shapes, reading raw MIME
// messages, and finding the verification codes and links in them. Pure,
// tested in lib_test.ts.

export type Kind = "mailpit" | "mailhog";

export interface Address {
  name?: string;
  address: string;
}

export interface Attachment {
  name: string;
  type: string;
  size: number;
  /** Mailpit: the part to download. */
  partId?: string;
}

/** A message as listed. */
export interface Summary {
  id: string;
  from?: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  /** ISO date. */
  date: string;
  /** MailHog has no read state: always true there. */
  read: boolean;
  size?: number;
  attachments: number;
  snippet?: string;
  tags: string[];
}

/** A message as read. */
export interface Message extends Summary {
  text?: string;
  html?: string;
  files: Attachment[];
}

// ---------------------------------------------------------------------------
// Mailpit (/api/v1)

interface MailpitAddress {
  Name?: string;
  Address: string;
}

export interface MailpitSummary {
  ID: string;
  MessageID?: string;
  Read?: boolean;
  From?: MailpitAddress | null;
  To?: MailpitAddress[] | null;
  Cc?: MailpitAddress[] | null;
  Subject?: string;
  Created?: string;
  Date?: string;
  Tags?: string[] | null;
  Size?: number;
  Attachments?: number | MailpitAttachment[] | null;
  Snippet?: string;
}

interface MailpitAttachment {
  PartID: string;
  FileName: string;
  ContentType: string;
  Size: number;
}

export interface MailpitMessage extends MailpitSummary {
  Text?: string;
  HTML?: string;
  Inline?: MailpitAttachment[] | null;
}

const addr = (a: MailpitAddress | null | undefined): Address | undefined =>
  a?.Address ? { name: a.Name || undefined, address: a.Address } : undefined;

export function fromMailpitSummary(m: MailpitSummary): Summary {
  return {
    id: m.ID,
    from: addr(m.From),
    to: (m.To ?? []).map(addr).filter((a): a is Address => !!a),
    cc: (m.Cc ?? []).map(addr).filter((a): a is Address => !!a),
    subject: m.Subject ?? "",
    date: m.Created ?? m.Date ?? "",
    read: m.Read ?? true,
    size: m.Size,
    attachments: Array.isArray(m.Attachments) ? m.Attachments.length : m.Attachments ?? 0,
    snippet: m.Snippet || undefined,
    tags: m.Tags ?? [],
  };
}

export function fromMailpitMessage(m: MailpitMessage): Message {
  return {
    ...fromMailpitSummary(m),
    date: m.Date ?? m.Created ?? "",
    text: m.Text || undefined,
    html: m.HTML || undefined,
    files: (Array.isArray(m.Attachments) ? m.Attachments : []).map((a) => ({
      name: a.FileName || "attachment",
      type: a.ContentType,
      size: a.Size,
      partId: a.PartID,
    })),
  };
}

// ---------------------------------------------------------------------------
// MailHog (/api/v2): every message comes whole, as raw MIME.

export interface MailHogItem {
  ID: string;
  Created?: string;
  Content?: { Headers?: Record<string, string[]>; Body?: string; Size?: number };
  Raw?: { From?: string; To?: string[]; Data?: string };
}

export function fromMailHog(item: MailHogItem): Message {
  const raw = item.Raw?.Data ??
    `${Object.entries(item.Content?.Headers ?? {}).map(([k, v]) => `${k}: ${v.join(", ")}`).join("\r\n")}\r\n\r\n${
      item.Content?.Body ?? ""
    }`;
  const mime = parseMime(raw);
  const h = mime.headers;
  const from = parseAddresses(h.from ?? "")[0] ?? (item.Raw?.From ? { address: item.Raw.From } : undefined);
  const to = parseAddresses(h.to ?? "");
  const text = mime.text ?? "";
  return {
    id: item.ID,
    from,
    to: to.length ? to : (item.Raw?.To ?? []).map((address) => ({ address })),
    cc: parseAddresses(h.cc ?? ""),
    subject: h.subject ?? "",
    date: item.Created ?? (h.date ? new Date(h.date).toISOString() : ""),
    read: true,
    size: item.Content?.Size ?? raw.length,
    attachments: mime.attachments.length,
    snippet: (text || htmlToText(mime.html ?? "")).replace(/\s+/g, " ").trim().slice(0, 200) || undefined,
    tags: [],
    text: mime.text,
    html: mime.html,
    files: mime.attachments,
  };
}

// ---------------------------------------------------------------------------
// MIME

/** RFC 2047 encoded words: `=?UTF-8?B?w6l0w6k=?=`, `=?iso-8859-1?Q?caf=E9?=`. */
export function decodeWords(text: string): string {
  return text
    .replace(/(=\?[^?]+\?[bq]\?[^?]*\?=)\s+(?==\?)/gi, "$1")
    .replace(/=\?([^?*]+)(?:\*[^?]*)?\?([bq])\?([^?]*)\?=/gi, (all, charset: string, enc: string, data: string) => {
      try {
        const bytes = enc.toLowerCase() === "b" ? base64Bytes(data) : qpBytes(data.replace(/_/g, " "), false);
        return decodeBytes(bytes, charset);
      } catch {
        return all;
      }
    });
}

function base64Bytes(data: string): Uint8Array {
  const clean = data.replace(/[^A-Za-z0-9+/]/g, "");
  const bin = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** Quoted-printable to bytes; characters above ASCII (8-bit bodies) are kept as UTF-8. */
function qpBytes(data: string, body = true): Uint8Array {
  const text = body ? data.replace(/=\r?\n/g, "") : data;
  const out: number[] = [];
  const enc = new TextEncoder();
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      const code = c.charCodeAt(0);
      if (code < 128) out.push(code);
      else out.push(...enc.encode(c));
    }
  }
  return new Uint8Array(out);
}

function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  let label = charset.trim().toLowerCase().replace(/^"|"$/g, "") || "utf-8";
  if (label === "us-ascii" || label === "ascii") label = "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** Header lines, unfolded; names lowercased, the first occurrence kept. */
export function parseHeaders(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = block.replace(/\r\n/g, "\n").replace(/\n[ \t]+/g, " ");
  for (const line of unfolded.split("\n")) {
    const i = line.indexOf(":");
    if (i <= 0) continue;
    const name = line.slice(0, i).trim().toLowerCase();
    if (!(name in out)) out[name] = decodeWords(line.slice(i + 1).trim());
  }
  return out;
}

/** `text/html; charset="utf-8"` → type and parameters. */
export function parseContentType(value: string | undefined): { type: string; params: Record<string, string> } {
  const [type, ...rest] = (value || "text/plain").split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const i = p.indexOf("=");
    if (i > 0) {
      params[p.slice(0, i).trim().toLowerCase().replace(/\*$/, "")] = p.slice(i + 1).trim().replace(/^"|"$/g, "");
    }
  }
  return { type: type.trim().toLowerCase(), params };
}

function splitHead(raw: string): [string, string] {
  const m = /\r?\n\r?\n/.exec(raw);
  return m ? [raw.slice(0, m.index), raw.slice(m.index + m[0].length)] : [raw, ""];
}

export interface Mime {
  headers: Record<string, string>;
  text?: string;
  html?: string;
  attachments: Attachment[];
}

/** A raw message: its headers, first text and HTML parts, and attachments. */
export function parseMime(raw: string): Mime {
  const [head, body] = splitHead(raw);
  const headers = parseHeaders(head);
  const out: Mime = { headers, attachments: [] };
  walk(headers, body, out, 0);
  return out;
}

function walk(headers: Record<string, string>, body: string, out: Mime, depth: number) {
  const { type, params } = parseContentType(headers["content-type"]);
  if (type.startsWith("multipart/") && params.boundary && depth < 10) {
    const b = params.boundary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const parts = body.split(new RegExp(`(?:^|\\r?\\n)--${b}(?:--)?[ \\t]*(?=\\r?\\n|$)`));
    // Before the first boundary is the preamble; after the closing one, the epilogue.
    for (const part of parts.slice(1)) {
      const trimmed = part.replace(/^\r?\n/, "");
      if (!trimmed.trim()) continue;
      const [h, b2] = splitHead(trimmed);
      walk(parseHeaders(h), b2, out, depth + 1);
    }
    return;
  }
  const encoding = (headers["content-transfer-encoding"] ?? "").toLowerCase();
  const bytes = encoding === "base64"
    ? base64Bytes(body)
    : encoding === "quoted-printable"
    ? qpBytes(body)
    : new TextEncoder().encode(body);
  const disposition = parseContentType(headers["content-disposition"]?.replace(/^(\w+)/, "x/$1"));
  const filename = disposition.params.filename ?? params.name;
  if (disposition.type === "x/attachment" || (filename && !type.startsWith("text/"))) {
    out.attachments.push({ name: decodeWords(filename ?? "attachment"), type, size: bytes.length });
  } else if (type === "text/plain" && out.text === undefined) out.text = decodeBytes(bytes, params.charset);
  else if (type === "text/html" && out.html === undefined) out.html = decodeBytes(bytes, params.charset);
}

/** `"Ada L." <ada@example.com>, bob@example.com` → addresses. */
export function parseAddresses(value: string): Address[] {
  const out: Address[] = [];
  for (const part of value.match(/(?:"[^"]*"|[^,"])+/g) ?? []) {
    const m = /^\s*(?:"?([^"<]*?)"?\s*)?<([^>]+)>\s*$/.exec(part);
    if (m) out.push({ name: m[1]?.trim() || undefined, address: m[2].trim() });
    else if (part.includes("@")) out.push({ address: part.trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading

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
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  copy: "©",
  reg: "®",
  euro: "€",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  zwnj: "",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
}

/** Readable text of an HTML mail: no head, scripts, styles or tags; paragraphs on their own lines. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(head|script|style|title)[\s\S]*?(<\/\1>|$)/gi, " ")
      .replace(/<!--[\s\S]*?(-->|$)/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|table|blockquote)>/gi, "\n")
      .replace(/<[^>]*(>|$)/g, " "),
  )
    .replace(/[ \t ​-‍͏﻿]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The text of a message: its text part, else its HTML without the markup. */
export function messageText(m: Pick<Message, "text" | "html">): string {
  const text = (m.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (text) return text;
  return htmlToText(m.html ?? "");
}

// ---------------------------------------------------------------------------
// Verification codes

const CODE_WORDS =
  /\b(code|codes|verification|verify|verifying|otp|one[- ]time|passcode|pass code|pin|security|confirm|confirmation|login|log in|sign[- ]?in|2fa|two[- ]factor|authenticat\w*|token|vérification|votre code|code de|usage unique|bestätigung\w*|sicherheitscode|código|codice|verificación)\b/i;

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;

export interface Code {
  code: string;
  score: number;
}

/**
 * Verification codes in a message, best first: 4 to 8 digits, `123-456` /
 * `123 456`, or 6 to 8 uppercase letters and digits mixed (`K7Q2XD`). A code
 * counts when a word like "code", "verify" or "OTP" is just before it, or
 * when it sits alone on its line; years, prices, phone numbers, times and
 * anything inside a link are ignored.
 */
export function findCodes(text: string, subject = ""): Code[] {
  const scores = new Map<string, number>();
  const consider = (body: string, inSubject: boolean) => {
    const clean = body.replace(URL_RE, " ");
    const re =
      /(?<![\w$€£¥/#@+-]|\w[.,:])(\d{3}[- ]\d{3}|\d{4,8}|(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,8})(?![\w%/@-]|[.,:]\w|\s?(?:px|pt|%|€|\$|usd|eur|am|pm|h\b))/g;
    for (const m of clean.matchAll(re)) {
      const raw = m[1];
      const code = raw.replace(/[- ]/g, "");
      const at = m.index!;
      const before = clean.slice(Math.max(0, at - 80), at);
      const lineStart = clean.lastIndexOf("\n", at - 1) + 1;
      const lineEnd = clean.indexOf("\n", at) < 0 ? clean.length : clean.indexOf("\n", at);
      const line = clean.slice(lineStart, lineEnd).trim();
      let score = 0;
      if (CODE_WORDS.test(before)) score += 3;
      if (line === raw || /^[^\w]*$/.test(line.replace(raw, ""))) score += 3;
      else if (line.length < 40 && CODE_WORDS.test(line)) score += 1;
      if (inSubject) score += 2;
      if (/^(19|20)\d\d$/.test(code) && !CODE_WORDS.test(before.slice(-25))) score -= 4;
      if (
        /[©]|copyright|\b(phone|tel|call|fax|order|invoice|ticket|ref|reference|n°|no\.)\s*[:#]?\s*$/i.test(
          before.slice(-30),
        )
      ) score -= 4;
      if (/^0+$/.test(code) || /^(\d)\1+$/.test(code) && code.length > 4) score -= 2;
      if (/[A-Z]/.test(code) && !CODE_WORDS.test(before)) score -= 2;
      if (score >= 3) scores.set(code, Math.max(scores.get(code) ?? 0, score));
    }
  };
  consider(subject, true);
  consider(text, false);
  return [...scores].map(([code, score]) => ({ code, score })).sort((a, b) => b.score - a.score);
}

// ---------------------------------------------------------------------------
// Links

export interface Link {
  url: string;
  label?: string;
  /** Looks like the link to verify, confirm, reset or sign in. */
  verify: boolean;
}

const VERIFY =
  /verif|confirm|activat|validat|magic|sign[-_]?in|log[-_]?in|signin|login|auth|token|reset|password|invit|accept|onboard|complete|finish|registration|register|email[-_]?link|callback|vérifi|bestätig/i;
const NOT_VERIFY =
  /unsubscribe|optout|opt-out|privacy|terms|legal|help|support|faq|preferences|manage|twitter\.com|x\.com|facebook|linkedin|instagram|youtube|apple\.com\/app|play\.google|mailto:/i;

const cleanUrl = (u: string) => decodeEntities(u).replace(/[.,;:!?)\]]+$/, "");

/** Links of the message (HTML anchors with their text, then bare URLs), verification ones first. */
export function findLinks(m: Pick<Message, "text" | "html">): Link[] {
  const seen = new Map<string, Link>();
  const add = (url: string, label?: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    const u = cleanUrl(url);
    const known = seen.get(u);
    if (known) {
      if (label && !known.label) known.label = label;
      return;
    }
    const verify = (VERIFY.test(u) || (!!label && VERIFY.test(label))) && !NOT_VERIFY.test(u) &&
      !(label && NOT_VERIFY.test(label));
    seen.set(u, { url: u, label, verify });
  };
  const html = m.html ?? "";
  for (const a of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlToText(a[3]).replace(/\s+/g, " ").trim().slice(0, 80) || undefined;
    add(a[2].trim(), label);
  }
  for (const u of (m.text ?? "").matchAll(URL_RE)) add(u[0]);
  for (const u of htmlToText(html).matchAll(URL_RE)) add(u[0]);
  const all = [...seen.values()];
  return [...all.filter((l) => l.verify), ...all.filter((l) => !l.verify)];
}

// ---------------------------------------------------------------------------
// Display

export const senderName = (a: Address | undefined) => a?.name?.trim() || a?.address.split("@")[0] || "Unknown";

export const addressLine = (list: Address[]) =>
  list.map((a) => a.name ? `${a.name} <${a.address}>` : a.address).join(", ");

/** "just now", "5 min", "3 h", "12 Oct". */
export function shortDate(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export const shortUrl = (url: string) => {
  try {
    const u = new URL(url);
    const path = u.pathname.length > 30 ? `${u.pathname.slice(0, 29)}…` : u.pathname;
    return `${u.host}${path === "/" ? "" : path}`;
  } catch {
    return url;
  }
};

export function bytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Markdown of a message: who, to whom, then the text. */
export function messageMarkdown(m: Message): string {
  const text = messageText(m) || "_This message has no text._";
  const escaped = text.replace(/^(#|>|-{3,}|={3,})/gm, "\\$1").slice(0, 30_000);
  return [
    `## ${m.subject || "(no subject)"}`,
    `From **${senderName(m.from)}** <${m.from?.address ?? ""}> to ${addressLine(m.to) || "?"}`,
    "",
    escaped,
  ].join("\n");
}
