// One shape for the servers of four providers: parsing their API answers,
// statuses, prices, sorting and the power actions each API offers.

import type { Color } from "@backslash/api";

export type Provider = "hetzner" | "digitalocean" | "linode" | "scaleway";

export const PROVIDERS: Provider[] = ["hetzner", "digitalocean", "linode", "scaleway"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  hetzner: "Hetzner Cloud",
  digitalocean: "DigitalOcean",
  linode: "Linode",
  scaleway: "Scaleway",
};

export const PROVIDER_COLORS: Record<Provider, Color> = {
  hetzner: "red",
  digitalocean: "blue",
  linode: "green",
  scaleway: "purple",
};

/** What every provider's status boils down to. */
export type State = "running" | "busy" | "off" | "other";

export interface Price {
  monthly: number;
  hourly?: number;
  currency: "EUR" | "USD";
}

export interface Server {
  provider: Provider;
  id: string;
  name: string;
  /** The provider's own word for it ("active", "stopped in place"…). */
  status: string;
  state: State;
  ipv4?: string;
  ipv6?: string;
  privateIps: string[];
  region: string;
  regionName?: string;
  type: string;
  cpus?: number;
  /** In GB. */
  memory?: number;
  /** In GB. */
  disk?: number;
  image?: string;
  created?: Date;
  tags: string[];
  price?: Price;
  /** Scaleway only: the zone the API paths need. */
  zone?: string;
  /** Scaleway only: the project, for the console URL. */
  project?: string;
}

const date = (s?: string | null) => {
  const d = s ? new Date(s) : undefined;
  return d && !isNaN(d.getTime()) ? d : undefined;
};

const num = (x: unknown): number | undefined => {
  const n = typeof x === "string" ? Number(x) : x;
  return typeof n === "number" && isFinite(n) ? n : undefined;
};

/** "2a01:4f8:c17:1234::/64" → "2a01:4f8:c17:1234::1": the address a server gets in its block. */
export function ipv6Address(block?: string | null): string | undefined {
  if (!block) return undefined;
  const [addr, len] = block.split("/");
  if (!addr) return undefined;
  if (len && Number(len) < 128 && addr.endsWith("::")) return `${addr}1`;
  return addr;
}

const isPrivateV4 = (ip: string) =>
  /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip);

// --- Hetzner Cloud ------------------------------------------------------------------------

export interface HetznerServer {
  id: number;
  name: string;
  status: string;
  created?: string;
  labels?: Record<string, string>;
  public_net?: { ipv4?: { ip?: string } | null; ipv6?: { ip?: string } | null };
  private_net?: { ip?: string }[];
  server_type?: {
    name?: string;
    cores?: number;
    memory?: number;
    disk?: number;
    prices?: { location: string; price_hourly?: { gross?: string }; price_monthly?: { gross?: string } }[];
  };
  datacenter?: { name?: string; location?: { name?: string; city?: string; country?: string } };
  location?: { name?: string; city?: string; country?: string };
  image?: { name?: string | null; description?: string } | null;
}

const HETZNER_STATES: Record<string, State> = {
  running: "running",
  off: "off",
  initializing: "busy",
  starting: "busy",
  stopping: "busy",
  rebuilding: "busy",
  migrating: "busy",
  deleting: "busy",
};

export function fromHetzner(s: HetznerServer): Server {
  const loc = s.datacenter?.location ?? s.location;
  const region = loc?.name ?? s.datacenter?.name ?? "";
  const price = s.server_type?.prices?.find((p) => p.location === region) ?? s.server_type?.prices?.[0];
  const monthly = num(price?.price_monthly?.gross);
  return {
    provider: "hetzner",
    id: String(s.id),
    name: s.name,
    status: s.status,
    state: HETZNER_STATES[s.status] ?? "other",
    ipv4: s.public_net?.ipv4?.ip || undefined,
    ipv6: ipv6Address(s.public_net?.ipv6?.ip),
    privateIps: (s.private_net ?? []).map((n) => n.ip ?? "").filter(Boolean),
    region,
    regionName: loc?.city ? `${loc.city}${loc.country ? `, ${loc.country}` : ""}` : undefined,
    type: s.server_type?.name ?? "",
    cpus: s.server_type?.cores,
    memory: s.server_type?.memory,
    disk: s.server_type?.disk,
    image: s.image?.description ?? s.image?.name ?? undefined,
    created: date(s.created),
    tags: Object.entries(s.labels ?? {}).map(([k, v]) => v ? `${k}=${v}` : k),
    price: monthly === undefined ? undefined : { monthly, hourly: num(price?.price_hourly?.gross), currency: "EUR" },
  };
}

// --- DigitalOcean -------------------------------------------------------------------------

export interface Droplet {
  id: number;
  name: string;
  status: string;
  memory?: number;
  vcpus?: number;
  disk?: number;
  created_at?: string;
  size_slug?: string;
  size?: { price_monthly?: number; price_hourly?: number };
  image?: { distribution?: string; name?: string };
  networks?: {
    v4?: { ip_address: string; type: string }[];
    v6?: { ip_address: string; type: string }[];
  };
  region?: { slug?: string; name?: string };
  tags?: string[];
}

const DO_STATES: Record<string, State> = { active: "running", off: "off", new: "busy", archive: "other" };

export function fromDigitalOcean(d: Droplet): Server {
  const v4 = d.networks?.v4 ?? [];
  const monthly = num(d.size?.price_monthly);
  return {
    provider: "digitalocean",
    id: String(d.id),
    name: d.name,
    status: d.status,
    state: DO_STATES[d.status] ?? "other",
    ipv4: v4.find((n) => n.type === "public")?.ip_address,
    ipv6: d.networks?.v6?.find((n) => n.type === "public")?.ip_address,
    privateIps: v4.filter((n) => n.type === "private").map((n) => n.ip_address),
    region: d.region?.slug ?? "",
    regionName: d.region?.name,
    type: d.size_slug ?? "",
    cpus: d.vcpus,
    memory: d.memory === undefined ? undefined : d.memory / 1024,
    disk: d.disk,
    image: d.image ? [d.image.distribution, d.image.name].filter(Boolean).join(" ") : undefined,
    created: date(d.created_at),
    tags: d.tags ?? [],
    price: monthly === undefined ? undefined : { monthly, hourly: num(d.size?.price_hourly), currency: "USD" },
  };
}

// --- Linode -------------------------------------------------------------------------------

export interface Linode {
  id: number;
  label: string;
  status: string;
  ipv4?: string[];
  ipv6?: string | null;
  region?: string;
  type?: string | null;
  specs?: { vcpus?: number; memory?: number; disk?: number };
  image?: string | null;
  created?: string;
  tags?: string[];
}

export interface LinodeType {
  id: string;
  label?: string;
  price?: { monthly?: number; hourly?: number };
}

const LINODE_STATES: Record<string, State> = {
  running: "running",
  offline: "off",
  stopped: "off",
  booting: "busy",
  rebooting: "busy",
  shutting_down: "busy",
  provisioning: "busy",
  deleting: "busy",
  migrating: "busy",
  rebuilding: "busy",
  cloning: "busy",
  restoring: "busy",
  resizing: "busy",
};

/** `types` maps a plan id to its price (from the public /linode/types). */
export function fromLinode(l: Linode, types: Record<string, Price> = {}): Server {
  const v4 = l.ipv4 ?? [];
  return {
    provider: "linode",
    id: String(l.id),
    name: l.label,
    status: l.status,
    state: LINODE_STATES[l.status] ?? "other",
    ipv4: v4.find((ip) => !isPrivateV4(ip)),
    ipv6: ipv6Address(l.ipv6),
    privateIps: v4.filter(isPrivateV4),
    region: l.region ?? "",
    type: l.type ?? "",
    cpus: l.specs?.vcpus,
    memory: l.specs?.memory === undefined ? undefined : l.specs.memory / 1024,
    disk: l.specs?.disk === undefined ? undefined : Math.round(l.specs.disk / 1024),
    image: l.image?.replace(/^linode\//, "") || undefined,
    created: date(l.created ? (/Z|[+-]\d\d:?\d\d$/.test(l.created) ? l.created : `${l.created}Z`) : undefined),
    tags: l.tags ?? [],
    price: l.type ? types[l.type] : undefined,
  };
}

export function linodePrices(types: LinodeType[]): Record<string, Price> {
  const out: Record<string, Price> = {};
  for (const t of types) {
    const monthly = num(t.price?.monthly);
    if (monthly !== undefined) out[t.id] = { monthly, hourly: num(t.price?.hourly), currency: "USD" };
  }
  return out;
}

// --- Scaleway -----------------------------------------------------------------------------

export interface ScalewayServer {
  id: string;
  name: string;
  state: string;
  commercial_type?: string;
  zone?: string;
  project?: string;
  arch?: string;
  creation_date?: string;
  tags?: string[];
  image?: { name?: string } | null;
  public_ip?: { address?: string } | null;
  public_ips?: { address?: string; family?: string }[];
  ipv6?: { address?: string } | null;
  private_ip?: string | null;
}

export interface ScalewayProduct {
  monthly_price?: number;
  hourly_price?: number;
  ncpus?: number;
  ram?: number;
  volumes_constraint?: { min_size?: number };
}

const SCALEWAY_STATES: Record<string, State> = {
  running: "running",
  stopped: "off",
  "stopped in place": "off",
  starting: "busy",
  stopping: "busy",
  locked: "other",
};

export function fromScaleway(s: ScalewayServer, zone: string, products: Record<string, ScalewayProduct> = {}): Server {
  const ips = s.public_ips ?? [];
  const product = s.commercial_type ? products[s.commercial_type] : undefined;
  const monthly = num(product?.monthly_price);
  return {
    provider: "scaleway",
    id: s.id,
    name: s.name,
    status: s.state,
    state: SCALEWAY_STATES[s.state] ?? "other",
    ipv4: ips.find((ip) => ip.family === "inet")?.address ?? s.public_ip?.address ?? undefined,
    ipv6: ips.find((ip) => ip.family === "inet6")?.address ?? s.ipv6?.address ?? undefined,
    privateIps: s.private_ip ? [s.private_ip] : [],
    region: s.zone ?? zone,
    type: s.commercial_type ?? "",
    cpus: product?.ncpus,
    memory: product?.ram === undefined ? undefined : product.ram / 1024 ** 3,
    image: s.image?.name ?? undefined,
    created: date(s.creation_date),
    tags: s.tags ?? [],
    price: monthly === undefined ? undefined : { monthly, hourly: num(product?.hourly_price), currency: "EUR" },
    zone: s.zone ?? zone,
    project: s.project,
  };
}

const ZONE = /^[a-z]{2}-[a-z]{3}-\d$/;

/** "fr-par-1, nl-ams-1 junk" → ["fr-par-1", "nl-ams-1"]. */
export function parseZones(text: unknown): string[] {
  const zones = String(text ?? "").toLowerCase().split(/[\s,;]+/).filter((z) => ZONE.test(z));
  return [...new Set(zones)];
}

// --- Actions ------------------------------------------------------------------------------

export type Power = "on" | "shutdown" | "off" | "reboot";

/** The HTTP call that powers a server on, shuts it down, cuts it or reboots it. */
export function powerRequest(s: Server, power: Power): { path: string; body?: Record<string, string> } {
  switch (s.provider) {
    case "hetzner": {
      const verb = { on: "poweron", shutdown: "shutdown", off: "poweroff", reboot: "reboot" }[power];
      return { path: `/v1/servers/${s.id}/actions/${verb}` };
    }
    case "digitalocean": {
      const type = { on: "power_on", shutdown: "shutdown", off: "power_off", reboot: "reboot" }[power];
      return { path: `/v2/droplets/${s.id}/actions`, body: { type } };
    }
    case "linode": {
      // Linode has no separate hard power-off: shutdown is its power-off.
      const verb = { on: "boot", shutdown: "shutdown", off: "shutdown", reboot: "reboot" }[power];
      return { path: `/v4/linode/instances/${s.id}/${verb}` };
    }
    case "scaleway": {
      // "poweroff" stops the server and releases its hypervisor; "stop_in_place" keeps it.
      const verb = { on: "poweron", shutdown: "poweroff", off: "poweroff", reboot: "reboot" }[power];
      return { path: `/instance/v1/zones/${s.zone}/servers/${s.id}/action`, body: { action: verb } };
    }
  }
}

/** Which power actions make sense for this provider and state. */
export function powerChoices(s: Server): Power[] {
  if (s.state === "off") return ["on"];
  if (s.state !== "running") return [];
  if (s.provider === "linode" || s.provider === "scaleway") return ["reboot", "shutdown"];
  return ["reboot", "shutdown", "off"];
}

export function consoleUrl(s: Server): string {
  switch (s.provider) {
    case "hetzner":
      // Tokens belong to a project the API does not name: the project list is one click away.
      return "https://console.hetzner.com/projects";
    case "digitalocean":
      return `https://cloud.digitalocean.com/droplets/${s.id}`;
    case "linode":
      return `https://cloud.linode.com/linodes/${s.id}`;
    case "scaleway":
      return `https://console.scaleway.com/instance/servers/${s.zone}/${s.id}/overview`;
  }
}

export function sshCommand(s: Server, user = "root"): string[] | undefined {
  const host = s.ipv4 ?? s.ipv6;
  if (!host) return undefined;
  const login = user.trim() || "root";
  return ["ssh", `${login}@${host}`];
}

// --- Formatting ---------------------------------------------------------------------------

const ORDER: State[] = ["running", "busy", "off", "other"];

/** By provider (in PROVIDERS order), running first, by name. */
export function sortServers(servers: Server[]): Server[] {
  return [...servers].sort((a, b) =>
    PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider) ||
    ORDER.indexOf(a.state) - ORDER.indexOf(b.state) ||
    a.name.localeCompare(b.name)
  );
}

export const STATE_COLORS: Record<State, Color> = { running: "green", busy: "yellow", off: "gray", other: "orange" };

/** "stopped in place" → "Stopped in place", "shutting_down" → "Shutting down". */
export function statusLabel(status: string): string {
  const s = status.replace(/_/g, " ");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/** €4.59/mo, $6/mo. */
export function formatPrice(p?: Price): string {
  if (!p) return "";
  const sign = p.currency === "EUR" ? "€" : "$";
  const value = Number.isInteger(p.monthly) ? String(p.monthly) : p.monthly.toFixed(2);
  return `${sign}${value}/mo`;
}

/** 0.5 → "512 MB", 4 → "4 GB". */
export function formatMemory(gb?: number): string {
  if (gb === undefined) return "";
  return gb < 1 ? `${Math.round(gb * 1024)} MB` : `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

export function specs(s: Server): string {
  return [
    s.cpus ? `${s.cpus} vCPU` : "",
    formatMemory(s.memory),
    s.disk ? `${s.disk} GB disk` : "",
  ].filter(Boolean).join(" · ");
}

export function monthlyTotal(servers: Server[]): string {
  const sums = new Map<string, number>();
  for (const s of servers) {
    if (s.price) sums.set(s.price.currency, (sums.get(s.price.currency) ?? 0) + s.price.monthly);
  }
  return [...sums].map(([currency, monthly]) =>
    formatPrice({ monthly: Math.round(monthly * 100) / 100, currency: currency as Price["currency"] })
  ).join(" + ");
}

export function age(date: Date | undefined, now = new Date()): string {
  if (!date) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

export const formatDate = (d?: Date) => d ? d.toLocaleDateString("en-GB", { dateStyle: "medium" }) : "";
