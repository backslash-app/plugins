// Parsing what network programs and services answer, and what the user typed.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Addresses and hosts

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export const isIPv4 = (s: string) => IPV4.test(s);

export function isIPv6(s: string): boolean {
  if (!/^[0-9a-f:.]+$/i.test(s) || !s.includes(":")) return false;
  const v4tail = s.match(/:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4tail && !isIPv4(v4tail[1])) return false;
  const body = v4tail ? s.slice(0, -v4tail[1].length) + "0:0" : s;
  const halves = body.split("::");
  if (halves.length > 2) return false;
  const groups = halves.flatMap((h) => (h ? h.split(":") : []));
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return false;
  return halves.length === 2 ? groups.length < 8 : groups.length === 8;
}

export const isIP = (s: string) => isIPv4(s) || isIPv6(s);

/** A host name: labels of letters, digits and hyphens, not starting with one (no option injection). */
export function isHostname(s: string): boolean {
  if (s.length > 253 || !s.includes(".") && s !== "localhost") return false;
  return s.replace(/\.$/, "").split(".").every((l) => /^(?!-)[a-z0-9_-]{1,63}(?<!-)$/i.test(l)) &&
    !/^\d+(\.\d+)*$/.test(s);
}

/** "https://www.example.com/path" → "www.example.com"; undefined when it's not a host or an IP. */
export function cleanHost(input: string): string | undefined {
  let s = input.trim();
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = new URL(s).hostname;
  } catch {
    return undefined;
  }
  s = s.replace(/^\[|\]$/g, "").replace(/\/.*$/, "");
  if (!isIPv6(s)) s = s.replace(/:\d+$/, "");
  s = s.toLowerCase();
  return isIP(s) || isHostname(s) ? s : undefined;
}

/** 192.0.2.10 → private, loopback… (undefined for public addresses). */
export function addressScope(ip: string): string | undefined {
  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 127) return "Loopback";
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "Private";
    if (a === 169 && b === 254) return "Link-local";
    if (a === 100 && b >= 64 && b <= 127) return "Carrier-grade NAT";
    if (a === 192 && b === 0) return "Documentation";
    return undefined;
  }
  const l = ip.toLowerCase();
  if (l === "::1") return "Loopback";
  if (/^fe[89ab]/.test(l)) return "Link-local";
  if (/^f[cd]/.test(l)) return "Unique local";
  return undefined;
}

/** The PTR name of an address: 1.2.3.4 → 4.3.2.1.in-addr.arpa. */
export function reverseName(ip: string): string {
  if (isIPv4(ip)) return `${ip.split(".").reverse().join(".")}.in-addr.arpa`;
  return `${expandIPv6(ip).replace(/:/g, "").split("").reverse().join(".")}.ip6.arpa`;
}

export function expandIPv6(ip: string): string {
  const [head, tail = ""] = ip.toLowerCase().split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") ? (tail ? tail.split(":") : []) : [];
  const fill = ip.includes("::") ? Array(8 - h.length - t.length).fill("0") : [];
  return [...h, ...fill, ...t].map((g) => g.padStart(4, "0")).join(":");
}

// ---------------------------------------------------------------------------
// What the user typed

export const RECORD_TYPES = ["A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "CAA", "SRV", "PTR"] as const;
export type RecordType = typeof RECORD_TYPES[number];

export type Intent =
  | { kind: "home" }
  | { kind: "ip" }
  | { kind: "interfaces" }
  | { kind: "speed" }
  | { kind: "dns"; host: string; types: RecordType[] }
  | { kind: "ping"; host: string }
  | { kind: "whois"; host: string }
  | { kind: "host"; host: string }
  | { kind: "invalid"; tool: "dns" | "ping" | "whois"; text: string };

/** "dns example.com mx", "ping 1.1.1.1", "whois x.org", "speed", "ip", or a bare host. */
export function parseIntent(query: string): Intent {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { kind: "home" };
  const [first, ...rest] = words;
  const cmd = first.toLowerCase();
  if (/^(?:ip|myip|my-ip|public|publicip|ipv4|ipv6|wan)$/.test(cmd) && !rest.length) return { kind: "ip" };
  if (/^(?:interfaces?|ifconfig|addr|local|lan|nic|interfaces?réseau)$/.test(cmd) && !rest.length) {
    return { kind: "interfaces" };
  }
  if (/^(?:speed|speedtest|speed-test|débit|debit|bandwidth)$/.test(cmd)) return { kind: "speed" };
  if (/^(?:dns|dig|nslookup|lookup|host|resolve)$/.test(cmd)) {
    const host = rest[0] ? cleanHost(rest[0]) : undefined;
    if (!host) return { kind: "invalid", tool: "dns", text: rest.join(" ") };
    const types = rest.slice(1).map((t) => t.toUpperCase()).filter((t): t is RecordType =>
      (RECORD_TYPES as readonly string[]).includes(t)
    );
    return { kind: "dns", host, types: types.length ? types : isIP(host) ? ["PTR"] : defaultTypes };
  }
  if (/^(?:ping|latency|latence)$/.test(cmd)) {
    const host = rest[0] ? cleanHost(rest[0]) : undefined;
    return host ? { kind: "ping", host } : { kind: "invalid", tool: "ping", text: rest.join(" ") };
  }
  if (/^(?:whois|rdap|registrar)$/.test(cmd)) {
    const host = rest[0] ? cleanHost(rest[0]) : undefined;
    return host ? { kind: "whois", host } : { kind: "invalid", tool: "whois", text: rest.join(" ") };
  }
  const host = words.length === 1 ? cleanHost(first) : undefined;
  if (host) return { kind: "host", host };
  return { kind: "home" };
}

export const defaultTypes: RecordType[] = ["A", "AAAA", "CNAME", "MX", "NS", "TXT"];

// ---------------------------------------------------------------------------
// DNS over HTTPS (application/dns-json)

const TYPE_NUMBERS: Record<number, string> = {
  1: "A",
  2: "NS",
  5: "CNAME",
  6: "SOA",
  12: "PTR",
  15: "MX",
  16: "TXT",
  28: "AAAA",
  33: "SRV",
  65: "HTTPS",
  257: "CAA",
};

export const RCODES: Record<number, string> = {
  0: "NOERROR",
  1: "FORMERR",
  2: "SERVFAIL",
  3: "NXDOMAIN",
  4: "NOTIMP",
  5: "REFUSED",
};

export interface DnsRecord {
  name: string;
  type: string;
  ttl: number;
  data: string;
  /** MX preference, SRV priority. */
  priority?: number;
}

export interface DnsAnswer {
  type: RecordType;
  status: string;
  records: DnsRecord[];
}

/** TXT data comes quoted, sometimes in several chunks: "v=spf1 " "include:…". */
export function unquoteTxt(data: string): string {
  const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\(.)/g, "$1"));
  return chunks.length ? chunks.join("") : data;
}

export function parseDoh(type: RecordType, json: unknown): DnsAnswer {
  const j = json as { Status?: number; Answer?: { name: string; type: number; TTL: number; data: string }[] };
  const records = (j.Answer ?? []).map((a): DnsRecord => {
    const t = TYPE_NUMBERS[a.type] ?? String(a.type);
    let data = a.data;
    let priority: number | undefined;
    if (t === "TXT") data = unquoteTxt(data);
    if (t === "MX") {
      const m = data.match(/^(\d+)\s+(.*)$/);
      if (m) [priority, data] = [Number(m[1]), m[2]];
    }
    return {
      name: a.name.replace(/\.$/, ""),
      type: t,
      ttl: a.TTL,
      data: t === "TXT" ? data : data.replace(/\.$/, ""),
      ...(priority !== undefined ? { priority } : {}),
    };
  });
  // CNAMEs come along with the A answers; keep only what was asked, CNAMEs stay for CNAME.
  return {
    type,
    status: RCODES[j.Status ?? 0] ?? `RCODE ${j.Status}`,
    records: records.filter((r) => r.type === type).sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)),
  };
}

/** `dig +noall +answer example.com MX` lines → records. */
export function parseDig(type: RecordType, out: string): DnsAnswer {
  const records = out.split("\n").flatMap((line): DnsRecord[] => {
    const m = line.trim().match(/^(\S+)\s+(\d+)\s+IN\s+(\S+)\s+(.*)$/);
    if (!m || m[3] !== type) return [];
    let data = m[4].trim();
    let priority: number | undefined;
    if (type === "TXT") data = unquoteTxt(data);
    if (type === "MX") {
      const p = data.match(/^(\d+)\s+(.*)$/);
      if (p) [priority, data] = [Number(p[1]), p[2]];
    }
    return [{
      name: m[1].replace(/\.$/, ""),
      type,
      ttl: Number(m[2]),
      data: type === "TXT" ? data : data.replace(/\.$/, ""),
      ...(priority !== undefined ? { priority } : {}),
    }];
  });
  const status = out.match(/status:\s*(\w+)/)?.[1] ?? "NOERROR";
  return { type, status, records: records.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)) };
}

export function formatTtl(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} d`;
}

// ---------------------------------------------------------------------------
// Ping

export interface PingReply {
  seq: number;
  ttl?: number;
  time: number;
}

export interface PingStats {
  host: string;
  address?: string;
  replies: PingReply[];
  transmitted?: number;
  received?: number;
  /** 0 to 100. */
  loss?: number;
  min?: number;
  avg?: number;
  max?: number;
  mdev?: number;
  errors: string[];
}

/** iputils, inetutils and BusyBox ping output (complete or partial, as it streams). */
export function parsePing(host: string, out: string): PingStats {
  const s: PingStats = { host, replies: [], errors: [] };
  for (const line of out.split("\n")) {
    const head = line.match(/^PING\s+(\S+)\s+\(([^)]+)\)/);
    if (head) s.address = head[2];
    const reply = line.match(/icmp_[sr]eq=(\d+)(?:.*?ttl=(\d+))?.*?time[=<]([\d.]+)\s*ms/i);
    if (reply) {
      s.replies.push({ seq: Number(reply[1]), ttl: reply[2] ? Number(reply[2]) : undefined, time: Number(reply[3]) });
    }
    const sum = line.match(
      /(\d+) packets transmitted, (\d+) (?:packets )?received(?:, \+\d+ errors)?, ([\d.]+)% packet loss/,
    );
    if (sum) [s.transmitted, s.received, s.loss] = [Number(sum[1]), Number(sum[2]), Number(sum[3])];
    const rtt = line.match(
      /(?:rtt|round-trip) min\/avg\/max(?:\/(?:mdev|stddev))? = ([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))?/,
    );
    if (rtt) {
      [s.min, s.avg, s.max] = [Number(rtt[1]), Number(rtt[2]), Number(rtt[3])];
      if (rtt[4]) s.mdev = Number(rtt[4]);
    }
    const err = line.match(
      /(Destination (?:Host|Net) Unreachable|Request timeout|Name or service not known|Temporary failure in name resolution|unknown host|Network is unreachable)/i,
    );
    if (err && !s.errors.includes(err[1])) s.errors.push(err[1]);
  }
  // Partial output: statistics from the replies so far.
  if (s.avg === undefined && s.replies.length) {
    const times = s.replies.map((r) => r.time);
    s.min = Math.min(...times);
    s.max = Math.max(...times);
    s.avg = times.reduce((a, b) => a + b, 0) / times.length;
  }
  return s;
}

export function latencyQuality(ms: number | undefined): { text: string; color: "green" | "yellow" | "orange" | "red" } {
  if (ms === undefined) return { text: "No answer", color: "red" };
  if (ms < 30) return { text: "Excellent", color: "green" };
  if (ms < 80) return { text: "Good", color: "green" };
  if (ms < 150) return { text: "Fair", color: "yellow" };
  return { text: "Slow", color: "orange" };
}

export const ms = (
  v: number | undefined,
) => (v === undefined ? "–" : v < 10 ? `${v.toFixed(2)} ms` : `${v.toFixed(1)} ms`);

// ---------------------------------------------------------------------------
// Whois

export interface Whois {
  fields: { label: string; value: string }[];
  nameServers: string[];
  statuses: string[];
  raw: string;
}

const WHOIS_FIELDS: [string, RegExp][] = [
  ["Domain", /^(?:domain name|domain)$/i],
  ["Registrar", /^(?:registrar|sponsoring registrar|registrar name)$/i],
  ["Registrant", /^(?:registrant organization|registrant|org|organisation|orgname|org-name|owner)$/i],
  ["Created", /^(?:creation date|created|registered on|registration time|domain registration date|regdate)$/i],
  ["Updated", /^(?:updated date|last updated|last-update|changed|last modified|updated)$/i],
  [
    "Expires",
    /^(?:registry expiry date|registrar registration expiration date|expiry date|expiration date|expires|paid-till|expire date)$/i,
  ],
  ["Country", /^(?:registrant country|country)$/i],
  ["Network", /^(?:netname|net-name)$/i],
  ["Range", /^(?:cidr|inetnum|netrange|inet6num|route)$/i],
  ["ASN", /^(?:originas|origin|aut-num)$/i],
  ["Abuse", /^(?:orgabuseemail|abuse-mailbox|registrar abuse contact email)$/i],
  ["DNSSEC", /^dnssec$/i],
];

/** The useful lines of `whois` output, first value of each kind. */
export function parseWhois(raw: string): Whois {
  const fields = new Map<string, string>();
  const ns = new Set<string>();
  const statuses = new Set<string>();
  for (const line of raw.split("\n")) {
    if (/^\s*[%#>]/.test(line)) continue;
    const m = line.match(/^\s*([A-Za-z][\w /.-]*?)\s*:\s*(.+?)\s*$/);
    if (!m) continue;
    const [, key, value] = m;
    if (/^(?:name server|nserver|nameservers?|name servers)$/i.test(key)) {
      ns.add(value.split(/\s+/)[0].toLowerCase().replace(/\.$/, ""));
      continue;
    }
    if (/^(?:domain status|status)$/i.test(key)) {
      statuses.add(value.split(/\s+/)[0]);
      continue;
    }
    for (const [label, re] of WHOIS_FIELDS) {
      if (re.test(key) && !fields.has(label) && !/redacted|not disclosed/i.test(value)) fields.set(label, value);
    }
  }
  return {
    fields: [...fields].map(([label, value]) => ({ label, value })),
    nameServers: [...ns],
    statuses: [...statuses],
    raw: raw.trim(),
  };
}

/** Days until the expiry date, if there is one and it parses. */
export function daysUntil(dateText: string | undefined, now = Date.now()): number | undefined {
  if (!dateText) return undefined;
  const t = Date.parse(dateText.replace(/^(\d{4})\.(\d{2})\.(\d{2})/, "$1-$2-$3"));
  return Number.isNaN(t) ? undefined : Math.floor((t - now) / 86400000);
}

/** "2026-03-01T12:00:00Z" → "1 Mar 2026"; anything else as is. */
export function shortDate(text: string): string {
  const t = Date.parse(text);
  return Number.isNaN(t)
    ? text
    : new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

// ---------------------------------------------------------------------------
// Public IP and geolocation (ipinfo.io)

export interface Geo {
  ip: string;
  hostname?: string;
  city?: string;
  region?: string;
  country?: string;
  loc?: { lat: number; lon: number };
  org?: string;
  asn?: string;
  postal?: string;
  timezone?: string;
}

export function parseIpinfo(json: unknown): Geo {
  const j = json as Record<string, string | undefined>;
  const [lat, lon] = (j.loc ?? "").split(",").map(Number);
  const org = j.org?.match(/^(AS\d+)\s+(.*)$/);
  return {
    ip: String(j.ip ?? ""),
    hostname: j.hostname || undefined,
    city: j.city || undefined,
    region: j.region || undefined,
    country: j.country || undefined,
    loc: Number.isFinite(lat) && Number.isFinite(lon) && j.loc ? { lat, lon } : undefined,
    org: org ? org[2] : j.org || undefined,
    asn: org ? org[1] : undefined,
    postal: j.postal || undefined,
    timezone: j.timezone || undefined,
  };
}

/** "FR" → "🇫🇷 France". */
export function countryName(code: string | undefined): string | undefined {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return code;
  const flag = [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
  let name = code.toUpperCase();
  try {
    name = new Intl.DisplayNames(["en"], { type: "region" }).of(name) ?? name;
  } catch {
    // Keep the code.
  }
  return `${flag} ${name}`;
}

export const place = (g: Geo) =>
  [g.city, g.region !== g.city ? g.region : undefined, g.country].filter(Boolean).join(", ");

// ---------------------------------------------------------------------------
// Local interfaces (`ip -j -s addr`, `ip -j route`)

export interface Address {
  family: "inet" | "inet6";
  address: string;
  prefix: number;
  scope: string;
}

export interface Interface {
  name: string;
  state: string;
  up: boolean;
  mac?: string;
  mtu: number;
  kind: "loopback" | "ethernet" | "wifi" | "vpn" | "bridge" | "virtual" | "other";
  addresses: Address[];
  rx?: number;
  tx?: number;
  gateway?: string;
  isDefault?: boolean;
}

export function interfaceKind(name: string, linkType: string | undefined): Interface["kind"] {
  if (linkType === "loopback" || name === "lo") return "loopback";
  if (/^(wl|wlan|wifi)/.test(name)) return "wifi";
  if (/^(tun|tap|wg|tailscale|ppp|nordlynx|proton|mullvad|vpn|zt)/.test(name) || linkType === "none") return "vpn";
  if (/^(br|virbr|docker|cni|podman|lxc|lxd)/.test(name)) return "bridge";
  if (/^(veth|vnet|ifb|dummy|vxlan|bond)/.test(name)) return "virtual";
  if (/^(en|eth|em|eno|ens|enp|usb)/.test(name)) return "ethernet";
  return "other";
}

export function parseInterfaces(addrJson: string, routeJson = "[]"): Interface[] {
  const links = JSON.parse(addrJson || "[]") as {
    ifname: string;
    flags?: string[];
    mtu: number;
    operstate?: string;
    link_type?: string;
    address?: string;
    addr_info?: { family: string; local: string; prefixlen: number; scope: string }[];
    stats64?: { rx?: { bytes: number }; tx?: { bytes: number } };
  }[];
  const routes = JSON.parse(routeJson || "[]") as { dst: string; gateway?: string; dev?: string; metric?: number }[];
  const defaults = routes.filter((r) => r.dst === "default").sort((a, b) => (a.metric ?? 0) - (b.metric ?? 0));
  return links.map((l): Interface => {
    const def = defaults.find((r) => r.dev === l.ifname);
    const up = (l.flags ?? []).includes("UP") && (l.flags ?? []).includes("LOWER_UP");
    return {
      name: l.ifname,
      state: (l.operstate ?? "UNKNOWN").toLowerCase(),
      up,
      mac: l.address && l.address !== "00:00:00:00:00:00" && l.link_type === "ether" ? l.address : undefined,
      mtu: l.mtu,
      kind: interfaceKind(l.ifname, l.link_type),
      addresses: (l.addr_info ?? []).filter((a) => a.family === "inet" || a.family === "inet6").map((a) => ({
        family: a.family as Address["family"],
        address: a.local,
        prefix: a.prefixlen,
        scope: a.scope,
      })),
      rx: l.stats64?.rx?.bytes,
      tx: l.stats64?.tx?.bytes,
      gateway: def?.gateway,
      isDefault: def ? def === defaults[0] : undefined,
    };
  });
}

/** Interfaces worth showing first: the default route, then up ones with addresses, loopback last. */
export function rankInterfaces(list: Interface[]): Interface[] {
  const score = (i: Interface) =>
    i.isDefault ? 0 : i.kind === "loopback" ? 4 : i.up && i.addresses.length ? 1 : i.up ? 2 : 3;
  return [...list].sort((a, b) => score(a) - score(b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Speed test

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** Bits per second, readable: "94.3 Mbit/s". */
export function formatSpeed(bps: number): string {
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(2)} Gbit/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(bps >= 1e8 ? 0 : 1)} Mbit/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} kbit/s`;
  return `${Math.round(bps)} bit/s`;
}

/** The 90th percentile of per-request speeds, as Cloudflare's own test reports. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export const median = (values: number[]) => percentile(values, 0.5);

/** Mean absolute difference between consecutive latencies. */
export function jitter(latencies: number[]): number {
  if (latencies.length < 2) return 0;
  let sum = 0;
  for (let i = 1; i < latencies.length; i++) sum += Math.abs(latencies[i] - latencies[i - 1]);
  return sum / (latencies.length - 1);
}

/**
 * The server's own processing time from its `Server-Timing: cfRequestDuration;dur=12.3`
 * header, subtracted from the measured time to leave the network part.
 */
export function serverTime(header: string | null): number {
  const m = header?.match(/dur=([\d.]+)/);
  return m ? Number(m[1]) : 0;
}

/** Download sizes, growing, cut when a step takes long enough to be meaningful. */
export const DOWNLOAD_STEPS = [100_000, 1_000_000, 10_000_000, 25_000_000, 100_000_000];
export const UPLOAD_STEPS = [100_000, 1_000_000, 10_000_000, 25_000_000];

export function speedVerdict(downBps: number): string {
  const mbps = downBps / 1e6;
  if (mbps >= 300) return "Fast enough for anything, several 4K streams at once";
  if (mbps >= 50) return "Great for 4K streaming and large downloads";
  if (mbps >= 15) return "Good for HD video calls and streaming";
  if (mbps >= 5) return "Fine for browsing and HD streaming";
  return "Slow: browsing works, video may stutter";
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

const PACKAGES: Record<string, Record<Family, string>> = {
  whois: { arch: "whois", debian: "whois", fedora: "whois", suse: "whois" },
  ping: { arch: "iputils", debian: "iputils-ping", fedora: "iputils", suse: "iputils" },
  dig: { arch: "bind", debian: "dnsutils", fedora: "bind-utils", suse: "bind-utils" },
  ip: { arch: "iproute2", debian: "iproute2", fedora: "iproute", suse: "iproute2" },
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

export function installCommand(program: string, family: Family): string {
  return `${MANAGERS[family]} ${PACKAGES[program]?.[family] ?? program}`;
}

export function installMarkdown(what: string, program: string, family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${
    families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${installCommand(program, f)}\``).join("\n\n")
  }`;
}
