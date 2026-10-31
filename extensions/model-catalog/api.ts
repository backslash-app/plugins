// OpenRouter's public model list, cached in the extension's storage, and the comparison set.

import { storage } from "@backslash/api";
import { type Model, parseModels } from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];

const CACHE = "models";
const COMPARE = "compare";

export async function fetchModels(signal?: AbortSignal): Promise<Model[]> {
  let res: Response;
  try {
    res = await fetch("https://openrouter.ai/api/v1/models", { headers: { Accept: "application/json" }, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach OpenRouter: ${e instanceof Error ? e.message : e}`);
  }
  if (res.status === 429) throw new Error("OpenRouter is rate limiting: try again in a minute");
  if (!res.ok) throw new Error(`OpenRouter answered ${res.status}`);
  const models = parseModels(await res.json().catch(() => undefined));
  if (!models.length) throw new Error("OpenRouter sent no model");
  return models;
}

export async function cachedModels(): Promise<{ at?: number; models: Model[] }> {
  const c = await storage.get(CACHE).catch(() => undefined) as { at?: number; models?: Model[] } | undefined;
  return { at: c?.at, models: Array.isArray(c?.models) ? c.models : [] };
}

export async function saveModels(models: Model[], at = Date.now()): Promise<void> {
  await storage.set(CACHE, { at, models } as unknown as Json).catch(() => {});
}

export async function compared(): Promise<string[]> {
  const ids = await storage.get(COMPARE).catch(() => undefined);
  return Array.isArray(ids) ? ids.map(String) : [];
}

export async function saveCompared(ids: string[]): Promise<void> {
  await storage.set(COMPARE, ids);
}
