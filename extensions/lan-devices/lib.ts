// The neighbor table, Avahi (mDNS / DNS-SD) services, nmap and ping output,
// MAC vendors, and merging it all into devices. No I/O here.

import { OUI } from "./oui.ts";

// ---------------------------------------------------------------------------
// Addresses

/** `3C-7C-3F-1A-2B-4C`, `3c7c.3f1a.2b4c` → `3c:7c:3f:1a:2b:4c`; undefined if it isn't one. */
export function normalizeMac(text: string): string | undefined {
  const hex = text.trim().toLowerCase().replace(/[:.-]/g, "");
  if (!/^[0-9a-f]{12}$/.test(hex)) return undefined;
  return hex.match(/../g)!.join(":");
}

const firstByte = (mac: string) => parseInt(mac.slice(0, 2), 16);

/** Locally administered: phones and computers randomize their MAC per network (Private Wi-Fi Address). */
export const isRandomMac = (mac: string) => (firstByte(mac) & 0x02) !== 0;
export const isMulticastMac = (mac: string) => (firstByte(mac) & 0x01) !== 0 || mac === "00:00:00:00:00:00";

export function isIPv4(text: string): boolean {
  const parts = text.split(".");
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

const ipNum = (ip: string) => ip.split(".").reduce((n, p) => n * 256 + Number(p), 0);
const numIp = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** Sorts 192.168.1.9 before 192.168.1.10. */
export const compareIp = (a: string, b: string) =>
  isIPv4(a) && isIPv4(b) ? ipNum(a) - ipNum(b) : Number(isIPv4(b)) - Number(isIPv4(a)) || a.localeCompare(b);

export function inSubnet(ip: string, net: string, prefix: number): boolean {
  if (!isIPv4(ip) || !isIPv4(net)) return false;
  const size = 2 ** (32 - prefix);
  return Math.floor(ipNum(ip) / size) === Math.floor(ipNum(net) / size);
}

/** Link-local IPv6 and the like are not worth a row of their own. */
export const isLinkLocal6 = (ip: string) => /^fe80:/i.test(ip);

// ---------------------------------------------------------------------------
// Vendors

/**
 * The vendor of a MAC address: the system's IEEE list when there is one
 * (`systemDb`, from parseOuiDb), else the bundled table of common ones.
 */
export function vendorOf(mac: string, systemDb?: Map<string, string>): string | undefined {
  if (isRandomMac(mac)) return undefined;
  const prefix = mac.replace(/:/g, "").slice(0, 6).toUpperCase();
  return OUI.get(prefix) ?? (systemDb?.get(prefix) ? shortVendor(systemDb.get(prefix)!) : undefined);
}

/** "Raspberry Pi Trading Ltd" → "Raspberry Pi Trading"; "TP-LINK TECHNOLOGIES CO.,LTD." → "TP-Link Technologies". */
export function shortVendor(name: string): string {
  let n = name.trim()
    .replace(
      /[,.]?\s*\b(inc|ltd|llc|co|corp|corporation|gmbh|ag|sa|sas|bv|b\.v|s\.a|s\.p\.a|pte|pty|plc|limited|company|kg|oy|ab)\b\.?/gi,
      "",
    )
    .replace(/[,.\s]+$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (n === n.toUpperCase() && /[A-Z]{4}/.test(n)) {
    n = n.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bTp-Link\b/i, "TP-Link");
  }
  return n || name.trim();
}

/**
 * The IEEE list in the formats systems install it, keeping only `wanted`
 * prefixes (the file has 30 000 lines):
 * hwdata / ieee-data `oui.txt`: `B8-27-EB   (hex)\t\tRaspberry Pi Foundation`;
 * nmap `nmap-mac-prefixes`: `B827EB Raspberry Pi Foundation`;
 * Wireshark `manuf`: `B8:27:EB\tRaspberryPi\tRaspberry Pi Foundation`.
 */
export function parseOuiDb(text: string, wanted: Set<string>): Map<string, string> {
  const out = new Map<string, string>();
  if (!wanted.size) return out;
  for (const line of text.split("\n")) {
    let m = /^([0-9A-F]{2})-([0-9A-F]{2})-([0-9A-F]{2})\s+\(hex\)\s+(.+)$/i.exec(line);
    if (m) {
      const p = `${m[1]}${m[2]}${m[3]}`.toUpperCase();
      if (wanted.has(p)) out.set(p, m[4].trim());
      continue;
    }
    m = /\(base 16\)/.test(line) ? null : /^([0-9A-F]{6})\s+(.+)$/i.exec(line);
    if (m) {
      const p = m[1].toUpperCase();
      if (wanted.has(p)) out.set(p, m[2].trim());
      continue;
    }
    m = /^([0-9A-F]{2}):([0-9A-F]{2}):([0-9A-F]{2})\t([^\t]+)(?:\t(.+))?$/i.exec(line);
    if (m) {
      const p = `${m[1]}${m[2]}${m[3]}`.toUpperCase();
      if (wanted.has(p)) out.set(p, (m[5] ?? m[4]).trim());
    }
  }
  return out;
}

export const ouiPrefix = (mac: string) => mac.replace(/:/g, "").slice(0, 6).toUpperCase();

// ---------------------------------------------------------------------------
// ip

export interface Neighbor {
  ip: string;
  mac: string;
  dev: string;
  /** reachable, stale, delay, probe, permanent… */
  state: string;
  router: boolean;
}

/** `ip -j neigh`: the hosts this computer talked to recently (IPv4 and IPv6), with their MAC. */
export function parseIpNeigh(json: string): Neighbor[] {
  let rows: { dst?: string; dev?: string; lladdr?: string; state?: string[]; router?: unknown }[];
  try {
    rows = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  return rows.flatMap((r) => {
    const mac = r.lladdr ? normalizeMac(r.lladdr) : undefined;
    const state = (r.state ?? []).map((s) => s.toLowerCase());
    if (!r.dst || !mac || isMulticastMac(mac) || state.some((s) => s === "failed" || s === "incomplete")) return [];
    return [{ ip: r.dst, mac, dev: r.dev ?? "", state: state.join(" ") || "seen", router: r.router !== undefined }];
  });
}

/** `/proc/net/arp`, when `ip` isn't installed. */
export function parseProcArp(text: string): Neighbor[] {
  return text.split("\n").slice(1).flatMap((line) => {
    const [ip, _hw, flags, hw, _mask, dev] = line.trim().split(/\s+/);
    const mac = hw ? normalizeMac(hw) : undefined;
    if (!ip || !mac || flags === "0x0" || isMulticastMac(mac)) return [];
    return [{ ip, mac, dev: dev ?? "", state: "seen", router: false }];
  });
}

export interface Subnet {
  dev: string;
  ip: string;
  prefix: number;
}

/** `ip -j -4 addr`: this computer's IPv4 networks (loopback, Docker and the like left out). */
export function parseAddrs(json: string): Subnet[] {
  let rows: {
    ifname?: string;
    flags?: string[];
    addr_info?: { family?: string; local?: string; prefixlen?: number }[];
  }[];
  try {
    rows = JSON.parse(json || "[]");
  } catch {
    return [];
  }
  return rows.flatMap((r) => {
    if (!r.ifname || /^(lo|docker\d*|br-|veth|virbr|podman|cni|flannel|tailscale|wg|tun|zt)/.test(r.ifname)) return [];
    if (r.flags && !r.flags.includes("UP")) return [];
    return (r.addr_info ?? []).filter((a) => a.family === "inet" && a.local && !a.local.startsWith("127."))
      .map((a) => ({ dev: r.ifname!, ip: a.local!, prefix: a.prefixlen ?? 24 }));
  });
}

/** `ip -j route show default` → the gateways (your router). */
export function parseGateways(json: string): string[] {
  try {
    const rows = JSON.parse(json || "[]") as { gateway?: string }[];
    return [...new Set(rows.flatMap((r) => (r.gateway ? [r.gateway] : [])))];
  } catch {
    return [];
  }
}

/** What a ping sweep covers: the subnet, at most a /24 around this computer (256 addresses). */
export function sweepTarget(s: Subnet): string {
  const prefix = Math.max(24, Math.min(30, s.prefix));
  const size = 2 ** (32 - prefix);
  const base = Math.floor(ipNum(s.ip) / size) * size;
  return `${numIp(base)}/${prefix}`;
}

/** Every host address of a /24 or smaller, for a sweep without nmap. */
export function hostsOf(cidr: string): string[] {
  const [net, p] = cidr.split("/");
  const prefix = Number(p);
  if (!isIPv4(net) || prefix < 24 || prefix > 30) return [];
  const size = 2 ** (32 - prefix);
  const base = Math.floor(ipNum(net) / size) * size;
  return Array.from({ length: size - 2 }, (_, i) => numIp(base + i + 1));
}

// ---------------------------------------------------------------------------
// Avahi

export interface Service {
  iface: string;
  proto: "IPv4" | "IPv6" | string;
  name: string;
  type: string;
  domain: string;
  host: string;
  address: string;
  port: number;
  txt: Record<string, string>;
}

/** Avahi's escapes: `\032` (decimal) for a space, `\.` for a dot in a name. */
export const unescapeAvahi = (s: string) =>
  s.replace(/\\(\d{3})/g, (_, d) => String.fromCharCode(Number(d))).replace(/\\(.)/g, "$1");

/** The TXT field: `"model=MacBookPro18,1" "osxvers=23"` → { model, osxvers }. */
export function parseTxt(field: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of field.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    const entry = unescapeAvahi(m[1]);
    const eq = entry.indexOf("=");
    if (eq > 0) out[entry.slice(0, eq).toLowerCase()] = entry.slice(eq + 1);
    else if (entry) out[entry.toLowerCase()] = "";
  }
  return out;
}

/**
 * `avahi-browse -aprt` resolved lines:
 * `=;wlp2s0;IPv4;Living\032Room;_googlecast._tcp;local;Chromecast-abc.local;192.168.1.30;8009;"fn=Living Room" "md=Chromecast"`.
 */
export function parseAvahi(text: string): Service[] {
  const out: Service[] = [];
  const seen = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line.startsWith("=;")) continue;
    // The TXT field may contain semicolons: split the first nine fields only.
    const parts: string[] = [];
    let rest = line;
    for (let i = 0; i < 9; i++) {
      const j = rest.indexOf(";");
      if (j < 0) {
        parts.push(rest);
        rest = "";
        break;
      }
      parts.push(rest.slice(0, j));
      rest = rest.slice(j + 1);
    }
    const [, iface, proto, name, type, domain, host, address, port] = parts;
    if (!address || !type) continue;
    const key = `${iface}|${proto}|${name}|${type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      iface,
      proto,
      name: unescapeAvahi(name),
      type,
      domain,
      host: unescapeAvahi(host),
      address: address.replace(/%.*$/, ""),
      port: Number(port) || 0,
      txt: parseTxt(rest),
    });
  }
  return out;
}

export interface ServiceInfo {
  label: string;
  /** How to open it in a browser, if it has a web page. */
  web?: "http" | "https";
}

export const SERVICES: Record<string, ServiceInfo> = {
  "_http._tcp": { label: "Web", web: "http" },
  "_https._tcp": { label: "Web", web: "https" },
  "_ssh._tcp": { label: "SSH" },
  "_sftp-ssh._tcp": { label: "SFTP" },
  "_smb._tcp": { label: "SMB" },
  "_afpovertcp._tcp": { label: "AFP" },
  "_nfs._tcp": { label: "NFS" },
  "_webdav._tcp": { label: "WebDAV", web: "http" },
  "_ftp._tcp": { label: "FTP" },
  "_adisk._tcp": { label: "Time Machine" },
  "_ipp._tcp": { label: "Printer" },
  "_ipps._tcp": { label: "Printer" },
  "_printer._tcp": { label: "Printer" },
  "_pdl-datastream._tcp": { label: "Printer" },
  "_uscan._tcp": { label: "Scanner" },
  "_uscans._tcp": { label: "Scanner" },
  "_scanner._tcp": { label: "Scanner" },
  "_googlecast._tcp": { label: "Chromecast" },
  "_airplay._tcp": { label: "AirPlay" },
  "_raop._tcp": { label: "AirPlay audio" },
  "_spotify-connect._tcp": { label: "Spotify Connect" },
  "_sonos._tcp": { label: "Sonos" },
  "_hap._tcp": { label: "HomeKit" },
  "_homekit._tcp": { label: "HomeKit" },
  "_hue._tcp": { label: "Hue" },
  "_matter._tcp": { label: "Matter" },
  "_matterc._udp": { label: "Matter" },
  "_meshcop._udp": { label: "Thread" },
  "_home-assistant._tcp": { label: "Home Assistant", web: "http" },
  "_esphomelib._tcp": { label: "ESPHome" },
  "_mqtt._tcp": { label: "MQTT" },
  "_rfb._tcp": { label: "VNC" },
  "_rdp._tcp": { label: "Remote Desktop" },
  "_workstation._tcp": { label: "Computer" },
  "_device-info._tcp": { label: "Device info" },
  "_companion-link._tcp": { label: "Apple device" },
  "_daap._tcp": { label: "Music sharing" },
  "_plexmediasvr._tcp": { label: "Plex", web: "http" },
  "_octoprint._tcp": { label: "OctoPrint", web: "http" },
  "_amzn-wplay._tcp": { label: "Fire TV" },
  "_androidtvremote2._tcp": { label: "Android TV" },
  "_sleep-proxy._udp": { label: "Sleep proxy" },
  "_kdeconnect._udp": { label: "KDE Connect" },
};

/** Services not worth a pill of their own. */
const QUIET = new Set(["_device-info._tcp", "_sleep-proxy._udp", "_workstation._tcp"]);

export const serviceLabel = (type: string) =>
  SERVICES[type]?.label ?? type.replace(/^_/, "").replace(/\._(tcp|udp)$/, "").toUpperCase();

/** A device's model as its services tell: Chromecast `md`, AirPlay `model`, printers `ty`… */
export function modelOf(services: Service[]): string | undefined {
  for (const s of services) {
    const t = s.txt;
    const model = t.ty ?? t.md ?? t.usb_mdl ??
      (s.type === "_device-info._tcp" || s.type.startsWith("_airplay") ? t.model : undefined) ??
      t.am;
    if (model) return model.replace(/^\s+|\s+$/g, "");
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// nmap, getent, ping

/** `nmap -sn -n -oG - 192.168.1.0/24`: `Host: 192.168.1.1 (router.lan)\tStatus: Up`. */
export function parseNmap(text: string): { ip: string; host?: string }[] {
  return text.split("\n").flatMap((line) => {
    const m = /^Host:\s+(\S+)\s+\(([^)]*)\)\s+Status:\s+Up/.exec(line);
    return m ? [{ ip: m[1], host: m[2] || undefined }] : [];
  });
}

/** `getent hosts 192.168.1.10 …`: `192.168.1.10    nas.local nas`. */
export function parseGetent(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split("\n")) {
    const [ip, name] = line.trim().split(/\s+/);
    if (ip && name && !out.has(ip)) out.set(ip, name);
  }
  return out;
}

export interface PingResult {
  sent: number;
  received: number;
  loss: number;
  min?: number;
  avg?: number;
  max?: number;
}

/** iputils and busybox `ping` summaries. */
export function parsePing(text: string): PingResult | undefined {
  const c = /(\d+) packets transmitted, (\d+) (?:packets )?received(?:, \+\d+ errors)?, ([\d.]+)% packet loss/.exec(
    text,
  );
  if (!c) return undefined;
  const r = /(?:rtt|round-trip) min\/avg\/max(?:\/(?:mdev|stddev))? = ([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(text);
  return {
    sent: Number(c[1]),
    received: Number(c[2]),
    loss: Number(c[3]),
    ...(r ? { min: Number(r[1]), avg: Number(r[2]), max: Number(r[3]) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Devices

export interface Device {
  ip: string;
  ipv6: string[];
  mac?: string;
  vendor?: string;
  randomMac: boolean;
  hostname?: string;
  /** The name it announces (mDNS service name), e.g. "Living Room". */
  label?: string;
  model?: string;
  services: Service[];
  dev?: string;
  state?: string;
  gateway: boolean;
  self: boolean;
  /** Seen by the ping sweep. */
  swept: boolean;
}

export interface Sources {
  neighbors: Neighbor[];
  services: Service[];
  names: Map<string, string>;
  swept: { ip: string; host?: string }[];
  gateways: string[];
  own: Subnet[];
  ouiDb?: Map<string, string>;
}

/** Everything known about each IPv4 address, from every source. */
export function mergeDevices(src: Sources): Device[] {
  const byIp = new Map<string, Device>();
  const macOf6 = new Map<string, string>();
  const get = (ip: string) => {
    let d = byIp.get(ip);
    if (!d) {
      d = { ip, ipv6: [], randomMac: false, services: [], gateway: false, self: false, swept: false };
      byIp.set(ip, d);
    }
    return d;
  };

  for (const n of src.neighbors) {
    if (!isIPv4(n.ip)) {
      macOf6.set(n.ip, n.mac);
      continue;
    }
    const d = get(n.ip);
    d.mac = n.mac;
    d.dev = n.dev;
    d.state = n.state;
  }
  // IPv6 neighbors join the IPv4 device with the same MAC.
  const byMac = new Map([...byIp.values()].flatMap((d) => (d.mac ? [[d.mac, d] as [string, Device]] : [])));
  for (const [ip6, mac] of macOf6) {
    const d = byMac.get(mac);
    if (d && !isLinkLocal6(ip6)) d.ipv6.push(ip6);
  }

  for (const s of src.services) {
    if (isIPv4(s.address)) {
      const d = get(s.address);
      d.services.push(s);
      d.hostname ??= s.host || undefined;
      d.dev ??= s.iface;
    }
  }
  // IPv6-only announcements: by host name, then by MAC.
  for (const s of src.services) {
    if (isIPv4(s.address)) continue;
    const d = [...byIp.values()].find((x) => x.hostname && x.hostname === s.host) ??
      (macOf6.get(s.address) ? byMac.get(macOf6.get(s.address)!) : undefined);
    if (d && !d.services.some((x) => x.type === s.type && x.name === s.name)) d.services.push(s);
  }

  for (const h of src.swept) {
    const d = get(h.ip);
    d.swept = true;
    if (h.host) d.hostname ??= h.host;
  }
  for (const [ip, name] of src.names) if (byIp.has(ip)) byIp.get(ip)!.hostname ??= name;
  for (const g of src.gateways) if (byIp.has(g)) byIp.get(g)!.gateway = true;
  for (const s of src.own) {
    if (byIp.has(s.ip)) {
      const d = byIp.get(s.ip)!;
      d.self = true;
      d.dev ??= s.dev;
    }
  }

  for (const d of byIp.values()) {
    if (d.mac) {
      d.randomMac = isRandomMac(d.mac);
      d.vendor = vendorOf(d.mac, src.ouiDb);
    }
    d.model = modelOf(d.services);
    d.label = d.services.find((s) => !QUIET.has(s.type) && s.name)?.name ?? d.services[0]?.name;
  }
  // Keep only the local networks (Avahi can announce Docker or VPN addresses).
  const local = (ip: string) => !src.own.length || src.own.some((s) => inSubnet(ip, s.ip, s.prefix));
  return [...byIp.values()].filter((d) => local(d.ip)).sort((a, b) => compareIp(a.ip, b.ip));
}

export type Kind =
  | "router"
  | "printer"
  | "tv"
  | "speaker"
  | "phone"
  | "computer"
  | "nas"
  | "camera"
  | "smart"
  | "this"
  | "device";

/** A guess at what the device is, for its icon. */
export function kindOf(d: Device): Kind {
  if (d.self) return "this";
  if (d.gateway) return "router";
  const types = new Set(d.services.map((s) => s.type));
  const v = (d.vendor ?? "").toLowerCase();
  const m = `${d.model ?? ""} ${d.label ?? ""} ${d.hostname ?? ""}`.toLowerCase();
  if (
    types.has("_ipp._tcp") || types.has("_ipps._tcp") || types.has("_printer._tcp") || types.has("_pdl-datastream._tcp")
  ) {
    return "printer";
  }
  if (
    types.has("_googlecast._tcp") || types.has("_amzn-wplay._tcp") || types.has("_androidtvremote2._tcp") ||
    /\btv\b|roku|shield/.test(m) || v === "roku"
  ) {
    return "tv";
  }
  if (
    types.has("_raop._tcp") || types.has("_spotify-connect._tcp") || types.has("_sonos._tcp") ||
    /sonos|bose|homepod|echo/.test(`${v} ${m}`)
  ) {
    return "speaker";
  }
  if (types.has("_adisk._tcp") || /synology|qnap|western digital/.test(v) || /\bnas\b|diskstation/.test(m)) {
    return "nas";
  }
  if (/hikvision|reolink/.test(v) || /\bcam(era)?\b/.test(m)) return "camera";
  if (
    types.has("_hap._tcp") || types.has("_hue._tcp") || types.has("_esphomelib._tcp") || types.has("_matter._tcp") ||
    /espressif|philips hue|shelly|tuya/.test(v)
  ) {
    return "smart";
  }
  if (/iphone|ipad|android|pixel|galaxy|oneplus|phone/.test(m)) return "phone";
  if (
    types.has("_ssh._tcp") || types.has("_workstation._tcp") || types.has("_rfb._tcp") || types.has("_smb._tcp") ||
    types.has("_rdp._tcp") ||
    /raspberry|intel|dell|lenovo|qemu|vmware|virtualbox/.test(v) || /macbook|imac|mac mini|desktop|laptop/.test(m)
  ) {
    return "computer";
  }
  return "device";
}

/** The name in the row: what it announces, its host name, else its address. */
export function displayName(d: Device): string {
  if (d.label) return d.label;
  if (d.hostname) return d.hostname.replace(/\.(local|lan|home|home\.arpa|localdomain|fritz\.box)\.?$/i, "");
  return d.ip;
}

/** The web page to open: an announced HTTP service (port, path), else http://ip. */
export function webUrl(d: Device): string {
  const s = d.services.find((x) => SERVICES[x.type]?.web && isIPv4(x.address));
  if (!s) return `http://${d.ip}/`;
  const scheme = SERVICES[s.type].web!;
  const defaultPort = scheme === "https" ? 443 : 80;
  const path = s.txt.path ? (s.txt.path.startsWith("/") ? s.txt.path : `/${s.txt.path}`) : "/";
  return `${scheme}://${d.ip}${s.port && s.port !== defaultPort ? `:${s.port}` : ""}${path}`;
}

/** Pills for the row: the services that say what it does, once each. */
export function serviceTags(d: Device, max = 3): string[] {
  const labels = [...new Set(d.services.filter((s) => !QUIET.has(s.type)).map((s) => serviceLabel(s.type)))];
  return labels.slice(0, max);
}

export const hasService = (d: Device, type: string) => d.services.some((s) => s.type === type);
