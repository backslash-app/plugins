// The providers' REST APIs: authentication, pagination, errors and power actions.

import { storage } from "@backslash/api";
import {
  type Droplet,
  fromDigitalOcean,
  fromHetzner,
  fromLinode,
  fromScaleway,
  type HetznerServer,
  type Linode,
  linodePrices,
  type LinodeType,
  parseZones,
  type Power,
  powerRequest,
  type Price,
  type Provider,
  PROVIDER_NAMES,
  PROVIDERS,
  type ScalewayProduct,
  type ScalewayServer,
  type Server,
} from "./lib.ts";

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = ["api.hetzner.cloud", "api.digitalocean.com", "api.linode.com", "api.scaleway.com"];

const BASES: Record<Provider, string> = {
  hetzner: "https://api.hetzner.cloud",
  digitalocean: "https://api.digitalocean.com",
  linode: "https://api.linode.com",
  scaleway: "https://api.scaleway.com",
};

export const TOKEN_PAGES: Record<Provider, string> = {
  hetzner: "https://docs.hetzner.com/cloud/api/getting-started/generating-api-token/",
  digitalocean: "https://cloud.digitalocean.com/account/api/tokens",
  linode: "https://cloud.linode.com/profile/tokens",
  scaleway: "https://console.scaleway.com/iam/api-keys",
};

export interface Prefs {
  hetznerToken?: string;
  digitaloceanToken?: string;
  linodeToken?: string;
  scalewaySecretKey?: string;
  scalewayZones?: string;
  sshUser?: string;
  terminal?: string;
}

export interface Account {
  provider: Provider;
  token: string;
  zones: string[];
}

/** The providers that have a token, in display order. */
export function accounts(prefs: Prefs): Account[] {
  const tokens: Record<Provider, string | undefined> = {
    hetzner: prefs.hetznerToken,
    digitalocean: prefs.digitaloceanToken,
    linode: prefs.linodeToken,
    scaleway: prefs.scalewaySecretKey,
  };
  return PROVIDERS.flatMap((provider) => {
    const token = String(tokens[provider] ?? "").trim();
    return token ? [{ provider, token, zones: provider === "scaleway" ? parseZones(prefs.scalewayZones) : [] }] : [];
  });
}

export class TokenError extends Error {
  constructor(readonly provider: Provider) {
    super(`${PROVIDER_NAMES[provider]} refused the token: check it in Settings`);
  }
}

function headers(a: Account, json: boolean): Record<string, string> {
  return {
    ...(a.provider === "scaleway" ? { "X-Auth-Token": a.token } : { Authorization: `Bearer ${a.token}` }),
    ...(json ? { "Content-Type": "application/json" } : {}),
    Accept: "application/json",
  };
}

/** The message of a provider's error body, whatever its shape. */
export function errorMessage(body: unknown): string {
  const b = body as Record<string, any> | undefined;
  return String(
    b?.error?.message ?? b?.message ?? b?.errors?.[0]?.reason ?? (typeof b?.error === "string" ? b.error : "") ?? "",
  );
}

export async function call<T>(
  a: Account,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<{ data: T; headers: Headers }> {
  let res: Response;
  try {
    res = await fetch(`${BASES[a.provider]}${path}`, {
      method: o.method ?? "GET",
      headers: headers(a, o.body !== undefined),
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
      signal: o.signal,
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Cannot reach ${PROVIDER_NAMES[a.provider]}: ${e instanceof Error ? e.message : e}`);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (res.status === 401) throw new TokenError(a.provider);
  if (!res.ok) {
    const msg = errorMessage(data);
    if (res.status === 403) {
      throw new Error(
        `${PROVIDER_NAMES[a.provider]} denied it${
          msg ? `: ${msg}` : ""
        }. The token needs write access to change servers`,
      );
    }
    if (res.status === 429) throw new Error(`${PROVIDER_NAMES[a.provider]} rate limit reached: try again in a minute`);
    throw new Error(`${PROVIDER_NAMES[a.provider]} answered ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return { data: data as T, headers: res.headers };
}

const MAX_PAGES = 10;

async function hetzner(a: Account, signal: AbortSignal): Promise<Server[]> {
  const out: Server[] = [];
  for (let page = 1; page && page <= MAX_PAGES;) {
    const { data } = await call<{ servers: HetznerServer[]; meta?: { pagination?: { next_page?: number | null } } }>(
      a,
      `/v1/servers?per_page=50&page=${page}`,
      { signal },
    );
    out.push(...data.servers.map(fromHetzner));
    page = data.meta?.pagination?.next_page ?? 0;
  }
  return out;
}

async function digitalocean(a: Account, signal: AbortSignal): Promise<Server[]> {
  const out: Server[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await call<{ droplets: Droplet[]; links?: { pages?: { next?: string } } }>(
      a,
      `/v2/droplets?per_page=200&page=${page}`,
      { signal },
    );
    out.push(...data.droplets.map(fromDigitalOcean));
    if (!data.links?.pages?.next) break;
  }
  return out;
}

/** Plan prices barely change: cached for a week (the endpoint is public). */
async function linodeTypes(a: Account, signal: AbortSignal): Promise<Record<string, Price>> {
  const cached = await storage.get("linode-types").catch(() => undefined) as
    | { at: number; prices: Record<string, Price> }
    | undefined;
  if (cached && Date.now() - cached.at < 7 * 86_400_000) return cached.prices;
  try {
    const { data } = await call<{ data: LinodeType[] }>(a, "/v4/linode/types?page_size=500", { signal });
    const prices = linodePrices(data.data);
    await storage.set("linode-types", { at: Date.now(), prices } as never).catch(() => {});
    return prices;
  } catch (e) {
    if (signal.aborted) throw e;
    return cached?.prices ?? {};
  }
}

async function linode(a: Account, signal: AbortSignal): Promise<Server[]> {
  const typesPromise = linodeTypes(a, signal);
  const all: Linode[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data } = await call<{ data: Linode[]; page: number; pages: number }>(
      a,
      `/v4/linode/instances?page=${page}&page_size=100`,
      { signal },
    );
    all.push(...data.data);
    if (data.page >= data.pages) break;
  }
  const types = await typesPromise;
  return all.map((l) => fromLinode(l, types));
}

async function scalewayProducts(a: Account, zone: string, signal: AbortSignal) {
  const key = `scaleway-products:${zone}`;
  const cached = await storage.get(key).catch(() => undefined) as
    | { at: number; servers: Record<string, ScalewayProduct> }
    | undefined;
  if (cached && Date.now() - cached.at < 7 * 86_400_000) return cached.servers;
  try {
    const { data } = await call<{ servers: Record<string, ScalewayProduct> }>(
      a,
      `/instance/v1/zones/${zone}/products/servers?per_page=100`,
      { signal },
    );
    const servers = Object.fromEntries(
      Object.entries(data.servers ?? {}).map(([k, p]) => [k, {
        monthly_price: p.monthly_price,
        hourly_price: p.hourly_price,
        ncpus: p.ncpus,
        ram: p.ram,
      }]),
    );
    await storage.set(key, { at: Date.now(), servers } as never).catch(() => {});
    return servers;
  } catch (e) {
    if (signal.aborted) throw e;
    return cached?.servers ?? {};
  }
}

async function scalewayZone(a: Account, zone: string, signal: AbortSignal): Promise<Server[]> {
  const productsPromise = scalewayProducts(a, zone, signal);
  const all: ScalewayServer[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, headers } = await call<{ servers: ScalewayServer[] }>(
      a,
      `/instance/v1/zones/${zone}/servers?per_page=100&page=${page}`,
      { signal },
    );
    all.push(...data.servers);
    const total = Number(headers.get("x-total-count") ?? all.length);
    if (all.length >= total || !data.servers.length) break;
  }
  const products = await productsPromise;
  return all.map((s) => fromScaleway(s, zone, products));
}

async function scaleway(a: Account, signal: AbortSignal): Promise<Server[]> {
  if (!a.zones.length) throw new Error("No valid Scaleway zone: set them in Settings (fr-par-1, nl-ams-1…)");
  const settled = await Promise.allSettled(a.zones.map((z) => scalewayZone(a, z, signal)));
  const failed = settled.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  // A bad token fails everywhere: report it once instead of half a list.
  if (failed && (failed.reason instanceof TokenError || settled.every((r) => r.status === "rejected"))) {
    throw failed.reason;
  }
  return settled.flatMap((r) => r.status === "fulfilled" ? r.value : []);
}

const LOADERS: Record<Provider, (a: Account, signal: AbortSignal) => Promise<Server[]>> = {
  hetzner,
  digitalocean,
  linode,
  scaleway,
};

export const loadServers = (a: Account, signal: AbortSignal) => LOADERS[a.provider](a, signal);

export async function power(a: Account, s: Server, p: Power): Promise<void> {
  const req = powerRequest(s, p);
  await call(a, req.path, { method: "POST", body: req.body ?? (s.provider === "linode" ? {} : undefined) });
}
