// Network and cache: Tempo colors for 30 minutes (10 while tomorrow is unknown), EcoWatt for 15 minutes
// (RTE allows one call per quarter hour), day-ahead prices for an hour.

import { storage } from "@backslash/api";
import {
  addDays,
  ECOWATT_URL,
  type EcowattDay,
  parisDate,
  parseEcowatt,
  parsePrices,
  parseStats,
  parseTempoDay,
  parseTempoDays,
  type PricePoint,
  RTE_TOKEN_URL,
  rteCredentials,
  seasonOf,
  spotUrl,
  TEMPO_API,
  type TempoDay,
  type TempoStats,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function cached<T>(key: string, ttl: (v: T) => number, fresh: boolean, get: () => Promise<T>): Promise<T> {
  const hit = fresh ? undefined : await load<{ at: number; value: T }>(key);
  if (hit && Date.now() - hit.at < ttl(hit.value)) return hit.value;
  try {
    const value = await get();
    await save(key, { at: Date.now(), value });
    return value;
  } catch (e) {
    // Better yesterday's answer than none, unless the user left.
    if (hit && !(e instanceof DOMException && e.name === "AbortError")) return hit.value;
    throw e;
  }
}

async function getJson(url: string, service: string, signal?: AbortSignal, init: RequestInit = {}): Promise<unknown> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: "application/json", ...init.headers as Record<string, string> },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new Error(`${service} refused the credentials: check them in Settings → Extensions → Electricity`);
  }
  if (res.status === 429) {
    await res.body?.cancel();
    throw new Error(`${service} asks to slow down: try again in a few minutes`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${service} answered ${res.status}`);
  }
  return await res.json();
}

const MIN = 60_000;

export interface Tempo {
  today?: TempoDay;
  tomorrow?: TempoDay;
  stats?: TempoStats;
  season: TempoDay[];
}

export async function tempo(o: { signal?: AbortSignal; fresh?: boolean; season?: boolean } = {}): Promise<Tempo> {
  const day = parisDate();
  const fresh = !!o.fresh;
  const get = (path: string) => getJson(`${TEMPO_API}${path}`, "api-couleur-tempo.fr", o.signal);
  const [today, tomorrow, stats, season] = await Promise.all([
    cached(`tempo:${day}`, () => 30 * MIN, fresh, async () => parseTempoDay(await get("/jourTempo/today")) ?? null),
    cached(
      `tempo:${addDays(day, 1)}`,
      (d: TempoDay | null) => !d || d.color === "unknown" ? 10 * MIN : 6 * 60 * MIN,
      fresh,
      async () => parseTempoDay(await get("/jourTempo/tomorrow")) ?? null,
    ),
    cached(`stats:${day}`, () => 60 * MIN, fresh, async () => parseStats(await get("/stats")) ?? null)
      .catch(() => null),
    o.season === false ? Promise.resolve([] as TempoDay[]) : cached(
      `season:${seasonOf(day)}`,
      () => 6 * 60 * MIN,
      fresh,
      async () => parseTempoDays(await get(`/joursTempo?periode=${seasonOf(day)}`)),
    ).catch(() => [] as TempoDay[]),
  ]);
  return { today: today ?? undefined, tomorrow: tomorrow ?? undefined, stats: stats ?? undefined, season };
}

// EcoWatt: the access token lives in memory only (two hours); the signals are cached.
let rteToken: { value: string; until: number; for: string } | undefined;

async function token(credentials: string, signal?: AbortSignal): Promise<string> {
  if (rteToken && rteToken.for === credentials && Date.now() < rteToken.until) return rteToken.value;
  const body = await getJson(RTE_TOKEN_URL, "RTE", signal, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  }) as { access_token?: string; expires_in?: number };
  if (!body.access_token) throw new Error("RTE gave no access token: check the EcoWatt credentials");
  rteToken = {
    value: body.access_token,
    until: Date.now() + Math.max(60, (body.expires_in ?? 7200) - 60) * 1000,
    for: credentials,
  };
  return rteToken.value;
}

export async function ecowatt(
  secret: unknown,
  o: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<EcowattDay[] | undefined> {
  const credentials = rteCredentials(secret);
  if (!credentials) return undefined;
  // Never more than one call every 15 minutes, even on Refresh: RTE answers 429 otherwise.
  return await cached("ecowatt", () => 15 * MIN, false, async () => {
    const t = await token(credentials, o.signal);
    return parseEcowatt(
      await getJson(ECOWATT_URL, "RTE EcoWatt", o.signal, { headers: { Authorization: `Bearer ${t}` } }),
    );
  });
}

export async function spotPrices(o: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<PricePoint[]> {
  const day = parisDate();
  return await cached(
    `spot:${day}`,
    // Tomorrow's prices come out around 13:00: look again sooner until they're there.
    (points: PricePoint[]) => points.some((p) => parisDate(p.start) === addDays(day, 1)) ? 6 * 60 * MIN : 30 * MIN,
    !!o.fresh,
    async () => parsePrices(await getJson(spotUrl(day, addDays(day, 1)), "Energy-Charts", o.signal)),
  );
}
