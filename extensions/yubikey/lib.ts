// Parsing ykman and gpg output, otpauth:// links, and the ykman command lines.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Devices

export interface Key {
  name: string;
  firmware?: string;
  interfaces: string[];
  serial?: string;
}

/** `ykman list`: "YubiKey 5 NFC (5.4.3) [OTP+FIDO+CCID] Serial: 12345678". */
export function parseList(text: string): Key[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).flatMap((line): Key[] => {
    const m = line.match(/^(.+?)\s+\(([\d.]+)\)\s+\[([^\]]*)\](?:\s+Serial:\s*(\d+))?/);
    if (!m) {
      return line.startsWith("YubiKey") || line.startsWith("Security Key") ? [{ name: line, interfaces: [] }] : [];
    }
    return [{ name: m[1], firmware: m[2], interfaces: m[3].split("+").filter(Boolean), serial: m[4] }];
  });
}

export interface Info {
  fields: [string, string][];
  /** Application → enabled over USB and NFC. */
  applications: { name: string; usb: string; nfc?: string }[];
  notes: string[];
}

/** `ykman info`: "Key: value" lines, then the applications table (tab- or space-aligned). */
export function parseInfo(text: string): Info {
  const info: Info = { fields: [], applications: [], notes: [] };
  let table = false;
  for (const raw of text.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    if (/^Applications\b/.test(line)) {
      table = true;
      continue;
    }
    if (table) {
      const cells = line.split(/\t+|\s{2,}/).map((c) => c.trim()).filter(Boolean);
      if (cells.length >= 2) info.applications.push({ name: cells[0], usb: cells[1], nfc: cells[2] });
      continue;
    }
    const m = line.match(/^([^:]+):\s*(.*)$/);
    if (m) info.fields.push([m[1].trim(), m[2].trim()]);
    else info.notes.push(line.trim());
  }
  return info;
}

export const field = (fields: [string, string][], name: string) =>
  fields.find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];

// ---------------------------------------------------------------------------
// OATH

export interface Account {
  /** As ykman names it: "GitHub:ada" (issuer:name). */
  id: string;
  issuer?: string;
  name: string;
  code?: string;
  touch: boolean;
  hotp: boolean;
}

/** "GitHub:ada" → issuer and name; a period prefix ("60/Steam:ada") is kept out of both. */
export function splitId(id: string): { issuer?: string; name: string } {
  const plain = id.replace(/^\d+\//, "");
  const colon = plain.indexOf(":");
  return colon > 0 ? { issuer: plain.slice(0, colon), name: plain.slice(colon + 1) } : { name: plain };
}

/** `ykman oath accounts code`: "GitHub:ada  123456", "[Requires Touch]" or "[HOTP Account]". */
export function parseCodes(text: string): Account[] {
  return text.split("\n").filter((l) => l.trim()).flatMap((line) => {
    const m = line.match(
      /^(.*?)\s+(\d{4,10}|\[Requires Touch\]|\[HOTP Account\]|\[Steam\]|[2-9B-DF-HJ-NP-TV-Y]{5})\s*$/,
    );
    if (!m) return [];
    const id = m[1].trim();
    const value = m[2];
    return [{
      id,
      ...splitId(id),
      code: value.startsWith("[") ? undefined : value,
      touch: value === "[Requires Touch]",
      hotp: value === "[HOTP Account]",
    }];
  });
}

/** `ykman oath accounts code -s`: the code only. */
export function parseSingleCode(text: string): string | undefined {
  return text.split("\n").map((l) => l.trim()).filter(Boolean).pop()?.match(/^([0-9A-Z]{4,10})$/)?.[1];
}

/** "123456" → "123 456", easier to read. */
export function groupCode(code: string): string {
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  if (code.length === 8) return `${code.slice(0, 4)} ${code.slice(4)}`;
  return code;
}

/** Seconds left in the 30-second window ykman computed codes for. */
export const secondsLeft = (now = Date.now(), period = 30) => period - Math.floor(now / 1000) % period;

export interface OtpAuth {
  type: "totp" | "hotp";
  issuer?: string;
  name: string;
  secret: string;
  digits: number;
  period: number;
  algorithm: string;
}

const BASE32 = /^[A-Z2-7]+=*$/;

/** An otpauth:// link, as QR codes carry it. Throws with what's wrong. */
export function parseOtpauth(uri: string): OtpAuth {
  let url: URL;
  try {
    url = new URL(uri.trim());
  } catch {
    throw new Error("Not a link: copy the otpauth:// link of the account");
  }
  if (url.protocol !== "otpauth:") throw new Error("Not an otpauth:// link");
  // otpauth://totp/Label: hostname is the type, pathname the label.
  const type = (url.hostname || url.pathname.replace(/^\/\//, "").split("/")[0]).toLowerCase();
  if (type !== "totp" && type !== "hotp") throw new Error(`Unsupported type “${type}”: only TOTP and HOTP`);
  const label = decodeURIComponent(
    (url.hostname ? url.pathname : url.pathname.replace(/^\/\/[^/]+/, "")).replace(/^\//, ""),
  );
  const colon = label.indexOf(":");
  const issuer = url.searchParams.get("issuer") ?? (colon > 0 ? label.slice(0, colon) : undefined);
  const name = (colon > 0 ? label.slice(colon + 1) : label).trim();
  const secret = (url.searchParams.get("secret") ?? "").replace(/\s+/g, "").toUpperCase();
  if (!secret) throw new Error("The link has no secret");
  if (!BASE32.test(secret)) throw new Error("The secret isn't valid base32");
  return {
    type,
    issuer: issuer?.trim() || undefined,
    name: name || issuer || "Account",
    secret,
    digits: Number(url.searchParams.get("digits") ?? 6),
    period: Number(url.searchParams.get("period") ?? 30),
    algorithm: (url.searchParams.get("algorithm") ?? "SHA1").toUpperCase(),
  };
}

/** A base32 secret typed by hand: spaces and dashes removed, upper-cased. */
export function cleanSecret(secret: string): string {
  const s = secret.replace(/[\s-]+/g, "").toUpperCase();
  if (!s || !BASE32.test(s)) throw new Error("The secret key must be base32 (letters A–Z and digits 2–7)");
  return s;
}

/** ykman's global options for one key. */
export const device = (serial?: string) => (serial ? ["--device", serial] : []);

const password = (pw?: string) => (pw ? ["-p", pw] : []);

export const oath = {
  codes: (serial?: string, pw?: string) => [...device(serial), "oath", "accounts", "code", ...password(pw)],
  code: (serial: string | undefined, id: string, pw?: string) => [
    ...device(serial),
    "oath",
    "accounts",
    "code",
    "-s",
    ...password(pw),
    id,
  ],
  uri: (serial: string | undefined, uri: string, touch: boolean, pw?: string) => [
    ...device(serial),
    "oath",
    "accounts",
    "uri",
    ...(touch ? ["-t"] : []),
    "-f",
    ...password(pw),
    uri,
  ],
  add: (serial: string | undefined, a: OtpAuth, touch: boolean, pw?: string) => [
    ...device(serial),
    "oath",
    "accounts",
    "add",
    "-o",
    a.type.toUpperCase(),
    "-d",
    String(a.digits),
    "-a",
    a.algorithm,
    ...(a.type === "totp" ? ["-P", String(a.period)] : []),
    ...(a.issuer ? ["-i", a.issuer] : []),
    ...(touch ? ["-t"] : []),
    "-f",
    ...password(pw),
    a.name,
    a.secret,
  ],
  rename: (serial: string | undefined, id: string, to: string, pw?: string) => [
    ...device(serial),
    "oath",
    "accounts",
    "rename",
    "-f",
    ...password(pw),
    id,
    to,
  ],
  delete: (serial: string | undefined, id: string, pw?: string) => [
    ...device(serial),
    "oath",
    "accounts",
    "delete",
    "-f",
    ...password(pw),
    id,
  ],
};

// ---------------------------------------------------------------------------
// PIV, FIDO2, OpenPGP

export interface Section {
  title: string;
  fields: [string, string][];
}

export interface Report {
  fields: [string, string][];
  warnings: string[];
  sections: Section[];
}

/**
 * The "Key: value" reports of `ykman piv info`, `ykman fido info` and `ykman openpgp info`.
 * Indented lines under a "Heading:" line belong to it (PIV slots, OpenPGP touch policies).
 */
export function parseReport(text: string): Report {
  const report: Report = { fields: [], warnings: [], sections: [] };
  let section: Section | undefined;
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const line = raw.trim();
    if (/^WARNING:/i.test(line)) {
      report.warnings.push(line.replace(/^WARNING:\s*/i, ""));
      continue;
    }
    const m = line.match(/^([^:]+?):\s*(.*)$/);
    if (!m) continue;
    if (indented && section) {
      section.fields.push([m[1], m[2]]);
    } else if (!m[2]) {
      section = { title: m[1], fields: [] };
      report.sections.push(section);
    } else {
      section = undefined;
      report.fields.push([m[1], m[2]]);
    }
  }
  return report;
}

/** "Slot 9A (AUTHENTICATION)" → "9A · Authentication". */
export function slotTitle(title: string): string {
  const m = title.match(/^Slot\s+(\w+)\s*\(([^)]+)\)/i);
  if (!m) return title;
  const name = m[2].toLowerCase().replace(/_/g, " ");
  return `${m[1].toUpperCase()} · ${name[0].toUpperCase()}${name.slice(1)}`;
}

/** "3/3" or "8 attempt(s) remaining" → the number left. */
export function triesLeft(value?: string): number | undefined {
  const m = value?.match(/(\d+)(?:\/\d+| attempts?| attempt\(s\))?/);
  return m ? Number(m[1]) : undefined;
}

/** `gpg --card-status`: "Name of cardholder: Ada" and "Signature key ....: ABCD …" lines. */
export function parseCardStatus(text: string): [string, string][] {
  const out: [string, string][] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^([A-Za-z][^.:]*?)\s*\.*:\s*(.*)$/);
    if (m && m[1] !== "sec" && m[1] !== "ssb") out.push([m[1].trim(), m[2].trim()]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Errors

/** ykman's messages as a sentence, with what to do. */
export function explainYkman(text: string): string {
  if (/No YubiKey detected|no device found|No YubiKey found/i.test(text)) return "No YubiKey plugged in";
  if (/Multiple YubiKeys/i.test(text)) return "Several YubiKeys are plugged in: unplug the others";
  if (/Failed connecting to|Failed to open device|PCSC|pcscd|Smart ?card/i.test(text)) {
    return "Couldn't talk to the YubiKey's smart card: start pcscd (sudo systemctl enable --now pcscd), " +
      "and if gpg is using the key, release it (gpgconf --kill scdaemon)";
  }
  if (/Wrong password|Authentication to the YubiKey failed|password.* incorrect/i.test(text)) {
    return "Wrong OATH password: check it in Settings → Extensions → YubiKey";
  }
  if (/Aborted!|password required|requires a password|Enter the password/i.test(text)) {
    return "These OATH accounts are protected by a password: set it in Settings → Extensions → YubiKey";
  }
  if (/Touch account timed out|timed out|No touch/i.test(text)) return "The YubiKey wasn't touched in time";
  if (/already exists/i.test(text)) return "An account with this name already exists";
  if (/No matching account|No matches/i.test(text)) return "No such account on the YubiKey";
  if (/not supported|not enabled|Application not available/i.test(text)) {
    return "This application isn't available on this YubiKey (or is disabled)";
  }
  return text.split("\n").map((l) => l.replace(/^Error:\s*/, "").trim()).filter(Boolean).pop() ?? "ykman failed";
}

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const get = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${get("ID")} ${get("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

/** yubikey-manager and the smart card daemon it needs for OATH, PIV and OpenPGP. */
export function installCommand(family?: Family): string {
  const pkg = {
    debian: "sudo apt install yubikey-manager pcscd",
    fedora: "sudo dnf install yubikey-manager pcsc-lite",
    arch: "sudo pacman -S yubikey-manager pcsclite",
    suse: "sudo zypper install yubikey-manager pcsc-lite",
  }[family ?? "debian"];
  return `${pkg} && sudo systemctl enable --now pcscd.socket`;
}
