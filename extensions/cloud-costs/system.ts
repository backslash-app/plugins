// Fetching each provider's month: the aws, bq and az CLIs (they sign in and
// sign the requests themselves), Hetzner's API with a token, and a cache in
// storage, since Cost Explorer charges for every request.

import { exec, storage } from "@backslash/api";
import {
  awsCostArgs,
  awsForecastArgs,
  azureForecastBody,
  azureForecastUrl,
  azureQueryBody,
  azureQueryUrl,
  azureSubscription,
  bqArgs,
  type Costs,
  estimateHetzner,
  gcpTable,
  hetznerResources,
  isFresh,
  parseAwsCosts,
  parseAzureCosts,
  parseBqCosts,
  parseHetznerPricing,
  period,
  type ProviderId,
  PROVIDERS,
  withAwsForecast,
  withAzureForecast,
} from "./lib.ts";

export interface Prefs {
  aws?: boolean;
  awsProfile?: string;
  gcpTable?: string;
  azure?: boolean;
  azureSubscription?: string;
  hetznerToken?: string;
  budget?: number | string;
  warnPercent?: number | string;
}

export class MissingCli extends Error {
  constructor(readonly cli: "aws" | "bq" | "az") {
    super(`The ${cli} command is not installed`);
  }
}

/** The providers turned on in the preferences, in display order. */
export function enabled(p: Prefs): ProviderId[] {
  const on: Record<ProviderId, boolean> = {
    aws: p.aws === true || String(p.aws) === "true",
    gcp: !!String(p.gcpTable ?? "").trim(),
    azure: p.azure === true || String(p.azure) === "true",
    hetzner: !!String(p.hetznerToken ?? "").trim(),
  };
  return PROVIDERS.filter((x) => on[x]);
}

async function cli(program: "aws" | "bq" | "az", args: string[], signal?: AbortSignal): Promise<any> {
  let out: string;
  try {
    out = await exec(program, args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new MissingCli(program);
    throw e;
  }
  try {
    return out ? JSON.parse(out) : undefined;
  } catch {
    throw new Error(`${program} did not answer JSON: ${out.slice(0, 200)}`);
  }
}

async function aws(p: Prefs, signal?: AbortSignal): Promise<Costs> {
  const profile = String(p.awsProfile ?? "").trim();
  // Cost Explorer has one endpoint, in us-east-1.
  const opts = [
    "--region",
    "us-east-1",
    "--output",
    "json",
    "--no-cli-pager",
    ...(profile ? ["--profile", profile] : []),
  ];
  const per = period();
  const pages: any[] = [];
  let token: string | undefined;
  do {
    const page = await cli("aws", [...awsCostArgs(per, token), ...opts], signal);
    pages.push(page);
    token = page?.NextPageToken || undefined;
  } while (token && pages.length < 20);
  const costs = parseAwsCosts(pages, per);
  // A new account has no forecast yet ("insufficient amount of historical data").
  const forecast = await cli("aws", [...awsForecastArgs(per), ...opts], signal).catch(() => undefined);
  return withAwsForecast(costs, forecast, per);
}

async function gcp(p: Prefs, signal?: AbortSignal): Promise<Costs> {
  const table = gcpTable(p.gcpTable);
  const per = period();
  return parseBqCosts(await cli("bq", bqArgs(table, per), signal), per);
}

async function azure(p: Prefs, signal?: AbortSignal): Promise<Costs> {
  const sub = azureSubscription(p.azureSubscription) ??
    String(await cli("az", ["account", "show", "--query", "id", "--output", "json"], signal) ?? "");
  if (!sub) throw new Error("No Azure subscription: run az login, or set the subscription ID in Settings");
  const per = period();
  // `az rest` calls the Cost Management API with the CLI's sign-in (same API as `az costmanagement query`).
  const post = (url: string, body: unknown) =>
    cli("az", ["rest", "--method", "post", "--url", url, "--body", JSON.stringify(body), "--output", "json"], signal);
  const pages: any[] = [];
  let url: string | undefined = azureQueryUrl(sub);
  while (url && pages.length < 20) {
    const page = await post(url, azureQueryBody());
    pages.push(page);
    url = page?.properties?.nextLink || undefined;
  }
  const costs = parseAzureCosts(pages, per);
  const forecast = await post(azureForecastUrl(sub), azureForecastBody(per)).catch(() => undefined);
  return withAzureForecast(costs, forecast, per);
}

async function hetzner(p: Prefs, signal?: AbortSignal): Promise<Costs> {
  const token = String(p.hetznerToken ?? "").trim();
  const get = async (path: string) => {
    let res: Response;
    try {
      res = await fetch(`https://api.hetzner.cloud/v1${path}`, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(`Cannot reach Hetzner Cloud: ${e instanceof Error ? e.message : e}`);
    }
    if (res.status === 401) throw new Error("Hetzner refused the token: check it in Settings");
    const body = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(body?.error?.message ?? `Hetzner answered ${res.status}`);
    return body;
  };
  const all = async (path: string, key: string) => {
    const out: any[] = [];
    for (let page = 1; page && page <= 20;) {
      const body = await get(`${path}?per_page=50&page=${page}`);
      out.push(...(body?.[key] ?? []));
      page = body?.meta?.pagination?.next_page ?? 0;
    }
    return out;
  };
  const [pricing, servers, volumes, loadBalancers, primaryIps] = await Promise.all([
    get("/pricing"),
    all("/servers", "servers"),
    all("/volumes", "volumes"),
    all("/load_balancers", "load_balancers"),
    all("/primary_ips", "primary_ips"),
  ]);
  const prices = parseHetznerPricing(pricing);
  return estimateHetzner(hetznerResources(prices, { servers, volumes, loadBalancers, primaryIps }), prices.currency);
}

const LOADERS: Record<ProviderId, (p: Prefs, signal?: AbortSignal) => Promise<Costs>> = { aws, gcp, azure, hetzner };

/** A provider's month, from the cache while it is fresh (or `force` to refetch). */
export async function costs(provider: ProviderId, p: Prefs, o: { force?: boolean; signal?: AbortSignal } = {}) {
  const key = `costs:${provider}`;
  if (!o.force) {
    const cached = await storage.get<Costs>(key).catch(() => undefined);
    if (cached && isFresh(cached, provider)) return { costs: cached, cached: true };
  }
  const fresh = await LOADERS[provider](p, o.signal);
  await storage.set(key, fresh).catch(() => {});
  return { costs: fresh, cached: false };
}

export interface Loaded {
  results: { provider: ProviderId; costs: Costs; cached: boolean }[];
  errors: { provider: ProviderId; error: unknown }[];
}

/** Every enabled provider in parallel. */
export async function loadAll(p: Prefs, o: { force?: boolean; signal?: AbortSignal } = {}): Promise<Loaded> {
  const providers = enabled(p);
  const settled = await Promise.allSettled(providers.map((x) => costs(x, p, o)));
  const out: Loaded = { results: [], errors: [] };
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") out.results.push({ provider: providers[i], ...r.value });
    else out.errors.push({ provider: providers[i], error: r.reason });
  });
  return out;
}

/** Forgets the cache, so the next load asks every provider again. */
export async function clearCache() {
  await Promise.all(PROVIDERS.map((x) => storage.delete(`costs:${x}`).catch(() => {})));
}

export async function notify(title: string, body: string) {
  await exec("notify-send", ["-a", "Backslash", "-i", "dialog-warning", title, body]).catch(() => {});
}
