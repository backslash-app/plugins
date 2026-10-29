// Copied files (clipboard URIs), age and SSH recipients, GPG keys from
// --with-colons, what an encrypted file is for, output names, and the age /
// gpg command lines. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files from the clipboard

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line, # comments), GNOME's x-special/gnome-copied-files ("copy" then URIs),
 * or plain absolute paths.
 */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue; // another machine
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

const trim = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => trim(p).split("/").pop() ?? p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";

/** `dir/name.ext`, or `dir/name-2.ext`, `-3`… : never an existing path. */
export function freePath(dir: string, name: string, ext: string, exists: (p: string) => boolean): string {
  const suffix = ext ? `.${ext}` : "";
  const base = `${dir === "/" ? "" : dir}/${name}`;
  let candidate = `${base}${suffix}`;
  for (let i = 2; exists(candidate); i++) candidate = `${base}-${i}${suffix}`;
  return candidate;
}

export const ENCRYPTED = /\.(age|gpg|pgp|asc)$/i;

/** "report.pdf" → "report.pdf.age" (or .gpg, .asc), never an existing file. */
export function encryptedPath(path: string, ext: "age" | "gpg" | "asc", exists: (p: string) => boolean): string {
  return freePath(dirname(path), basename(path), ext, exists);
}

/** "report.pdf.age" → "report.pdf", or "report-2.pdf" when that is taken; "secret.gpg" → "secret". */
export function decryptedPath(path: string, exists: (p: string) => boolean): string {
  const name = basename(path).replace(ENCRYPTED, "") || "decrypted";
  const m = name.match(/^(.+?)(\.[^.]+)?$/)!;
  const ext = m[2] ? m[2].slice(1) : "";
  return freePath(dirname(path), ext ? m[1] : name, ext, exists);
}

// ---------------------------------------------------------------------------
// age recipients

export interface Recipient {
  /** age1…, or a whole SSH public key line. */
  key: string;
  kind: "age" | "ssh" | "plugin";
  label?: string;
  /** Where it was found: the preference, or a ~/.ssh file. */
  source: string;
}

const AGE_KEY = /^age1[02-9ac-hj-np-z]{58}$/;
const PLUGIN_KEY = /^age1[a-z0-9]+1[02-9ac-hj-np-z]+$/;
const SSH_TYPES = ["ssh-ed25519", "ssh-rsa"];

export const isAgeKey = (s: string) => AGE_KEY.test(s);

/** One SSH public key line, if age can encrypt to it (Ed25519 and RSA). */
export function parseSshKey(line: string, source = ""): Recipient | undefined {
  const m = line.trim().match(/^(ssh-ed25519|ssh-rsa|ecdsa-\S+|sk-\S+)\s+([A-Za-z0-9+/=]+)(?:\s+(.*))?$/);
  if (!m || !SSH_TYPES.includes(m[1])) return undefined;
  return { key: `${m[1]} ${m[2]}`, kind: "ssh", label: m[3]?.trim() || undefined, source };
}

/**
 * The recipients of the preference: age keys or SSH public keys, one per line
 * or separated by commas, named with "# Alice" after the key or "Alice: " before it.
 */
export function parseRecipients(text: string, source = "Preferences"): { recipients: Recipient[]; invalid: string[] } {
  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  const entries = text.split(/\r?\n/).flatMap((l) => (/^\s*ssh-/.test(l) ? [l] : l.split(",")));
  for (const raw of entries) {
    let entry = raw.trim();
    if (!entry || entry.startsWith("#")) continue;
    let label: string | undefined;
    const hash = entry.indexOf(" #");
    if (hash > 0) [entry, label] = [entry.slice(0, hash).trim(), entry.slice(hash + 2).trim()];
    const named = entry.match(/^([^:]+?):\s*(age1\S+|ssh-\S+\s+\S+.*)$/);
    if (named) [label, entry] = [named[1].trim(), named[2].trim()];
    if (AGE_KEY.test(entry)) recipients.push({ key: entry, kind: "age", label, source });
    else if (PLUGIN_KEY.test(entry)) recipients.push({ key: entry, kind: "plugin", label, source });
    else {
      const ssh = parseSshKey(entry, source);
      if (ssh) recipients.push({ ...ssh, label: label ?? ssh.label });
      else invalid.push(entry.length > 24 ? `${entry.slice(0, 24)}…` : entry);
    }
  }
  const seen = new Set<string>();
  return { recipients: recipients.filter((r) => !seen.has(r.key) && !!seen.add(r.key)), invalid };
}

export const recipientTitle = (r: Recipient) =>
  r.label ?? (r.kind === "ssh" ? `${r.key.split(" ")[0]} key` : `${r.key.slice(0, 12)}…${r.key.slice(-6)}`);

/** `age-keygen -y identity`: the public keys of an identity file. */
export const parsePublicKeys = (out: string) =>
  out.split("\n").map((l) => l.trim()).filter((l) => AGE_KEY.test(l) || PLUGIN_KEY.test(l));

/** What an identity file holds: age secret keys, or an SSH private key. */
export function identityKind(text: string): "age" | "ssh" | "other" {
  if (/^AGE-SECRET-KEY-1[0-9A-Z]+$/m.test(text) || /^AGE-PLUGIN-/m.test(text)) return "age";
  if (/-----BEGIN (OPENSSH|RSA) PRIVATE KEY-----/.test(text)) return "ssh";
  return "other";
}

// ---------------------------------------------------------------------------
// What an age file is encrypted to

const ARMOR_BEGIN = "-----BEGIN AGE ENCRYPTED FILE-----";

/** The decoded start of an age file, armored or not. */
function ageHeader(head: Uint8Array): string | undefined {
  let text = new TextDecoder("latin1").decode(head);
  if (text.trimStart().startsWith(ARMOR_BEGIN)) {
    const body = text.trimStart().slice(ARMOR_BEGIN.length).split("-----END")[0].replace(/\s+/g, "");
    try {
      // Only whole groups of 4 characters decode.
      text = atob(body.slice(0, body.length - (body.length % 4)));
    } catch {
      return undefined;
    }
  }
  return text.startsWith("age-encryption.org/v1\n") ? text : undefined;
}

/** The stanza types of an age header: X25519, ssh-ed25519, ssh-rsa, scrypt (a passphrase), plugins. */
export function ageStanzas(head: Uint8Array): string[] | undefined {
  const text = ageHeader(head);
  if (!text) return undefined;
  const types: string[] = [];
  for (const line of text.split("\n").slice(1)) {
    if (line.startsWith("---")) break;
    const m = line.match(/^-> (\S+)/);
    if (m) types.push(m[1]);
  }
  return types;
}

export type Scheme = "age" | "age-passphrase" | "gpg" | "gpg-armored" | "unknown";

/** Which tool decrypts a file, from its first bytes. */
export function schemeOf(head: Uint8Array): Scheme {
  const stanzas = ageStanzas(head);
  if (stanzas) return stanzas.includes("scrypt") ? "age-passphrase" : "age";
  const text = new TextDecoder("latin1").decode(head.subarray(0, 64)).trimStart();
  if (text.startsWith("-----BEGIN PGP MESSAGE-----")) return "gpg-armored";
  // An OpenPGP packet: public-key encrypted session key (tag 1) or symmetric (tag 3), old or new format.
  const b = head[0];
  if (b !== undefined && (b & 0x80)) {
    const tag = b & 0x40 ? b & 0x3f : (b >> 2) & 0x0f;
    if (tag === 1 || tag === 3) return "gpg";
  }
  return "unknown";
}

/** Armored text a user copied, if it is an age or PGP message. */
export function armoredKind(text: string): "age" | "gpg" | undefined {
  const t = text.trim();
  if (t.startsWith(ARMOR_BEGIN) && t.includes("-----END AGE ENCRYPTED FILE-----")) return "age";
  if (t.startsWith("-----BEGIN PGP MESSAGE-----") && t.includes("-----END PGP MESSAGE-----")) return "gpg";
  return undefined;
}

// ---------------------------------------------------------------------------
// GPG keys

export interface GpgKey {
  fingerprint: string;
  keyId: string;
  uids: string[];
  /** Key ids of the subkeys, to recognize ENC_TO lines. */
  subkeys: string[];
  canEncrypt: boolean;
  expired: boolean;
  revoked: boolean;
  /** Validity as gpg computes it: u (ultimate), f (full), m, n, - (unknown)… */
  validity: string;
  created?: Date;
  expires?: Date;
}

/** `gpg --list-keys --with-colons` (or --list-secret-keys): pub/sec, fpr, uid and sub lines. */
export function parseGpgKeys(out: string): GpgKey[] {
  const keys: GpgKey[] = [];
  let cur: GpgKey | undefined;
  let lastWasPrimary = false;
  const date = (s: string) => (/^\d+$/.test(s) ? new Date(Number(s) * 1000) : undefined);
  for (const line of out.split("\n")) {
    const f = line.split(":");
    switch (f[0]) {
      case "pub":
      case "sec":
        cur = {
          fingerprint: "",
          keyId: f[4],
          uids: [],
          subkeys: [],
          // Capital letters of field 12 sum up the key and its subkeys: E = can encrypt now.
          canEncrypt: (f[11] ?? "").includes("E"),
          expired: f[1] === "e",
          revoked: f[1] === "r",
          validity: f[1] || "-",
          created: date(f[5]),
          expires: date(f[6]),
        };
        keys.push(cur);
        lastWasPrimary = true;
        break;
      case "fpr":
        if (cur && lastWasPrimary && !cur.fingerprint) cur.fingerprint = f[9];
        lastWasPrimary = false;
        break;
      case "uid":
        if (cur && f[1] !== "r" && f[9]) cur.uids.push(unescapeColons(f[9]));
        lastWasPrimary = false;
        break;
      case "sub":
      case "ssb":
        if (cur) cur.subkeys.push(f[4]);
        lastWasPrimary = false;
        break;
    }
  }
  return keys;
}

/** gpg escapes ":" and other bytes in user ids as \x3a. */
const unescapeColons = (s: string) => s.replace(/\\x([0-9a-f]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16)));

/** Keys one can encrypt to: not expired, not revoked, with an encryption subkey. */
export const usableKeys = (keys: GpgKey[]) => keys.filter((k) => k.canEncrypt && !k.expired && !k.revoked);

/** "Ada Lovelace <ada@example.com>" → { name: "Ada Lovelace", email: "ada@example.com" } */
export function splitUid(uid: string): { name: string; email?: string } {
  const m = uid.match(/^(.*?)\s*(?:\((.*)\))?\s*<([^>]+)>$/);
  if (m) return { name: m[1] || m[3], email: m[3] };
  return { name: uid };
}

/** `gpg --list-only --status-fd 1 --decrypt`: the key ids a message is encrypted to. */
export function parseEncTo(out: string): string[] {
  return [...out.matchAll(/^\[GNUPG:\] ENC_TO ([0-9A-F]{16})/gm)].map((m) => m[1]);
}

/** Who those key ids are, from the keyring. */
export function recipientsOf(keyIds: string[], keys: GpgKey[]): { keyId: string; key?: GpgKey }[] {
  return keyIds.map((id) => ({
    keyId: id,
    key: keys.find((k) => k.keyId === id || k.subkeys.includes(id) || k.fingerprint.endsWith(id)),
  }));
}

export const groupedFingerprint = (fpr: string) => fpr.toUpperCase().match(/.{1,4}/g)?.join(" ") ?? fpr;

// ---------------------------------------------------------------------------
// Command lines

/** age to recipients: `age -e [-a] -r … -o output -- input` (stdin and stdout when no paths). */
export function ageEncryptArgs(
  recipients: string[],
  o: { input?: string; output?: string; armor?: boolean },
): string[] {
  if (!recipients.length) throw new Error("Pick at least one recipient");
  return [
    "-e",
    ...(o.armor ? ["-a"] : []),
    ...recipients.flatMap((r) => ["-r", r]),
    ...(o.output ? ["-o", o.output] : []),
    ...(o.input ? ["--", o.input] : []),
  ];
}

/** age with a passphrase: asked in the terminal, twice. */
export const agePassphraseArgs = (input: string, output: string, armor = false) => [
  "-e",
  "-p",
  ...(armor ? ["-a"] : []),
  "-o",
  output,
  "--",
  input,
];

export function ageDecryptArgs(identities: string[], o: { input?: string; output?: string }): string[] {
  return [
    "-d",
    ...identities.flatMap((i) => ["-i", i]),
    ...(o.output ? ["-o", o.output] : []),
    ...(o.input ? ["--", o.input] : []),
  ];
}

/**
 * gpg to keys picked from the keyring. `--trust-model always`: the user picked
 * the key by name in the list, which is the certification gpg asks for;
 * without it, batch mode refuses every key that isn't signed.
 */
export function gpgEncryptArgs(
  fingerprints: string[],
  o: { input?: string; output?: string; armor?: boolean; self?: string },
): string[] {
  if (!fingerprints.length) throw new Error("Pick at least one key");
  return [
    "--batch",
    "--no-tty",
    "--trust-model",
    "always",
    "--encrypt",
    ...(o.armor ? ["--armor"] : []),
    ...fingerprints.flatMap((f) => ["--recipient", f]),
    ...(o.self && !fingerprints.includes(o.self) ? ["--encrypt-to", o.self] : []),
    ...(o.output ? ["--output", o.output] : []),
    ...(o.input ? ["--", o.input] : []),
  ];
}

/** gpg with a passphrase (symmetric, AES-256): pinentry asks for it. */
export const gpgSymmetricArgs = (input: string, output: string, armor = false) => [
  "--symmetric",
  "--cipher-algo",
  "AES256",
  ...(armor ? ["--armor"] : []),
  "--output",
  output,
  "--",
  input,
];

/** gpg -d: the passphrase of the secret key (or the message) comes from pinentry. */
export const gpgDecryptArgs = (o: { input?: string; output?: string }) => [
  "--batch",
  "--no-tty",
  "--status-fd",
  "2",
  ...(o.output ? ["--output", o.output] : []),
  "--decrypt",
  ...(o.input ? ["--", o.input] : []),
];

/** The sentence a user understands, from what age or gpg printed. */
export function decryptError(message: string): string {
  const m = message.replace(/^.*?exited with \d+: /s, "");
  if (/no identity matched/i.test(m)) return "None of your age identities can open it";
  if (/incorrect passphrase|Bad session key|bad passphrase/i.test(m)) return "Wrong passphrase";
  if (/No secret key|decryption failed: No secret key/i.test(m)) return "Your keyring has no key that can open it";
  if (/Inappropriate ioctl|cannot open \/dev\/tty|No pinentry|pinentry.*(not found|failed)/i.test(m)) {
    return "No passphrase prompt could open: decrypt it in a terminal";
  }
  if (/could not read passphrase|failed to read passphrase|terminal/i.test(m)) {
    return "It needs a passphrase: decrypt it in a terminal";
  }
  const line = m.split("\n").map((l) => l.replace(/^(age: error: |gpg: |\[GNUPG:\] .*)/, "").trim()).filter(Boolean);
  return line.find((l) => !/report unexpected/.test(l)) ?? "Decryption failed";
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Text decoded for display, or undefined when it looks binary. */
export function asText(bytes: Uint8Array): string | undefined {
  const sample = bytes.subarray(0, 8192);
  if (sample.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
}
