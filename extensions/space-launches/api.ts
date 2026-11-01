// Network and cache. Launch Library 2 allows about 15 requests an hour
// without a key, so answers are kept 30 minutes and reused when throttled.

import { storage } from "@backslash/api";
import {
  eventsUrl,
  type Kind,
  type Launch,
  launchesUrl,
  type Page,
  slimEvent,
  slimLaunch,
  type SpaceEvent,
  throttleWait,
} from "./lib.ts";

/** Same list as `[permissions] net` in backslash.toml. */
export const HOSTS = ["ll.thespacedevs.com"];

const TTL = 30 * 60_000;

type Json = Parameters<typeof storage.set>[1];

interface Cached<T> {
  at: number;
  data: T;
}

async function load<T>(key: string): Promise<Cached<T> | undefined> {
  return await storage.get(key).catch(() => undefined) as Cached<T> | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export interface Fetched<T> {
  data: T;
  /** When the data was fetched, for "updated 12 min ago". */
  at: number;
  /** Set when the API refused (throttled or down) and an older copy is shown. */
  stale?: string;
}

async function getJson<T>(url: string, token: string | undefined, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      signal,
      headers: { Accept: "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Launch Library is unreachable: ${(e as Error).message}`);
  }
  const body = await res.json().catch(() => ({})) as { detail?: string };
  if (res.status === 429) {
    const wait = throttleWait(body.detail);
    throw new Error(
      `Launch Library's free limit is reached${wait ? `, try again in ${Math.ceil(wait / 60)} min` : ""}`,
    );
  }
  if (res.status === 401 || res.status === 403) throw new Error("Launch Library refused the API key: check it");
  if (!res.ok) throw new Error(`Launch Library answered ${res.status}${body.detail ? `: ${body.detail}` : ""}`);
  return body as T;
}

async function cached<T>(
  key: string,
  url: string,
  slim: (page: Page<T>) => T[],
  o: { token?: string; signal?: AbortSignal; fresh?: boolean },
): Promise<Fetched<T[]>> {
  const old = await load<T[]>(key);
  if (old && !o.fresh && Date.now() - old.at < TTL) return { data: old.data, at: old.at };
  try {
    const data = slim(await getJson<Page<T>>(url, o.token, o.signal));
    const at = Date.now();
    await save(key, { at, data });
    return { data, at };
  } catch (e) {
    if ((e as Error).name === "AbortError" || !old) throw e;
    return { data: old.data, at: old.at, stale: (e as Error).message };
  }
}

export function launches(
  kind: Kind,
  o: { token?: string; signal?: AbortSignal; fresh?: boolean } = {},
): Promise<Fetched<Launch[]>> {
  return cached(`launches:${kind}`, launchesUrl(kind), (p) => (p.results ?? []).map(slimLaunch), o);
}

export function events(
  o: { token?: string; signal?: AbortSignal; fresh?: boolean } = {},
): Promise<Fetched<SpaceEvent[]>> {
  return cached("events:upcoming", eventsUrl(), (p) => (p.results ?? []).map(slimEvent), o);
}
