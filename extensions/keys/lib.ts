// SSH public keys, ssh-keygen / ssh-add listings and GnuPG's colon format. No I/O here.

// ---------------------------------------------------------------------------
// SSH

export interface PublicKey {
  /** `ssh-ed25519`, `ssh-rsa`, `ecdsa-sha2-nistp256`, `sk-ssh-ed25519@openssh.com`, `…-cert-v01@openssh.com`. */
  algorithm: string;
  /** The base64 blob. */
  blob: string;
  comment: string;
}

/** The first key of a `.pub` file (`type base64 comment`), options before it ignored. */
export function parsePublicKey(text: string): PublicKey | undefined {
  for (const line of text.split("\n")) {
    const m = /(?:^|\s)((?:ssh|ecdsa|sk)-[\w@.-]+)\s+([A-Za-z0-9+/]+={0,3})(?:\s+(.*))?$/.exec(line.trim());
    if (m) return { algorithm: m[1], blob: m[2], comment: (m[3] ?? "").trim() };
  }
  return undefined;
}

export interface Fingerprint {
  bits: number;
  /** `SHA256:…` */
  fingerprint: string;
  comment: string;
  /** `ED25519`, `RSA`, `ECDSA`, `ED25519-SK`, `ED25519-CERT`… */
  type: string;
}

/** One line of `ssh-keygen -lf` or `ssh-add -l`: `256 SHA256:abc… me@host (ED25519)`. */
export function parseFingerprintLine(line: string): Fingerprint | undefined {
  const m = /^(\d+)\s+(\S+:\S+)\s+(.*?)\s*\(([\w-]+)\)\s*$/.exec(line.trim());
  if (!m) return undefined;
  return { bits: Number(m[1]), fingerprint: m[2], comment: m[3] === "no comment" ? "" : m[3], type: m[4] };
}

/** `ssh-add -l`: the loaded keys; empty when the agent has none. */
export function parseAgentList(out: string): Fingerprint[] {
  return out.split("\n").map(parseFingerprintLine).filter((f): f is Fingerprint => !!f);
}

/** What `ssh-add -l` failing means, as a user would say it. */
export function agentState(error: string): "empty" | "no-agent" | "unknown" {
  if (/has no identities/i.test(error)) return "empty";
  if (/could not open a connection|connection refused|no such file|error connecting/i.test(error)) return "no-agent";
  return "unknown";
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The length-prefixed fields of an SSH wire-format blob. */
export function blobFields(blob: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  for (let at = 0; at + 4 <= blob.length && out.length < 8;) {
    const len = view.getUint32(at);
    if (at + 4 + len > blob.length) break;
    out.push(blob.subarray(at + 4, at + 4 + len));
    at += 4 + len;
  }
  return out;
}

function mpintBits(n: Uint8Array): number {
  let i = 0;
  while (i < n.length && n[i] === 0) i++;
  if (i === n.length) return 0;
  return (n.length - i - 1) * 8 + (32 - Math.clz32(n[i]));
}

/** The key's size in bits, read from its public blob, as `ssh-keygen -l` reports it. */
export function keyBits(key: PublicKey): number {
  const a = key.algorithm.replace(/-cert-v01@openssh\.com$/, "");
  if (a.includes("ed25519")) return 256;
  if (a.includes("ed448")) return 456;
  const curve = /nistp(\d+)/.exec(a);
  if (curve) return Number(curve[1]);
  if (a === "ssh-rsa" || a === "ssh-dss") {
    const fields = blobFields(decodeBase64(key.blob));
    const cert = key.algorithm.includes("-cert-");
    // ssh-rsa: name, e, n; certificates insert a nonce after the name.
    const n = a === "ssh-rsa" ? fields[cert ? 3 : 2] : fields[cert ? 2 : 1];
    return n ? mpintBits(n) : 0;
  }
  return 0;
}

/** `ED25519`, `RSA`, `ECDSA-SK`…, the type `ssh-keygen -l` shows in parentheses. */
export function keyType(algorithm: string): string {
  const cert = algorithm.includes("-cert-v01@") ? "-CERT" : "";
  const a = algorithm.replace(/-cert-v01@openssh\.com$/, "").replace(/@openssh\.com$/, "");
  const sk = a.startsWith("sk-") ? "-SK" : "";
  const base = a.includes("ed25519")
    ? "ED25519"
    : a.includes("ecdsa")
    ? "ECDSA"
    : a === "ssh-rsa"
    ? "RSA"
    : a === "ssh-dss"
    ? "DSA"
    : a.toUpperCase();
  return base + sk + cert;
}

/** `SHA256:` + unpadded base64 of the SHA-256 of the blob, like `ssh-keygen -l`. */
export async function sha256Fingerprint(blob: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", decodeBase64(blob) as BufferSource));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  return `SHA256:${btoa(bin).replace(/=+$/, "")}`;
}

export interface Certificate {
  /** Undefined when valid forever. */
  validFrom?: number;
  validTo?: number;
  principals: string[];
  keyId?: string;
}

/** `ssh-keygen -Lf id_ed25519-cert.pub`. */
export function parseCertificate(out: string): Certificate {
  const cert: Certificate = { principals: [] };
  const valid = /Valid:\s+(?:from\s+(\S+)\s+to\s+(\S+)|(forever)|after\s+(\S+)|before\s+(\S+))/.exec(out);
  // Local times, as ssh-keygen prints them.
  const time = (t?: string) => t ? Date.parse(t) : undefined;
  if (valid && !valid[3]) {
    cert.validFrom = time(valid[1] ?? valid[4]);
    cert.validTo = time(valid[2] ?? valid[5]);
  }
  cert.keyId = /Key ID:\s+"(.*)"/.exec(out)?.[1];
  const principals = /Principals:\s*\n((?:\s{12,}\S.*\n?)*)/.exec(out);
  if (principals) cert.principals = principals[1].split("\n").map((l) => l.trim()).filter((l) => l && l !== "(none)");
  return cert;
}

/** Files of ~/.ssh that are never keys. */
const NOT_KEYS = /^(config|known_hosts.*|authorized_keys.*|environment|rc|.*\.(old|bak|sock|socket|log))$/;

/** The private key files to look for: `id_*` without `.pub`, and the partner of each `.pub`. */
export function privateKeyNames(names: string[]): string[] {
  const set = new Set(names);
  const out = new Set<string>();
  for (const n of names) {
    if (n.endsWith(".pub")) {
      const priv = n.replace(/(-cert)?\.pub$/, "");
      if (set.has(priv)) out.add(priv);
    } else if (/^id_/.test(n) && !NOT_KEYS.test(n)) out.add(n);
  }
  return [...out].sort();
}

/** A file name usable for a new key in ~/.ssh. */
export function validKeyName(name: string): string | undefined {
  if (!name) return "Give the key a file name";
  if (!/^[\w.@-]+$/.test(name) || name.startsWith(".")) return "Use letters, digits, dots, dashes or underscores";
  if (name.endsWith(".pub")) return "Name the private key; .pub is added for the public one";
  if (NOT_KEYS.test(name)) return `${name} is used by SSH for something else`;
  return undefined;
}

/** `ssh-keygen` arguments for a new Ed25519 key. */
export function keygenArgs(path: string, comment: string, passphrase: string): string[] {
  return ["-t", "ed25519", "-a", "100", "-f", path, "-N", passphrase, "-C", comment, "-q"];
}

/** The first name of `id_ed25519`, `id_ed25519_2`… that is not taken. */
export function freeKeyName(names: string[], base = "id_ed25519"): string {
  const taken = new Set(names);
  if (!taken.has(base) && !taken.has(`${base}.pub`)) return base;
  for (let i = 2;; i++) {
    const n = `${base}_${i}`;
    if (!taken.has(n) && !taken.has(`${n}.pub`)) return n;
  }
}

// ---------------------------------------------------------------------------
// GnuPG

export interface GpgUid {
  uid: string;
  name: string;
  email?: string;
  validity: string;
}

export interface GpgSubkey {
  keyId: string;
  fingerprint?: string;
  algorithm: string;
  bits: number;
  created?: number;
  expires?: number;
  capabilities: string;
  validity: string;
}

export interface GpgKey extends GpgSubkey {
  /** Whether the secret part is here (`sec`), or only the public key (`pub`). */
  secret: boolean;
  /** `#`: a stub (secret key offline), `>`: on a smartcard. */
  card?: string;
  uids: GpgUid[];
  subkeys: GpgSubkey[];
}

const ALGORITHMS: Record<string, string> = {
  "1": "RSA",
  "2": "RSA",
  "3": "RSA",
  "16": "Elgamal",
  "17": "DSA",
  "18": "ECDH",
  "19": "ECDSA",
  "22": "EdDSA",
  "23": "AEDH",
  "24": "AEDSA",
};

/** `ed25519` or `RSA 4096`. */
function algorithmName(algo: string, bits: string, curve?: string): string {
  if (curve) return curve;
  const name = ALGORITHMS[algo] ?? `algorithm ${algo}`;
  return bits ? `${name} ${bits}` : name;
}

const epoch = (s?: string) => s && /^\d+$/.test(s) && s !== "0" ? Number(s) * 1000 : undefined;

/** `Ada Lovelace (work) <ada@example.com>` → name and email. */
export function splitUid(uid: string): { name: string; email?: string } {
  const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(uid);
  if (m) return { name: m[1].replace(/\s*\([^)]*\)$/, "") || m[2], email: m[2] };
  if (/^[^\s@]+@[^\s@]+$/.test(uid)) return { name: uid, email: uid };
  return { name: uid };
}

/** `\x3a` and other escapes of GnuPG's colon listing. */
const unescape = (s: string) => s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** `gpg --list-keys --with-colons` or `--list-secret-keys --with-colons`. */
export function parseGpgColons(out: string): GpgKey[] {
  const keys: GpgKey[] = [];
  let current: GpgKey | undefined;
  let last: GpgSubkey | undefined;
  for (const line of out.split("\n")) {
    const f = line.split(":");
    const type = f[0];
    if (type === "pub" || type === "sec") {
      current = {
        secret: type === "sec",
        validity: f[1],
        bits: Number(f[2]) || 0,
        algorithm: algorithmName(f[3], f[2], f[16]),
        keyId: f[4],
        created: epoch(f[5]),
        expires: epoch(f[6]),
        capabilities: f[11] ?? "",
        card: f[14] === "#" || f[14] === ">" ? f[14] : f[14] && f[14] !== "+" ? ">" : undefined,
        uids: [],
        subkeys: [],
      };
      keys.push(current);
      last = current;
    } else if ((type === "sub" || type === "ssb") && current) {
      last = {
        validity: f[1],
        bits: Number(f[2]) || 0,
        algorithm: algorithmName(f[3], f[2], f[16]),
        keyId: f[4],
        created: epoch(f[5]),
        expires: epoch(f[6]),
        capabilities: f[11] ?? "",
      };
      current.subkeys.push(last);
    } else if (type === "fpr" && last && !last.fingerprint) {
      last.fingerprint = f[9];
    } else if (type === "uid" && current) {
      const uid = unescape(f[9] ?? "");
      current.uids.push({ uid, validity: f[1], ...splitUid(uid) });
    }
  }
  return keys;
}

export const CAPABILITIES: Record<string, string> = { s: "sign", c: "certify", e: "encrypt", a: "authenticate" };

/** The usable capabilities of a key (the upper-case letters of the primary key), in words. */
export function capabilityWords(caps: string): string[] {
  const upper = caps.replace(/[^SCEA]/g, "");
  const letters = upper ? upper.toLowerCase() : caps.replace(/[^scea]/g, "");
  return Object.entries(CAPABILITIES).filter(([c]) => letters.includes(c)).map(([, word]) => word);
}

export type KeyHealth = "ok" | "expiring" | "expired" | "revoked" | "invalid";

/** Expired, revoked, or expiring within `soonDays`. */
export function keyHealth(k: { validity: string; expires?: number }, now = Date.now(), soonDays = 30): KeyHealth {
  if (k.validity === "r") return "revoked";
  if (k.validity === "e" || (k.expires && k.expires <= now)) return "expired";
  if (k.validity === "i" || k.validity === "d") return "invalid";
  if (k.expires && k.expires - now < soonDays * 86_400_000) return "expiring";
  return "ok";
}

/** "in 3 months", "2 days ago", "never". */
export function whenWords(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "never";
  const d = ms - now, a = Math.abs(d), day = 86_400_000;
  const text = a < day
    ? "today"
    : a < 60 * day
    ? `${Math.round(a / day)} days`
    : a < 730 * day
    ? `${Math.round(a / (30 * day))} months`
    : `${Math.round(a / (365 * day))} years`;
  if (text === "today") return text;
  return d > 0 ? `in ${text}` : `${text} ago`;
}

export const shortDate = (ms?: number) =>
  ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";

/** `ABCD EF01 …` groups of four, as GnuPG prints fingerprints. */
export const groupFingerprint = (fpr: string) => fpr.replace(/(.{4})(?=.)/g, "$1 ");
