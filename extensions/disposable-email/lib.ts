// Disposable Email logic: mail.tm's shapes, random addresses, reading a
// message, and finding the verification codes and links in it. Pure, tested
// in lib_test.ts.

export const API = "https://api.mail.tm";

export interface Domain {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate?: boolean;
}

export interface Address {
  address: string;
  name?: string;
}

/** A message as listed. */
export interface Summary {
  id: string;
  from: Address;
  to: Address[];
  subject: string;
  intro?: string;
  seen: boolean;
  hasAttachments?: boolean;
  size?: number;
  createdAt: string;
}

/** A message as read. */
export interface Message extends Summary {
  text?: string;
  html?: string[] | string;
  cc?: Address[];
  attachments?: { id: string; filename: string; contentType: string; size: number; downloadUrl: string }[];
}

/** The account kept in storage: a throwaway address and the password generated for it. */
export interface Account {
  id: string;
  address: string;
  password: string;
  token?: string;
  /** Unix ms. */
  created: number;
}

/** mail.tm lists are plain arrays (application/json) or Hydra collections (application/ld+json). */
export function members<T>(body: unknown): T[] {
  if (Array.isArray(body)) return body as T[];
  const b = body as Record<string, unknown> | undefined;
  const m = b?.["hydra:member"] ?? b?.member;
  return Array.isArray(m) ? m as T[] : [];
}

/** A random public domain among the active ones. */
export function pickDomain(domains: Domain[], random = Math.random): string {
  const usable = domains.filter((d) => d.isActive && !d.isPrivate);
  if (!usable.length) throw new Error("mail.tm has no domain available right now: try again later");
  return usable[Math.floor(random() * usable.length)].domain;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz";
const ALNUM = `${LETTERS}0123456789`;

function randomString(chars: string, n: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return [...bytes].map((b) => chars[b % chars.length]).join("");
}

/** A local part that reads like a name: a letter, then letters and digits (10 characters). */
export const randomLocalPart = () => randomString(LETTERS, 1) + randomString(ALNUM, 9);

/** A strong password for the throwaway account. */
export const randomPassword = () => randomString(`${ALNUM}ABCDEFGHIJKLMNOPQRSTUVWXYZ`, 24);

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

const htmlOf = (m: Pick<Message, "html">) => Array.isArray(m.html) ? m.html.join("\n") : m.html ?? "";

/** The text of a message: its text part, else its HTML without the markup. */
export function messageText(m: Pick<Message, "text" | "html">): string {
  const text = (m.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (text) return text;
  return htmlToText(htmlOf(m));
}

// ---------------------------------------------------------------------------
// Verification codes

const CODE_WORDS =
  /\b(code|codes|verification|verify|verifying|otp|one[- ]time|passcode|pass code|pin|security|confirm|confirmation|login|log in|sign[- ]?in|2fa|two[- ]factor|authenticat\w*|token|vérification|confirmation|votre code|code de|usage unique|bestätigung\w*|sicherheitscode|código|codice|verificación)\b/i;

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
    // Not glued to other characters: "v1.2345", "$1999", "10:30", "a-1234" and "1234px" are left alone.
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
      // Things that only look like codes.
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
  /** Looks like the link to verify, confirm or sign in. */
  verify: boolean;
}

const VERIFY =
  /verif|confirm|activat|validat|magic|sign[-_]?in|log[-_]?in|signin|login|auth|token|reset|password|invit|accept|onboard|welcome|complete|finish|registration|register|email[-_]?link|callback|vérifi|bestätig/i;
const NOT_VERIFY =
  /unsubscribe|optout|opt-out|privacy|terms|legal|help|support|faq|preferences|manage|twitter\.com|x\.com|facebook|linkedin|instagram|youtube|apple\.com\/app|play\.google|mailto:/i;

const cleanUrl = (u: string) => decodeEntities(u).replace(/[.,;:!?)\]]+$/, "");

/** Links of the message (HTML anchors with their text, then bare URLs), verification ones first. */
export function findLinks(m: Pick<Message, "text" | "html">): Link[] {
  const seen = new Map<string, Link>();
  const add = (url: string, label?: string) => {
    if (!/^https?:\/\//i.test(url)) return;
    const u = cleanUrl(url);
    if (seen.has(u)) {
      if (label && !seen.get(u)!.label) seen.get(u)!.label = label;
      return;
    }
    const verify = (VERIFY.test(u) || (!!label && VERIFY.test(label))) && !NOT_VERIFY.test(u) &&
      !(label && NOT_VERIFY.test(label));
    seen.set(u, { url: u, label, verify });
  };
  for (const a of htmlOf(m).matchAll(/<a\b[^>]*?\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = htmlToText(a[3]).replace(/\s+/g, " ").trim().slice(0, 80) || undefined;
    add(a[2].trim(), label);
  }
  for (const u of (m.text ?? "").matchAll(URL_RE)) add(u[0]);
  for (const u of htmlToText(htmlOf(m)).matchAll(URL_RE)) add(u[0]);
  const all = [...seen.values()];
  return [...all.filter((l) => l.verify), ...all.filter((l) => !l.verify)];
}

// ---------------------------------------------------------------------------
// Display

export const senderName = (a: Address | undefined) => a?.name?.trim() || a?.address.split("@")[0] || "Unknown";

/** "just now", "5 min", "3 h", "Mon", "12 Oct". */
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

/** Markdown of a message: who, then the text (links kept as they are). */
export function messageMarkdown(m: Message): string {
  const text = messageText(m) || "_This message has no text._";
  const escaped = text.replace(/^(#|>|-{3,}|={3,})/gm, "\\$1").slice(0, 30_000);
  return [`## ${m.subject || "(no subject)"}`, `From **${senderName(m.from)}** <${m.from?.address ?? ""}>`, "", escaped]
    .join(
      "\n",
    );
}

/** Newest first, one per address. */
export const addAccount = (all: Account[], a: Account) => [a, ...all.filter((x) => x.id !== a.id)].slice(0, 10);

export const removeAccount = (all: Account[], id: string) => all.filter((a) => a.id !== id);
