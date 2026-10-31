// OpenWrt (ubus), UniFi Network and Freebox OS answers as one model. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Kind = "openwrt" | "unifi" | "freebox";

export const TITLES: Record<Kind, string> = { openwrt: "OpenWrt", unifi: "UniFi", freebox: "Freebox" };

export interface Client {
  /** The MAC address, lower case. */
  mac: string;
  name: string;
  ip?: string;
  ip6?: string;
  connection: "wifi" | "wired";
  /** `undefined` when the router can't tell (an OpenWrt DHCP lease of a wired device). */
  online?: boolean;
  ssid?: string;
  /** "2.4 GHz", "5 GHz", "6 GHz". */
  band?: string;
  /** dBm. */
  signal?: number;
  /** Link rates, bits per second. */
  linkDown?: number;
  linkUp?: number;
  /** Current traffic, bytes per second (download = to the client). */
  down?: number;
  up?: number;
  /** Total traffic, bytes. */
  totalDown?: number;
  totalUp?: number;
  /** Seconds connected. */
  uptime?: number;
  /** Unix ms. */
  lastSeen?: number;
  vendor?: string;
  network?: string;
  /** DHCP lease left, seconds. */
  lease?: number;
  blocked?: boolean;
}

export interface Router {
  kind: Kind;
  name: string;
  model?: string;
  firmware?: string;
  /** Seconds. */
  uptime?: number;
  wan: {
    online: boolean;
    ip?: string;
    ip6?: string;
    type?: string;
    /** Bytes per second right now. */
    down?: number;
    up?: number;
    /** Line capacity, bits per second. */
    maxDown?: number;
    maxUp?: number;
    totalDown?: number;
    totalUp?: number;
    latency?: number;
  };
  cpu?: number;
  memory?: number;
  temperature?: number;
  /** The MAC that UniFi reboots. */
  gatewayMac?: string;
}

// ---------------------------------------------------------------------------
// OpenWrt (ubus)

export interface UbusBoard {
  hostname?: string;
  model?: string;
  board_name?: string;
  release?: { distribution?: string; version?: string; description?: string };
}

export interface UbusInfo {
  uptime?: number;
  load?: number[];
  memory?: { total?: number; free?: number; available?: number; buffered?: number; cached?: number };
}

export interface UbusInterface {
  up?: boolean;
  uptime?: number;
  proto?: string;
  l3_device?: string;
  device?: string;
  "ipv4-address"?: { address: string; mask?: number }[];
  "ipv6-address"?: { address: string; mask?: number }[];
}

export interface UbusLeases {
  dhcp_leases?: { expires?: number | false; hostname?: string; macaddr?: string; ipaddr?: string }[];
  dhcp6_leases?: { expires?: number | false; hostname?: string; macaddr?: string; ip6addr?: string }[];
}

export type UbusHints = Record<string, { name?: string; ipaddrs?: string[]; ip6addrs?: string[] }>;

export interface UbusStation {
  mac: string;
  signal?: number;
  inactive?: number;
  connected_time?: number;
  rx?: { rate?: number; bytes?: number };
  tx?: { rate?: number; bytes?: number };
}

/** A ubus JSON-RPC answer: `result: [status, data]`, or a JSON-RPC `error`. */
export function ubusResult<T>(body: unknown): { status: number; data?: T; error?: string } {
  const b = body as { result?: [number, T?]; error?: { code?: number; message?: string } };
  if (b?.error) return { status: b.error.code === -32002 ? 6 : -1, error: b.error.message ?? "ubus error" };
  if (!Array.isArray(b?.result)) return { status: -1, error: "Not a ubus answer" };
  return { status: b.result[0], data: b.result[1] };
}

export const UBUS_STATUS: Record<number, string> = {
  1: "invalid command",
  2: "invalid argument",
  3: "method not found",
  4: "not found",
  5: "no data",
  6: "permission denied",
  7: "timeout",
  8: "not supported",
  9: "unknown error",
  10: "connection failed",
};

const mac = (m: unknown) => String(m ?? "").toLowerCase();

const memoryRatio = (m: UbusInfo["memory"]) => {
  if (!m?.total) return undefined;
  const free = m.available ?? (m.free ?? 0) + (m.buffered ?? 0) + (m.cached ?? 0);
  return Math.max(0, Math.min(1, 1 - free / m.total));
};

export function openwrtRouter(
  board: UbusBoard | undefined,
  info: UbusInfo | undefined,
  wan: UbusInterface | undefined,
  rates: { down?: number; up?: number; totalDown?: number; totalUp?: number },
): Router {
  return {
    kind: "openwrt",
    name: board?.hostname || "OpenWrt",
    model: board?.model,
    firmware: board?.release?.description ||
      [board?.release?.distribution, board?.release?.version].filter(Boolean).join(" ") || undefined,
    uptime: info?.uptime,
    wan: {
      online: Boolean(wan?.up),
      ip: wan?.["ipv4-address"]?.[0]?.address,
      ip6: wan?.["ipv6-address"]?.[0]?.address,
      type: wan?.proto,
      down: rates.down,
      up: rates.up,
      totalDown: rates.totalDown,
      totalUp: rates.totalUp,
    },
    // 1-minute load, as a share of one core (ubus scales it by 65536).
    cpu: info?.load?.[0] !== undefined ? Math.min(1, info.load[0] / 65536) : undefined,
    memory: memoryRatio(info?.memory),
  };
}

/** Bytes per second between two samples of interface counters. */
export function rate(before: number | undefined, after: number | undefined, seconds: number): number | undefined {
  if (before === undefined || after === undefined || seconds <= 0 || after < before) return undefined;
  return (after - before) / seconds;
}

/** Wi-Fi stations (online), then DHCP leases and host hints (wired or unknown). */
export function openwrtClients(
  stations: { device: string; ssid?: string; band?: string; list: UbusStation[] }[],
  leases: UbusLeases | undefined,
  hints: UbusHints | undefined,
): Client[] {
  const byMac = new Map<string, Client>();
  const leaseOf = new Map<string, { name?: string; ip?: string; expires?: number }>();
  for (const l of leases?.dhcp_leases ?? []) {
    if (!l.macaddr) continue;
    leaseOf.set(mac(l.macaddr), {
      name: l.hostname,
      ip: l.ipaddr,
      expires: typeof l.expires === "number" ? l.expires : undefined,
    });
  }
  const hint = (m: string) => hints?.[m.toUpperCase()] ?? hints?.[m];
  const named = (m: string) => leaseOf.get(m)?.name || hint(m)?.name || m;
  for (const ap of stations) {
    for (const s of ap.list) {
      const m = mac(s.mac);
      byMac.set(m, {
        mac: m,
        name: named(m),
        ip: leaseOf.get(m)?.ip ?? hint(m)?.ipaddrs?.[0],
        ip6: hint(m)?.ip6addrs?.[0],
        connection: "wifi",
        online: true,
        ssid: ap.ssid,
        band: ap.band,
        signal: s.signal,
        // iwinfo rates are kbit/s, from the access point's side: its tx is the client's download.
        linkDown: s.tx?.rate ? s.tx.rate * 1000 : undefined,
        linkUp: s.rx?.rate ? s.rx.rate * 1000 : undefined,
        totalDown: s.tx?.bytes,
        totalUp: s.rx?.bytes,
        uptime: s.connected_time,
        lease: leaseOf.get(m)?.expires,
      });
    }
  }
  for (const [m, l] of leaseOf) {
    if (byMac.has(m)) continue;
    byMac.set(m, {
      mac: m,
      name: named(m),
      ip: l.ip,
      ip6: hint(m)?.ip6addrs?.[0],
      connection: "wired",
      online: undefined,
      lease: l.expires,
    });
  }
  return sortClients([...byMac.values()]);
}

/** iwinfo's frequency (MHz) as a band. */
export function band(mhz: number | undefined): string | undefined {
  if (!mhz) return undefined;
  if (mhz < 3000) return "2.4 GHz";
  if (mhz < 5925) return "5 GHz";
  return "6 GHz";
}

// ---------------------------------------------------------------------------
// UniFi Network

export interface UnifiStation {
  mac: string;
  hostname?: string;
  name?: string;
  ip?: string;
  is_wired?: boolean;
  essid?: string;
  radio?: string;
  channel?: number;
  signal?: number;
  rssi?: number;
  tx_rate?: number;
  rx_rate?: number;
  "tx_bytes-r"?: number;
  "rx_bytes-r"?: number;
  tx_bytes?: number;
  rx_bytes?: number;
  uptime?: number;
  last_seen?: number;
  oui?: string;
  network?: string;
  blocked?: boolean;
}

export interface UnifiHealth {
  subsystem: string;
  status?: string;
  wan_ip?: string;
  gw_mac?: string;
  gw_name?: string;
  gw_version?: string;
  "rx_bytes-r"?: number;
  "tx_bytes-r"?: number;
  "gw_system-stats"?: { cpu?: string | number; mem?: string | number; uptime?: string | number };
  latency?: number;
  xput_down?: number;
  xput_up?: number;
  num_user?: number;
}

export interface UnifiDevice {
  mac: string;
  type?: string;
  model?: string;
  name?: string;
  version?: string;
  uptime?: number;
  "system-stats"?: { cpu?: string | number; mem?: string | number };
}

/** The `{ meta: { rc }, data }` envelope of the classic UniFi API. */
export function unifiData<T>(body: unknown): T[] {
  const b = body as { meta?: { rc?: string; msg?: string }; data?: T[] };
  if (b?.meta?.rc && b.meta.rc !== "ok") throw new Error(`UniFi: ${b.meta.msg ?? b.meta.rc}`);
  return Array.isArray(b?.data) ? b.data : [];
}

const RADIOS: Record<string, string> = { ng: "2.4 GHz", na: "5 GHz", "6e": "6 GHz" };

export function unifiClients(stations: UnifiStation[]): Client[] {
  return sortClients(stations.map((s) => ({
    mac: mac(s.mac),
    name: s.name || s.hostname || s.oui || mac(s.mac),
    ip: s.ip,
    connection: s.is_wired ? "wired" : "wifi",
    online: true,
    ssid: s.essid,
    band: s.radio ? RADIOS[s.radio] : undefined,
    signal: s.signal ?? (s.rssi !== undefined ? s.rssi - 96 : undefined),
    // Rates are kbit/s; tx is what the network sends to the client.
    linkDown: s.tx_rate ? s.tx_rate * 1000 : undefined,
    linkUp: s.rx_rate ? s.rx_rate * 1000 : undefined,
    down: s["tx_bytes-r"],
    up: s["rx_bytes-r"],
    totalDown: s.tx_bytes,
    totalUp: s.rx_bytes,
    uptime: s.uptime,
    lastSeen: s.last_seen ? s.last_seen * 1000 : undefined,
    vendor: s.oui || undefined,
    network: s.network,
    blocked: s.blocked,
  })));
}

const GATEWAYS = new Set(["ugw", "udm", "uxg", "ucg"]);
const num = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : Number(v));

export function unifiRouter(health: UnifiHealth[], devices: UnifiDevice[]): Router {
  const wan = health.find((h) => h.subsystem === "wan");
  const www = health.find((h) => h.subsystem === "www");
  const gw = devices.find((d) => GATEWAYS.has(d.type ?? "")) ?? devices.find((d) => d.mac === wan?.gw_mac);
  const stats = gw?.["system-stats"] ?? wan?.["gw_system-stats"];
  const cpu = num(stats?.cpu), mem = num(stats?.mem);
  return {
    kind: "unifi",
    name: gw?.name || wan?.gw_name || "UniFi Gateway",
    model: gw?.model,
    firmware: gw?.version ?? wan?.gw_version,
    uptime: gw?.uptime ?? num(wan?.["gw_system-stats"]?.uptime),
    wan: {
      online: wan?.status === "ok",
      ip: wan?.wan_ip,
      // The gateway receives from the internet (rx) what clients download.
      down: wan?.["rx_bytes-r"],
      up: wan?.["tx_bytes-r"],
      maxDown: www?.xput_down ? www.xput_down * 1e6 : undefined,
      maxUp: www?.xput_up ? www.xput_up * 1e6 : undefined,
      latency: www?.latency,
    },
    cpu: cpu !== undefined && Number.isFinite(cpu) ? cpu / 100 : undefined,
    memory: mem !== undefined && Number.isFinite(mem) ? mem / 100 : undefined,
    gatewayMac: gw?.mac ?? wan?.gw_mac,
  };
}

// ---------------------------------------------------------------------------
// Freebox OS

export interface FreeboxHost {
  id: string;
  primary_name?: string;
  host_type?: string;
  active?: boolean;
  reachable?: boolean;
  last_activity?: number;
  last_time_reachable?: number;
  vendor_name?: string;
  l2ident?: { id?: string; type?: string };
  l3connectivities?: { addr: string; af: string; active?: boolean; reachable?: boolean }[];
  access_point?: {
    connectivity_type?: string;
    wifi_information?: { band?: string; ssid?: string; signal?: number; phy_rx_rate?: number; phy_tx_rate?: number };
    rx_rate?: number;
    tx_rate?: number;
    rx_bytes?: number;
    tx_bytes?: number;
    ethernet_information?: { speed?: number; link?: string };
  };
}

export interface FreeboxConnection {
  state?: string;
  type?: string;
  media?: string;
  ipv4?: string;
  ipv6?: string;
  rate_down?: number;
  rate_up?: number;
  bandwidth_down?: number;
  bandwidth_up?: number;
  bytes_down?: number;
  bytes_up?: number;
}

export interface FreeboxSystem {
  firmware_version?: string;
  uptime_val?: number;
  board_name?: string;
  temp_cpum?: number;
  temp_cpub?: number;
  model_info?: { pretty_name?: string; name?: string };
  sensors?: { id: string; name?: string; value?: number }[];
}

const FBX_BANDS: Record<string, string> = { "2d4g": "2.4 GHz", "5g": "5 GHz", "6g": "6 GHz", "60g": "60 GHz" };

export function freeboxClients(hosts: FreeboxHost[]): Client[] {
  return sortClients(
    hosts.filter((h) => h.l2ident?.id).map((h): Client => {
      const ap = h.access_point;
      const wifi = ap?.wifi_information;
      const l3 = (af: string) =>
        (h.l3connectivities ?? []).filter((c) => c.af === af).sort((a, b) => Number(b.active) - Number(a.active))[0]
          ?.addr;
      return {
        mac: mac(h.l2ident?.id),
        name: h.primary_name || h.vendor_name || mac(h.l2ident?.id),
        ip: l3("ipv4"),
        ip6: l3("ipv6"),
        connection: ap?.connectivity_type === "wifi" || wifi ? "wifi" : "wired",
        online: Boolean(h.active),
        ssid: wifi?.ssid,
        band: wifi?.band ? FBX_BANDS[wifi.band] ?? wifi.band : undefined,
        signal: wifi?.signal,
        // Freebox phy rates are kbit/s, from the client's side.
        linkDown: wifi?.phy_rx_rate ? wifi.phy_rx_rate * 1000 : undefined,
        linkUp: wifi?.phy_tx_rate ? wifi.phy_tx_rate * 1000 : undefined,
        down: ap?.rx_rate,
        up: ap?.tx_rate,
        totalDown: ap?.rx_bytes,
        totalUp: ap?.tx_bytes,
        lastSeen: h.last_activity ? h.last_activity * 1000 : undefined,
        vendor: h.vendor_name || undefined,
      };
    }),
  );
}

const MEDIA: Record<string, string> = { ftth: "Fiber", xdsl: "DSL", backup_4g: "4G backup" };

export function freeboxRouter(connection: FreeboxConnection | undefined, system: FreeboxSystem | undefined): Router {
  const cpu = system?.sensors?.find((s) => /cpu/i.test(s.id))?.value ?? system?.temp_cpum ?? system?.temp_cpub;
  return {
    kind: "freebox",
    name: system?.model_info?.pretty_name || "Freebox",
    model: system?.board_name,
    firmware: system?.firmware_version,
    uptime: system?.uptime_val,
    wan: {
      online: connection?.state === "up",
      ip: connection?.ipv4 || undefined,
      ip6: connection?.ipv6 || undefined,
      type: connection?.media ? MEDIA[connection.media] ?? connection.media : connection?.type,
      down: connection?.rate_down,
      up: connection?.rate_up,
      maxDown: connection?.bandwidth_down,
      maxUp: connection?.bandwidth_up,
      totalDown: connection?.bytes_down,
      totalUp: connection?.bytes_up,
    },
    temperature: cpu,
  };
}

/** Freebox OS `{ success, result, error_code, msg }`. */
export function freeboxResult<T>(body: unknown): T {
  const b = body as { success?: boolean; result?: T; error_code?: string; msg?: string };
  if (!b?.success) throw new FreeboxError(b?.error_code ?? "unknown", b?.msg ?? "Freebox error");
  return b.result as T;
}

export class FreeboxError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
  }
}

/** `/api_version`'s `api_version: "10.2"` and `api_base_url: "/api/"` → `/api/v10`. */
export function freeboxApiPath(info: { api_version?: string; api_base_url?: string } | undefined): string {
  const major = Number.parseInt(String(info?.api_version ?? "4"), 10) || 4;
  const base = (info?.api_base_url || "/api/").replace(/\/+$/, "");
  return `${base}/v${major}`;
}

/** The login password: hex HMAC-SHA1 of the challenge, keyed with the app token. */
export async function freeboxPassword(appToken: string, challenge: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(appToken), { name: "HMAC", hash: "SHA-1" }, false, [
    "sign",
  ]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(challenge)));
  return [...sig].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const FREEBOX_APP = {
  app_id: "app.backslash.router",
  app_name: "Backslash",
  app_version: "1.0.0",
};

export const PAIRING: Record<string, { label: string; color: Color }> = {
  unknown: { label: "Pairing request expired", color: "red" },
  pending: { label: "Waiting for your answer on the Freebox", color: "yellow" },
  timeout: { label: "No answer on the Freebox in time", color: "red" },
  granted: { label: "Paired", color: "green" },
  denied: { label: "Refused on the Freebox", color: "red" },
};

// ---------------------------------------------------------------------------
// Shared

/** Online first, then by name. */
export function sortClients(clients: Client[]): Client[] {
  const rank = (c: Client) => c.online === true ? 0 : c.online === undefined ? 1 : 2;
  return [...clients].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** "Online", "Wi-Fi", "Wired" or "Offline": the section of a client. */
export function section(c: Client): string {
  if (c.online === false) return "Offline";
  return c.connection === "wifi" ? "Wi-Fi" : "Wired";
}

/** Signal quality for the color: green above −60 dBm, yellow above −72, red below. */
export function signalColor(dbm: number | undefined): Color | undefined {
  if (dbm === undefined) return undefined;
  return dbm >= -60 ? "green" : dbm >= -72 ? "yellow" : "red";
}

export function signalBars(dbm: number | undefined): string {
  if (dbm === undefined) return "";
  const bars = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
  return "▂▄▆█".slice(0, bars) + "▁".repeat(4 - bars);
}

/** Bytes per second as bits: "12.3 Mb/s". */
export function speed(bytesPerSecond: number | undefined): string {
  if (bytesPerSecond === undefined) return "";
  return bits(bytesPerSecond * 8);
}

/** Bits per second: "940 Mb/s", "1.2 Gb/s". */
export function bits(bps: number | undefined): string {
  if (bps === undefined) return "";
  const units = ["b/s", "kb/s", "Mb/s", "Gb/s"];
  let v = bps, i = 0;
  while (v >= 1000 && i < units.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function bytes(n: number | undefined): string {
  if (!n) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Seconds as "3d 4h", "2h 5m", "12m". */
export function duration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const d = Math.floor(seconds / 86400), h = Math.floor(seconds % 86400 / 3600), m = Math.floor(seconds % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** The status line: "23 clients online · ↓ 12 Mb/s ↑ 1.2 Mb/s". */
export function statusLine(router: Router | undefined, clients: Client[]): string {
  const online = clients.filter((c) => c.online !== false).length;
  const parts = [`${online} client${online === 1 ? "" : "s"} online`];
  if (router?.wan.down !== undefined) parts.push(`↓ ${speed(router.wan.down)} ↑ ${speed(router.wan.up)}`);
  if (router && !router.wan.online) parts.push("internet down");
  return parts.join(" · ");
}

/** The kind preference, or a guess from the address. */
export function kindFrom(pref: unknown, base: string): Kind | undefined {
  const k = String(pref ?? "").trim().toLowerCase().replace(/[\s-]/g, "");
  if (k === "openwrt" || k === "luci") return "openwrt";
  if (k === "unifi" || k === "ubiquiti" || k === "unifios") return "unifi";
  if (k === "freebox" || k === "freeboxos") return "freebox";
  if (/mafreebox\.freebox\.fr|freebox/i.test(base)) return "freebox";
  if (/unifi/i.test(base)) return "unifi";
  if (/openwrt/i.test(base)) return "openwrt";
  return undefined;
}
