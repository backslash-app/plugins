// Network and cache: the feed list and the stations are kept a day, the live status is always fetched.

import { storage } from "@backslash/api";
import {
  type Feeds,
  hostAllowed,
  HOSTS,
  parseDiscovery,
  parseStations,
  parseStatus,
  parseVehicleTypes,
  type Propulsion,
  type Station,
  type Status,
  type System,
  systemName,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];
const DAY = 86_400_000;

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

export class HostError extends Error {}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Not a feed URL: ${url}`);
  }
  if (!hostAllowed(host)) {
    throw new HostError(
      `${host} isn't one of the hosts this extension may reach (${
        HOSTS.join(", ")
      }). Pick a system from the list in Settings, or ask for this one to be added.`,
    );
  }
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${host} is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`${host} answered ${res.status}${res.status === 404 ? ": is the gbfs.json URL right?" : ""}`);
  }
  try {
    return await res.json();
  } catch {
    throw new Error(`${host} didn't send a GBFS feed`);
  }
}

async function cachedJson<T>(key: string, ttl: number, fresh: boolean, get: () => Promise<T>): Promise<T> {
  const hit = fresh ? undefined : await load<{ at: number; value: T }>(key);
  if (hit && Date.now() - hit.at < ttl) return hit.value;
  const value = await get();
  await save(key, { at: Date.now(), value });
  return value;
}

export interface Network {
  name: string;
  feeds: Feeds;
  stations: Station[];
  types: Record<string, Propulsion>;
}

/** The feed list, stations and vehicle types of a system, cached for a day. */
export async function network(system: System, o: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<Network> {
  const fresh = !!o.fresh;
  return await cachedJson<Network>(`network:${system.url}`, DAY, fresh, async () => {
    const feeds = parseDiscovery(await getJson(system.url, o.signal));
    if (!feeds.station_information || !feeds.station_status) {
      throw new Error(`${system.name}'s feed has no stations (free-floating systems aren't supported)`);
    }
    const [info, types, sys] = await Promise.all([
      getJson(feeds.station_information, o.signal),
      feeds.vehicle_types ? getJson(feeds.vehicle_types, o.signal).catch(() => undefined) : undefined,
      system.id === "custom" && feeds.system_information
        ? getJson(feeds.system_information, o.signal).catch(() => undefined)
        : undefined,
    ]);
    const stations = parseStations(info);
    if (!stations.length) throw new Error(`${system.name} lists no stations right now`);
    return {
      name: (sys ? systemName(sys) : undefined) ?? system.name,
      feeds,
      stations,
      types: types ? parseVehicleTypes(types) : {},
    };
  });
}

/** Live bikes and docks of every station. */
export async function liveStatus(net: Network, signal?: AbortSignal): Promise<Map<string, Status>> {
  return parseStatus(await getJson(net.feeds.station_status!, signal), net.types);
}

// Favorite stations: ids per system.

export async function favorites(system: System): Promise<string[]> {
  return await load<string[]>(`favorites:${system.url}`) ?? [];
}

export async function toggleFavorite(system: System, id: string): Promise<boolean> {
  const list = await favorites(system);
  const has = list.includes(id);
  await save(`favorites:${system.url}`, has ? list.filter((x) => x !== id) : [...list, id]);
  return !has;
}
