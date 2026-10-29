// Domains and DNS records of four registrars as plain data: Porkbun and Gandi
// JSON, OVH's signed requests, Namecheap's XML. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type RegistrarId = "porkbun" | "gandi" | "ovh" | "namecheap";

export const REGISTRARS: RegistrarId[] = ["porkbun", "gandi", "ovh", "namecheap"];

export const REGISTRAR_NAMES: Record<RegistrarId, string> = {
  porkbun: "Porkbun",
  gandi: "Gandi",
  ovh: "OVHcloud",
  namecheap: "Namecheap",
};

export const REGISTRAR_COLORS: Record<RegistrarId, Color> = {
  porkbun: "pink",
  gandi: "teal",
  ovh: "blue",
  namecheap: "orange",
};

export interface Domain {
  registrar: RegistrarId;
  name: string;
  expires?: Date;
  created?: Date;
  autoRenew?: boolean;
  /** "active", "expired", "ok"… as the registrar says it. */
  status?: string;
  locked?: boolean;
  privacy?: boolean;
  /** Whether the registrar's DNS serves it, so records can be read and changed here. */
  dns: boolean;
}

export interface DnsRecord {
  /** Unique within the domain. */
  id: string;
  domain: string;
  registrar: RegistrarId;
  /** Relative to the domain: "" for the apex, "www", "_dmarc". */
  name: string;
  type: string;
  content: string;
  ttl?: number;
  prio?: number;
  notes?: string;
}

const date = (text: unknown): Date | undefined => {
  if (typeof text !== "string" || !text.trim()) return undefined;
  const d = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text);
  return isNaN(d.getTime()) ? undefined : d;
};

const truthy = (v: unknown) => v === true || v === 1 || v === "1" || v === "true" || v === "yes" || v === "on";

const num = (v: unknown) => {
  const n = Number(v);
  return v === undefined || v === null || v === "" || !Number.isFinite(n) ? undefined : n;
};

// ---------------------------------------------------------------------------
// Names

/** `www.example.com` in `example.com` → `www`; the apex → "". */
export function relativeName(fqdn: string, domain: string): string {
  const name = fqdn.toLowerCase().replace(/\.$/, "");
  const d = domain.toLowerCase();
  if (name === d || name === "@" || name === "") return "";
  return name.endsWith(`.${d}`) ? name.slice(0, -d.length - 1) : name;
}

/** "" or "@" → the domain; `www` → `www.example.com`; a full name stays. */
export function fullName(name: string, domain: string): string {
  const n = name.trim().replace(/\.$/, "").toLowerCase();
  if (!n || n === "@") return domain;
  return n === domain || n.endsWith(`.${domain}`) ? n : `${n}.${domain}`;
}

/** What the form's name field means, relative: `@`, `www.example.com` and `www` alike. */
export const typedName = (name: string, domain: string) => relativeName(fullName(name, domain), domain);

export const displayName = (r: Pick<DnsRecord, "name">) => r.name || "@";

/** Namecheap wants the second-level name and the rest apart: `shop.co.uk` → `shop` + `co.uk`. */
export function splitDomain(domain: string): { sld: string; tld: string } {
  const i = domain.indexOf(".");
  if (i <= 0) throw new Error(`${domain} is not a domain name`);
  return { sld: domain.slice(0, i), tld: domain.slice(i + 1) };
}

// ---------------------------------------------------------------------------
// Expiry

export function daysUntil(d: Date | undefined, now = Date.now()): number | undefined {
  return d ? Math.floor((d.getTime() - now) / 86400_000) : undefined;
}

export type ExpiryState = "ok" | "soon" | "expired" | "unknown";

export function expiryState(d: Domain, warnDays: number, now = Date.now()): ExpiryState {
  const days = daysUntil(d.expires, now);
  if (days === undefined) return "unknown";
  if (days < 0) return "expired";
  return days < warnDays ? "soon" : "ok";
}

/** A domain about to expire without auto-renew is the one to look at. */
export function expiryColor(d: Domain, warnDays: number, now = Date.now()): Color {
  const s = expiryState(d, warnDays, now);
  if (s === "expired") return "red";
  if (s === "soon") return d.autoRenew ? "yellow" : "red";
  return s === "unknown" ? "gray" : "green";
}

/** "in 12 days", "in 3 months", "in 2 years", "expired 4 days ago". */
export function expiryText(d: Date | undefined, now = Date.now()): string {
  const days = daysUntil(d, now);
  if (days === undefined) return "no expiry date";
  const span = (n: number) =>
    n >= 730
      ? `${Math.floor(n / 365)} years`
      : n >= 60
      ? `${Math.floor(n / 30)} months`
      : `${n} day${n === 1 ? "" : "s"}`;
  if (days < 0) {
    const ago = Math.floor((now - d!.getTime()) / 86400_000);
    return ago ? `expired ${span(ago)} ago` : "expired today";
  }
  if (days === 0) return "expires today";
  return `in ${span(days)}`;
}

/** Soonest expiry first, unknown dates last, then by name. */
export function sortDomains(domains: Domain[]): Domain[] {
  return [...domains].sort((a, b) =>
    (a.expires?.getTime() ?? Infinity) - (b.expires?.getTime() ?? Infinity) || a.name.localeCompare(b.name)
  );
}

// ---------------------------------------------------------------------------
// Records

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT", "NS", "SRV", "CAA"];

/** Types whose content has a priority in front with some registrars. */
const PRIO_TYPES = ["MX", "SRV"];

export const TYPE_COLORS: Record<string, Color> = {
  A: "blue",
  AAAA: "purple",
  CNAME: "teal",
  ALIAS: "teal",
  MX: "orange",
  TXT: "green",
  NS: "gray",
};

const TYPE_ORDER = ["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT"];

/** By domain, apex first, by name, then A, AAAA, CNAME, MX, TXT. */
export function sortRecords(all: DnsRecord[]): DnsRecord[] {
  const rank = (t: string) => (TYPE_ORDER.indexOf(t) + 1) || 99;
  return [...all].sort((a, b) =>
    a.domain.localeCompare(b.domain) ||
    Number(!!a.name) - Number(!!b.name) ||
    a.name.localeCompare(b.name) ||
    rank(a.type) - rank(b.type) ||
    (a.prio ?? 0) - (b.prio ?? 0) ||
    a.content.localeCompare(b.content)
  );
}

export type RecordFilter = "all" | "address" | "cname" | "mx" | "txt" | "other";

export function filterRecords(all: DnsRecord[], filter: RecordFilter): DnsRecord[] {
  switch (filter) {
    case "address":
      return all.filter((r) => r.type === "A" || r.type === "AAAA");
    case "cname":
      return all.filter((r) => r.type === "CNAME" || r.type === "ALIAS");
    case "mx":
      return all.filter((r) => r.type === "MX");
    case "txt":
      return all.filter((r) => r.type === "TXT");
    case "other":
      return all.filter((r) => !["A", "AAAA", "CNAME", "ALIAS", "MX", "TXT"].includes(r.type));
    default:
      return all;
  }
}

export const ttlLabel = (ttl: number | undefined) =>
  ttl === undefined
    ? "default"
    : ttl % 86400 === 0
    ? `${ttl / 86400} d`
    : ttl % 3600 === 0
    ? `${ttl / 3600} h`
    : ttl % 60 === 0
    ? `${ttl / 60} min`
    : `${ttl} s`;

/** A BIND zone file line. */
export function zoneLine(r: DnsRecord): string {
  const content = r.type === "TXT" && !r.content.startsWith('"') ? `"${r.content.replace(/"/g, '\\"')}"` : r.content;
  const dot = (s: string) =>
    /^[\w.-]+$/.test(s) && ["CNAME", "ALIAS", "MX", "NS"].includes(r.type) && !s.endsWith(".") ? `${s}.` : s;
  return [
    `${fullName(r.name, r.domain)}.`,
    r.ttl ?? 3600,
    "IN",
    r.type,
    ...(r.prio !== undefined ? [r.prio] : []),
    dot(content),
  ].join("\t");
}

/** What the record form gives. */
export interface RecordInput {
  type?: string;
  name?: string;
  content?: string;
  ttl?: string;
  prio?: string;
}

/** A checked record, the name relative to the domain. */
export interface RecordSpec {
  name: string;
  type: string;
  content: string;
  ttl?: number;
  prio?: number;
}

/** Validates the form; `minTtl` is the registrar's floor (Porkbun: 600). */
export function recordSpec(v: RecordInput, domain: string, minTtl = 60): RecordSpec {
  const type = String(v.type ?? "A").trim().toUpperCase();
  if (!RECORD_TYPES.includes(type)) throw new Error(`Unsupported type ${type}`);
  const name = typedName(String(v.name ?? ""), domain);
  if (name && !/^(\*\.)?[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$|^\*$/i.test(name)) {
    throw new Error(`“${name}” is not a valid name`);
  }
  const content = String(v.content ?? "").trim();
  if (!content) throw new Error("Content is required");
  if (type === "A" && !/^((25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(25[0-5]|2[0-4]\d|1?\d?\d)$/.test(content)) {
    throw new Error(`“${content}” is not an IPv4 address`);
  }
  if (type === "AAAA" && !(/^[0-9a-f:.]+$/i.test(content) && content.includes(":"))) {
    throw new Error(`“${content}” is not an IPv6 address`);
  }
  if (["CNAME", "ALIAS", "MX", "NS"].includes(type) && !/^[a-z0-9_.-]+\.?$/i.test(content)) {
    throw new Error(`“${content}” is not a host name`);
  }
  if (type === "CNAME" && !name) throw new Error("The apex can't be a CNAME: use ALIAS or A records");
  const ttlText = String(v.ttl ?? "").trim().toLowerCase();
  let ttl: number | undefined;
  if (ttlText && ttlText !== "auto" && ttlText !== "default") {
    ttl = Number(ttlText.replace(/s$/, ""));
    if (!Number.isInteger(ttl) || ttl < minTtl || ttl > 604800) {
      throw new Error(`TTL is a number of seconds from ${minTtl} to 604800, or empty for the default`);
    }
  }
  let prio: number | undefined;
  if (PRIO_TYPES.includes(type)) {
    prio = Number(String(v.prio ?? "").trim() || "10");
    if (!Number.isInteger(prio) || prio < 0 || prio > 65535) throw new Error("Priority is a number from 0 to 65535");
  }
  return { name, type, content: content.replace(/^"(.*)"$/s, type === "TXT" ? "$1" : "$&"), ttl, prio };
}

// ---------------------------------------------------------------------------
// Porkbun (api.porkbun.com/api/json/v3)

/** `POST /domain/listAll`. */
export function parsePorkbunDomains(body: any): Domain[] {
  return (Array.isArray(body?.domains) ? body.domains : []).map((d: any): Domain => ({
    registrar: "porkbun",
    name: String(d.domain).toLowerCase(),
    expires: date(d.expireDate),
    created: date(d.createDate),
    autoRenew: truthy(d.autoRenew),
    status: d.status ? String(d.status).toLowerCase() : undefined,
    locked: d.securityLock === undefined ? undefined : truthy(d.securityLock),
    privacy: d.whoisPrivacy === undefined ? undefined : truthy(d.whoisPrivacy),
    // Porkbun answers for its own name servers only; a domain elsewhere shows an error there.
    dns: true,
  }));
}

/** `POST /dns/retrieve/{domain}`: names are full, priorities apart. */
export function parsePorkbunRecords(body: any, domain: string): DnsRecord[] {
  return (Array.isArray(body?.records) ? body.records : []).map((r: any): DnsRecord => ({
    id: String(r.id),
    domain,
    registrar: "porkbun",
    name: relativeName(String(r.name ?? ""), domain),
    type: String(r.type).toUpperCase(),
    content: String(r.content ?? ""),
    ttl: num(r.ttl),
    prio: PRIO_TYPES.includes(String(r.type).toUpperCase()) ? num(r.prio) : undefined,
    notes: r.notes ? String(r.notes) : undefined,
  }));
}

/** The body of `/dns/create/{domain}` and `/dns/edit/{domain}/{id}`, keys added by the caller. */
export function porkbunRecordBody(spec: RecordSpec): Record<string, string> {
  return {
    name: spec.name,
    type: spec.type,
    content: spec.content,
    ...(spec.ttl !== undefined ? { ttl: String(spec.ttl) } : {}),
    ...(spec.prio !== undefined ? { prio: String(spec.prio) } : {}),
  };
}

// ---------------------------------------------------------------------------
// Gandi (api.gandi.net/v5)

/** `GET /v5/domain/domains`. */
export function parseGandiDomains(body: any): Domain[] {
  return (Array.isArray(body) ? body : []).map((d: any): Domain => {
    const status: string[] = Array.isArray(d.status) ? d.status : [];
    const auto = typeof d.autorenew === "object" && d.autorenew !== null ? d.autorenew.enabled : d.autorenew;
    return {
      registrar: "gandi",
      name: String(d.fqdn ?? d.fqdn_unicode).toLowerCase(),
      expires: date(d.dates?.registry_ends_at),
      created: date(d.dates?.created_at ?? d.dates?.registry_created_at),
      autoRenew: auto === undefined || auto === null ? undefined : !!auto,
      status: status.find((s) => !/^client/.test(s)) ?? (status.length ? "ok" : undefined),
      locked: status.includes("clientTransferProhibited"),
      dns: (d.nameserver?.current ?? "livedns") === "livedns",
    };
  });
}

/** `GET /v5/livedns/domains/{fqdn}/records`: one record per value of each rrset. */
export function parseGandiRecords(body: any, domain: string): DnsRecord[] {
  return (Array.isArray(body) ? body : []).flatMap((rr: any) =>
    (rr.rrset_values ?? []).map((value: string, i: number): DnsRecord => {
      const type = String(rr.rrset_type).toUpperCase();
      const v = String(value);
      const m = PRIO_TYPES.includes(type) ? /^(\d+)\s+(.+)$/.exec(v) : null;
      return {
        id: `${rr.rrset_name}/${type}/${i}`,
        domain,
        registrar: "gandi",
        name: rr.rrset_name === "@" ? "" : String(rr.rrset_name),
        type,
        content: m ? m[2] : type === "TXT" ? v.replace(/^"(.*)"$/s, "$1").replace(/\\"/g, '"') : v,
        ttl: num(rr.rrset_ttl),
        prio: m ? Number(m[1]) : undefined,
      };
    })
  );
}

/** A record as Gandi stores it in an rrset: TXT quoted, MX with its priority. */
export function gandiValue(r: Pick<RecordSpec, "type" | "content" | "prio">): string {
  if (r.type === "TXT") return `"${r.content.replace(/^"(.*)"$/s, "$1").replace(/(?<!\\)"/g, '\\"')}"`;
  if (r.prio !== undefined) return `${r.prio} ${r.content}`;
  return r.content;
}

export const gandiName = (name: string) => name || "@";

/**
 * The values left in an rrset after replacing (or, with `next` undefined,
 * removing) one record of it. Empty means the rrset goes away.
 */
export function rrsetValues(all: DnsRecord[], target: DnsRecord, next?: RecordSpec): string[] {
  return all
    .filter((r) => r.name === target.name && r.type === target.type)
    .flatMap((r) => r.id === target.id ? (next ? [gandiValue(next)] : []) : [gandiValue(r)]);
}

// ---------------------------------------------------------------------------
// OVHcloud (eu.api.ovh.com/1.0)

export const OVH_ENDPOINTS: Record<string, string> = {
  eu: "https://eu.api.ovh.com/1.0",
  ca: "https://ca.api.ovh.com/1.0",
  us: "https://api.us.ovhcloud.com/1.0",
};

export function ovhEndpoint(pref: unknown): string {
  const key = String(pref ?? "").trim().toLowerCase().replace(/^ovh-/, "") || "eu";
  const url = OVH_ENDPOINTS[key];
  if (!url) throw new Error(`Unknown OVH endpoint “${pref}”: use eu, ca or us`);
  return url;
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * `X-Ovh-Signature`: "$1$" + SHA-1 of
 * `secret+consumerKey+METHOD+fullUrl+body+timestamp`.
 */
export async function ovhSignature(
  appSecret: string,
  consumerKey: string,
  method: string,
  url: string,
  body: string,
  timestamp: number,
): Promise<string> {
  const text = [appSecret, consumerKey, method.toUpperCase(), url, body, String(timestamp)].join("+");
  return `$1$${hex(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text)))}`;
}

/** `GET /domain/{name}/serviceInfos`. */
export function parseOvhService(name: string, info: any, zones: Set<string>): Domain {
  return {
    registrar: "ovh",
    name: name.toLowerCase(),
    expires: date(info?.expiration),
    created: date(info?.creation),
    autoRenew: info?.renew
      ? !!(info.renew.automatic || info.renew.forced) && !info.renew.deleteAtExpiration
      : undefined,
    status: info?.status ? String(info.status) : undefined,
    dns: zones.has(name.toLowerCase()),
  };
}

/** `GET /domain/zone/{zone}/record/{id}`: MX and SRV keep their priority in the target. */
export function parseOvhRecord(r: any, domain: string): DnsRecord {
  const type = String(r.fieldType).toUpperCase();
  const target = String(r.target ?? "");
  const m = PRIO_TYPES.includes(type) ? /^(\d+)\s+(.+)$/.exec(target) : null;
  return {
    id: String(r.id),
    domain,
    registrar: "ovh",
    name: String(r.subDomain ?? ""),
    type,
    content: m ? m[2] : type === "TXT" ? target.replace(/^"(.*)"$/s, "$1") : target,
    ttl: num(r.ttl) || undefined,
    prio: m ? Number(m[1]) : undefined,
  };
}

/** The body of `POST /domain/zone/{zone}/record` (without `fieldType` for a `PUT`). */
export function ovhRecordBody(spec: RecordSpec, create: boolean): Record<string, string | number> {
  return {
    ...(create ? { fieldType: spec.type } : {}),
    subDomain: spec.name,
    target: spec.prio !== undefined ? `${spec.prio} ${spec.content}` : spec.content,
    ...(spec.ttl !== undefined ? { ttl: spec.ttl } : create ? {} : { ttl: 0 }),
  };
}

// ---------------------------------------------------------------------------
// Namecheap (api.namecheap.com/xml.response)

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export const decodeXml = (s: string) =>
  s.replace(
    /&(#x[0-9a-f]+|#\d+|\w+);/gi,
    (all, e: string) =>
      e[0] === "#"
        ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
        : ENTITIES[e] ?? all,
  );

/** The attributes of every `<tag …>` (self-closing or not), case kept. */
export function xmlElements(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (const m of xml.matchAll(new RegExp(`<${tag}\\b([^>]*?)\\/?>`, "gi"))) {
    const attrs: Record<string, string> = {};
    for (const a of m[1].matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
      attrs[a[1]] = decodeXml(a[3] ?? a[4] ?? "");
    }
    out.push(attrs);
  }
  return out;
}

/** The text inside the first `<tag>…</tag>`. */
export const xmlText = (xml: string, tag: string) =>
  ((m) => m ? decodeXml(m[1].trim()) : undefined)(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(xml));

/** `<Errors><Error Number="1011102">Parameter APIKey is missing</Error></Errors>`. */
export function namecheapErrors(xml: string): { number: string; message: string }[] {
  if (!/Status\s*=\s*"ERROR"/i.test(xml)) return [];
  const errors = [...xml.matchAll(/<Error\b[^>]*Number\s*=\s*"(\d+)"[^>]*>([\s\S]*?)<\/Error>/gi)].map((m) => ({
    number: m[1],
    message: decodeXml(m[2].trim()),
  }));
  return errors.length ? errors : [{ number: "", message: "Namecheap answered with an error" }];
}

/** `MM/DD/YYYY`, as Namecheap writes dates. */
const usDate = (text: string | undefined) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text ?? "");
  return m ? new Date(Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]))) : undefined;
};

/** `namecheap.domains.getList`. */
export function parseNamecheapDomains(xml: string): { domains: Domain[]; total: number } {
  const domains = xmlElements(xml, "Domain").filter((d) => d.Name).map((d): Domain => ({
    registrar: "namecheap",
    name: d.Name.toLowerCase(),
    expires: usDate(d.Expires),
    created: usDate(d.Created),
    autoRenew: truthy(String(d.AutoRenew).toLowerCase()),
    status: truthy(String(d.IsExpired).toLowerCase()) ? "expired" : "active",
    locked: truthy(String(d.IsLocked).toLowerCase()),
    privacy: d.WhoisGuard ? d.WhoisGuard.toUpperCase() === "ENABLED" : undefined,
    dns: truthy(String(d.IsOurDNS).toLowerCase()),
  }));
  return { domains, total: Number(xmlText(xml, "TotalItems") ?? domains.length) };
}

/** `namecheap.domains.dns.getHosts`. */
export function parseNamecheapHosts(xml: string, domain: string): DnsRecord[] {
  return xmlElements(xml, "host").map((h, i): DnsRecord => {
    const type = String(h.Type ?? "").toUpperCase();
    return {
      id: h.HostId || String(i),
      domain,
      registrar: "namecheap",
      name: h.Name === "@" ? "" : String(h.Name ?? ""),
      type,
      content: String(h.Address ?? ""),
      ttl: num(h.TTL),
      prio: type === "MX" ? num(h.MXPref) : undefined,
    };
  });
}

/**
 * The parameters of `namecheap.domains.dns.setHosts`, which replaces every
 * record of the domain: all of them are sent, numbered from 1.
 */
export function namecheapHostParams(records: (RecordSpec | DnsRecord)[]): Record<string, string> {
  const params: Record<string, string> = {};
  records.forEach((r, i) => {
    const n = i + 1;
    params[`HostName${n}`] = r.name || "@";
    params[`RecordType${n}`] = r.type;
    params[`Address${n}`] = r.content;
    params[`TTL${n}`] = String(r.ttl ?? 1800);
    if (r.type === "MX") params[`MXPref${n}`] = String(r.prio ?? 10);
  });
  // MX records are only served with EmailType=MX.
  if (records.some((r) => r.type === "MX")) params.EmailType = "MX";
  return params;
}

// ---------------------------------------------------------------------------
// Dashboards

export function dashboardUrl(d: Pick<Domain, "registrar" | "name">): string {
  switch (d.registrar) {
    case "porkbun":
      return `https://porkbun.com/account/domainsSpeedy?search=${encodeURIComponent(d.name)}`;
    case "gandi":
      return `https://admin.gandi.net/domain/${encodeURIComponent(d.name)}`;
    case "ovh":
      return `https://www.ovh.com/manager/#/web/domain/${encodeURIComponent(d.name)}/information`;
    case "namecheap":
      return `https://ap.www.namecheap.com/domains/domaincontrolpanel/${encodeURIComponent(d.name)}/domain`;
  }
}

export function dnsDashboardUrl(d: Pick<Domain, "registrar" | "name">): string {
  switch (d.registrar) {
    case "porkbun":
      return `https://porkbun.com/account/domainsSpeedy?search=${encodeURIComponent(d.name)}`;
    case "gandi":
      return `https://admin.gandi.net/domain/${encodeURIComponent(d.name)}/records`;
    case "ovh":
      return `https://www.ovh.com/manager/#/web/domain/${encodeURIComponent(d.name)}/zone`;
    case "namecheap":
      return `https://ap.www.namecheap.com/domains/domaincontrolpanel/${encodeURIComponent(d.name)}/advancedns`;
  }
}

/** Runs `fn` on every item, at most `limit` at a time, keeping the order. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
