// MAC addresses, magic packets, the neighbor table and saved machines. No I/O here.

/**
 * `aa:bb:cc:dd:ee:ff`, `AA-BB-CC-DD-EE-FF`, `aabb.ccdd.eeff` (Cisco) or
 * `aabbccddeeff` → its six bytes. Throws a readable error otherwise.
 */
export function parseMac(text: string): Uint8Array {
  const t = text.trim();
  let hex: string | undefined;
  if (/^[0-9a-f]{1,2}([:-])[0-9a-f]{1,2}(\1[0-9a-f]{1,2}){4}$/i.test(t)) {
    hex = t.split(/[:-]/).map((p) => p.padStart(2, "0")).join("");
  } else if (/^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i.test(t)) hex = t.replace(/\./g, "");
  else if (/^[0-9a-f]{12}$/i.test(t)) hex = t;
  if (!hex) throw new Error(`“${t}” is not a MAC address (like 3c:7c:3f:1a:2b:4c)`);
  const bytes = new Uint8Array(6);
  for (let i = 0; i < 6; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** `3c:7c:3f:1a:2b:4c`, lower case. */
export function formatMac(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(":");
}

export const normalizeMac = (text: string) => formatMac(parseMac(text));

export function isBroadcastMac(bytes: Uint8Array): boolean {
  return bytes.every((b) => b === 0xff) || bytes.every((b) => b === 0) || (bytes[0] & 1) === 1;
}

/**
 * The magic packet: six 0xFF bytes, then the MAC sixteen times (102 bytes),
 * followed by the 4- or 6-byte SecureOn password when there is one.
 */
export function magicPacket(mac: string | Uint8Array, secureOn?: string): Uint8Array {
  const bytes = typeof mac === "string" ? parseMac(mac) : mac;
  const password = secureOn?.trim() ? parseSecureOn(secureOn) : new Uint8Array();
  const packet = new Uint8Array(6 + 16 * 6 + password.length);
  packet.fill(0xff, 0, 6);
  for (let i = 0; i < 16; i++) packet.set(bytes, 6 + i * 6);
  packet.set(password, 102);
  return packet;
}

/** A SecureOn password: six bytes written like a MAC, or four like an IPv4 address. */
export function parseSecureOn(text: string): Uint8Array {
  const t = text.trim();
  const ip = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(t);
  if (ip) return new Uint8Array(ip.slice(1).map(Number));
  try {
    return parseMac(t);
  } catch {
    throw new Error("A SecureOn password is 6 bytes like a MAC address (00:11:22:33:44:55)");
  }
}

export function isIPv4(text: string): boolean {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** The broadcast address of `ip`/`prefix`: 192.168.1.20/24 → 192.168.1.255. */
export function broadcastOf(ip: string, prefix: number): string {
  const n = ip.split(".").reduce((acc, p) => acc * 256 + Number(p), 0);
  const host = prefix >= 32 ? 0 : 2 ** (32 - prefix) - 1;
  const b = (n - (n % (host + 1))) + host;
  return [24, 16, 8, 0].map((s) => Math.floor(b / 2 ** s) % 256).join(".");
}

// ---------------------------------------------------------------------------
// Neighbor table

export interface Neighbor {
  ip: string;
  mac: string;
  dev: string;
  state: string;
}

/** `ip -j neigh`: hosts this computer talked to recently, with their MAC. */
export function parseIpNeigh(json: string): Neighbor[] {
  const rows = JSON.parse(json || "[]") as { dst?: string; dev?: string; lladdr?: string; state?: string[] }[];
  return rows.filter((r) => r.dst && r.lladdr && !(r.state ?? []).some((s) => s === "FAILED" || s === "INCOMPLETE"))
    .flatMap((r) => {
      try {
        const bytes = parseMac(r.lladdr!);
        if (isBroadcastMac(bytes)) return [];
        return [{
          ip: r.dst!,
          mac: formatMac(bytes),
          dev: r.dev ?? "",
          state: (r.state ?? []).join(" ").toLowerCase(),
        }];
      } catch {
        return [];
      }
    });
}

/** `/proc/net/arp`, when `ip` isn't installed. */
export function parseProcArp(text: string): Neighbor[] {
  return text.split("\n").slice(1).flatMap((line) => {
    const [ip, _hw, flags, mac, _mask, dev] = line.trim().split(/\s+/);
    if (!ip || !mac || flags === "0x0") return [];
    try {
      const bytes = parseMac(mac);
      if (isBroadcastMac(bytes)) return [];
      return [{ ip, mac: formatMac(bytes), dev: dev ?? "", state: "reachable" }];
    } catch {
      return [];
    }
  });
}

/** IPv4 first, then by address; one row per MAC (its IPv4 address when it has one). */
export function dedupeNeighbors(list: Neighbor[]): Neighbor[] {
  const byMac = new Map<string, Neighbor>();
  for (const n of list) {
    const seen = byMac.get(n.mac);
    if (!seen || (!isIPv4(seen.ip) && isIPv4(n.ip))) byMac.set(n.mac, n);
  }
  return [...byMac.values()].sort((a, b) =>
    Number(isIPv4(b.ip)) - Number(isIPv4(a.ip)) || ipKey(a.ip).localeCompare(ipKey(b.ip))
  );
}

const ipKey = (ip: string) => isIPv4(ip) ? ip.split(".").map((p) => p.padStart(3, "0")).join(".") : ip;

/** `ip -j addr`: the broadcast address of each interface's IPv4 network. */
export function parseBroadcasts(json: string): Record<string, string> {
  const rows = JSON.parse(json || "[]") as {
    ifname?: string;
    addr_info?: { family?: string; local?: string; prefixlen?: number; broadcast?: string }[];
  }[];
  const out: Record<string, string> = {};
  for (const r of rows) {
    const inet = r.addr_info?.find((a) => a.family === "inet" && a.local && a.local !== "127.0.0.1");
    if (!r.ifname || !inet) continue;
    out[r.ifname] = inet.broadcast ?? broadcastOf(inet.local!, inet.prefixlen ?? 24);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Machines

export interface Machine {
  id: string;
  name: string;
  mac: string;
  broadcast: string;
  port: number;
  /** A name or address to check whether it is up. */
  host?: string;
  secureOn?: string;
  lastWoken?: number;
}

export const DEFAULT_BROADCAST = "255.255.255.255";

/** Form values → a machine, or a sentence saying what is wrong. */
export function machineFromForm(
  values: Record<string, string | boolean>,
  id: string,
  previous?: Machine,
): Machine {
  const name = String(values.name ?? "").trim();
  if (!name) throw new Error("Give the machine a name");
  const mac = normalizeMac(String(values.mac ?? ""));
  if (isBroadcastMac(parseMac(mac))) throw new Error("That is a broadcast or multicast MAC, not a computer's");
  const broadcast = String(values.broadcast ?? "").trim() || DEFAULT_BROADCAST;
  if (!isIPv4(broadcast)) throw new Error(`“${broadcast}” is not an IPv4 broadcast address (like 192.168.1.255)`);
  const portText = String(values.port ?? "").trim() || "9";
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The port is a number from 1 to 65535");
  const host = String(values.host ?? "").trim() || undefined;
  if (host && !/^[\w.-]+$|^\[?[0-9a-f:]+\]?$/i.test(host)) throw new Error(`“${host}” is not a host name or address`);
  const secureOn = String(values.secureOn ?? "").trim() || undefined;
  if (secureOn) parseSecureOn(secureOn);
  return { id, name, mac, broadcast, port, host, secureOn, lastWoken: previous?.lastWoken };
}

/** Programs that send magic packets, tried when Deno can't, with their arguments. */
export const PROGRAMS = ["wakeonlan", "wol", "etherwake"] as const;

export function programArgs(program: (typeof PROGRAMS)[number], m: Machine): string[] {
  switch (program) {
    case "wakeonlan":
      return ["-i", m.broadcast, "-p", String(m.port), m.mac];
    case "wol":
      return ["-i", m.broadcast, "-p", String(m.port), ...(m.secureOn ? [`--passwd=${m.secureOn}`] : []), m.mac];
    case "etherwake":
      // Raw Ethernet frame: needs root or CAP_NET_RAW, ignores the port.
      return ["-b", ...(m.secureOn ? ["-p", m.secureOn] : []), m.mac];
  }
}

/** Ports tried to see whether a machine is up: SSH, RDP, SMB, HTTP, VNC. A refused connection counts as up. */
export const PROBE_PORTS = [22, 3389, 445, 80, 5900];

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

/** A unique id for a new machine. */
export const newId = (mac: string) => `${mac.replace(/:/g, "")}-${Date.now().toString(36)}`;
