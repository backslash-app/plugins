// /etc/hosts as lines: parsed, changed one line at a time, and written back byte for byte
// identical everywhere else.

export interface Blank {
  kind: "blank";
  raw: string;
}

export interface Comment {
  kind: "comment";
  raw: string;
  /** Without the `#`. */
  text: string;
}

export interface Entry {
  kind: "entry";
  raw: string;
  /** False for an entry commented out with `#`. */
  enabled: boolean;
  ip: string;
  hosts: string[];
  /** Text after a `#` at the end of the line. */
  comment?: string;
}

/** A line that is neither: kept as it is. */
export interface Invalid {
  kind: "invalid";
  raw: string;
  reason: string;
}

export type Line = Blank | Comment | Entry | Invalid;

export interface HostsFile {
  lines: Line[];
  /** `\r\n` when most lines end so; new lines follow. */
  eol: "\n" | "\r\n";
}

export const HOSTS_PATH = "/etc/hosts";
export const BACKUP_PATH = "/etc/hosts.backslash.bak";

// ---------------------------------------------------------------------------
// Validation

export function isIPv4(s: string): boolean {
  const parts = s.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255 && !/^0\d/.test(p));
}

export function isIPv6(s: string): boolean {
  const [addr, zone] = s.split("%");
  if (zone !== undefined && !/^[\w.-]+$/.test(zone)) return false;
  if (!/^[0-9a-fA-F:.]+$/.test(addr) || !addr.includes(":")) return false;
  const halves = addr.split("::");
  if (halves.length > 2) return false;
  const groups = (h: string) => (h ? h.split(":") : []);
  const all = [...groups(halves[0]), ...(halves.length === 2 ? groups(halves[1]) : [])];
  let count = all.length;
  const last = all.at(-1);
  if (last && last.includes(".")) {
    if (!isIPv4(last)) return false;
    count++;
    all.pop();
  }
  if (!all.every((g) => /^[0-9a-fA-F]{1,4}$/.test(g))) return false;
  return halves.length === 2 ? count < 8 : count === 8;
}

export const isIP = (s: string) => isIPv4(s) || isIPv6(s);

/** RFC 1123 host names; underscores are tolerated, as resolvers do. */
export function isHostname(s: string): boolean {
  if (!s || s.length > 253) return false;
  const name = s.endsWith(".") ? s.slice(0, -1) : s;
  return name.split(".").every((l) => /^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(l)) &&
    !/^\d+$/.test(name.split(".").at(-1) ?? "");
}

/** Host names typed by a user: separated by spaces or commas, URLs reduced to their host. */
export function splitHostnames(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    if (!raw) continue;
    let h = raw.trim();
    const url = /^[a-z][a-z0-9+.-]*:\/\/([^/:?#]+)/i.exec(h);
    if (url) h = url[1];
    h = h.replace(/\/.*$/, "").toLowerCase();
    if (h && !out.includes(h)) out.push(h);
  }
  return out;
}

/** Why an entry can't be written, or undefined. */
export function entryProblem(ip: string, hosts: string[]): string | undefined {
  if (!isIP(ip)) return `“${ip}” is not an IP address (e.g. 127.0.0.1, 192.168.1.10 or ::1)`;
  if (!hosts.length) return "Give at least one host name";
  const bad = hosts.find((h) => !isHostname(h));
  if (bad) return `“${bad}” is not a valid host name`;
  return undefined;
}

// ---------------------------------------------------------------------------
// Parsing

function parseEntry(body: string): { ip: string; hosts: string[]; comment?: string } | undefined {
  const hash = body.indexOf("#");
  const main = hash >= 0 ? body.slice(0, hash) : body;
  const comment = hash >= 0 ? body.slice(hash + 1).trim() || undefined : undefined;
  const words = main.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || !isIP(words[0])) return undefined;
  return { ip: words[0], hosts: words.slice(1), comment };
}

export function parseLine(raw: string): Line {
  const text = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
  if (!text.trim()) return { kind: "blank", raw };
  const commented = /^\s*#+\s?(.*)$/.exec(text);
  if (commented) {
    // "# 127.0.0.1 example.test" is an entry turned off; "# The following lines…" is a comment.
    const e = parseEntry(commented[1]);
    if (e && e.hosts.every(isHostname)) return { kind: "entry", raw, enabled: false, ...e };
    return { kind: "comment", raw, text: commented[1].trim() };
  }
  const e = parseEntry(text);
  if (e) return { kind: "entry", raw, enabled: true, ...e };
  const first = text.trim().split(/\s+/)[0];
  return {
    kind: "invalid",
    raw,
    reason: isIP(first) ? "An address without a host name" : `“${first}” is not an IP address`,
  };
}

export function parseHosts(text: string): HostsFile {
  const raws = text.split("\n");
  const crlf = raws.filter((r) => r.endsWith("\r")).length;
  return { lines: raws.map(parseLine), eol: crlf > raws.length / 2 ? "\r\n" : "\n" };
}

/** The exact text: unchanged lines are written as they were read. */
export const serialize = (file: HostsFile) => file.lines.map((l) => l.raw).join("\n");

// ---------------------------------------------------------------------------
// Entries

export interface Indexed {
  /** Position of the line in the file. */
  index: number;
  entry: Entry;
  /** The comment line above a group of entries, used as its section. */
  section?: string;
}

/** The entries in file order, each with the comment heading its group. */
export function entries(file: HostsFile): Indexed[] {
  const out: Indexed[] = [];
  let heading: string | undefined;
  file.lines.forEach((line, index) => {
    if (line.kind === "comment") {
      if (line.text && !/^[#=*\s-]+$/.test(line.text)) heading = line.text;
    } else if (line.kind === "entry") {
      out.push({ index, entry: line, section: heading });
    }
  });
  return out;
}

/** Entries the system needs: localhost, the machine's own name (127.0.1.1), IPv6 multicast names. */
export function isProtected(e: Entry): boolean {
  return e.hosts.some((h) => /^(localhost|localhost\.localdomain|localhost4|localhost6|ip6-[\w-]+)$/i.test(h)) ||
    e.ip === "127.0.1.1";
}

export const isBlock = (e: Entry) => /^(0\.0\.0\.0|::|0:0:0:0:0:0:0:0)$/.test(e.ip);

export function addressKind(ip: string): "Blocked" | "Loopback" | "Local network" | "IPv6 local" | "Internet" {
  if (/^(0\.0\.0\.0|::)$/.test(ip)) return "Blocked";
  if (/^127\./.test(ip) || ip === "::1") return "Loopback";
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip)) {
    return "Local network";
  }
  if (/^(fe80|fc|fd|ff0)/i.test(ip)) return "IPv6 local";
  return "Internet";
}

/** One entry line: `192.168.1.10\tnas nas.lan\t# Synology`. */
export function formatEntry(ip: string, hosts: string[], comment?: string): string {
  return `${ip}\t${hosts.join(" ")}${comment?.trim() ? `\t# ${comment.trim()}` : ""}`;
}

const withEol = (file: HostsFile, raw: string) => (file.eol === "\r\n" ? `${raw}\r` : raw);

function lineAt(file: HostsFile, index: number, expected: string): Entry {
  const line = file.lines[index];
  if (!line || line.raw !== expected || line.kind !== "entry") {
    throw new Error("The hosts file changed since it was opened: look at it again");
  }
  return line;
}

const replaceLine = (file: HostsFile, index: number, raw: string): HostsFile => ({
  ...file,
  lines: file.lines.map((l, i) => (i === index ? parseLine(raw) : l)),
});

/** Comments an entry out, or back in, keeping the rest of the line. */
export function setEnabled(file: HostsFile, index: number, expected: string, enabled: boolean): HostsFile {
  const e = lineAt(file, index, expected);
  if (e.enabled === enabled) return file;
  const raw = enabled ? e.raw.replace(/^(\s*)#+ ?/, "$1") : `# ${e.raw}`;
  return replaceLine(file, index, raw);
}

export function removeLine(file: HostsFile, index: number, expected: string): HostsFile {
  lineAt(file, index, expected);
  return { ...file, lines: file.lines.filter((_, i) => i !== index) };
}

/** Replaces an entry's address, names and comment; a disabled one stays disabled. */
export function editEntry(
  file: HostsFile,
  index: number,
  expected: string,
  ip: string,
  hosts: string[],
  comment?: string,
): HostsFile {
  const e = lineAt(file, index, expected);
  const problem = entryProblem(ip, hosts);
  if (problem) throw new Error(problem);
  const text = formatEntry(ip, hosts, comment);
  return replaceLine(file, index, withEol(file, e.enabled ? text : `# ${text}`));
}

/** Appends an entry at the end, before the final newline. */
export function addEntry(file: HostsFile, ip: string, hosts: string[], comment?: string): HostsFile {
  const problem = entryProblem(ip, hosts);
  if (problem) throw new Error(problem);
  const lines = [...file.lines];
  const endsWithNewline = lines.length > 0 && lines.at(-1)!.raw === "";
  const at = endsWithNewline ? lines.length - 1 : lines.length;
  const added = parseLine(withEol(file, formatEntry(ip, hosts, comment)));
  if (!endsWithNewline && lines.length) {
    // The last line had no newline: give it one; the file now ends with a newline.
    const last = lines.at(-1)!;
    lines[lines.length - 1] = parseLine(withEol(file, last.raw));
  }
  lines.splice(at, 0, added);
  if (!lines.length || lines.at(-1)!.raw !== "") lines.push({ kind: "blank", raw: "" });
  return { ...file, lines };
}

/** Enabled entries naming this host: what it resolves to now. */
export function findHost(file: HostsFile, host: string): Indexed[] {
  const h = host.toLowerCase();
  return entries(file).filter((x) => x.entry.enabled && x.entry.hosts.some((n) => n.toLowerCase() === h));
}

/** The names to block for a domain: itself, and www. if asked (not for a www. name already). */
export function blockNames(domain: string, www: boolean): string[] {
  const [d] = splitHostnames(domain);
  if (!d) return [];
  return www && !d.startsWith("www.") ? [d, `www.${d}`] : [d];
}

// ---------------------------------------------------------------------------
// Before writing

/**
 * Why the new content must not be written, or undefined: it must parse back to the
 * same lines, keep localhost, and not shrink to nothing.
 */
export function checkBeforeWrite(before: string, after: string): string | undefined {
  if (after.includes("\0")) return "The new hosts file contains a NUL character";
  if (after.length > 50 * 1024 * 1024) return "The new hosts file is over 50 MB";
  if (serialize(parseHosts(after)) !== after) return "The new hosts file doesn't read back the same";
  const hasLocalhost = (text: string) =>
    entries(parseHosts(text)).some((x) => x.entry.enabled && x.entry.hosts.includes("localhost"));
  if (hasLocalhost(before) && !hasLocalhost(after)) return "The change would remove localhost from the hosts file";
  if (before.trim() && !after.trim()) return "The change would empty the hosts file";
  return undefined;
}

/** What pkexec runs, as root: back up the file, then write stdin over it in place (keeping its inode and rights). */
export const WRITE_SCRIPT = `cp -p ${HOSTS_PATH} ${BACKUP_PATH} && tee ${HOSTS_PATH} > /dev/null`;

/** What pkexec runs to bring the backup back. */
export const RESTORE_SCRIPT = `test -s ${BACKUP_PATH} && tee ${HOSTS_PATH} < ${BACKUP_PATH} > /dev/null`;

export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized to change the hosts file";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
