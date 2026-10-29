// Copied files (clipboard URIs), hash algorithms, SHA256SUMS-style files in
// their GNU, BSD and signed forms, hashes pasted from a web page, and what
// gpg --status-fd says about a signature. Pure, tested in lib_test.ts.

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

// ---------------------------------------------------------------------------
// Algorithms

export type Algo = "sha256" | "sha512" | "sha1" | "md5" | "blake2b";

export const ALGOS: { algo: Algo; title: string; program: string; length: number; weak?: boolean }[] = [
  { algo: "sha256", title: "SHA-256", program: "sha256sum", length: 64 },
  { algo: "sha512", title: "SHA-512", program: "sha512sum", length: 128 },
  { algo: "blake2b", title: "BLAKE2b", program: "b2sum", length: 128 },
  { algo: "sha1", title: "SHA-1", program: "sha1sum", length: 40, weak: true },
  { algo: "md5", title: "MD5", program: "md5sum", length: 32, weak: true },
];

export const algoInfo = (a: Algo) => ALGOS.find((x) => x.algo === a)!;
export const algoTitle = (a: Algo) => algoInfo(a).title;

/** The algorithms a hex hash of this length can come from (SHA-512 and BLAKE2b share 128). */
export const algosForLength = (n: number): Algo[] => ALGOS.filter((a) => a.length === n).map((a) => a.algo);

const ALGO_NAMES: [RegExp, Algo][] = [
  [/^sha-?256$|^sha2-256$/i, "sha256"],
  [/^sha-?512$|^sha2-512$/i, "sha512"],
  [/^sha-?1$/i, "sha1"],
  [/^md5$/i, "md5"],
  [/^blake2b?(-512)?$|^b2$/i, "blake2b"],
];

/** "SHA256", "sha-512", "BLAKE2b", "MD5" → an algorithm. */
export function algoFromName(name: string): Algo | undefined {
  return ALGO_NAMES.find(([re]) => re.test(name.trim()))?.[1];
}

/** The hash on the first line of `sha256sum -- file` ("\" first when the name was escaped). */
export function parseHashOutput(out: string): string {
  const m = out.trim().match(/^\\?([0-9a-fA-F]+)\s/) ?? out.trim().match(/^\\?([0-9a-fA-F]+)$/);
  if (!m) throw new Error("Unexpected output from the hash program");
  return m[1].toLowerCase();
}

// ---------------------------------------------------------------------------
// Sums files

export interface SumEntry {
  name: string;
  hash: string;
  algo?: Algo;
}

export interface SumsFile {
  entries: SumEntry[];
  /** Algorithm told by the file's name (SHA256SUMS, x.iso.sha512…). */
  algo?: Algo;
  /** An inline (clearsigned) PGP signature wraps the sums. */
  clearsigned: boolean;
}

const SUMS_NAME =
  /^(?:(sha(?:1|224|256|384|512)|md5|b2|blake2b?)sums?(?:\.txt)?|checksums?(?:\.txt)?|.+\.(sha(?:1|256|512)(?:sum)?|md5(?:sum)?|b2(?:sum)?|digests?))$/i;

/** Whether a file looks like a list of checksums: SHA256SUMS, CHECKSUMS.txt, x.iso.sha256… */
export const isSumsFile = (path: string) =>
  SUMS_NAME.test(basename(path).replace(/\.(asc|sig|gpg)$/i, "")) && !/\.(asc|sig|gpg)$/i.test(basename(path));

/** The algorithm a sums file's name tells, if it does. */
export function algoFromSumsName(path: string): Algo | undefined {
  const name = basename(path).toLowerCase();
  const m = name.match(/^(sha1|sha256|sha512|md5|b2|blake2b?)sums?/) ??
    name.match(/\.(sha1|sha256|sha512|md5|b2)(?:sums?)?$/);
  if (!m) return undefined;
  return m[1] === "b2" ? "blake2b" : algoFromName(m[1]);
}

/** For `x.iso.sha256`: the file it is about (`x.iso`). */
export function sumsSubject(path: string): string | undefined {
  const m = basename(path).match(/^(.+)\.(sha1|sha256|sha512|md5|b2)(?:sum)?$/i);
  return m?.[1];
}

/** GNU escapes names with a backslash or a newline: `\hash  a\\b`. */
const unescapeName = (name: string) =>
  name.replace(/\\(\\|n|r)/g, (_, c) => (c === "n" ? "\n" : c === "r" ? "\r" : "\\"));

/** The body of a clearsigned message, without the armor and dash-escaping. */
export function clearsignedBody(text: string): string | undefined {
  const m = text.match(
    /-----BEGIN PGP SIGNED MESSAGE-----\r?\n(?:[A-Za-z]+: .*\r?\n)*\r?\n([\s\S]*?)\r?\n-----BEGIN PGP SIGNATURE-----/,
  );
  return m?.[1].split(/\r?\n/).map((l) => l.replace(/^- /, "")).join("\n");
}

/**
 * Parses a sums file: GNU coreutils (`hash  name`, `hash *name` for binary
 * mode), BSD / OpenSSL tags (`SHA256 (name) = hash`), or a hash alone (for
 * `x.iso.sha256`). Comments and blank lines are skipped; a clearsigned file
 * is read inside its armor.
 */
export function parseSums(text: string, path = ""): SumsFile {
  const body = clearsignedBody(text);
  const algo = algoFromSumsName(path);
  const entries: SumEntry[] = [];
  const subject = sumsSubject(path);
  for (const raw of (body ?? text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    let m = line.match(/^([A-Za-z0-9-]+) ?\((.+)\) ?= ?([0-9a-fA-F]{32,128})$/);
    if (m) {
      entries.push({ name: m[2], hash: m[3].toLowerCase(), algo: algoFromName(m[1]) });
      continue;
    }
    m = raw.match(/^(\\)?([0-9a-fA-F]{32,128})(?: [ *]| \*?|\t)(.+?)\r?$/);
    if (m) {
      const name = m[1] ? unescapeName(m[3]) : m[3];
      entries.push({ name: name.replace(/^\*/, ""), hash: m[2].toLowerCase() });
      continue;
    }
    m = line.match(/^([0-9a-fA-F]{32,128})$/);
    if (m && subject) entries.push({ name: subject, hash: m[1].toLowerCase() });
  }
  for (const e of entries) {
    if (e.algo) continue;
    const candidates = algosForLength(e.hash.length);
    e.algo = algo && candidates.includes(algo) ? algo : candidates.length === 1 ? candidates[0] : algo ?? candidates[0];
  }
  return { entries: entries.filter((e) => algosForLength(e.hash.length).length), algo, clearsigned: !!body };
}

/** The line about `fileName` in a sums file: names may carry ./ or a folder. */
export function findEntry(sums: SumsFile, fileName: string): SumEntry | undefined {
  const exact = sums.entries.find((e) => e.name === fileName || e.name.replace(/^\.\//, "") === fileName);
  return exact ?? sums.entries.find((e) => basename(e.name) === fileName);
}

/** `hash  name`, as sha256sum writes it (and reads it back with -c). */
export function sumsLine(hash: string, name: string): string {
  if (/[\\\n\r]/.test(name)) {
    return `\\${hash}  ${name.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}`;
  }
  return `${hash}  ${name}`;
}

// ---------------------------------------------------------------------------
// A hash copied from a web page

export interface CopiedHash {
  hash: string;
  algos: Algo[];
  /** A file name copied with it, as in `hash  name`. */
  name?: string;
}

/**
 * The hash in copied text: a bare hex string, `sha256:…`, `hash  name`,
 * `SHA256 (name) = hash`, with spaces or a newline around. Undefined for
 * anything else (other text, file lists).
 */
export function copiedHash(text: string): CopiedHash | undefined {
  const t = text.trim();
  if (!t || t.length > 600 || t.split("\n").length > 2) return undefined;
  let m = t.match(/^(?:([A-Za-z0-9-]+)[:=]\s*)?([0-9a-fA-F]{32,128})$/);
  if (m) {
    const hash = m[2].toLowerCase();
    const named = m[1] ? algoFromName(m[1]) : undefined;
    const algos = named ? [named] : algosForLength(hash.length);
    return algos.length && (!named || algoInfo(named).length === hash.length) ? { hash, algos } : undefined;
  }
  const sums = parseSums(t);
  if (sums.entries.length === 1) {
    const e = sums.entries[0];
    const fromTag = /^[A-Za-z]/.test(t) ? e.algo : undefined;
    return { hash: e.hash, algos: fromTag ? [fromTag] : algosForLength(e.hash.length), name: e.name };
  }
  // A hash with spaces every few characters (some sites group them).
  m = t.replace(/\s+/g, "").match(/^([0-9a-fA-F]{32,128})$/);
  if (m && /^[0-9a-fA-F\s]+$/.test(t)) {
    const hash = m[1].toLowerCase();
    const algos = algosForLength(hash.length);
    return algos.length ? { hash, algos } : undefined;
  }
  return undefined;
}

/** Hashes compare without case; a 0x prefix or spaces are ignored. */
export const sameHash = (a: string, b: string) =>
  a.toLowerCase().replace(/^0x|\s+/g, "") === b.toLowerCase().replace(/^0x|\s+/g, "");

/** "3f2a8c1d…9be0" for a row. */
export const shortHash = (hash: string, n = 8) =>
  hash.length > n * 2 + 1 ? `${hash.slice(0, n)}…${hash.slice(-n)}` : hash;

/** The hash in groups of 8, easier to compare by eye. */
export const groupedHash = (hash: string) => hash.match(/.{1,8}/g)?.join(" ") ?? hash;

// ---------------------------------------------------------------------------
// Signatures

/** For a detached signature `x.iso.sig` / `.asc` / `.sign`: the signed file `x.iso`. */
export function signedFile(sigPath: string): string | undefined {
  const m = sigPath.match(/^(.+)\.(sig|asc|sign|gpg)$/i);
  return m?.[1];
}

export const SIGNATURE = /\.(sig|asc|sign)$/i;

/** What a file that ends with .asc or .sig holds, from its first bytes. */
export function pgpKind(head: Uint8Array): "signature" | "clearsigned" | "message" | "key" | "binary" | "other" {
  const text = new TextDecoder().decode(head.subarray(0, 64));
  if (text.startsWith("-----BEGIN PGP SIGNATURE-----")) return "signature";
  if (text.startsWith("-----BEGIN PGP SIGNED MESSAGE-----")) return "clearsigned";
  if (text.startsWith("-----BEGIN PGP MESSAGE-----")) return "message";
  if (text.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) return "key";
  // A binary OpenPGP packet: the high bit of the first byte is set.
  if (head.length && (head[0] & 0x80)) return "binary";
  return "other";
}

export type SigStatus = "good" | "bad" | "expired-key" | "expired-signature" | "revoked-key" | "no-key" | "error";
export type Trust = "ultimate" | "full" | "marginal" | "never" | "undefined";

export interface Signature {
  status: SigStatus;
  keyId?: string;
  fingerprint?: string;
  signer?: string;
  trust?: Trust;
  /** When it was signed. */
  created?: Date;
}

/** `gpg --status-fd 1 --verify …`: one result per signature (NEWSIG starts each). */
export function parseGpgStatus(out: string): Signature[] {
  const sigs: Signature[] = [];
  let cur: Signature | undefined;
  const begin = () => {
    cur = { status: "error" };
    sigs.push(cur);
  };
  for (const line of out.split("\n")) {
    const m = line.match(/^\[GNUPG:\] (\S+)\s?(.*)$/);
    if (!m) continue;
    const [kw, rest] = [m[1], m[2]];
    const f = rest.split(" ");
    if (kw === "NEWSIG") {
      begin();
      continue;
    }
    const status: Record<string, SigStatus> = {
      GOODSIG: "good",
      BADSIG: "bad",
      EXPKEYSIG: "expired-key",
      EXPSIG: "expired-signature",
      REVKEYSIG: "revoked-key",
    };
    if (status[kw]) {
      if (!cur || (cur.status !== "error" && cur.keyId)) begin();
      cur!.status = status[kw];
      cur!.keyId = f[0];
      cur!.signer = f.slice(1).join(" ") || undefined;
    } else if (kw === "ERRSIG") {
      if (!cur) begin();
      cur!.keyId = f[0];
      // ERRSIG <keyid> <pkalgo> <hashalgo> <class> <time> <rc> <fpr>; rc 9 = missing key.
      cur!.status = f[5] === "9" ? "no-key" : "error";
      if (f[4] && /^\d+$/.test(f[4])) cur!.created = new Date(Number(f[4]) * 1000);
      if (f[6] && f[6] !== "-") cur!.fingerprint = f[6];
    } else if (kw === "NO_PUBKEY") {
      if (!cur) begin();
      cur!.status = "no-key";
      cur!.keyId ??= f[0];
    } else if (kw === "VALIDSIG") {
      if (!cur) begin();
      // VALIDSIG <fpr> <date> <timestamp> … <primary fpr>
      cur!.fingerprint = f[9] || f[0];
      if (/^\d+$/.test(f[2] ?? "")) cur!.created = new Date(Number(f[2]) * 1000);
    } else if (kw.startsWith("TRUST_")) {
      if (!cur) begin();
      cur!.trust = kw.slice(6).toLowerCase() as Trust;
    }
  }
  return sigs;
}

/** The one-line verdict of a signature, and its color. */
export function sigVerdict(s: Signature): { text: string; color: "green" | "orange" | "red" | "gray" } {
  const who = s.signer ? ` from ${s.signer}` : "";
  switch (s.status) {
    case "good":
      if (s.trust === "never") {
        return { text: `Good signature${who}, but the key is marked untrusted`, color: "orange" };
      }
      if (s.trust === "ultimate" || s.trust === "full") return { text: `Good signature${who}`, color: "green" };
      return { text: `Good signature${who} (key not certified)`, color: "green" };
    case "bad":
      return { text: `BAD signature${who}: the file was changed`, color: "red" };
    case "expired-key":
      return { text: `Good signature${who}, made with an expired key`, color: "orange" };
    case "expired-signature":
      return { text: `Expired signature${who}`, color: "orange" };
    case "revoked-key":
      return { text: `Signature${who} made with a REVOKED key`, color: "red" };
    case "no-key":
      return {
        text: `Can't check: the public key ${s.keyId ?? ""} isn't in your keyring`.replace("  ", " "),
        color: "orange",
      };
    case "error":
      return { text: "The signature couldn't be checked", color: "gray" };
  }
}

export const TRUST_TITLES: Record<Trust, string> = {
  ultimate: "Ultimate (your own key)",
  full: "Full",
  marginal: "Marginal",
  never: "Never",
  undefined: "Not certified",
};

/** "B329 438B 2FB9 4515 …" */
export const groupedFingerprint = (fpr: string) => fpr.toUpperCase().match(/.{1,4}/g)?.join(" ") ?? fpr;

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

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
