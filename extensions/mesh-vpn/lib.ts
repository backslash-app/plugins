// `netbird status --json`, `zerotier-cli -j info / listnetworks / peers`, as plain data. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// NetBird

/** One peer of `netbird status --json` (`peers.details[]`). */
export interface RawNetbirdPeer {
  fqdn?: string;
  netbirdIp?: string;
  publicKey?: string;
  status?: string;
  statusSince?: string;
  connectionType?: string;
  iceCandidateType?: { local?: string; remote?: string };
  iceCandidateEndpoint?: { local?: string; remote?: string };
  relayAddress?: string;
  lastWireguardHandshake?: string;
  transferReceived?: number;
  transferSent?: number;
  /** A Go `time.Duration`: nanoseconds. Some builds print it as text ("12.3ms"). */
  latency?: number | string;
  quantumResistance?: boolean;
  routes?: string[] | null;
  networks?: string[] | null;
}

export interface RawNetbirdStatus {
  peers?: { total?: number; connected?: number; details?: RawNetbirdPeer[] | null };
  cliVersion?: string;
  daemonVersion?: string;
  management?: { url?: string; connected?: boolean; error?: string };
  signal?: { url?: string; connected?: boolean; error?: string };
  relays?: { total?: number; available?: number };
  netbirdIp?: string;
  publicKey?: string;
  usesKernelInterface?: boolean;
  fqdn?: string;
  networks?: string[] | null;
}

export interface NetbirdPeer {
  key: string;
  name: string;
  fqdn: string;
  ip?: string;
  connected: boolean;
  since?: string;
  /** "P2P" or "Relayed". */
  connection?: string;
  endpoint?: string;
  /** Milliseconds, when measured. */
  latency?: number;
  rx: number;
  tx: number;
  handshake?: string;
  routes: string[];
}

export interface NetbirdStatus {
  connected: boolean;
  managementUrl?: string;
  managementError?: string;
  signalConnected: boolean;
  /** Without the prefix length. */
  ip?: string;
  cidr?: string;
  fqdn?: string;
  version?: string;
  peersConnected: number;
  peersTotal: number;
  relays?: string;
  kernel: boolean;
  networks: string[];
  peers: NetbirdPeer[];
}

const ZERO_DATE = /^0001-01-01/;
const realDate = (d?: string) => (d && !ZERO_DATE.test(d) ? d : undefined);

/** Nanoseconds (Go's time.Duration), or "12.345ms" / "1.2s" / "850µs", to milliseconds. */
export function latencyMs(value: unknown): number | undefined {
  if (typeof value === "number") return value > 0 ? value / 1e6 : undefined;
  if (typeof value !== "string") return undefined;
  const m = /^([\d.]+)\s*(ns|µs|us|ms|s)$/.exec(value.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const factor = { ns: 1e-6, "µs": 1e-3, us: 1e-3, ms: 1, s: 1000 }[m[2] as "ms"];
  return n > 0 ? n * factor : undefined;
}

export function parseNetbird(json: string): NetbirdStatus {
  const s = JSON.parse(json) as RawNetbirdStatus;
  const peers = (s.peers?.details ?? []).map((p): NetbirdPeer => {
    const fqdn = String(p.fqdn ?? "");
    const connected = /^connected$/i.test(p.status ?? "");
    return {
      key: p.publicKey || fqdn || p.netbirdIp || "peer",
      name: fqdn.split(".")[0] || p.netbirdIp || "peer",
      fqdn,
      ip: p.netbirdIp?.split("/")[0] || undefined,
      connected,
      since: realDate(p.statusSince),
      connection: connected ? p.connectionType || undefined : undefined,
      endpoint: connected ? (p.relayAddress || p.iceCandidateEndpoint?.remote || undefined) : undefined,
      latency: connected ? latencyMs(p.latency) : undefined,
      rx: p.transferReceived ?? 0,
      tx: p.transferSent ?? 0,
      handshake: realDate(p.lastWireguardHandshake),
      routes: [...(p.routes ?? []), ...(p.networks ?? [])].filter((r, i, a) => a.indexOf(r) === i),
    };
  });
  const cidr = s.netbirdIp || undefined;
  return {
    connected: Boolean(s.management?.connected) && Boolean(cidr),
    managementUrl: s.management?.url?.replace(/:443$/, "") || undefined,
    managementError: s.management?.error || undefined,
    signalConnected: Boolean(s.signal?.connected),
    ip: cidr?.split("/")[0],
    cidr,
    fqdn: s.fqdn || undefined,
    version: s.daemonVersion || s.cliVersion || undefined,
    peersConnected: s.peers?.connected ?? peers.filter((p) => p.connected).length,
    peersTotal: s.peers?.total ?? peers.length,
    relays: s.relays?.total ? `${s.relays.available ?? 0}/${s.relays.total}` : undefined,
    kernel: Boolean(s.usesKernelInterface),
    networks: s.networks ?? [],
    peers: sortBy(peers, (p) => [Number(!p.connected), p.latency ?? 1e9, p.name]),
  };
}

/** `netbird status` prints this instead of JSON when signed out or the daemon is down. */
export function netbirdProblem(text: string): { state: "login" | "daemon" | "other"; message: string } {
  if (/NeedsLogin|LoginFailed|login.*required|SessionExpired/i.test(text)) {
    return { state: "login", message: "NetBird needs you to sign in" };
  }
  if (/daemon|connect(ion)? refused|no such file|dial unix|failed to connect/i.test(text)) {
    return { state: "daemon", message: "The NetBird service isn't running" };
  }
  return { state: "other", message: firstLine(text) || "netbird status failed" };
}

/** The sign-in link `netbird up` prints when SSO is needed. */
export function loginUrl(output: string): string | undefined {
  return /https:\/\/\S+(?:activate|device|login|authorize|verification|user_code)\S*/i.exec(output)?.[0]
    ?.replace(/[)\].,]+$/, "");
}

// ---------------------------------------------------------------------------
// ZeroTier

export interface RawZtInfo {
  address?: string;
  online?: boolean;
  version?: string;
  tcpFallbackActive?: boolean;
  config?: { settings?: { primaryPort?: number } };
}

export interface RawZtNetwork {
  id?: string;
  nwid?: string;
  name?: string;
  status?: string;
  type?: string;
  mac?: string;
  portDeviceName?: string;
  assignedAddresses?: string[] | null;
  routes?: { target?: string; via?: string | null }[] | null;
  allowManaged?: boolean;
  allowGlobal?: boolean;
  allowDefault?: boolean;
  allowDNS?: boolean;
  dns?: { domain?: string; servers?: string[] | null } | null;
  mtu?: number;
}

export interface RawZtPeer {
  address?: string;
  latency?: number;
  role?: string;
  version?: string;
  isBonded?: boolean;
  tunneled?: boolean;
  paths?: { active?: boolean; address?: string; expired?: boolean; preferred?: boolean; lastReceive?: number }[];
}

export interface ZtNode {
  address: string;
  online: boolean;
  version?: string;
  tcpFallback: boolean;
  port?: number;
}

export interface ZtNetwork {
  id: string;
  name: string;
  status: string;
  private: boolean;
  addresses: string[];
  device?: string;
  mac?: string;
  routes: string[];
  allowDefault: boolean;
  allowDns: boolean;
  dnsDomain?: string;
}

export interface ZtPeer {
  address: string;
  role: string;
  latency?: number;
  version?: string;
  path?: string;
  direct: boolean;
  relayed: boolean;
}

export function parseZtInfo(json: string): ZtNode {
  const i = JSON.parse(json) as RawZtInfo;
  return {
    address: i.address ?? "",
    online: Boolean(i.online),
    version: i.version,
    tcpFallback: Boolean(i.tcpFallbackActive),
    port: i.config?.settings?.primaryPort,
  };
}

export function parseZtNetworks(json: string): ZtNetwork[] {
  const list = JSON.parse(json) as RawZtNetwork[];
  return (Array.isArray(list) ? list : []).map((n) => ({
    id: n.nwid ?? n.id ?? "",
    name: n.name || "",
    status: n.status ?? "UNKNOWN",
    private: (n.type ?? "PRIVATE") !== "PUBLIC",
    addresses: n.assignedAddresses ?? [],
    device: n.portDeviceName,
    mac: n.mac,
    routes: (n.routes ?? []).map((r) => r.via ? `${r.target} via ${r.via}` : String(r.target ?? "")).filter(Boolean),
    allowDefault: Boolean(n.allowDefault),
    allowDns: Boolean(n.allowDNS),
    dnsDomain: n.dns?.domain || undefined,
  })).filter((n) => n.id);
}

/** Leaves (other members) first by latency; root servers (PLANET, MOON) after. */
export function parseZtPeers(json: string): ZtPeer[] {
  const list = JSON.parse(json) as RawZtPeer[];
  const peers = (Array.isArray(list) ? list : []).map((p): ZtPeer => {
    const active = (p.paths ?? []).filter((x) => x.active && !x.expired);
    const best = active.find((x) => x.preferred) ?? active[0];
    return {
      address: p.address ?? "",
      role: p.role ?? "LEAF",
      latency: typeof p.latency === "number" && p.latency >= 0 ? p.latency : undefined,
      version: p.version && p.version !== "-1.-1.-1" ? p.version : undefined,
      path: best?.address?.replace(/\/(\d+)$/, ":$1"),
      direct: Boolean(best),
      relayed: !best || Boolean(p.tunneled),
    };
  }).filter((p) => p.address);
  return sortBy(peers, (p) => [Number(p.role !== "LEAF"), Number(!p.direct), p.latency ?? 1e9, p.address]);
}

/** ZeroTier network IDs are 16 hex digits. */
export function cleanNetworkId(text: unknown): string | undefined {
  const id = String(text ?? "").trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(id) ? id : undefined;
}

export const ZT_STATUS: Record<string, { label: string; color: Color }> = {
  OK: { label: "Connected", color: "green" },
  REQUESTING_CONFIGURATION: { label: "Waiting for config", color: "yellow" },
  ACCESS_DENIED: { label: "Not authorized", color: "orange" },
  NOT_FOUND: { label: "Network not found", color: "red" },
  PORT_ERROR: { label: "Interface error", color: "red" },
  CLIENT_TOO_OLD: { label: "Client too old", color: "red" },
  AUTHENTICATION_REQUIRED: { label: "Sign-in required", color: "orange" },
};

export const ztStatus = (s: string) => ZT_STATUS[s] ?? { label: s.toLowerCase().replace(/_/g, " "), color: "gray" };

/** What to do about a zerotier-cli failure. */
export function explainZt(text: string): string {
  if (/authtoken|permission denied|access denied/i.test(text)) {
    return "zerotier-cli can't read the service's auth token: copy it to ~/.zeroTierOneAuthToken";
  }
  if (/connection failed|connection refused|cannot connect|503/i.test(text)) {
    return "The ZeroTier service isn't running";
  }
  if (/invalid network|invalid.*id/i.test(text)) return "That is not a ZeroTier network ID (16 hex digits)";
  return firstLine(text) || "zerotier-cli failed";
}

/** The command that gives the current user access to zerotier-cli. */
export const ZT_TOKEN_FIX =
  "sudo cp /var/lib/zerotier-one/authtoken.secret ~/.zeroTierOneAuthToken && sudo chown $USER ~/.zeroTierOneAuthToken && chmod 600 ~/.zeroTierOneAuthToken";

// ---------------------------------------------------------------------------
// Formatting

export function ms(value: number | undefined): string {
  if (value === undefined) return "";
  if (value < 1) return "<1 ms";
  return value < 10 ? `${value.toFixed(1)} ms` : `${Math.round(value)} ms`;
}

export function latencyColor(value: number | undefined): Color | undefined {
  if (value === undefined) return undefined;
  return value < 50 ? "green" : value < 150 ? "yellow" : "red";
}

export function bytes(n: number): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ago(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The command's subtitle in the root search. */
export function summary(nb: NetbirdStatus | undefined, zt: ZtNetwork[] | undefined): string | null {
  const parts: string[] = [];
  if (nb) parts.push(nb.connected ? `NetBird ${nb.peersConnected}/${nb.peersTotal} peers` : "NetBird off");
  if (zt) {
    const ok = zt.filter((n) => n.status === "OK").length;
    parts.push(zt.length ? `ZeroTier ${ok}/${zt.length} networks` : "ZeroTier: no network");
  }
  return parts.length ? parts.join(" · ") : null;
}

const firstLine = (text: string) => text.trim().split("\n").map((l) => l.trim()).find(Boolean) ?? "";

function sortBy<T>(items: T[], key: (t: T) => (string | number)[]): T[] {
  return [...items].sort((a, b) => {
    const ka = key(a), kb = key(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] === kb[i]) continue;
      return typeof ka[i] === "number" ? (ka[i] as number) - (kb[i] as number) : String(ka[i]).localeCompare(
        String(kb[i]),
      );
    }
    return 0;
  });
}
