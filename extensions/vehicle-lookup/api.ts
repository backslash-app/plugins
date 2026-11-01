// Network and cache. A VIN always decodes the same, so decodes are kept for
// good; recalls are kept a day. Recent lookups are remembered for the empty search.

import { storage } from "@backslash/api";
import {
  type Decoded,
  decodeUrl,
  type Recall,
  type RecallsResponse,
  recallsUrl,
  toDecoded,
  toRecalls,
  type VpicResponse,
} from "./lib.ts";

const RECALLS_TTL = 24 * 3600_000;
const RECENT_MAX = 12;

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function getJson<T>(url: string, service: string, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) throw new Error(`${service} answered ${res.status}`);
  try {
    return await res.json() as T;
  } catch {
    throw new Error(`${service} sent something that isn't JSON`);
  }
}

export async function decode(vin: string, signal?: AbortSignal): Promise<Decoded> {
  const key = `vin:${vin}`;
  const cached = await load<VpicResponse>(key);
  if (cached) return toDecoded(cached);
  const res = await getJson<VpicResponse>(decodeUrl(vin), "NHTSA vPIC", signal);
  const decoded = toDecoded(res);
  // Don't remember a failed decode: vPIC may learn the maker later.
  if (decoded.quality !== "failed") await save(key, res);
  return decoded;
}

export async function recalls(make: string, model: string, year: number, signal?: AbortSignal): Promise<Recall[]> {
  const key = `recalls:${make.toLowerCase()}|${model.toLowerCase()}|${year}`;
  const cached = await load<{ at: number; data: RecallsResponse }>(key);
  if (cached && Date.now() - cached.at < RECALLS_TTL) return toRecalls(cached.data);
  const data = await getJson<RecallsResponse>(recallsUrl(make, model, year), "NHTSA recalls", signal);
  await save(key, { at: Date.now(), data });
  return toRecalls(data);
}

export interface Recent {
  vin: string;
  name: string;
  at: number;
}

export async function recent(): Promise<Recent[]> {
  return await load<Recent[]>("recent") ?? [];
}

export async function remember(vin: string, name: string): Promise<void> {
  const list = (await recent()).filter((r) => r.vin !== vin);
  await save("recent", [{ vin, name, at: Date.now() }, ...list].slice(0, RECENT_MAX));
}

export async function forget(vin: string): Promise<void> {
  await save("recent", (await recent()).filter((r) => r.vin !== vin));
}

export async function forgetAll(): Promise<void> {
  await save("recent", []);
}
