// Copied files, PrivateBin v2 encryption, 0x0.st rules, croc output and the share history.
// Pure (WebCrypto aside), tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Copied files (text/uri-list or x-special/gnome-copied-files)

export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue;
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

export const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p;

/** 1536 → "1.5 KB" (decimal units, as file managers show). */
export function size(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 1000 && i < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

const MIME: Record<string, string> = {
  txt: "text/plain",
  md: "text/markdown",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  zip: "application/zip",
  json: "application/json",
  csv: "text/csv",
  html: "text/html",
};

export const mimeType = (name: string) =>
  MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

/** The first line of a text, shortened: what a history row shows for a shared text. */
export function textTitle(text: string, max = 60): string {
  const line = text.trim().split(/\r?\n/)[0].trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line || "Text";
}

// ---------------------------------------------------------------------------
// Expiry

export interface Expiry {
  /** PrivateBin's `meta.expire` value. */
  privatebin: string;
  hours: number;
  title: string;
}

export const EXPIRIES: Expiry[] = [
  { privatebin: "1hour", hours: 1, title: "1 hour" },
  { privatebin: "1day", hours: 24, title: "1 day" },
  { privatebin: "1week", hours: 24 * 7, title: "1 week" },
  { privatebin: "1month", hours: 24 * 30, title: "30 days" },
];

export const expiry = (key: unknown): Expiry =>
  EXPIRIES.find((e) => e.privatebin === key || e.title === key) ?? EXPIRIES[1];

/**
 * How long 0x0.st keeps a file: between 30 days (512 MiB) and a year (tiny
 * files), on a cubic curve; its `expires` field can only shorten that.
 */
export function retentionDays(bytes: number): number {
  const minAge = 30;
  const maxAge = 365;
  const maxSize = 512 * 1024 * 1024;
  return minAge + (-maxAge + minAge) * Math.pow(Math.min(bytes, maxSize) / maxSize - 1, 3);
}

export const MAX_0X0 = 512 * 1024 * 1024;

/** "in 5 h", "in 3 d", "expired", "never". */
export function expiresIn(at: number | undefined, now = Date.now()): string {
  if (at === undefined) return "never";
  const m = Math.round((at - now) / 60_000);
  if (m <= 0) return "expired";
  if (m < 60) return `in ${m} min`;
  if (m < 48 * 60) return `in ${Math.round(m / 60)} h`;
  return `in ${Math.round(m / 1440)} d`;
}

// ---------------------------------------------------------------------------
// Base58 and base64

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bitcoin base58, leading zero bytes as `1`: how PrivateBin writes the key in the URL fragment. */
export function base58(bytes: Uint8Array): string {
  const digits: number[] = [];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let zeros = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    zeros += "1";
  }
  return zeros + digits.reverse().map((d) => B58[d]).join("");
}

export function unbase58(text: string, length?: number): Uint8Array {
  const bytes: number[] = [];
  for (const ch of text) {
    let carry = B58.indexOf(ch);
    if (carry < 0) throw new Error(`Not base58: ${ch}`);
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  const zeros = text.match(/^1*/)![0].length;
  const out = [...new Array(zeros).fill(0), ...bytes.reverse()];
  // PrivateBin pads a short key back to 32 bytes.
  while (length && out.length < length) out.unshift(0);
  return new Uint8Array(out);
}

export function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------
// PrivateBin, format version 2

export type Formatter = "plaintext" | "syntaxhighlighting" | "markdown";

/** `[iv, salt, iterations, key size, tag size, algorithm, mode, compression]`. */
export type CipherSpec = [string, string, number, number, number, "aes", "gcm", "zlib" | "none"];

/** `[spec, formatter, open discussion, burn after reading]`, authenticated with the ciphertext. */
export type Adata = [CipherSpec, Formatter, 0 | 1, 0 | 1];

export interface PasteBody {
  v: 2;
  adata: Adata;
  ct: string;
  meta: { expire: string };
}

/** What PrivateBin encrypts: the text, and optionally one file as a data URL. */
export interface PasteContent {
  paste: string;
  attachment?: string;
  attachment_name?: string;
}

/** PrivateBin turns strings into bytes one UTF-16 unit per byte (passwords included): do the same. */
const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function aesKey(key: Uint8Array, password: string, salt: Uint8Array, iterations: number, usage: KeyUsage) {
  const material = password ? new Uint8Array([...key, ...latin1(password)]) : key;
  const base = await crypto.subtle.importKey("raw", material as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export interface Encrypted {
  body: PasteBody;
  /** The 32 random bytes that never leave this computer except in the URL fragment. */
  key: Uint8Array;
}

/**
 * Encrypts a paste as PrivateBin's JavaScript client does: PBKDF2-SHA256
 * (100,000 iterations) over the random key and the password, AES-256-GCM
 * with the JSON `adata` as authenticated data, raw deflate before.
 */
export async function encryptPaste(
  content: PasteContent,
  options: {
    expire: string;
    formatter?: Formatter;
    burn?: boolean;
    password?: string;
    compress?: boolean;
    random?: (n: number) => Uint8Array;
  },
): Promise<Encrypted> {
  const random = options.random ?? ((n: number) => crypto.getRandomValues(new Uint8Array(n)));
  const key = random(32);
  const iv = random(16);
  const salt = random(8);
  const compression = options.compress === false ? "none" : "zlib";
  const spec: CipherSpec = [toBase64(iv), toBase64(salt), 100_000, 256, 128, "aes", "gcm", compression];
  const adata: Adata = [spec, options.formatter ?? "plaintext", 0, options.burn ? 1 : 0];
  const plain = new TextEncoder().encode(JSON.stringify(content));
  const data = compression === "zlib" ? await deflateRaw(plain) : plain;
  const aes = await aesKey(key, options.password ?? "", salt, 100_000, "encrypt");
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv as BufferSource,
      additionalData: latin1(JSON.stringify(adata)) as BufferSource,
      tagLength: 128,
    },
    aes,
    data as BufferSource,
  );
  return { key, body: { v: 2, adata, ct: toBase64(new Uint8Array(ct)), meta: { expire: options.expire } } };
}

/** The reverse, to check our own pastes (and in tests). */
export async function decryptPaste(
  body: Pick<PasteBody, "adata" | "ct">,
  key: Uint8Array,
  password = "",
): Promise<PasteContent> {
  const [spec] = body.adata;
  const aes = await aesKey(key, password, fromBase64(spec[1]), spec[2], "decrypt");
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(spec[0]) as BufferSource,
        additionalData: latin1(JSON.stringify(body.adata)) as BufferSource,
        tagLength: spec[4],
      },
      aes,
      fromBase64(body.ct) as BufferSource,
    ),
  );
  const data = spec[7] === "zlib" ? await inflateRaw(plain) : plain;
  return JSON.parse(new TextDecoder().decode(data));
}

/** A file as PrivateBin's attachment: a data URL. */
export function dataUrl(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${toBase64(bytes)}`;
}

/** `https://privatebin.net/` + id + key → the link to share; burn-after-reading links start the fragment with `-`. */
export function pasteUrl(instance: string, id: string, key: Uint8Array, burn = false): string {
  return `${instance}?${id}${burn ? "#-" : "#"}${base58(key)}`;
}

export const deleteUrl = (instance: string, id: string, token: string) =>
  `${instance}?pasteid=${encodeURIComponent(id)}&deletetoken=${encodeURIComponent(token)}`;

/** `privatebin.net`, `https://bin.example.org/paste` → `https://bin.example.org/paste/`. */
export function normalizeInstance(input: unknown): string {
  let s = String(input ?? "").trim() || "https://privatebin.net";
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  const u = new URL(s);
  u.search = "";
  u.hash = "";
  if (!u.pathname.endsWith("/")) u.pathname += "/";
  return u.toString();
}

/**
 * Hosts a PrivateBin instance may live on, as in `[permissions] net`: the
 * public instances listed there, and self-hosted ones on the local network
 * or Tailscale.
 */
export const PRIVATEBIN_HOSTS = [
  "privatebin.net",
  "bin.disroot.org",
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

function inRange(ip: string, cidr: string): boolean {
  const [base, bits] = cidr.split("/");
  const n = (a: string) => a.split(".").reduce((x, o) => (x << 8) + Number(o), 0) >>> 0;
  const mask = Number(bits) === 0 ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (n(ip) & mask) === (n(base) & mask);
}

export function allowedInstance(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  const ipv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  return PRIVATEBIN_HOSTS.some((h) => {
    if (h.includes("/")) return ipv4 && inRange(host, h);
    if (h.startsWith("*.")) return host.endsWith(h.slice(1));
    return host === h;
  });
}

// ---------------------------------------------------------------------------
// croc

/** croc prints its code phrase in several ways depending on its version. */
export function crocCode(output: string): string | undefined {
  // deno-lint-ignore no-control-regex
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");
  const patterns = [
    /Code is:\s*([^\s"']+)/i,
    /CROC_SECRET=["']?([^\s"'*]{6,})/,
    /\bcroc\s+(?:--\S+\s+)*(\d+-[a-z]+(?:-[a-z]+)+)\b/,
    /\b(\d{3,4}(?:-[a-z]+){2,})\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1];
  }
  return undefined;
}

/** The web page some croc versions print to receive in a browser. */
export function crocWebUrl(output: string): string | undefined {
  return /https:\/\/\S*croc\S*/i.exec(output)?.[0].replace(/[)\].,]+$/, "");
}

/** What a croc log says about the transfer, from its last lines. */
export function crocProgress(output: string): { state: "waiting" | "sending" | "done" | "failed"; text?: string } {
  // deno-lint-ignore no-control-regex
  const text = output.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "\n");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const last = lines.at(-1) ?? "";
  if (/^(error|could not|failed)/i.test(last) || /room (is )?(full|not ready)|bad password|incorrect/i.test(last)) {
    return { state: "failed", text: last };
  }
  if (lines.some((l) => /100%|transfer(red)? complete|files? sent/i.test(l))) return { state: "done" };
  const percent = [...text.matchAll(/(\d{1,3})%/g)].at(-1)?.[1];
  if (percent || lines.some((l) => /^Sending \(/.test(l))) {
    return { state: "sending", text: percent ? `${percent} %` : undefined };
  }
  return { state: "waiting" };
}

/** The `systemd-run` arguments of a croc transfer, its output going to `log`. */
export function crocArgs(unit: string, log: string, what: { files?: string[]; text?: string }): string[] {
  const send = what.text !== undefined ? ["send", "--text", what.text] : ["send", ...(what.files ?? [])];
  return [
    "--user",
    "--quiet",
    "--collect",
    `--unit=${unit}`,
    "--description=Backslash: croc transfer",
    `--property=StandardOutput=append:${log}`,
    `--property=StandardError=append:${log}`,
    // A receiver who never comes should not keep croc waiting forever.
    "--property=RuntimeMaxSec=24h",
    "croc",
    ...send,
  ];
}

// ---------------------------------------------------------------------------
// History

export type Service = "0x0" | "privatebin" | "croc";

export interface Share {
  id: string;
  service: Service;
  /** File name, or the first line of a text. */
  name: string;
  kind: "file" | "text" | "files";
  bytes?: number;
  created: number;
  /** Unix ms; undefined: never. */
  expires?: number;
  url?: string;
  /** 0x0.st's X-Token, to delete the file early. */
  token?: string;
  /** PrivateBin's delete link. */
  deleteUrl?: string;
  burn?: boolean;
  password?: boolean;
  /** croc */
  code?: string;
  unit?: string;
  log?: string;
  webUrl?: string;
  paths?: string[];
}

export const SERVICE_NAMES: Record<Service, string> = { "0x0": "0x0.st", privatebin: "PrivateBin", croc: "croc" };

/** The command for the receiver: `CROC_SECRET=… croc` on Linux and macOS (croc refuses codes in arguments there). */
export const receiveCommand = (code: string) => `CROC_SECRET=${code} croc`;

/** What to put in the clipboard: the links, or the code phrase. */
export function shareText(s: Share): string {
  if (s.service === "croc") return s.code ?? "";
  return s.url ?? "";
}

export const isExpired = (s: Share, now = Date.now()) => s.expires !== undefined && s.expires <= now;
