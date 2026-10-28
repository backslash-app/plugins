// `tailscale status --json` and friends, as plain data. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// Shapes

/** A node as `tailscale status --json` describes it (Self and each Peer). */
export interface RawNode {
  ID?: string;
  PublicKey?: string;
  HostName?: string;
  DNSName?: string;
  OS?: string;
  UserID?: number;
  TailscaleIPs?: string[] | null;
  Tags?: string[] | null;
  Relay?: string;
  CurAddr?: string;
  RxBytes?: number;
  TxBytes?: number;
  Created?: string;
  LastSeen?: string;
  LastHandshake?: string;
  Online?: boolean;
  /** This peer is the exit node in use. */
  ExitNode?: boolean;
  /** This peer offers itself as an exit node. */
  ExitNodeOption?: boolean;
  Active?: boolean;
  KeyExpiry?: string;
  sshHostKeys?: string[] | null;
  Expired?: boolean;
}

export interface RawStatus {
  Version?: string;
  BackendState?: string;
  AuthURL?: string;
  TailscaleIPs?: string[] | null;
  Self?: RawNode;
  Health?: string[] | null;
  MagicDNSSuffix?: string;
  CurrentTailnet?: { Name?: string; MagicDNSSuffix?: string; MagicDNSEnabled?: boolean } | null;
  Peer?: Record<string, RawNode> | null;
  User?: Record<string, { ID: number; LoginName?: string; DisplayName?: string; ProfilePicURL?: string }> | null;
  ExitNodeStatus?: { ID?: string; Online?: boolean; TailscaleIPs?: string[] } | null;
}

export interface Device {
  id: string;
  /** The machine name in the tailnet (first label of the MagicDNS name). */
  name: string;
  hostName: string;
  /** `laptop.tail1234.ts.net`, without the trailing dot. */
  dnsName: string;
  ipv4?: string;
  ipv6?: string;
  os: string;
  online: boolean;
  isSelf: boolean;
  lastSeen?: string;
  exitNode: boolean;
  exitNodeOption: boolean;
  tags: string[];
  owner?: string;
  ownerLogin?: string;
  /** `direct` with an address, or `relay` through a DERP region. */
  connection?: { kind: "direct"; address: string } | { kind: "relay"; region: string };
  rxBytes: number;
  txBytes: number;
  keyExpiry?: string;
  expired: boolean;
  tailscaleSsh: boolean;
}

export interface Status {
  state: string;
  version?: string;
  authUrl?: string;
  tailnet?: string;
  magicDnsSuffix?: string;
  health: string[];
  self?: Device;
  peers: Device[];
}

// ---------------------------------------------------------------------------
// Parsing

const ZERO = "0001-01-01T00:00:00Z";
const realDate = (d?: string) => (d && !d.startsWith("0001-") && d !== ZERO ? d : undefined);

function device(n: RawNode, status: RawStatus, isSelf: boolean): Device {
  const dnsName = String(n.DNSName ?? "").replace(/\.$/, "");
  const ips = n.TailscaleIPs ?? [];
  const user = n.UserID !== undefined ? status.User?.[String(n.UserID)] : undefined;
  const tags = n.Tags ?? [];
  return {
    id: n.ID ?? n.PublicKey ?? dnsName,
    name: dnsName.split(".")[0] || n.HostName || "unknown",
    hostName: n.HostName ?? "",
    dnsName,
    ipv4: ips.find((ip) => !ip.includes(":")),
    ipv6: ips.find((ip) => ip.includes(":")),
    os: n.OS ?? "",
    online: isSelf ? status.BackendState === "Running" : Boolean(n.Online),
    isSelf,
    lastSeen: realDate(n.LastSeen),
    exitNode: Boolean(n.ExitNode),
    exitNodeOption: Boolean(n.ExitNodeOption),
    tags,
    // Tagged devices belong to the tailnet, not to the user who added them.
    owner: tags.length ? undefined : user?.DisplayName || user?.LoginName,
    ownerLogin: tags.length ? undefined : user?.LoginName,
    connection: n.CurAddr
      ? { kind: "direct", address: n.CurAddr }
      : n.Active && n.Relay
      ? { kind: "relay", region: n.Relay }
      : undefined,
    rxBytes: n.RxBytes ?? 0,
    txBytes: n.TxBytes ?? 0,
    keyExpiry: realDate(n.KeyExpiry),
    expired: Boolean(n.Expired),
    tailscaleSsh: (n.sshHostKeys?.length ?? 0) > 0,
  };
}

export function parseStatus(json: string): Status {
  const s = JSON.parse(json) as RawStatus;
  const peers = Object.values(s.Peer ?? {}).map((p) => device(p, s, false));
  return {
    state: s.BackendState ?? "NoState",
    version: s.Version?.split("-")[0],
    authUrl: s.AuthURL || undefined,
    tailnet: s.CurrentTailnet?.Name,
    magicDnsSuffix: s.CurrentTailnet?.MagicDNSSuffix ?? s.MagicDNSSuffix,
    health: s.Health ?? [],
    self: s.Self ? device(s.Self, s, true) : undefined,
    peers: sortDevices(peers),
  };
}

/** Exit node in use first, then online, then by name. */
export function sortDevices(devices: Device[]): Device[] {
  return [...devices].sort((a, b) =>
    Number(b.exitNode) - Number(a.exitNode) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name)
  );
}

export const exitNodeInUse = (s: Status) => s.peers.find((p) => p.exitNode);

// ---------------------------------------------------------------------------
// Looks

export const STATES: Record<string, { label: string; color: Color }> = {
  Running: { label: "Connected", color: "green" },
  Starting: { label: "Connecting…", color: "yellow" },
  Stopped: { label: "Disconnected", color: "gray" },
  NeedsLogin: { label: "Signed out", color: "orange" },
  NeedsMachineAuth: { label: "Waiting for approval", color: "orange" },
  NoState: { label: "Not running", color: "gray" },
};

export const stateLook = (state: string) => STATES[state] ?? { label: state, color: "gray" as Color };

const OS_NAMES: Record<string, string> = {
  linux: "Linux",
  windows: "Windows",
  macOS: "macOS",
  darwin: "macOS",
  iOS: "iOS",
  android: "Android",
  freebsd: "FreeBSD",
  openbsd: "OpenBSD",
  js: "Browser",
  tvOS: "tvOS",
};

export const osName = (os: string) => OS_NAMES[os] ?? (os || "Unknown OS");

/** Phones and tablets have no glyph of their own; servers are tagged or headless Linux. */
export function deviceIcon(d: Device): string {
  if (d.exitNode) return Icons.globe;
  if (d.os === "iOS" || d.os === "android") return Icons.apps;
  if (d.tags.length || d.os === "freebsd" || d.os === "openbsd") return Icons.server;
  return Icons.monitor;
}

// ---------------------------------------------------------------------------
// Formatting

export function ago(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const s = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/** "in 3 days", "in 5 months", "expired". */
export function until(iso: string | undefined, now = new Date()): string {
  if (!iso) return "";
  const days = Math.floor((Date.parse(iso) - now.getTime()) / 86_400_000);
  if (days < 0) return "expired";
  if (days < 1) return "today";
  if (days < 60) return `in ${days} day${days === 1 ? "" : "s"}`;
  return `in ${Math.round(days / 30)} months`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let u = -1;
  do {
    v /= 1024;
    u++;
  } while (v >= 1024 && u < units.length - 1);
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[u]}`;
}

/** The footer line: "steven@example.com · Connected as laptop · exit node: nas". */
export function statusLine(s: Status): string {
  const look = stateLook(s.state);
  const parts = [
    s.tailnet ?? "Tailscale",
    s.self && s.state === "Running" ? `${look.label} as ${s.self.name}` : look.label,
  ];
  const exit = exitNodeInUse(s);
  if (exit) parts.push(`exit node ${exit.name}`);
  if (s.state === "Running") parts.push(`${s.peers.filter((p) => p.online).length} of ${s.peers.length} online`);
  return parts.join(" · ");
}

/** The root subtitle: "Connected · 4 online", "Connected via nas", "Disconnected". */
export function subtitle(s: Status): string {
  const look = stateLook(s.state);
  if (s.state !== "Running") return look.label;
  const exit = exitNodeInUse(s);
  if (exit) return `Connected via ${exit.name}`;
  return `Connected · ${s.peers.filter((p) => p.online).length} online`;
}

// ---------------------------------------------------------------------------
// Commands

export const sshTarget = (d: Device, user?: string) =>
  `${user?.trim() ? `${user.trim()}@` : ""}${d.dnsName || d.ipv4 || d.name}`;

/** Tailscale SSH when the device runs it (it advertises SSH host keys), plain ssh otherwise. */
export const sshArgv = (d: Device, user?: string) =>
  d.tailscaleSsh ? ["tailscale", "ssh", sshTarget(d, user)] : ["ssh", sshTarget(d, user)];

/** `tailscale set` arguments; no device clears the exit node. */
export const exitNodeArgs = (d?: Device) => ["set", `--exit-node=${d ? d.ipv4 ?? d.dnsName : ""}`];

/** `tailscale file cp` arguments. */
export const taildropArgs = (paths: string[], d: Device) => ["file", "cp", ...paths, `${d.ipv4 ?? d.dnsName}:`];

/** `~/x` → `/home/me/x`; one path per line in the form. */
export function expandPaths(input: string, home: string): string[] {
  return input.split("\n").map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean).map((p) =>
    p === "~" ? home : p.startsWith("~/") ? `${home}${p.slice(1)}` : p.replace(/^file:\/\//, "")
  ).map((p) => {
    try {
      return decodeURIComponent(p);
    } catch {
      return p;
    }
  });
}

/** `pong from nas (100.64.0.2) via DERP(fra) in 32ms` → "32 ms via relay fra". */
export function parsePing(out: string): { ms: number; via: string; direct: boolean } | undefined {
  const m = /pong from \S+ \([^)]*\) via (\S+) in ([\d.]+)ms/.exec(out);
  if (!m) return undefined;
  const derp = /^DERP\(([^)]+)\)$/.exec(m[1]);
  return { ms: Number(m[2]), via: derp ? `relay ${derp[1]}` : m[1], direct: !derp };
}

/** Turns tailscale's errors into what to do about them. */
export function explainError(message: string): string {
  if (/access denied|permission denied|prefs write access denied|checkprefs/i.test(message)) {
    return "Tailscale needs root for this: run “sudo tailscale set --operator=$USER” once";
  }
  if (/failed to connect to local tailscaled|tailscaled.*not running|connection refused/i.test(message)) {
    return "tailscaled is not running: sudo systemctl enable --now tailscaled";
  }
  const line = message.replace(/^tailscale exited with \d+:\s*/, "").split("\n").find((l) => l.trim()) ?? message;
  return line.trim();
}

// ---------------------------------------------------------------------------
// Installing

export type Family = "arch" | "debian" | "fedora" | "suse";

/** `ID` and `ID_LIKE` of /etc/os-release. */
export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export function installCommand(family: Family | undefined): string {
  switch (family) {
    case "arch":
      return "sudo pacman -S tailscale";
    case "fedora":
      return "sudo dnf install tailscale";
    case "suse":
      return "sudo zypper install tailscale";
    default:
      return "curl -fsSL https://tailscale.com/install.sh | sh";
  }
}
