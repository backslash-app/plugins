// TOTP (RFC 6238), base32, otpauth:// links, Google Authenticator migration
// codes, Aegis and 2FAS exports, the passphrase vault and the background scan
// script. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Base32 (RFC 4648)

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Decodes base32, ignoring case, spaces, dashes and padding. Throws on other characters. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const c of clean) {
    const v = ALPHABET.indexOf(c);
    if (v < 0) throw new Error(`“${c}” is not a base32 character`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export function base32Encode(bytes: Uint8Array, pad = false): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  if (pad) { while (out.length % 8) out += "="; }
  return out;
}

/** A secret as typed or pasted, normalized ("jbsw y3dp-ehpk 3pxp" → "JBSWY3DPEHPK3PXP"); throws when invalid. */
export function normalizeSecret(text: string): string {
  const clean = text.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
  if (!clean) throw new Error("The secret key is empty");
  const bytes = base32Decode(clean);
  if (bytes.length < 5) throw new Error("The secret key is too short");
  return clean;
}

// ---------------------------------------------------------------------------
// TOTP

export type Algorithm = "SHA1" | "SHA256" | "SHA512";
export const ALGORITHMS: Algorithm[] = ["SHA1", "SHA256", "SHA512"];

export interface OtpParams {
  digits: number;
  period: number;
  algorithm: Algorithm;
}

export const DEFAULTS: OtpParams = { digits: 6, period: 30, algorithm: "SHA1" };

const HASH: Record<Algorithm, string> = { SHA1: "SHA-1", SHA256: "SHA-256", SHA512: "SHA-512" };

/** HOTP (RFC 4226) of a counter. */
export async function hotp(
  key: Uint8Array,
  counter: number,
  digits = 6,
  algorithm: Algorithm = "SHA1",
): Promise<string> {
  const msg = new Uint8Array(8);
  const view = new DataView(msg.buffer);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const k = await crypto.subtle.importKey(
    "raw",
    key as Uint8Array<ArrayBuffer>,
    { name: "HMAC", hash: HASH[algorithm] },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", k, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/** TOTP (RFC 6238) at `seconds` since the epoch. */
export function totp(key: Uint8Array, seconds: number, p: OtpParams = DEFAULTS): Promise<string> {
  return hotp(key, Math.floor(seconds / p.period), p.digits, p.algorithm);
}

/** Seconds before the code changes. */
export const secondsLeft = (seconds: number, period: number) => period - (Math.floor(seconds) % period);

/** "123456" → "123 456", "12345678" → "1234 5678", "1234567" → "123 4567". */
export function groupCode(code: string): string {
  if (code.length < 6) return code;
  const half = Math.floor(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`;
}

// ---------------------------------------------------------------------------
// Accounts

export interface Account extends OtpParams {
  issuer: string;
  account: string;
  /** Base32, normalized. */
  secret: string;
}

function algorithmOf(text: string | undefined): Algorithm {
  const a = (text ?? "SHA1").toUpperCase().replace(/[-_]/g, "");
  if (a === "SHA1" || a === "SHA256" || a === "SHA512") return a;
  throw new Error(`Unsupported algorithm ${text}: use SHA1, SHA256 or SHA512`);
}

export function validParams(digits: number, period: number): void {
  if (!Number.isInteger(digits) || digits < 6 || digits > 10) throw new Error("Digits must be between 6 and 10");
  if (!Number.isInteger(period) || period < 5 || period > 300) throw new Error("Period must be 5 to 300 seconds");
}

/** Builds an account from form fields; throws with a readable message. */
export function accountFrom(fields: {
  issuer?: string;
  account?: string;
  secret: string;
  digits?: string | number;
  period?: string | number;
  algorithm?: string;
}): Account {
  const digits = Number(fields.digits || 6);
  const period = Number(fields.period || 30);
  validParams(digits, period);
  const issuer = (fields.issuer ?? "").trim();
  const account = (fields.account ?? "").trim();
  if (!issuer && !account) throw new Error("Give the account an issuer or a name");
  return {
    issuer,
    account,
    secret: normalizeSecret(fields.secret),
    digits,
    period,
    algorithm: algorithmOf(fields.algorithm),
  };
}

/** `otpauth://totp/GitHub:ada?secret=…&issuer=GitHub&digits=6&period=30&algorithm=SHA1`. */
export function parseOtpauth(uri: string): Account {
  const text = uri.trim();
  const m = text.match(/^otpauth:\/\/([a-z]+)\/([^?]*)(?:\?(.*))?$/i);
  if (!m) throw new Error("Not an otpauth:// link");
  const type = m[1].toLowerCase();
  if (type === "hotp") throw new Error("Counter-based (HOTP) codes aren't supported, only time-based (TOTP)");
  if (type !== "totp") throw new Error(`Unknown code type “${m[1]}”`);
  const params = new URLSearchParams(m[3] ?? "");
  let label = m[2];
  try {
    label = decodeURIComponent(label);
  } catch {
    // Keep it as it is.
  }
  const colon = label.indexOf(":");
  const prefix = colon >= 0 ? label.slice(0, colon).trim() : "";
  const account = (colon >= 0 ? label.slice(colon + 1) : label).trim();
  const secret = params.get("secret");
  if (!secret) throw new Error("The link has no secret");
  return accountFrom({
    issuer: params.get("issuer")?.trim() || prefix,
    account,
    secret,
    digits: params.get("digits") ?? undefined,
    period: params.get("period") ?? undefined,
    algorithm: params.get("algorithm") ?? undefined,
  });
}

export function buildOtpauth(a: Account): string {
  const label = a.issuer ? `${encodeURIComponent(a.issuer)}:${encodeURIComponent(a.account)}` : encodeURIComponent(
    a.account,
  );
  const params = new URLSearchParams({ secret: a.secret });
  if (a.issuer) params.set("issuer", a.issuer);
  params.set("algorithm", a.algorithm);
  params.set("digits", String(a.digits));
  params.set("period", String(a.period));
  return `otpauth://totp/${label}?${params}`;
}

// ---------------------------------------------------------------------------
// Google Authenticator export (otpauth-migration://offline?data=…, protobuf)

function readVarint(buf: Uint8Array, pos: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (pos < buf.length) {
    const b = buf[pos++];
    result += (b & 0x7f) * 2 ** shift;
    if (!(b & 0x80)) return [result, pos];
    shift += 7;
  }
  throw new Error("Truncated data");
}

/** Fields of a protobuf message: number → values (numbers for varints, bytes otherwise). */
function protoFields(buf: Uint8Array): Map<number, (number | Uint8Array)[]> {
  const fields = new Map<number, (number | Uint8Array)[]>();
  let pos = 0;
  while (pos < buf.length) {
    const [key, p] = readVarint(buf, pos);
    pos = p;
    const field = Math.floor(key / 8);
    const wire = key & 7;
    let value: number | Uint8Array;
    if (wire === 0) [value, pos] = readVarint(buf, pos);
    else if (wire === 2) {
      const [len, p2] = readVarint(buf, pos);
      value = buf.subarray(p2, p2 + len);
      pos = p2 + len;
    } else if (wire === 1) {
      value = buf.subarray(pos, pos + 8);
      pos += 8;
    } else if (wire === 5) {
      value = buf.subarray(pos, pos + 4);
      pos += 4;
    } else throw new Error("Unsupported data");
    fields.set(field, [...(fields.get(field) ?? []), value]);
  }
  return fields;
}

export interface ImportResult {
  accounts: Account[];
  /** Entries left out, with why. */
  skipped: string[];
}

/** Accounts of a Google Authenticator "Transfer accounts" QR code. */
export function parseMigration(uri: string): ImportResult {
  const m = uri.trim().match(/^otpauth-migration:\/\/offline\?(.*)$/i);
  if (!m) throw new Error("Not a Google Authenticator export");
  const data = new URLSearchParams(m[1]).get("data");
  if (!data) throw new Error("The export has no data");
  const raw = Uint8Array.from(atob(data.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const dec = new TextDecoder();
  const result: ImportResult = { accounts: [], skipped: [] };
  for (const param of protoFields(raw).get(1) ?? []) {
    if (!(param instanceof Uint8Array)) continue;
    const f = protoFields(param);
    const str = (n: number) => {
      const v = f.get(n)?.[0];
      return v instanceof Uint8Array ? dec.decode(v) : "";
    };
    const num = (n: number) => {
      const v = f.get(n)?.[0];
      return typeof v === "number" ? v : 0;
    };
    const secret = f.get(1)?.[0];
    let name = str(2);
    let issuer = str(3);
    if (!issuer && name.includes(":")) {
      [issuer, name] = [name.slice(0, name.indexOf(":")), name.slice(name.indexOf(":") + 1)];
    } else if (issuer && name.startsWith(`${issuer}:`)) name = name.slice(issuer.length + 1);
    const label = issuer || name || "Unnamed";
    if (num(6) === 1) {
      result.skipped.push(`${label} (counter-based)`);
      continue;
    }
    const algo = ({ 0: "SHA1", 1: "SHA1", 2: "SHA256", 3: "SHA512" } as Record<number, Algorithm>)[num(4)];
    if (!algo || !(secret instanceof Uint8Array)) {
      result.skipped.push(`${label} (unsupported)`);
      continue;
    }
    result.accounts.push({
      issuer: issuer.trim(),
      account: name.trim(),
      secret: base32Encode(secret),
      digits: num(5) === 2 ? 8 : 6,
      period: 30,
      algorithm: algo,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Aegis and 2FAS exports (plain, unencrypted JSON), or a list of links

/** Reads an Aegis or 2FAS JSON export, or text with one otpauth:// link per line. */
export function parseExport(text: string): ImportResult {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("The file is empty");
  if (!trimmed.startsWith("{")) return parseLinks(trimmed);
  let data: any;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error("The file isn't valid JSON");
  }
  const result: ImportResult = { accounts: [], skipped: [] };
  const add = (label: string, build: () => Account) => {
    try {
      result.accounts.push(build());
    } catch (e) {
      result.skipped.push(`${label || "Unnamed"} (${(e as Error).message})`);
    }
  };
  if (data.db !== undefined && data.header !== undefined) {
    // Aegis
    if (typeof data.db === "string" || (data.header?.slots ?? null) !== null) {
      throw new Error("This Aegis export is encrypted: export it again without encryption");
    }
    for (const e of data.db?.entries ?? []) {
      const label = e.issuer || e.name;
      if (String(e.type).toLowerCase() !== "totp") {
        result.skipped.push(`${label || "Unnamed"} (${e.type})`);
        continue;
      }
      add(label, () =>
        accountFrom({
          issuer: e.issuer,
          account: e.name,
          secret: String(e.info?.secret ?? ""),
          digits: e.info?.digits,
          period: e.info?.period,
          algorithm: e.info?.algo,
        }));
    }
    return result;
  }
  if (Array.isArray(data.services)) {
    // 2FAS
    if (!data.services.length && data.servicesEncrypted) {
      throw new Error("This 2FAS backup is encrypted: export it again without a password");
    }
    const services = [...data.services].sort((a, b) => (a.order?.position ?? 0) - (b.order?.position ?? 0));
    for (const s of services) {
      const otp = s.otp ?? {};
      const label = otp.issuer || s.name;
      const type = String(otp.tokenType ?? "TOTP").toUpperCase();
      if (type !== "TOTP") {
        result.skipped.push(`${label || "Unnamed"} (${type})`);
        continue;
      }
      add(label, () =>
        accountFrom({
          issuer: otp.issuer || s.name,
          account: otp.account || otp.label || "",
          secret: String(s.secret ?? ""),
          digits: otp.digits,
          period: otp.period,
          algorithm: otp.algorithm,
        }));
    }
    return result;
  }
  throw new Error("Not an Aegis or 2FAS export");
}

/** otpauth:// and otpauth-migration:// links, one per line. */
export function parseLinks(text: string): ImportResult {
  const result: ImportResult = { accounts: [], skipped: [] };
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    try {
      if (/^otpauth-migration:/i.test(line)) {
        const r = parseMigration(line);
        result.accounts.push(...r.accounts);
        result.skipped.push(...r.skipped);
      } else result.accounts.push(parseOtpauth(line));
    } catch (e) {
      result.skipped.push(`${line.slice(0, 40)}${line.length > 40 ? "…" : ""} (${(e as Error).message})`);
    }
  }
  if (!result.accounts.length && !result.skipped.length) throw new Error("No otpauth:// link found");
  return result;
}

/** Same issuer, account and secret: importing twice doesn't duplicate. */
export const sameAccount = (a: Account, b: Account) =>
  a.secret === b.secret && a.issuer.toLowerCase() === b.issuer.toLowerCase() &&
  a.account.toLowerCase() === b.account.toLowerCase();

// ---------------------------------------------------------------------------
// Display

export function displayName(a: { issuer: string; account: string }): { title: string; subtitle?: string } {
  if (a.issuer) return { title: a.issuer, subtitle: a.account || undefined };
  return { title: a.account };
}

const TINTS = ["blue", "green", "purple", "orange", "teal", "pink", "red", "yellow"] as const;

/** A stable color per issuer. */
export function tintFor(name: string): (typeof TINTS)[number] {
  let h = 0;
  for (const c of name.toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function sortAccounts<T extends { issuer: string; account: string }>(list: T[]): T[] {
  const key = (a: T) => `${(a.issuer || a.account).toLowerCase()}\u0000${a.account.toLowerCase()}`;
  return [...list].sort((a, b) => key(a).localeCompare(key(b)));
}

// ---------------------------------------------------------------------------
// Vault: secrets encrypted with a passphrase, when there is no keyring

export interface Sealed {
  iv: string;
  data: string;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

export const newSalt = () => b64(crypto.getRandomValues(new Uint8Array(16)));

export const PBKDF2_ITERATIONS = 210_000;

/** AES-256-GCM key from the passphrase (PBKDF2-SHA256). */
export async function vaultKey(passphrase: string, salt: string, iterations = PBKDF2_ITERATIONS): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, [
    "deriveKey",
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: unb64(salt), iterations, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function seal(key: CryptoKey, text: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(text)),
  );
  return { iv: b64(iv), data: b64(data) };
}

/** Throws when the key is wrong or the data was changed. */
export async function unseal(key: CryptoKey, sealed: Sealed): Promise<string> {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(sealed.iv) }, key, unb64(sealed.data));
  return new TextDecoder().decode(plain);
}

/** Encrypted with each vault: tells a wrong passphrase apart. */
export const VAULT_CHECK = "backslash-authenticator";

// ---------------------------------------------------------------------------
// Session, background scan

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";
export interface Session {
  wayland: boolean;
  desktop: Desktop;
}
export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "DBUS_SESSION_BUS_ADDRESS",
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const current = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || current.includes("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || current.includes("sway")
    ? "sway"
    : current.some((d) => d === "gnome" || d === "ubuntu" || d === "unity" || d === "pop")
    ? "gnome"
    : current.includes("kde")
    ? "kde"
    : "other";
  return { wayland, desktop };
}

export type ShotTool = "grim" | "gnome-screenshot" | "spectacle" | "maim" | "scrot" | "import";

/** Tools that can capture an area in this session, best first. */
export function areaTools(s: Session): ShotTool[] {
  if (s.wayland) {
    if (s.desktop === "gnome") return ["gnome-screenshot"];
    if (s.desktop === "kde") return ["spectacle"];
    return ["grim", "gnome-screenshot", "spectacle"];
  }
  return ["maim", "scrot", "import", "gnome-screenshot", "spectacle"];
}

export function capturePackages(s: Session): string[] {
  if (s.wayland) {
    if (s.desktop === "gnome") return ["gnome-screenshot"];
    if (s.desktop === "kde") return ["spectacle"];
    return ["grim", "slurp"];
  }
  return ["maim"];
}

/** Single-quotes for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function areaCommand(tool: ShotTool, file: string): string {
  const f = q(file);
  switch (tool) {
    case "grim":
      return `geometry=$(slurp -d) || exit 0; grim -g "$geometry" ${f}`;
    case "gnome-screenshot":
      return `gnome-screenshot -a -f ${f}`;
    case "spectacle":
      return `spectacle -b -n -r -o ${f}`;
    case "maim":
      return `maim -s ${f}`;
    case "scrot":
      return `scrot -s -o ${f}`;
    case "import":
      return `import ${f}`;
  }
}

/** The keyring attributes of a stored secret. */
export const KEYRING_APP = "backslash-authenticator";
export const secretAttrs = (id: string) => ["application", KEYRING_APP, "entry", id];
export const pendingAttrs = (id: string) => ["application", KEYRING_APP, "pending", id];

export interface ScanOptions {
  tool: ShotTool;
  /** ~/.cache/backslash/authenticator */
  cache: string;
  /** Put the scanned link in the keyring (else in a private file, mode 0600). */
  keyring: boolean;
}

/**
 * Background script: select an area, decode it, hand the link to the
 * extension. The picture is deleted right away; with a keyring, the link goes
 * into it and only a random id is written to disk.
 */
export function scanScript(o: ScanOptions): string {
  const shot = `${o.cache}/scan.png`;
  const scans = `${o.cache}/scans`;
  const store = o.keyring
    ? `printf %s "$out" | secret-tool store --label='Backslash Authenticator: scanned account' ${
      pendingAttrs('"$id"').map((a) => (a.startsWith('"') ? a : q(a))).join(" ")
    } && : > ${q(`${scans}/`)}"$id.pending"`
    : `printf '%s\\n' "$out" > ${q(`${scans}/`)}"$id.uri"`;
  return [
    "umask 077",
    "sleep 0.4",
    `mkdir -p ${q(scans)}`,
    `rm -f ${q(shot)}`,
    `${areaCommand(o.tool, shot)} || exit 0`,
    `[ -s ${q(shot)} ] || exit 0`,
    `out=$(zbarimg --raw -q ${q(shot)} 2>/dev/null)`,
    `rm -f ${q(shot)}`,
    `case "$out" in`,
    `  otpauth://*|otpauth-migration://*)`,
    `    id=$(date +%s%N)`,
    `    if ${store}; then`,
    `      notify-send -a Backslash -i security-high 'Two-factor account scanned' 'Open Authenticator to finish adding it' 2>/dev/null`,
    "    else",
    `      notify-send -a Backslash 'Could not save the scanned account' 'Is the keyring unlocked?' 2>/dev/null`,
    "    fi ;;",
    `  '') notify-send -a Backslash 'No QR code found' 'Select the whole code with a little margin around it' 2>/dev/null ;;`,
    `  *) notify-send -a Backslash 'Not a two-factor QR code' 'It holds no otpauth:// link' 2>/dev/null ;;`,
    "esac",
    "true",
  ].join("\n");
}

export function systemdRunArgs(unit: string, script: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: scan a two-factor QR code",
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  "secret-tool": { debian: "libsecret-tools", arch: "libsecret", fedora: "libsecret", suse: "libsecret-tools" },
  zbarimg: { debian: "zbar-tools", arch: "zbar", fedora: "zbar", suse: "zbar" },
  spectacle: { debian: "kde-spectacle" },
  import: { debian: "imagemagick", arch: "imagemagick", fedora: "ImageMagick", suse: "ImageMagick" },
};

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installCommand(programs: string[], family: Family): string {
  return `${MANAGERS[family]} ${[...new Set(programs.map((p) => PACKAGES[p]?.[family] ?? p))].join(" ")}`;
}

export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${
    families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installCommand(programs, f)}\``).join("\n\n")
  }`;
}
