// IPv4 and IPv6 subnet arithmetic. Addresses are bigints so both families share the same code.

export type Family = 4 | 6;

export const WIDTH: Record<Family, number> = { 4: 32, 6: 128 };

/** An address with a prefix length, as typed: `address` may be a host inside the network. */
export interface Network {
  family: Family;
  address: bigint;
  prefix: number;
  /** Typed without a prefix or mask: a single address. */
  bare: boolean;
}

/** An inclusive range of addresses of one family. */
export interface Span {
  family: Family;
  start: bigint;
  end: bigint;
}

const ALL = (family: Family) => (1n << BigInt(WIDTH[family])) - 1n;

// Parsing

/** Strict dotted quad: four decimal numbers 0–255, no leading zeros (they read as octal in some tools). */
export function parseIPv4(text: string): bigint {
  const parts = text.trim().split(".");
  if (parts.length !== 4) throw new Error(`Not an IPv4 address: ${text}`);
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) throw new Error(`Not an IPv4 address: ${text}`);
    if (part.length > 1 && part.startsWith("0")) {
      throw new Error(`Leading zeros are ambiguous (octal in some tools): ${text}`);
    }
    const n = Number(part);
    if (n > 255) throw new Error(`${part} is more than 255 in ${text}`);
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

/** RFC 4291 text: `::` once, 1–4 hex digits per group, an IPv4 tail, a `%zone` ignored. */
export function parseIPv6(text: string): bigint {
  const source = text.trim().replace(/^\[(.*)\]$/, "$1").replace(/%[\w.-]+$/, "");
  if (!source.includes(":")) throw new Error(`Not an IPv6 address: ${text}`);
  const halves = source.split("::");
  if (halves.length > 2) throw new Error(`"::" can appear only once: ${text}`);
  const groups = (part: string, last: boolean): number[] => {
    if (part === "") return [];
    const out: number[] = [];
    const items = part.split(":");
    items.forEach((g, i) => {
      if (last && i === items.length - 1 && g.includes(".")) {
        const v4 = Number(parseIPv4(g));
        out.push(v4 >>> 16, v4 & 0xffff);
      } else if (/^[0-9a-f]{1,4}$/i.test(g)) out.push(parseInt(g, 16));
      else throw new Error(`Not an IPv6 address: ${text}`);
    });
    return out;
  };
  const head = groups(halves[0], halves.length === 1);
  const tail = halves.length === 2 ? groups(halves[1], true) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) {
    throw new Error(`An IPv6 address has 8 groups of 16 bits: ${text}`);
  }
  const all = [...head, ...Array(halves.length === 2 ? missing : 0).fill(0), ...tail];
  return all.reduce((v, g) => (v << 16n) | BigInt(g), 0n);
}

export function parseAddress(text: string): { family: Family; value: bigint } {
  const t = text.trim();
  if (t.includes(":")) return { family: 6, value: parseIPv6(t) };
  if (/^[\d.]+$/.test(t)) return { family: 4, value: parseIPv4(t) };
  throw new Error(`Not an IPv4 or IPv6 address: ${text}`);
}

export function isAddress(text: string): boolean {
  try {
    parseAddress(text);
    return true;
  } catch {
    return false;
  }
}

export function maskOf(prefix: number, family: Family): bigint {
  return ALL(family) ^ ((1n << BigInt(WIDTH[family] - prefix)) - 1n);
}

/** The prefix length of a contiguous netmask (`255.255.252.0`), or undefined. */
export function netmaskPrefix(value: bigint, family: Family = 4): number | undefined {
  for (let p = 0; p <= WIDTH[family]; p++) if (maskOf(p, family) === value) return p;
  return undefined;
}

/** The prefix length of a Cisco wildcard mask (`0.0.3.255`), or undefined. */
export function wildcardPrefix(value: bigint, family: Family = 4): number | undefined {
  return netmaskPrefix(ALL(family) ^ value, family);
}

function parsePrefix(text: string, family: Family, original: string): number {
  if (/^\d{1,3}$/.test(text)) {
    const p = Number(text);
    if (p > WIDTH[family]) throw new Error(`An IPv${family} prefix is 0 to ${WIDTH[family]}, not /${p}`);
    return p;
  }
  if (family === 4 && /^[\d.]+$/.test(text)) {
    const value = parseIPv4(text);
    const p = netmaskPrefix(value) ?? wildcardPrefix(value);
    if (p === undefined) throw new Error(`${text} is not a contiguous netmask`);
    return p;
  }
  throw new Error(`Not a prefix length: ${original}`);
}

/** `10.0.0.0/8`, `10.0.0.5/255.0.0.0`, `10.0.0.5 255.255.252.0`, `2001:db8::/48` or a bare address. */
export function parseNetwork(text: string): Network {
  const t = text.trim().replace(/\s*\/\s*/, "/");
  const slash = t.split("/");
  if (slash.length > 2) throw new Error(`Not a network: ${text}`);
  let [addr, prefixText] = slash;
  if (prefixText === undefined) {
    const words = addr.split(/\s+/);
    if (words.length === 2 && maskLike(words[1])) [addr, prefixText] = words;
    else if (words.length > 1) throw new Error(`Not a network: ${text}`);
  }
  const { family, value } = parseAddress(addr);
  if (prefixText === undefined) return { family, address: value, prefix: WIDTH[family], bare: true };
  return { family, address: value, prefix: parsePrefix(prefixText, family, text), bare: false };
}

/** A dotted netmask (`255.…`) or wildcard (`0.…`) written after an address. */
export function maskLike(text: string): boolean {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(text)) return false;
  try {
    const v = parseIPv4(text);
    const mask = netmaskPrefix(v);
    if (mask !== undefined && mask > 0) return true;
    const wild = wildcardPrefix(v);
    return wild !== undefined && wild > 0 && wild < 32;
  } catch {
    return false;
  }
}

// Network arithmetic

export function base(n: Network): bigint {
  return n.address & maskOf(n.prefix, n.family);
}

export function last(n: Network): bigint {
  return base(n) | (ALL(n.family) ^ maskOf(n.prefix, n.family));
}

export function size(n: Network | { family: Family; prefix: number }): bigint {
  return 1n << BigInt(WIDTH[n.family] - n.prefix);
}

/** IPv4 keeps the network and broadcast addresses out, except on /31 (RFC 3021) and /32. IPv6 has no broadcast. */
export function hostRange(n: Network): { first: bigint; last: bigint; count: bigint } {
  const b = base(n), l = last(n), total = size(n);
  if (n.family === 6 || n.prefix >= 31) return { first: b, last: l, count: total };
  return { first: b + 1n, last: l - 1n, count: total - 2n };
}

export function usableHosts(prefix: number, family: Family): bigint {
  const total = size({ family, prefix });
  return family === 6 || prefix >= 31 ? total : total - 2n;
}

export function cidr(n: Network): string {
  return `${formatAddress(base(n), n.family)}/${n.prefix}`;
}

export function withPrefix(n: Network, prefix: number): Network {
  return { family: n.family, address: base(n), prefix, bare: false };
}

export function contains(outer: Network, inner: Network): boolean {
  return outer.family === inner.family && outer.prefix <= inner.prefix && base(outer) === (base(inner) &
        maskOf(outer.prefix, outer.family));
}

/** The smallest network that holds both. */
export function supernet(a: Network, b: Network): Network {
  if (a.family !== b.family) throw new Error("IPv4 and IPv6 never share a network");
  let p = Math.min(a.prefix, b.prefix);
  while (p > 0 && (base(a) & maskOf(p, a.family)) !== (base(b) & maskOf(p, a.family))) p--;
  return withPrefix({ ...a, address: base(a) }, p);
}

/** The network of the same size just before or after, if it exists. */
export function neighbor(n: Network, direction: 1 | -1): Network | undefined {
  const next = base(n) + BigInt(direction) * size(n);
  if (next < 0n || next > ALL(n.family)) return undefined;
  return { family: n.family, address: next, prefix: n.prefix, bare: false };
}

export const SPLIT_LIMIT = 256;

/** The subnets of length `prefix` inside `n`: the first `limit`, and how many there are. */
export function split(n: Network, prefix: number, limit = SPLIT_LIMIT): { subnets: Network[]; total: bigint } {
  if (prefix <= n.prefix) throw new Error(`Split /${n.prefix} into something longer than /${n.prefix}`);
  if (prefix > WIDTH[n.family]) throw new Error(`An IPv${n.family} prefix is at most /${WIDTH[n.family]}`);
  const total = 1n << BigInt(prefix - n.prefix);
  const step = size({ family: n.family, prefix });
  const subnets: Network[] = [];
  for (let i = 0n; i < total && i < BigInt(limit); i++) {
    subnets.push({ family: n.family, address: base(n) + i * step, prefix, bare: false });
  }
  return { subnets, total };
}

/** The prefix that splits `n` into at least `count` subnets. */
export function prefixForCount(n: Network, count: number): number {
  if (!Number.isInteger(count) || count < 2) throw new Error("Split into 2 subnets or more");
  const bits = Math.ceil(Math.log2(count) - 1e-9);
  return n.prefix + bits;
}

/**
 * The longest prefix with room for `hosts` usable addresses. Two hosts or more get a classic subnet with a network
 * and broadcast address (/30, not the point-to-point /31).
 */
export function prefixForHosts(hosts: bigint, family: Family = 4): number {
  if (hosts < 1n) throw new Error("Ask for 1 host or more");
  if (hosts === 1n) return WIDTH[family];
  const longest = family === 4 ? 30 : WIDTH[family] - 1;
  for (let p = longest; p >= 0; p--) if (usableHosts(p, family) >= hosts) return p;
  throw new Error(`No IPv${family} network holds ${hosts} hosts`);
}

// Summarizing

export function spanOf(n: Network): Span {
  return { family: n.family, start: base(n), end: last(n) };
}

/** `10.0.0.1-10.0.0.20`, `10.0.0.1 - 20` (last octet), a network or an address. */
export function parseSpan(text: string): Span {
  const t = text.trim();
  const dash = t.match(/^(.+?)\s*-\s*(.+)$/);
  if (dash) {
    const a = parseAddress(dash[1]);
    let endText = dash[2];
    if (a.family === 4 && /^\d{1,3}$/.test(endText)) endText = dash[1].replace(/\d+$/, endText);
    const b = parseAddress(endText);
    if (a.family !== b.family) throw new Error(`Mixed IPv4 and IPv6 in ${text}`);
    if (b.value < a.value) throw new Error(`The range ${text} ends before it starts`);
    return { family: a.family, start: a.value, end: b.value };
  }
  return spanOf(parseNetwork(t));
}

/** Merges overlapping and adjacent spans, IPv4 first. */
export function merge(spans: Span[]): Span[] {
  const sorted = [...spans].sort((a, b) => a.family - b.family || (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const out: Span[] = [];
  for (const s of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.family === s.family && s.start <= prev.end + 1n) {
      if (s.end > prev.end) prev.end = s.end;
    } else out.push({ ...s });
  }
  return out;
}

/** The fewest CIDR blocks covering exactly this span. */
export function spanToNetworks(span: Span): Network[] {
  const width = WIDTH[span.family];
  const out: Network[] = [];
  let start = span.start;
  while (start <= span.end) {
    let bits = 0;
    while (bits < width && ((start >> BigInt(bits)) & 1n) === 0n) bits++;
    while (start + (1n << BigInt(bits)) - 1n > span.end) bits--;
    out.push({ family: span.family, address: start, prefix: width - bits, bare: false });
    start += 1n << BigInt(bits);
  }
  return out;
}

export function summarize(spans: Span[]): Network[] {
  return merge(spans).flatMap(spanToNetworks);
}

// Formatting

export function formatIPv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((s) => String((value >> s) & 255n)).join(".");
}

function groups(value: bigint): number[] {
  return Array.from({ length: 8 }, (_, i) => Number((value >> BigInt(112 - 16 * i)) & 0xffffn));
}

/** RFC 5952: lowercase, no leading zeros, the longest run of zero groups as `::`, IPv4-mapped as dotted. */
export function formatIPv6(value: bigint): string {
  if (value >> 32n === 0xffffn) return `::ffff:${formatIPv4(value & 0xffffffffn)}`;
  const g = groups(value);
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8;) {
    if (g[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen) [best, bestLen] = [i, j - i];
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

export function expandIPv6(value: bigint): string {
  return groups(value).map((x) => x.toString(16).padStart(4, "0")).join(":");
}

export function formatAddress(value: bigint, family: Family): string {
  return family === 4 ? formatIPv4(value) : formatIPv6(value);
}

/** Dotted binary for IPv4, colon-separated groups of 16 bits for IPv6. */
export function binary(value: bigint, family: Family): string {
  const bits = value.toString(2).padStart(WIDTH[family], "0");
  const chunk = family === 4 ? 8 : 16;
  return bits.match(new RegExp(`.{${chunk}}`, "g"))!.join(family === 4 ? "." : ":");
}

export function hex(value: bigint, family: Family): string {
  return "0x" + value.toString(16).padStart(WIDTH[family] / 4, "0");
}

const SUPERSCRIPT = "⁰¹²³⁴⁵⁶⁷⁸⁹";
const sup = (n: number) => [...String(n)].map((d) => SUPERSCRIPT[Number(d)]).join("");

/** Exact with separators when it fits, otherwise as a power of two. */
export function formatCount(n: bigint): string {
  if (n < 10n ** 15n) return n.toLocaleString("en-US");
  const bits = n.toString(2).length - 1;
  const digits = n.toString();
  const approx = `${digits[0]}.${digits.slice(1, 3)} × 10${sup(digits.length - 1)}`;
  return n === 1n << BigInt(bits) ? `2${sup(bits)} (≈ ${approx})` : `≈ ${approx}`;
}

export function plural(n: bigint | number, word: string): string {
  const many = word.endsWith("s") ? `${word}es` : `${word}s`;
  return `${formatCount(BigInt(n))} ${BigInt(n) === 1n ? word : many}`;
}

// Classification

export interface Scope {
  cidr: string;
  name: string;
  /** Short label for a tag. */
  label: string;
  color: "green" | "blue" | "purple" | "orange" | "gray" | "teal" | "red";
  rfc?: string;
}

const SCOPES: Scope[] = [
  { cidr: "0.0.0.0/8", name: "“This network”", label: "Reserved", color: "gray", rfc: "RFC 791" },
  { cidr: "10.0.0.0/8", name: "Private network", label: "Private", color: "green", rfc: "RFC 1918" },
  { cidr: "100.64.0.0/10", name: "Carrier-grade NAT", label: "CGNAT", color: "teal", rfc: "RFC 6598" },
  { cidr: "127.0.0.0/8", name: "Loopback", label: "Loopback", color: "purple", rfc: "RFC 1122" },
  { cidr: "169.254.0.0/16", name: "Link-local (APIPA)", label: "Link-local", color: "teal", rfc: "RFC 3927" },
  { cidr: "172.16.0.0/12", name: "Private network", label: "Private", color: "green", rfc: "RFC 1918" },
  { cidr: "192.0.0.0/24", name: "IETF protocol assignments", label: "Reserved", color: "gray", rfc: "RFC 6890" },
  {
    cidr: "192.0.2.0/24",
    name: "Documentation (TEST-NET-1)",
    label: "Documentation",
    color: "orange",
    rfc: "RFC 5737",
  },
  {
    cidr: "192.88.99.0/24",
    name: "6to4 relay anycast (deprecated)",
    label: "Reserved",
    color: "gray",
    rfc: "RFC 7526",
  },
  { cidr: "192.168.0.0/16", name: "Private network", label: "Private", color: "green", rfc: "RFC 1918" },
  { cidr: "198.18.0.0/15", name: "Benchmarking", label: "Benchmarking", color: "gray", rfc: "RFC 2544" },
  {
    cidr: "198.51.100.0/24",
    name: "Documentation (TEST-NET-2)",
    label: "Documentation",
    color: "orange",
    rfc: "RFC 5737",
  },
  {
    cidr: "203.0.113.0/24",
    name: "Documentation (TEST-NET-3)",
    label: "Documentation",
    color: "orange",
    rfc: "RFC 5737",
  },
  { cidr: "224.0.0.0/4", name: "Multicast", label: "Multicast", color: "purple", rfc: "RFC 5771" },
  { cidr: "240.0.0.0/4", name: "Reserved for future use", label: "Reserved", color: "gray", rfc: "RFC 1112" },
  { cidr: "255.255.255.255/32", name: "Limited broadcast", label: "Broadcast", color: "red", rfc: "RFC 919" },
  { cidr: "::/128", name: "Unspecified address", label: "Unspecified", color: "gray", rfc: "RFC 4291" },
  { cidr: "::1/128", name: "Loopback", label: "Loopback", color: "purple", rfc: "RFC 4291" },
  { cidr: "::ffff:0:0/96", name: "IPv4-mapped address", label: "IPv4-mapped", color: "teal", rfc: "RFC 4291" },
  { cidr: "64:ff9b::/96", name: "NAT64 well-known prefix", label: "NAT64", color: "teal", rfc: "RFC 6052" },
  { cidr: "64:ff9b:1::/48", name: "Local NAT64", label: "NAT64", color: "teal", rfc: "RFC 8215" },
  { cidr: "100::/64", name: "Discard-only", label: "Reserved", color: "gray", rfc: "RFC 6666" },
  { cidr: "2000::/3", name: "Global unicast", label: "Public", color: "blue", rfc: "RFC 4291" },
  { cidr: "2001::/32", name: "Teredo tunneling", label: "Teredo", color: "teal", rfc: "RFC 4380" },
  { cidr: "2001:db8::/32", name: "Documentation", label: "Documentation", color: "orange", rfc: "RFC 3849" },
  { cidr: "2002::/16", name: "6to4", label: "6to4", color: "teal", rfc: "RFC 3056" },
  { cidr: "3fff::/20", name: "Documentation", label: "Documentation", color: "orange", rfc: "RFC 9637" },
  { cidr: "fc00::/7", name: "Unique local address (private)", label: "Private", color: "green", rfc: "RFC 4193" },
  { cidr: "fe80::/10", name: "Link-local", label: "Link-local", color: "teal", rfc: "RFC 4291" },
  { cidr: "ff00::/8", name: "Multicast", label: "Multicast", color: "purple", rfc: "RFC 4291" },
];

const SCOPE_NETWORKS = SCOPES.map((s) => ({ scope: s, net: parseNetwork(s.cidr) }));

const PUBLIC_V4: Scope = { cidr: "", name: "Public (globally routable)", label: "Public", color: "blue" };
const RESERVED_V6: Scope = { cidr: "", name: "Reserved by the IETF", label: "Reserved", color: "gray" };
const MIXED: Scope = { cidr: "", name: "Spans several kinds of ranges", label: "Mixed", color: "gray" };

/** The most specific special-purpose block holding the whole network. */
export function scopeOf(n: Network): Scope {
  const holding = SCOPE_NETWORKS.filter((s) => contains(s.net, n)).sort((a, b) => b.net.prefix - a.net.prefix)[0];
  if (holding) return holding.scope;
  if (SCOPE_NETWORKS.some((s) => contains(n, s.net))) return MIXED;
  return n.family === 4 ? PUBLIC_V4 : RESERVED_V6;
}

/** Classful addressing, still asked about in exams and old configs. */
export function ipv4Class(value: bigint): { name: string; defaultPrefix?: number } {
  const first = Number(value >> 24n);
  if (first < 128) return { name: "A", defaultPrefix: 8 };
  if (first < 192) return { name: "B", defaultPrefix: 16 };
  if (first < 224) return { name: "C", defaultPrefix: 24 };
  if (first < 240) return { name: "D (multicast)" };
  return { name: "E (reserved)" };
}

/** The PTR name of one address. */
export function ptrName(value: bigint, family: Family): string {
  if (family === 4) return formatIPv4(value).split(".").reverse().join(".") + ".in-addr.arpa";
  return [...value.toString(16).padStart(32, "0")].reverse().join(".") + ".ip6.arpa";
}

/** The reverse DNS zones covering a network: octet (IPv4) or nibble (IPv6) boundaries. */
export function reverseZones(n: Network, limit = 16): { zones: string[]; total: number } {
  const unit = n.family === 4 ? 8 : 4;
  const labels = Math.min(Math.ceil(n.prefix / unit), n.family === 4 ? 3 : 32);
  const zoneBits = labels * unit;
  const total = n.prefix >= zoneBits ? 1 : 2 ** (zoneBits - n.prefix);
  const zones: string[] = [];
  const step = 1n << BigInt(WIDTH[n.family] - zoneBits);
  for (let i = 0; i < Math.min(total, limit); i++) {
    const v = base(n) + BigInt(i) * step;
    const name = ptrName(v, n.family).split(".");
    zones.push(name.slice(name.length - labels - 2).join("."));
  }
  return { zones, total };
}

// Queries

export type Query =
  | { kind: "empty" }
  | { kind: "network"; network: Network }
  | { kind: "prefix"; prefix: number; family?: Family }
  | { kind: "hosts"; hosts: bigint }
  | { kind: "split"; network: Network; prefix: number }
  | { kind: "contains"; needle: Network; haystack: Network }
  | { kind: "summarize"; spans: Span[]; inputs: string[] }
  | { kind: "error"; message: string };

export const EXAMPLES: { query: string; title: string }[] = [
  { query: "192.168.1.0/24", title: "A network: hosts, broadcast, netmask, binary" },
  { query: "10.0.0.5 255.255.252.0", title: "An address and its netmask" },
  { query: "2001:db8::/48", title: "An IPv6 prefix" },
  { query: "10.0.0.0/16 split 24", title: "Split into /24 subnets" },
  { query: "172.16.0.0/12 into 6", title: "Split into at least 6 subnets" },
  { query: "10.0.0.5 in 10.0.0.0/8", title: "Is an address in a network?" },
  { query: "10.0.0.0/24 10.0.1.0/24 10.0.2.0-10.0.3.255", title: "Summarize into the fewest CIDRs" },
  { query: "500 hosts", title: "The smallest subnet for 500 hosts" },
  { query: "/27", title: "What a prefix length means" },
];

function attempt<T>(f: () => T): T | undefined {
  try {
    return f();
  } catch {
    return undefined;
  }
}

export function parseQuery(input: string): Query {
  const q = input.trim().replace(/\s+/g, " ");
  if (!q) return { kind: "empty" };
  try {
    let m = q.match(/^(.+?) split ?\/?(\d{1,3})$/i);
    if (m && !/^\d+$/.test(m[1])) {
      const network = parseNetwork(m[1]);
      return { kind: "split", network, prefix: Number(m[2]) };
    }
    m = q.match(/^(.+?) (?:into|in to|÷) ?(\d+)(?: subnets?| networks?)?$/i);
    if (m) {
      const network = parseNetwork(m[1]);
      return { kind: "split", network, prefix: prefixForCount(network, Number(m[2])) };
    }
    m = q.match(/^(?:is )?(.+?) (?:in|inside|within|∈) (.+?)\??$/i);
    if (m) {
      const needle = parseNetwork(m[1]), haystack = parseNetwork(m[2]);
      if (needle.family !== haystack.family) throw new Error("IPv4 and IPv6 never share a network");
      return { kind: "contains", needle, haystack };
    }
    m = q.match(/^(\d[\d,_ ]*?) ?(?:hosts?|machines?|addresses|hôtes?)$/i) ??
      q.match(/^(?:hosts?|hôtes?) (\d[\d,_]*)$/i);
    if (m) return { kind: "hosts", hosts: BigInt(m[1].replace(/[,_ ]/g, "")) };
    m = q.match(/^\/(\d{1,3})$/);
    if (m) {
      const prefix = Number(m[1]);
      if (prefix > 128) throw new Error("A prefix length is 0 to 32 (IPv4) or 0 to 128 (IPv6)");
      return { kind: "prefix", prefix };
    }
    if (/^255\.\d+\.\d+\.\d+$/.test(q) && q !== "255.255.255.255") {
      const p = netmaskPrefix(parseIPv4(q));
      if (p !== undefined) return { kind: "prefix", prefix: p, family: 4 };
    }
    const single = attempt(() => parseNetwork(q));
    if (single) return { kind: "network", network: single };
    const inputs = q.replace(/\s*-\s*/g, "-").split(/[\s,;]+/).filter(Boolean);
    const spans = inputs.map(parseSpan);
    return { kind: "summarize", spans, inputs };
  } catch (e) {
    return { kind: "error", message: (e as Error).message };
  }
}
