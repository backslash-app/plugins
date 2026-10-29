// Certificates as plain data: PEM blocks, `openssl x509 -text` and `openssl s_client`
// output, fingerprints, expiry, mkcert file names. Pure (fingerprints use Web Crypto), tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// PEM

const PEM = /-----BEGIN (?:X509 |TRUSTED )?CERTIFICATE-----[\s\S]+?-----END (?:X509 |TRUSTED )?CERTIFICATE-----/g;

/** Every certificate block in a text (a bundle, `s_client -showcerts` output, the clipboard). */
export function pemBlocks(text: string): string[] {
  return [...String(text ?? "").matchAll(PEM)].map((m) =>
    m[0].replace(/(TRUSTED |X509 )CERTIFICATE/g, "CERTIFICATE").replace(/\r/g, "")
  );
}

/** Whether a text holds a private key: never shown, only mentioned. */
export const hasPrivateKey = (text: string) => /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text);

/** The DER bytes of a PEM block. */
export function pemToDer(pem: string): Uint8Array {
  const b64 = pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** `AB:CD:…`, as openssl and browsers print fingerprints. */
export const colonHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(":");

export interface Fingerprints {
  sha256: string;
  sha1: string;
}

/** SHA-256 and SHA-1 of the DER, the same as `openssl x509 -fingerprint`. */
export async function fingerprints(pem: string): Promise<Fingerprints> {
  const der = pemToDer(pem);
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", der as BufferSource),
    crypto.subtle.digest("SHA-1", der as BufferSource),
  ]);
  return { sha256: colonHex(new Uint8Array(a)), sha1: colonHex(new Uint8Array(b)) };
}

// ---------------------------------------------------------------------------
// openssl x509 -text

export interface Cert {
  subject: string;
  issuer: string;
  serial: string;
  notBefore?: Date;
  notAfter?: Date;
  signature: string;
  /** "RSA 2048", "ECDSA P-256", "Ed25519". */
  keyType: string;
  names: string[];
  isCA: boolean;
  keyUsage: string[];
  extendedKeyUsage: string[];
  ocsp?: string;
  caIssuers?: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `Nov  7 12:44:37 2026 GMT` → Date. */
export function parseOpensslDate(text: string | undefined): Date | undefined {
  const m = /^([A-Z][a-z]{2})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})(?:\s+GMT)?$/.exec(
    String(text ?? "").trim(),
  );
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[1]);
  if (month < 0) return undefined;
  return new Date(Date.UTC(Number(m[6]), month, Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])));
}

/** The indented lines under a `Header:` line of the text output. */
function block(text: string, header: string): string[] {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => l.trim().replace(/:?\s*(critical)?$/, "") === header);
  if (i < 0) return [];
  const indent = lines[i].search(/\S/);
  const out: string[] = [];
  for (const l of lines.slice(i + 1)) {
    if (!l.trim() || l.search(/\S/) <= indent) break;
    out.push(l.trim());
  }
  return out;
}

function keyType(text: string): string {
  const alg = /Public Key Algorithm:\s*(\S+)/.exec(text)?.[1] ?? "";
  const bits = /Public-Key:\s*\((\d+) bit\)/.exec(text)?.[1];
  if (/rsa/i.test(alg)) return `RSA${bits ? ` ${bits}` : ""}`;
  if (/ecPublicKey/i.test(alg)) {
    const curve = /NIST CURVE:\s*(\S+)/.exec(text)?.[1] ?? /ASN1 OID:\s*(\S+)/.exec(text)?.[1];
    return `ECDSA${curve ? ` ${curve}` : bits ? ` ${bits}` : ""}`;
  }
  if (/ed25519/i.test(alg)) return "Ed25519";
  if (/ed448/i.test(alg)) return "Ed448";
  return alg || "Unknown";
}

/** The output of `openssl x509 -noout -text`. */
export function parseCertText(text: string): Cert {
  const line = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? "";
  const serialInline = line(/Serial Number:\s*(\S.*)$/m);
  const serial = serialInline
    ? serialInline.replace(/\s*\(0x[0-9a-f]+\)$/i, "").replace(/^(\d+)$/, (n) => BigInt(n).toString(16))
    : (block(text, "Serial Number")[0] ?? "");
  const san = block(text, "X509v3 Subject Alternative Name").join(", ");
  const aia = block(text, "Authority Information Access");
  const list = (header: string) => block(text, header).join(", ").split(/,\s*/).map((s) => s.trim()).filter(Boolean);
  return {
    subject: line(/^\s*Subject:\s*(.*)$/m),
    issuer: line(/^\s*Issuer:\s*(.*)$/m),
    serial: serial.replace(/:/g, "").toUpperCase(),
    notBefore: parseOpensslDate(line(/Not Before\s*:\s*(.*)$/m)),
    notAfter: parseOpensslDate(line(/Not After\s*:\s*(.*)$/m)),
    signature: line(/Signature Algorithm:\s*(\S+)/),
    keyType: keyType(text),
    names: [...san.matchAll(/(?:DNS|IP Address|email|URI):([^,\s]+)/g)].map((m) => m[1]),
    isCA: block(text, "X509v3 Basic Constraints").some((l) => /CA:TRUE/.test(l)),
    keyUsage: list("X509v3 Key Usage"),
    extendedKeyUsage: list("X509v3 Extended Key Usage"),
    ocsp: aia.map((l) => /^OCSP - URI:(\S+)/.exec(l)?.[1]).find(Boolean),
    caIssuers: aia.map((l) => /^CA Issuers - URI:(\S+)/.exec(l)?.[1]).find(Boolean),
  };
}

/** A field of a distinguished name in either `CN = x, O = y` or `/CN=x/O=y` form. */
export function dnField(dn: string | undefined, key: string): string | undefined {
  if (!dn) return undefined;
  const m = new RegExp(`(?:^|[,/]\\s*)${key}\\s*=\\s*("[^"]*"|[^,/]+)`).exec(dn);
  return m ? m[1].replace(/^"|"$/g, "").trim() : undefined;
}

/** What a certificate is called: its CN, else its first name, else its organization. */
export const certName = (c: Pick<Cert, "subject" | "names">) =>
  dnField(c.subject, "CN") ?? c.names[0] ?? dnField(c.subject, "O") ?? (c.subject || "Certificate");

/** "Let's Encrypt (R11)", "mkcert development CA". */
export function issuerName(c: Pick<Cert, "issuer">): string {
  const o = dnField(c.issuer, "O");
  const cn = dnField(c.issuer, "CN");
  if (o && cn && o !== cn && !cn.startsWith(o)) return `${o} (${cn})`;
  return cn ?? o ?? c.issuer;
}

export const selfSigned = (c: Pick<Cert, "subject" | "issuer">) => !!c.subject && c.subject === c.issuer;

/** mkcert's certificates and root say so in their organization. */
export const isMkcert = (c: Pick<Cert, "subject" | "issuer">) =>
  /mkcert development/i.test(`${dnField(c.subject, "O") ?? ""} ${dnField(c.issuer, "O") ?? ""}`);

// ---------------------------------------------------------------------------
// Expiry

export function daysLeft(c: Pick<Cert, "notAfter">, now = Date.now()): number | undefined {
  return c.notAfter ? Math.floor((c.notAfter.getTime() - now) / 86400_000) : undefined;
}

export type Health = "valid" | "expiring" | "expired" | "notYet" | "unknown";

export function health(c: Pick<Cert, "notAfter" | "notBefore">, warnDays: number, now = Date.now()): Health {
  if (!c.notAfter) return "unknown";
  if (c.notBefore && c.notBefore.getTime() > now) return "notYet";
  if (c.notAfter.getTime() <= now) return "expired";
  return (daysLeft(c, now) ?? 0) < warnDays ? "expiring" : "valid";
}

export const HEALTH: Record<Health, { title: string; color: Color }> = {
  valid: { title: "Valid", color: "green" },
  expiring: { title: "Expires soon", color: "orange" },
  expired: { title: "Expired", color: "red" },
  notYet: { title: "Not yet valid", color: "yellow" },
  unknown: { title: "Unknown", color: "gray" },
};

/** "in 12 days", "today", "3 days ago", "in 2 years". */
export function expiryText(c: Pick<Cert, "notAfter">, now = Date.now()): string {
  const d = daysLeft(c, now);
  if (d === undefined) return "no expiry date";
  const span = (n: number) =>
    n >= 730
      ? `${Math.floor(n / 365)} years`
      : n >= 60
      ? `${Math.floor(n / 30)} months`
      : `${n} day${n === 1 ? "" : "s"}`;
  if (c.notAfter!.getTime() <= now) return d === -1 || d === 0 ? "expired today" : `expired ${span(-d - 1)} ago`;
  if (d === 0) return "expires today";
  return `in ${span(d)}`;
}

/** Soonest expiry first; certificates without a date last. */
export function sortByExpiry<T extends { cert: Pick<Cert, "notAfter"> }>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.cert.notAfter?.getTime() ?? Infinity) - (b.cert.notAfter?.getTime() ?? Infinity));
}

/** Whether a certificate covers a host name (wildcards cover one label). */
export function covers(c: Pick<Cert, "names" | "subject">, host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  const names = c.names.length ? c.names : [dnField(c.subject, "CN") ?? ""];
  return names.some((n) => {
    const name = n.toLowerCase();
    if (name === h) return true;
    if (name.startsWith("*.")) {
      const rest = h.slice(h.indexOf(".") + 1);
      return h.includes(".") && rest === name.slice(2);
    }
    return false;
  });
}

// ---------------------------------------------------------------------------
// openssl s_client

export interface Target {
  host: string;
  port: number;
}

/** `example.com`, `example.com:8443`, `https://example.com/x`, `[::1]:443`, `smtp.x.com:465` → host and port. */
export function parseTarget(input: string): Target {
  const text = String(input ?? "").trim();
  if (!text) throw new Error("Type a host name, such as example.com or example.com:8443");
  let host = text;
  let port = 443;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) {
    const u = new URL(text);
    host = u.hostname.replace(/^\[|\]$/g, "");
    const defaults: Record<string, number> = { "https:": 443, "wss:": 443, "ldaps:": 636, "ftps:": 990, "imaps:": 993 };
    port = u.port ? Number(u.port) : defaults[u.protocol] ?? 443;
  } else {
    const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(text);
    const hp = /^([^:/\s]+)(?::(\d+))?(?:\/.*)?$/.exec(text);
    if (v6) [host, port] = [v6[1], v6[2] ? Number(v6[2]) : 443];
    else if (hp) [host, port] = [hp[1], hp[2] ? Number(hp[2]) : 443];
    else throw new Error(`“${text}” is not a host name`);
  }
  if (!/^[a-z0-9.\-_:]+$/i.test(host)) throw new Error(`“${host}” is not a host name`);
  if (!(port > 0 && port < 65536)) throw new Error(`${port} is not a port`);
  return { host: host.toLowerCase(), port };
}

/** `host:port`, with brackets for IPv6. */
export const targetText = (t: Target) => `${t.host.includes(":") ? `[${t.host}]` : t.host}:${t.port}`;

export const isIp = (host: string) => /^[\d.]+$/.test(host) || host.includes(":");

export interface Handshake {
  protocol?: string;
  cipher?: string;
  verifyCode?: number;
  verifyText?: string;
  tempKey?: string;
}

/** The connection summary of `openssl s_client` output. */
export function parseHandshake(out: string): Handshake {
  const neu = /^New, (\S+), Cipher is (\S+)/m.exec(out);
  const verify = /Verify return code: (\d+) \(([^)]*)\)/.exec(out);
  return {
    protocol: neu?.[1] ?? /^\s*Protocol\s*:\s*(\S+)/m.exec(out)?.[1],
    cipher: neu?.[2] ?? /^\s*Cipher\s*:\s*(\S+)/m.exec(out)?.[1],
    verifyCode: verify ? Number(verify[1]) : undefined,
    verifyText: verify?.[2],
    tempKey: /Server Temp Key: (.+)$/m.exec(out)?.[1]?.trim(),
  };
}

/** The useful line of an s_client failure: "Connection refused", "Name or service not known". */
export function connectError(message: string): string {
  const lines = message.split("\n").map((l) => l.trim()).filter(Boolean);
  const known = lines.find((l) =>
    /refused|not known|timed out|timeout|no route|unreachable|wrong version|handshake failure|alert/i.test(l)
  );
  const text = (known ?? lines.find((l) => /error/i.test(l)) ?? lines[0] ?? "No TLS handshake")
    .replace(/^.*?:error:[0-9A-F]+:[^:]*:[^:]*:[^:]*:\d+:/, "").replace(/^connect:errno=\d+$/, "Connection failed");
  if (/wrong version number/i.test(text)) return "The server does not speak TLS on this port";
  if (/not known|nodename/i.test(text)) return "This host name does not resolve";
  if (/refused/i.test(text)) return "Connection refused";
  return text;
}

/** Plain-language names of the usual verify codes. */
export function verifyLook(code: number | undefined, text?: string): { title: string; color: Color } {
  if (code === undefined) return { title: "Not verified", color: "gray" };
  if (code === 0) return { title: "Trusted", color: "green" };
  const known: Record<number, string> = {
    10: "Expired",
    18: "Self-signed",
    19: "Self-signed root in chain",
    20: "Unknown issuer",
    21: "Incomplete chain",
    62: "Wrong host name",
  };
  return { title: known[code] ?? text ?? `Error ${code}`, color: code === 62 || code === 10 ? "red" : "orange" };
}

/** Leaf, intermediates and root, as served (index 0 is the server's own). */
export function chainRole(index: number, cert: Pick<Cert, "subject" | "issuer" | "isCA">, total: number): string {
  if (index === 0) return "Server";
  if (selfSigned(cert)) return "Root";
  return index === total - 1 && !cert.isCA ? "Certificate" : "Intermediate";
}

// ---------------------------------------------------------------------------
// Files and mkcert

/** Folders and files skipped while looking for certificates. */
export const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  "vendor",
  "target",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
  ".cache",
  ".next",
  ".terraform",
]);

export const CERT_FILE = /\.(pem|crt|cer|cert)$/i;

/** Files that are private keys by their name: not opened. */
export const KEY_FILE = /(^|[-_.])(key|priv|private)([-_.]|$)|\.key$/i;

export const looksLikeCert = (name: string) => CERT_FILE.test(name) && !KEY_FILE.test(name.replace(CERT_FILE, ""));

/** mkcert's key next to a certificate: `x.pem` → `x-key.pem`. */
export const keyFileFor = (path: string) => path.replace(/(\.pem|\.crt)$/i, "-key.pem");

/** Names typed by the user: commas or spaces, each a host, wildcard, IP or e-mail. */
export function parseNames(text: string): string[] {
  const names = String(text ?? "").split(/[\s,]+/).map((n) => n.trim()).filter(Boolean);
  for (const n of names) {
    if (!/^(\*\.)?[a-z0-9_.\-]+$/i.test(n) && !/^[0-9a-f:]+$/i.test(n) && !/^[^@\s]+@[^@\s]+$/.test(n)) {
      throw new Error(`“${n}” is not a host name, IP address or e-mail`);
    }
  }
  if (!names.length) throw new Error("Type at least one name: localhost, myapp.test, *.myapp.test, 127.0.0.1");
  return [...new Set(names)];
}

/** The file name mkcert would pick: `example.test+2` for three names, `_wildcard.example.test`. */
export function mkcertBase(names: string[]): string {
  const first = (names[0] ?? "cert").replace(/^\*/, "_wildcard").replace(/:/g, "_");
  return names.length > 1 ? `${first}+${names.length - 1}` : first;
}

/** `~/certs` → `/home/ada/certs`. */
export const expandHome = (path: string, home: string) =>
  path.trim().replace(/^~(?=$|\/)/, home).replace(/\/+$/, "") || home;

/** `/home/ada/certs/x.pem` → `~/certs/x.pem`. */
export const tildify = (path: string, home: string) =>
  home && (path === home || path.startsWith(home + "/")) ? `~${path.slice(home.length)}` : path;

/** The folders searched for certificate files: the `read` permission, as in backslash.toml. */
export const FOLDERS = [
  "~/.local/share/mkcert",
  "~/certs",
  "~/Projects",
  "~/projects",
  "~/Code",
  "~/code",
  "~/src",
  "~/dev",
  "~/Developer",
  "~/work",
  "~/git",
  "~/repos",
];
