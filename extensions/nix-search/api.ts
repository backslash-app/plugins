// search.nixos.org's Elasticsearch backend, with the public credentials its own page uses.

import { storage } from "@backslash/api";
import { type Backend, FALLBACK, indexName, parseBackend, scriptUrl } from "./lib.ts";

const SITE = "https://search.nixos.org";
const DAY = 24 * 60 * 60 * 1000;

/** The index version and channels change a few times a year: read them from the site, once a day. */
export async function backend(signal?: AbortSignal, force = false): Promise<Backend> {
  const cached = (await storage.get("backend").catch(() => undefined)) as unknown as
    | { at: number; value: Backend }
    | undefined;
  if (!force && cached && Date.now() - cached.at < DAY) return cached.value;
  try {
    const page = await (await fetch(`${SITE}/packages`, { signal })).text();
    const script = scriptUrl(page);
    const found = script ? parseBackend(await (await fetch(script, { signal })).text()) : undefined;
    if (found) {
      await storage.set("backend", { at: Date.now(), value: found } as never).catch(() => {});
      return found;
    }
  } catch (e) {
    if (signal?.aborted) throw e;
  }
  return cached?.value ?? FALLBACK;
}

async function post(b: Backend, channel: string, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(`${SITE}/backend/${indexName(b, channel)}/_search`, {
      method: "POST",
      signal,
      headers: { Authorization: `Basic ${btoa(`${b.username}:${b.password}`)}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("search.nixos.org can't be reached: check your connection");
  }
}

/** Runs a query on a channel's index; reads the index name again if it moved. */
export async function query(channel: string, body: unknown, signal?: AbortSignal): Promise<any> {
  let b = await backend(signal);
  let res = await post(b, channel, body, signal);
  if (res.status === 404 || res.status === 401) {
    b = await backend(signal, true);
    res = await post(b, channel, body, signal);
  }
  if (!res.ok) throw new Error(`search.nixos.org answered ${res.status}`);
  return await res.json();
}
