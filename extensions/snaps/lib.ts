// Parsing what the snap command prints. Pure, tested in lib_test.ts.

export interface Revision {
  name: string;
  version: string;
  rev: string;
  /** `latest/stable`, or "" for snaps installed from a file. */
  tracking: string;
  publisher: string;
  /** ✓ verified account, ✪ starred developer. */
  verified: "verified" | "starred" | undefined;
  notes: string[];
  disabled: boolean;
}

export type Kind = "app" | "base" | "snapd" | "kernel" | "gadget";

export interface Snap {
  name: string;
  current: Revision;
  /** Older revisions kept for reverting, newest first. */
  old: Revision[];
  kind: Kind;
}

const dash = (s: string | undefined) => (!s || s === "-" ? "" : s);

/** "mozilla✓" → ["mozilla", "verified"], "kde✪" → ["kde", "starred"]. Some terminals get "mozilla**". */
export function parsePublisher(text: string): [string, Revision["verified"]] {
  const t = dash(text);
  if (/(✓|\*\*)$/.test(t)) return [t.replace(/(✓|\*\*)$/, ""), "verified"];
  if (/(✪|\*)$/.test(t)) return [t.replace(/(✪|\*)$/, ""), "starred"];
  return [t, undefined];
}

/** Splits a column table on runs of spaces, the header naming the columns. */
function table(text: string): Record<string, string>[] {
  const lines = text.split("\n").filter((l) => l.trim());
  if (lines.length < 1) return [];
  const header = lines[0].trim().split(/\s+/).map((h) => h.toLowerCase());
  return lines.slice(1).map((line) => {
    const cells = line.trim().split(/\s+/);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      // The last column takes what is left.
      row[h] = i === header.length - 1 ? cells.slice(i).join(" ") : cells[i] ?? "";
    });
    return row;
  });
}

/** `snap list --all`: `Name Version Rev Tracking Publisher Notes`. */
export function parseList(text: string): Revision[] {
  if (!/^Name\s+Version\s+Rev/m.test(text)) return [];
  return table(text).filter((r) => r.name && r.rev).map((r) => {
    const [publisher, verified] = parsePublisher(r.publisher);
    const notes = dash(r.notes).split(",").map((n) => n.trim()).filter(Boolean);
    return {
      name: r.name,
      version: dash(r.version),
      rev: r.rev,
      tracking: dash(r.tracking),
      publisher,
      verified,
      notes,
      disabled: notes.includes("disabled"),
    };
  });
}

const KINDS: Kind[] = ["base", "snapd", "kernel", "gadget"];

export function kindOf(r: Revision): Kind {
  if (r.notes.includes("core")) return "base"; // the old `core` snap
  return KINDS.find((k) => r.notes.includes(k)) ?? "app";
}

/** One snap per name: the active revision, and the disabled ones kept for reverting. */
export function groupSnaps(revisions: Revision[]): Snap[] {
  const by = new Map<string, Revision[]>();
  for (const r of revisions) by.set(r.name, [...(by.get(r.name) ?? []), r]);
  const out: Snap[] = [];
  for (const [name, revs] of by) {
    const sorted = [...revs].sort((a, b) => revNumber(b.rev) - revNumber(a.rev));
    const current = sorted.find((r) => !r.disabled) ?? sorted[0];
    out.push({ name, current, old: sorted.filter((r) => r !== current), kind: kindOf(current) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Revisions are numbers; `x1`, `x2` are local installs (`--dangerous`), ranked after store ones. */
export const revNumber = (rev: string) => (/^x\d+$/.test(rev) ? 1e9 + Number(rev.slice(1)) : Number(rev) || 0);

export const isLocal = (r: Revision) => /^x\d+$/.test(r.rev);

// ---------------------------------------------------------------------------
// snap info

export interface Channel {
  name: string;
  version: string;
  date?: string;
  rev?: string;
  size?: number;
}

export interface Info {
  name: string;
  summary?: string;
  description?: string;
  publisher?: string;
  storeUrl?: string;
  contact?: string;
  license?: string;
  commands: string[];
  services: string[];
  tracking?: string;
  refreshDate?: string;
  hold?: string;
  installedSize?: number;
  channels: Channel[];
}

/** "286MB", "1kB", "1.2GB" (snapd's decimal units) → bytes. */
export function parseSize(text: string | undefined): number | undefined {
  const m = text?.trim().match(/^([\d.]+)\s*([kMGT]?)B$/i);
  if (!m) return undefined;
  const pow = m[2] ? "kmgt".indexOf(m[2].toLowerCase()) + 1 : 0;
  return Math.round(parseFloat(m[1]) * 1000 ** pow);
}

/** `latest/stable:    131.0.3-1  2024-10-15 (5134) 286MB -`, or `latest/beta: ↑` / `--`. */
function parseChannel(name: string, rest: string): Channel | undefined {
  const t = rest.trim();
  if (!t || t === "↑" || t === "^" || t === "--") return undefined;
  const m = t.match(/^(\S+)\s+(?:(\d{4}-\d{2}-\d{2})\s+)?\((\w+)\)\s+(\S+)/);
  if (!m) return { name, version: t.split(/\s+/)[0] };
  return { name, version: m[1], date: m[2], rev: m[3], size: parseSize(m[4]) };
}

/** `snap info a b c`: one block per snap, separated by `---`. */
export function parseInfo(text: string): Info[] {
  return text.split(/^---\s*$/m).map(parseInfoBlock).filter((i): i is Info => !!i);
}

function parseInfoBlock(block: string): Info | undefined {
  const info: Info = { name: "", commands: [], services: [], channels: [] };
  let list: "description" | "commands" | "services" | "channels" | undefined;
  const description: string[] = [];
  for (const line of block.split("\n")) {
    if (!line.trim()) {
      if (list === "description") description.push("");
      continue;
    }
    const indented = /^\s/.test(line);
    if (indented && list) {
      const t = line.trim();
      if (list === "description") description.push(t);
      else if (list === "commands") info.commands.push(t.replace(/^-\s*/, ""));
      else if (list === "services") info.services.push(t.replace(/^([^:]+):.*$/, "$1").replace(/^-\s*/, ""));
      else if (list === "channels") {
        const m = t.match(/^([^:\s]+):\s*(.*)$/);
        const c = m ? parseChannel(m[1], m[2]) : undefined;
        if (c) info.channels.push(c);
      }
      continue;
    }
    list = undefined;
    const m = line.match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    switch (key) {
      case "name":
        info.name = value.trim();
        break;
      case "summary":
        info.summary = unquote(value);
        break;
      case "publisher":
        info.publisher = parsePublisher(value.trim())[0];
        break;
      case "store-url":
        info.storeUrl = value.trim();
        break;
      case "contact":
        info.contact = value.trim() || undefined;
        break;
      case "license":
        info.license = value.trim() === "unset" ? undefined : value.trim();
        break;
      case "description":
        list = "description";
        if (value.trim() && value.trim() !== "|") description.push(unquote(value));
        break;
      case "commands":
      case "services":
      case "channels":
        list = key;
        break;
      case "tracking":
        info.tracking = value.trim();
        break;
      case "refresh-date":
        info.refreshDate = value.trim();
        break;
      case "hold":
        info.hold = value.trim();
        break;
      case "installed": {
        const s = value.trim().match(/\(\w+\)\s+(\S+)/);
        info.installedSize = parseSize(s?.[1]);
        break;
      }
    }
  }
  info.description = description.join("\n").trim() || undefined;
  return info.name ? info : undefined;
}

const unquote = (s: string) => s.trim().replace(/^'(.*)'$/, "$1").replace(/^"(.*)"$/, "$1");

/** `refresh-date: today at 10:21 CEST, held` → whether snapd won't update it on its own. */
export const isHeld = (info: Info | undefined, rev: Revision) =>
  rev.notes.includes("held") || !!info?.hold || /\bheld\b/.test(info?.refreshDate ?? "");

// ---------------------------------------------------------------------------
// Updates and connections

export interface Update {
  name: string;
  version: string;
  rev: string;
  size?: number;
}

/** `snap refresh --list`: a table, or "All snaps up to date." */
export function parseRefreshList(text: string): Update[] {
  if (!/^Name\s+Version\s+Rev/m.test(text)) return [];
  return table(text).filter((r) => r.name && r.rev).map((r) => ({
    name: r.name,
    version: dash(r.version),
    rev: r.rev,
    size: parseSize(r.size),
  }));
}

export interface Connection {
  interface: string;
  plug: string;
  slot: string;
  notes: string[];
  connected: boolean;
}

/** `snap connections <snap>`: `Interface Plug Slot Notes`, `-` for what is not connected. */
export function parseConnections(text: string): Connection[] {
  if (!/^Interface\s+Plug\s+Slot/m.test(text)) return [];
  return table(text).filter((r) => r.interface).map((r) => ({
    interface: r.interface,
    plug: dash(r.plug),
    slot: dash(r.slot),
    notes: dash(r.notes).split(",").filter(Boolean),
    connected: dash(r.plug) !== "" && dash(r.slot) !== "",
  }));
}

/** "audio-playback" → "Audio playback", "content[gnome-42-2204]" → "Content: gnome-42-2204". */
export function interfaceTitle(name: string): string {
  const m = name.match(/^([\w-]+)\[(.+)\]$/);
  const base = (m ? m[1] : name).replace(/-/g, " ");
  const title = base.charAt(0).toUpperCase() + base.slice(1);
  return m ? `${title}: ${m[2]}` : title;
}

/** Interfaces that reach far outside the sandbox. */
const SENSITIVE = new Set([
  "home",
  "removable-media",
  "camera",
  "audio-record",
  "personal-files",
  "system-files",
  "ssh-keys",
  "ssh-public-keys",
  "password-manager-service",
  "screen-inhibit-control",
  "raw-usb",
  "hardware-observe",
  "system-observe",
  "process-control",
  "log-observe",
  "kernel-module-control",
  "docker",
  "docker-support",
  "snapd-control",
  "x11",
  "shutdown",
  "network-control",
  "firewall-control",
  "mount-observe",
  "block-devices",
]);

export const isSensitive = (c: Connection) => SENSITIVE.has(c.interface.replace(/\[.*$/, ""));

/** The plug or slot of this snap, to pass to `snap connect`/`disconnect`. */
export const endpoint = (c: Connection, snap: string) =>
  c.plug.startsWith(`${snap}:`) ? c.plug : c.slot.startsWith(`${snap}:`) ? c.slot : c.plug || c.slot;

// ---------------------------------------------------------------------------
// Commands run as root

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

const ROOT_PATH = "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/snap/bin";

/** A root script running each snap command; it goes on after a failure and exits 1 if any failed. */
export function rootScript(commands: string[][]): string {
  return [
    ROOT_PATH,
    "failed=0",
    ...commands.map((argv) => `${shellLine(["snap", ...argv])} || failed=1`),
    "exit $failed",
  ].join("\n");
}

/** `snap remove <name> --revision=<rev>` for each old revision. */
export const removeOldCommands = (snaps: Snap[]) =>
  snaps.flatMap((s) => s.old.map((r) => ["remove", s.name, `--revision=${r.rev}`]));

/** pkexec's exit codes and messages, in words; undefined when it ran the program. */
export function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

/** snapd's errors, shortened: `error: cannot refresh "firefox": snap "firefox" has running apps (firefox)`. */
export function snapError(stderr: string): string {
  const line = stderr.split("\n").map((l) => l.trim()).filter(Boolean).find((l) => l.startsWith("error:")) ??
    stderr.split("\n").filter(Boolean).pop() ?? "snap failed";
  const t = line.replace(/^error:\s*/, "");
  const running = t.match(/has running apps \(([^)]+)\)/);
  if (running) return `Close ${running[1]} first: it is running`;
  if (/cannot revert.*no revision to revert to|no previous revision/i.test(t)) return "No older revision to revert to";
  if (/cannot communicate with server|connection refused/i.test(t)) return "snapd isn't running";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "—";
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const NOTE_TITLES: Record<string, string> = {
  classic: "Classic (no sandbox)",
  devmode: "Developer mode",
  jailmode: "Jail mode",
  try: "Try mode",
  broken: "Broken",
  held: "Updates paused",
  base: "Base",
  core: "Core",
  snapd: "snapd",
  kernel: "Kernel",
  gadget: "Gadget",
  disabled: "Disabled",
};

export const storeUrl = (name: string) => `https://snapcraft.io/${encodeURIComponent(name)}`;
