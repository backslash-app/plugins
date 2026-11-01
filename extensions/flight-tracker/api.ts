// Network and cache. OpenSky counts API credits per day (anonymous: 400, an
// account's API client: 4,000), so answers are kept 20 seconds for an area,
// 60 for the whole world, and your city forever.

import { storage } from "@backslash/api";
import {
  areaUrl,
  geocodingUrl,
  type GeoResult,
  icaoUrl,
  parseCoordinates,
  pickPlace,
  type Place,
  type Point,
  splitCity,
  type StatesResponse,
  TOKEN_URL,
  worldUrl,
} from "./lib.ts";

const AREA_TTL = 20_000;
const WORLD_TTL = 60_000;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export interface Credentials {
  clientId: string;
  clientSecret: string;
}

/** API credits left today, from the last answer's `x-rate-limit-remaining`. */
export let creditsLeft: number | undefined;

let token: { value: string; until: number; for: string } | undefined;

/** An OAuth2 access token for an OpenSky API client (client credentials flow), kept until it expires. */
async function accessToken(c: Credentials, signal?: AbortSignal, fresh = false): Promise<string> {
  if (!fresh && token && token.for === c.clientId && Date.now() < token.until) return token.value;
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      signal,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: c.clientId,
        client_secret: c.clientSecret,
      }),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`OpenSky's sign-in service is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({})) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !body.access_token) {
    throw new Error(
      res.status === 401 || body.error === "invalid_client"
        ? "OpenSky refused your API client: check its client ID and secret in Settings → Extensions → Flight Tracker"
        : `OpenSky's sign-in service answered ${res.status}${body.error ? `: ${body.error}` : ""}`,
    );
  }
  // Renewed a minute early.
  token = { value: body.access_token, until: Date.now() + ((body.expires_in ?? 1800) - 60) * 1000, for: c.clientId };
  return token.value;
}

/** "in 3 h 20 min" from a number of seconds. */
function inTime(seconds: number): string {
  const m = Math.ceil(seconds / 60);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
}

/** Thrown when the day's credits are used up. */
export class RateLimited extends Error {}

export async function getStates(
  url: string,
  creds: Credentials | undefined,
  signal?: AbortSignal,
): Promise<StatesResponse> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (creds) headers.authorization = `Bearer ${await accessToken(creds, signal)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal, headers });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`OpenSky is unreachable: ${(e as Error).message}`);
  }
  const left = Number(res.headers.get("x-rate-limit-remaining"));
  if (res.headers.has("x-rate-limit-remaining") && Number.isFinite(left)) creditsLeft = left;
  if (res.status === 429) {
    const retry = Number(res.headers.get("x-rate-limit-retry-after-seconds"));
    creditsLeft = 0;
    throw new RateLimited(
      `OpenSky's daily API credits are used up${
        Number.isFinite(retry) && retry > 0 ? `: they come back ${inTime(retry)}` : ""
      }. ` +
        (creds
          ? "Your API client gets 4,000 a day."
          : "Anonymous use gets 400 a day; add an OpenSky API client in the settings for 4,000."),
    );
  }
  if (res.status === 401 && creds) {
    token = undefined;
    throw new Error("OpenSky refused the access token: check the API client in the settings");
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim().slice(0, 200);
    throw new Error(`OpenSky answered ${res.status}${text && !text.startsWith("<") ? `: ${text}` : ""}`);
  }
  return await res.json() as StatesResponse;
}

const memory = new Map<string, { at: number; data: StatesResponse }>();

async function cached(
  key: string,
  url: string,
  ttl: number,
  creds: Credentials | undefined,
  signal?: AbortSignal,
  fresh = false,
  persist = true,
): Promise<StatesResponse> {
  const hit = memory.get(key) ?? (persist ? await load<{ at: number; data: StatesResponse }>(key) : undefined);
  if (!fresh && hit && Date.now() - hit.at < ttl) return hit.data;
  const data = await getStates(url, creds, signal);
  const entry = { at: Date.now(), data };
  memory.set(key, entry);
  if (persist) await save(key, entry);
  return data;
}

/** Aircraft within `radiusKm` of a point (1 credit up to about 200 km in mid-latitudes). */
export function around(
  p: Point,
  radiusKm: number,
  creds?: Credentials,
  signal?: AbortSignal,
  fresh = false,
): Promise<StatesResponse> {
  const key = `area:${p.latitude.toFixed(3)},${p.longitude.toFixed(3)}:${radiusKm}`;
  return cached(key, areaUrl(p, radiusKm), AREA_TTL, creds, signal, fresh);
}

/** One transponder, wherever it is. */
export function byIcao(icao24: string, creds?: Credentials, signal?: AbortSignal): Promise<StatesResponse> {
  return cached(`icao:${icao24}`, icaoUrl([icao24]), AREA_TTL, creds, signal);
}

/** Every aircraft in the world (4 credits), kept in memory only: it is over a megabyte. */
export function world(creds?: Credentials, signal?: AbortSignal, fresh = false): Promise<StatesResponse> {
  return cached("world", worldUrl(), WORLD_TTL, creds, signal, fresh, false);
}

/** The API client preferences, when both are filled in. */
export function credentialsOf(prefs: Record<string, unknown>): Credentials | undefined {
  const clientId = String(prefs.clientId ?? "").trim();
  const clientSecret = String(prefs.clientSecret ?? "").trim();
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Open-Meteo is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`Open-Meteo answered ${res.status}`);
  return await res.json() as T;
}

/** The location preference as a point: typed coordinates, or a city looked up once and remembered. */
export async function resolveLocation(text: string, signal?: AbortSignal): Promise<Place | undefined> {
  const value = text.trim();
  if (!value) return undefined;
  const point = parseCoordinates(value);
  if (point) return { ...point, name: `${point.latitude}, ${point.longitude}` };
  const key = `place:${value.toLowerCase()}`;
  const known = await load<Place>(key);
  if (known) return known;
  const { name, hint } = splitCity(value);
  const res = await getJson<{ results?: GeoResult[] }>(geocodingUrl(name), signal);
  const place = pickPlace(res.results ?? [], hint);
  if (!place) throw new Error(`No city named “${value}”: check the location in the extension settings`);
  await save(key, place);
  return place;
}
