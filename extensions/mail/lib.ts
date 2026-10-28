// IMAP responses (framing, tokens, FETCH, SEARCH, LIST), MIME headers and text
// previews, account presets and formatting. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Bytes and text

/**
 * IMAP is a byte protocol and literal lengths count bytes, so responses are
 * kept as "binary strings" (one char per byte) until a field is decoded.
 */
export function toBinary(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return s;
}

export const fromBinary = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** Bytes in a MIME charset; unknown charsets fall back to UTF-8. */
export function decodeBytes(bytes: Uint8Array, charset = "utf-8"): string {
  let label = charset.trim().toLowerCase().replace(/^["']|["']$/g, "");
  if (!label || label === "us-ascii" || label === "ascii" || label === "unknown-8bit") label = "utf-8";
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return new TextDecoder().decode(bytes);
  }
}

/** 8-bit text as servers send it in headers: UTF-8 when valid, Latin-1 otherwise. */
export function binaryText(s: string): string {
  if (!/[\x80-\xff]/.test(s)) return s;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(fromBinary(s));
  } catch {
    return s;
  }
}

export function base64Encode(text: string): string {
  return btoa(toBinary(new TextEncoder().encode(text)));
}

/** Forgiving base64: ignores line breaks and junk, and a truncated tail. */
export function base64Bytes(s: string): Uint8Array {
  let clean = s.replace(/[^A-Za-z0-9+/]/g, "");
  if (clean.length % 4 === 1) clean = clean.slice(0, -1);
  clean += "=".repeat((4 - (clean.length % 4)) % 4);
  try {
    return fromBinary(atob(clean));
  } catch {
    return new Uint8Array();
  }
}

export function quotedPrintableBytes(s: string, header = false): Uint8Array {
  const text = (header ? s.replace(/_/g, " ") : s).replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(text.slice(i + 1, i + 3))) {
      out.push(parseInt(text.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return new Uint8Array(out);
}

/** RFC 2047 encoded words: `=?UTF-8?Q?Caf=C3=A9?=`, `=?iso-8859-1?B?...?=`. */
export function decodeWords(input: string): string {
  const text = binaryText(input);
  return text
    // Whitespace between two encoded words is not part of the text.
    .replace(/(=\?[^?\s]+\?[bq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[bq]\?)/gi, "$1")
    .replace(/=\?([^?\s]+)\?([bq])\?([^?\s]*)\?=/gi, (_, charset: string, enc: string, data: string) => {
      const bytes = enc.toLowerCase() === "b" ? base64Bytes(data) : quotedPrintableBytes(data, true);
      return decodeBytes(bytes, charset.split("*")[0]);
    });
}

// ---------------------------------------------------------------------------
// Framing

/**
 * Cuts the server's byte stream into responses: a line, with the literals it
 * announces (`{123}\r\n` followed by 123 bytes) kept inline.
 */
export class Framer {
  #buf = "";

  push(chunk: Uint8Array) {
    this.#buf += toBinary(chunk);
  }

  /** The next complete response (without its final CRLF), if it has arrived. */
  next(): string | undefined {
    let pos = 0;
    while (true) {
      const eol = this.#buf.indexOf("\r\n", pos);
      if (eol < 0) return undefined;
      const literal = /\{(\d+)\+?\}$/.exec(this.#buf.slice(pos, eol));
      if (!literal) {
        const line = this.#buf.slice(0, eol);
        this.#buf = this.#buf.slice(eol + 2);
        return line;
      }
      const end = eol + 2 + Number(literal[1]);
      if (this.#buf.length < end) return undefined;
      pos = end;
    }
  }

  get pending(): number {
    return this.#buf.length;
  }
}

// ---------------------------------------------------------------------------
// Tokens

/** An atom or string, NIL, or a parenthesized list. */
export type Token = string | null | Token[];

/**
 * A response as tokens. Atoms keep their `[...]` part whole, so
 * `BODY[HEADER.FIELDS (FROM)]<0>` is one token.
 */
export function tokenize(line: string): Token[] {
  let i = 0;
  const n = line.length;
  const readList = (nested: boolean): Token[] => {
    const out: Token[] = [];
    while (i < n) {
      const c = line[i];
      if (c === " " || c === "\r" || c === "\n") {
        i++;
      } else if (c === ")") {
        i++;
        if (nested) return out;
      } else if (c === "(") {
        i++;
        out.push(readList(true));
      } else if (c === '"') {
        i++;
        let s = "";
        while (i < n && line[i] !== '"') {
          if (line[i] === "\\" && i + 1 < n) i++;
          s += line[i++];
        }
        i++;
        out.push(s);
      } else {
        const literal = c === "{" ? /^\{(\d+)\+?\}\r\n/.exec(line.slice(i, i + 24)) : null;
        if (literal) {
          i += literal[0].length;
          out.push(line.slice(i, i + Number(literal[1])));
          i += Number(literal[1]);
          continue;
        }
        let s = "";
        let depth = 0;
        while (i < n) {
          const ch = line[i];
          if (depth === 0 && (ch === " " || ch === "(" || ch === ")" || ch === '"' || ch === "\r")) break;
          if (ch === "[") depth++;
          else if (ch === "]" && depth > 0) depth--;
          s += ch;
          i++;
        }
        out.push(s.toUpperCase() === "NIL" ? null : s);
      }
    }
    return out;
  };
  return readList(false);
}

const str = (t: Token | undefined): string | undefined => (typeof t === "string" ? t : undefined);

// ---------------------------------------------------------------------------
// Responses

export interface Status {
  tag: string;
  status: "OK" | "NO" | "BAD" | "PREAUTH" | "BYE";
  /** The response code: `AUTHENTICATIONFAILED`, `CAPABILITY IMAP4rev1 …`. */
  code?: string;
  text: string;
}

export function parseStatus(line: string): Status | undefined {
  const m = /^(\S+) (OK|NO|BAD|PREAUTH|BYE)\b ?(?:\[([^\]]*)\])? ?(.*)$/i.exec(line);
  if (!m) return undefined;
  return { tag: m[1], status: m[2].toUpperCase() as Status["status"], code: m[3], text: m[4].trim() };
}

/** Capabilities from `* CAPABILITY …` lines or a `[CAPABILITY …]` code. */
export function capabilities(lines: string[]): Set<string> {
  const caps = new Set<string>();
  for (const line of lines) {
    const m = /^\* CAPABILITY (.*)$/i.exec(line) ?? /\[CAPABILITY ([^\]]*)\]/i.exec(line);
    if (m) { for (const c of m[1].trim().split(/\s+/)) caps.add(c.toUpperCase()); }
  }
  return caps;
}

/** UIDs of `* SEARCH 4 8 15` lines. */
export function searchUids(lines: string[]): number[] {
  const out: number[] = [];
  for (const line of lines) {
    const m = /^\* SEARCH\b(.*)$/i.exec(line);
    if (m) { for (const n of m[1].trim().split(/\s+/)) if (/^\d+$/.test(n)) out.push(Number(n)); }
  }
  return out;
}

/** The attributes of a `* 12 FETCH (UID 3 FLAGS (\Seen) …)` response, keys upper-cased. */
export function parseFetch(line: string): Record<string, Token> | undefined {
  if (!/^\* \d+ FETCH /i.test(line)) return undefined;
  const tokens = tokenize(line);
  const list = tokens[3];
  if (!Array.isArray(list)) return undefined;
  const out: Record<string, Token> = {};
  for (let i = 0; i + 1 < list.length; i += 2) {
    const key = str(list[i]);
    if (!key) continue;
    // `BODY[TEXT]<0>` → `BODY[TEXT]`; `BODY.PEEK[…]` is answered as `BODY[…]`.
    out[key.toUpperCase().replace(/<\d+>$/, "").replace(/^BODY\.PEEK\[/, "BODY[")] = list[i + 1];
  }
  return out;
}

export interface Folder {
  name: string;
  delimiter?: string;
  flags: string[];
}

/** `* LIST (\HasNoChildren \Archive) "/" "Archive"` lines. */
export function parseFolders(lines: string[]): Folder[] {
  const out: Folder[] = [];
  for (const line of lines) {
    if (!/^\* (LIST|XLIST) /i.test(line)) continue;
    const t = tokenize(line);
    const flags = Array.isArray(t[2]) ? t[2].filter((f): f is string => typeof f === "string") : [];
    const name = str(t[4]);
    if (name !== undefined) out.push({ name, delimiter: str(t[3]), flags: flags.map((f) => f.toLowerCase()) });
  }
  return out;
}

const FALLBACK_NAMES: Record<"archive" | "trash", string[]> = {
  archive: ["archive", "archives", "inbox.archive", "inbox/archive", "[gmail]/all mail", "all mail"],
  trash: [
    "trash",
    "inbox.trash",
    "inbox/trash",
    "deleted messages",
    "deleted items",
    "deleted",
    "bin",
    "[gmail]/trash",
    "[gmail]/bin",
    "corbeille",
  ],
};

/** The archive or trash folder: by special use (RFC 6154), then by the usual names. */
export function specialFolder(folders: Folder[], use: "archive" | "trash"): string | undefined {
  const flags = use === "archive" ? ["\\archive", "\\all", "\\allmail"] : ["\\trash"];
  for (const flag of flags) {
    const f = folders.find((f) => f.flags.includes(flag) && !f.flags.includes("\\noselect"));
    if (f) return f.name;
  }
  for (const name of FALLBACK_NAMES[use]) {
    const f = folders.find((f) => f.name.toLowerCase() === name && !f.flags.includes("\\noselect"));
    if (f) return f.name;
  }
  return undefined;
}

/** A string argument: quoted, or undefined when it needs a literal (8-bit, line breaks). */
export function quote(s: string): string | undefined {
  if (/[^\x20-\x7e]/.test(s)) return undefined;
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** `4,8,9,10,11` → `4,8:11`. */
export function uidSet(uids: number[]): string {
  const sorted = [...new Set(uids)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++;
    parts.push(j > i ? `${sorted[i]}:${sorted[j]}` : String(sorted[i]));
    i = j;
  }
  return parts.join(",");
}

// ---------------------------------------------------------------------------
// Headers and MIME

/** Header block → lower-cased names (first occurrence), unfolded, still undecoded. */
export function parseHeaders(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  for (const line of unfolded.split(/\r?\n/)) {
    const m = /^([!-9;-~]+):\s*(.*)$/.exec(line);
    if (m && !(m[1].toLowerCase() in out)) out[m[1].toLowerCase()] = m[2].trim();
  }
  return out;
}

/** `text/plain; charset="utf-8"` → type and parameters. */
export function contentType(value: string | undefined): { type: string; params: Record<string, string> } {
  const [type, ...rest] = (value || "text/plain").split(";");
  const params: Record<string, string> = {};
  for (const p of rest) {
    const m = /^\s*([^=\s]+)\s*=\s*(?:"([^"]*)"|([^\s;]*))/.exec(p);
    if (m) params[m[1].toLowerCase()] = m[2] ?? m[3];
  }
  return { type: type.trim().toLowerCase() || "text/plain", params };
}

export function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  switch ((encoding ?? "").trim().toLowerCase()) {
    case "base64":
      return base64Bytes(body);
    case "quoted-printable":
      return quotedPrintableBytes(body);
    default:
      return fromBinary(body);
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  zwnj: "",
  shy: "",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  euro: "€",
  copy: "©",
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

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(head|script|style|title)[\s\S]*?(<\/\1>|$)/gi, " ")
      .replace(/<!--[\s\S]*?(-->|$)/g, " ")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]*(>|$)/g, " "),
  );
}

/** The readable text of a (possibly truncated) message body, from its first text part. */
export function bodyText(headers: Record<string, string>, body: string, depth = 0): string {
  const ct = contentType(headers["content-type"]);
  if (ct.type.startsWith("multipart/") && ct.params.boundary && depth < 4) {
    const parts = body.split(`--${ct.params.boundary}`).slice(1);
    const parsed = parts.map((p) => {
      const split = /\r?\n\r?\n/.exec(p);
      const head = split ? p.slice(0, split.index) : p;
      return {
        headers: parseHeaders(head.replace(/^\r?\n/, "")),
        body: split ? p.slice(split.index + split[0].length) : "",
      };
    });
    const pick = parsed.find((p) => contentType(p.headers["content-type"]).type === "text/plain") ??
      parsed.find((p) => contentType(p.headers["content-type"]).type.startsWith("multipart/")) ??
      parsed.find((p) => contentType(p.headers["content-type"]).type === "text/html");
    return pick ? bodyText(pick.headers, pick.body, depth + 1) : "";
  }
  if (!ct.type.startsWith("text/")) return "";
  const text = decodeBytes(decodeTransfer(body, headers["content-transfer-encoding"]), ct.params.charset ?? "utf-8");
  return ct.type === "text/html" ? htmlToText(text) : text;
}

/** One line of the body: without quotes, signatures, links and blank space. */
export function preview(text: string, max = 180): string {
  const lines: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "--" || line === "-- " || /^_{8,}$/.test(line)) break;
    if (line.startsWith(">") || /^On .+ wrote:$/.test(line) || /^Le .+ a écrit\s?:$/.test(line)) continue;
    if (line) lines.push(line);
  }
  const one = lines.join(" ").replace(/https?:\/\/\S{30,}/g, "").replace(/[\s​-‍͏﻿]+/g, " ")
    .trim();
  return one.length > max ? `${one.slice(0, max).replace(/\s+\S*$/, "")}…` : one;
}

// ---------------------------------------------------------------------------
// Addresses and dates

export interface Address {
  name?: string;
  email: string;
}

/** `"Ada Lovelace" <ada@example.com>` (a header) → name and address. */
export function parseAddress(value: string | undefined): Address {
  const text = decodeWords(value ?? "").trim();
  const m = /^(.*?)\s*<([^>]+)>/.exec(text);
  if (m) {
    const name = m[1].trim().replace(/^"(.*)"$/, "$1").replace(/\\(.)/g, "$1").trim();
    return { name: name || undefined, email: m[2].trim() };
  }
  const email = text.replace(/\s*\(.*\)$/, "").trim();
  const comment = /\(([^)]+)\)/.exec(text)?.[1];
  return { name: comment, email };
}

/** An envelope address list `((name adl mailbox host) …)`. */
function envelopeAddresses(t: Token | undefined): Address[] {
  if (!Array.isArray(t)) return [];
  return t.filter(Array.isArray).map((a) => {
    const [name, , mailbox, host] = a as Token[];
    const decoded = name ? decodeWords(String(name)).trim() : "";
    return { name: decoded || undefined, email: [str(mailbox), str(host)].filter(Boolean).join("@") };
  }).filter((a) => a.email);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const ZONES: Record<string, number> = {
  UT: 0,
  UTC: 0,
  GMT: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  PST: -8,
  PDT: -7,
};

/** RFC 5322 dates (`Tue, 27 Oct 2026 14:03:00 +0100`) and INTERNALDATE (`27-Oct-2026 14:03:00 +0100`). */
export function parseDate(raw: string | undefined): number | undefined {
  const s = (raw ?? "").trim();
  const m = /(\d{1,2})[\s-]+([a-z]{3})[a-z]*[\s-]+(\d{2,4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([+-]\d{4}|[a-z]{1,4})?/i
    .exec(s);
  if (m) {
    const mo = MONTHS.indexOf(m[2].toLowerCase());
    if (mo >= 0) {
      const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      const z = m[7] ?? "+0000";
      const offset = /^[+-]/.test(z)
        ? (z[0] === "-" ? -1 : 1) * (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5)))
        : (ZONES[z.toUpperCase()] ?? 0) * 60;
      return Date.UTC(y, mo, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0)) - offset * 60_000;
    }
  }
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

// ---------------------------------------------------------------------------
// Messages

export interface Message {
  uid: number;
  flags: string[];
  date?: number;
  from: Address;
  to: Address[];
  subject: string;
  messageId?: string;
  size?: number;
  preview: string;
  attachments: boolean;
}

/** The fields this extension fetches, in one `UID FETCH`. */
export const PREVIEW_BYTES = 3072;
export const FETCH_ITEMS =
  `(UID FLAGS INTERNALDATE RFC822.SIZE ENVELOPE BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID CONTENT-TYPE CONTENT-TRANSFER-ENCODING)] BODY.PEEK[TEXT]<0.${PREVIEW_BYTES}>)`;

export function parseMessage(f: Record<string, Token>): Message | undefined {
  const uid = Number(str(f.UID));
  if (!Number.isFinite(uid) || uid <= 0) return undefined;
  const env = Array.isArray(f.ENVELOPE) ? f.ENVELOPE : [];
  const headerKey = Object.keys(f).find((k) => k.startsWith("BODY[HEADER"));
  const headers = parseHeaders(str(headerKey ? f[headerKey] : undefined) ?? "");
  const from = envelopeAddresses(env[2])[0] ?? parseAddress(headers.from);
  const subject = decodeWords(str(env[1]) ?? headers.subject ?? "").replace(/\s+/g, " ").trim();
  const ct = contentType(headers["content-type"]);
  return {
    uid,
    flags: Array.isArray(f.FLAGS) ? f.FLAGS.filter((x): x is string => typeof x === "string") : [],
    date: parseDate(str(env[0]) ?? headers.date) ?? parseDate(str(f.INTERNALDATE)),
    from,
    to: envelopeAddresses(env[5]),
    subject: subject || "(no subject)",
    messageId: (str(env[9]) ?? headers["message-id"] ?? "").trim() || undefined,
    size: str(f["RFC822.SIZE"]) ? Number(f["RFC822.SIZE"]) : undefined,
    preview: preview(bodyText(headers, str(f["BODY[TEXT]"]) ?? "")),
    attachments: ct.type === "multipart/mixed",
  };
}

// ---------------------------------------------------------------------------
// Accounts

export type Security = "tls" | "starttls";

export interface Preset {
  id: string;
  name: string;
  host: string;
  port: number;
  security: Security;
  /** Where to create the password the extension signs in with. */
  passwordUrl?: string;
  passwordHelp: string;
  webmail?: string;
  /** Why it can't work, for providers that turned password sign-in off. */
  unsupported?: string;
}

export const PRESETS: Record<string, Preset> = {
  gmail: {
    id: "gmail",
    name: "Gmail",
    host: "imap.gmail.com",
    port: 993,
    security: "tls",
    passwordUrl: "https://myaccount.google.com/apppasswords",
    passwordHelp: "An app password (Google Account → Security → 2-Step Verification → App passwords)",
    webmail: "https://mail.google.com/mail/",
  },
  fastmail: {
    id: "fastmail",
    name: "Fastmail",
    host: "imap.fastmail.com",
    port: 993,
    security: "tls",
    passwordUrl: "https://app.fastmail.com/settings/security/apps",
    passwordHelp: "An app password with IMAP access (Settings → Privacy & Security → App passwords)",
    webmail: "https://app.fastmail.com/mail/Inbox/",
  },
  icloud: {
    id: "icloud",
    name: "iCloud Mail",
    host: "imap.mail.me.com",
    port: 993,
    security: "tls",
    passwordUrl: "https://account.apple.com/account/manage",
    passwordHelp: "An app-specific password (Apple Account → Sign-In and Security → App-Specific Passwords)",
    webmail: "https://www.icloud.com/mail/",
  },
  yahoo: {
    id: "yahoo",
    name: "Yahoo Mail",
    host: "imap.mail.yahoo.com",
    port: 993,
    security: "tls",
    passwordUrl: "https://login.yahoo.com/account/security",
    passwordHelp: "An app password (Account Security → Generate app password)",
    webmail: "https://mail.yahoo.com/",
  },
  proton: {
    id: "proton",
    name: "Proton Mail",
    host: "127.0.0.1",
    port: 1143,
    security: "starttls",
    passwordUrl: "https://proton.me/mail/bridge",
    passwordHelp: "The IMAP password Proton Mail Bridge shows for the account (not your Proton password)",
    webmail: "https://mail.proton.me/u/0/inbox",
  },
  outlook: {
    id: "outlook",
    name: "Outlook",
    host: "outlook.office365.com",
    port: 993,
    security: "tls",
    passwordHelp: "",
    webmail: "https://outlook.live.com/mail/",
    unsupported:
      "Microsoft turned off password sign-in (basic authentication) for IMAP on Outlook.com and Microsoft 365: use the Microsoft 365 extension for this account",
  },
  custom: {
    id: "custom",
    name: "IMAP",
    host: "",
    port: 993,
    security: "tls",
    passwordHelp: "Your password, or an app password if the provider requires one",
  },
};

const ALIASES: Record<string, string> = {
  google: "gmail",
  googlemail: "gmail",
  "google workspace": "gmail",
  icloud: "icloud",
  "icloud mail": "icloud",
  apple: "icloud",
  me: "icloud",
  protonmail: "proton",
  "proton mail": "proton",
  "proton bridge": "proton",
  hotmail: "outlook",
  "outlook.com": "outlook",
  live: "outlook",
  "microsoft 365": "outlook",
  office365: "outlook",
  "yahoo mail": "yahoo",
  aol: "custom",
  imap: "custom",
  other: "custom",
};

/** The provider preference (any case, a few synonyms), or a guess from the address. */
export function presetFor(provider: unknown, email: string): Preset {
  const p = String(provider ?? "").trim().toLowerCase();
  const id = PRESETS[p] ? p : ALIASES[p];
  if (id) return PRESETS[id];
  const domain = email.split("@")[1]?.toLowerCase() ?? "";
  if (/^(gmail|googlemail)\.com$/.test(domain)) return PRESETS.gmail;
  if (/^(fastmail\.(com|fm)|messagingengine\.com)$/.test(domain)) return PRESETS.fastmail;
  if (/^(icloud|me|mac)\.com$/.test(domain)) return PRESETS.icloud;
  if (/^(yahoo|ymail)\./.test(domain)) return PRESETS.yahoo;
  if (/^(proton\.me|protonmail\.(com|ch)|pm\.me)$/.test(domain)) return PRESETS.proton;
  if (/^(outlook|hotmail|live|msn)\./.test(domain)) return PRESETS.outlook;
  return PRESETS.custom;
}

export interface Account {
  /** 1 to 3: the preferences it comes from. */
  index: number;
  email: string;
  password: string;
  preset: Preset;
  host: string;
  port: number;
  security: Security;
}

export interface AccountProblem {
  index: number;
  email: string;
  preset: Preset;
  message: string;
}

export const ACCOUNT_SLOTS = [1, 2, 3];

/** `imap.example.com`, `imap.example.com:143`, `imaps://host` → host, port, security. */
export function parseServer(input: string, fallback: Preset): { host: string; port: number; security: Security } {
  let text = input.trim();
  let scheme = "";
  const m = /^(imaps?):\/\//i.exec(text);
  if (m) {
    scheme = m[1].toLowerCase();
    text = text.slice(m[0].length);
  }
  text = text.replace(/\/.*$/, "");
  const hp = /^\[?([^\]]+?)\]?(?::(\d+))?$/.exec(text);
  const host = (hp?.[1] ?? text).toLowerCase();
  const port = hp?.[2] ? Number(hp[2]) : scheme === "imap" ? 143 : fallback.port;
  const security: Security = scheme === "imap" || port === 143 || port === 1143
    ? "starttls"
    : scheme === "imaps" || port === 993
    ? "tls"
    : fallback.security;
  return { host, port, security };
}

/** The accounts set in the preferences, and those that can't be used as set. */
export function accountsFrom(prefs: Record<string, unknown>): { accounts: Account[]; problems: AccountProblem[] } {
  const accounts: Account[] = [];
  const problems: AccountProblem[] = [];
  for (const index of ACCOUNT_SLOTS) {
    const email = String(prefs[`email${index}`] ?? "").trim();
    const password = String(prefs[`password${index}`] ?? "");
    const server = String(prefs[`server${index}`] ?? "").trim();
    const provider = String(prefs[`provider${index}`] ?? "").trim();
    if (!email && !password && !server && !provider) continue;
    const preset = presetFor(provider, email);
    const problem = (message: string) => problems.push({ index, email: email || `Account ${index}`, preset, message });
    if (preset.unsupported) {
      problem(preset.unsupported);
      continue;
    }
    if (!email) {
      problem(`Add the address of account ${index}`);
      continue;
    }
    const where = server ? parseServer(server, preset) : preset;
    if (!where.host) {
      problem(`Add the IMAP server of ${email} (imap.example.com)`);
      continue;
    }
    if (!password) {
      problem(`Add the password of ${email}`);
      continue;
    }
    accounts.push({ index, email, password, preset, host: where.host, port: where.port, security: where.security });
  }
  return { accounts, problems };
}

export const isLoopback = (host: string) => /^(127\.\d+\.\d+\.\d+|localhost|::1|\[::1\])$/i.test(host);

/** Where Enter opens a message: Gmail finds it by Message-ID, others open the inbox. */
export function webmailUrl(a: Pick<Account, "preset" | "email">, messageId?: string): string | undefined {
  if (a.preset.id === "gmail") {
    const base = `https://mail.google.com/mail/u/${encodeURIComponent(a.email)}/`;
    const id = messageId?.replace(/^<|>$/g, "");
    return id ? `${base}#search/rfc822msgid%3A${encodeURIComponent(id)}` : `${base}#inbox`;
  }
  return a.preset.webmail;
}

/** A reply in the default mail app. */
export function replyUrl(m: Pick<Message, "from" | "subject" | "messageId">): string {
  const subject = /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`;
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (m.messageId) params.push(`In-Reply-To=${encodeURIComponent(m.messageId)}`);
  return `mailto:${encodeURIComponent(m.from.email).replace(/%40/g, "@")}?${params.join("&")}`;
}

// ---------------------------------------------------------------------------
// Formatting

/** "09:12" today, "Yesterday", "Mon", "12 Oct", "12 Oct 2025". */
export function shortDate(ms: number | undefined, now = Date.now()): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  if (ms >= today.getTime()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (ms >= today.getTime() - day) return "Yesterday";
  if (ms >= today.getTime() - 6 * day) return d.toLocaleDateString("en-GB", { weekday: "short" });
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) });
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

export function size(bytes: number | undefined): string | undefined {
  if (bytes === undefined || !Number.isFinite(bytes)) return undefined;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const senderName = (a: Address) => a.name || a.email.split("@")[0] || a.email;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** "5 unread", or nothing when the inbox is clean. */
export function unreadSubtitle(total: number): string | null {
  return total > 0 ? `${total} unread` : null;
}
