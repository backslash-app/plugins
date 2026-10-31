// The AUR's RPC (v5) and cgit, on aur.archlinux.org.

import { type AurPackage, infoUrls, parseRpc, pkgbuildUrl, rank, searchTerms, searchUrl } from "./lib.ts";

async function get(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { signal, headers: { "User-Agent": "Backslash AUR extension" } });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("The AUR can't be reached: check your connection");
  }
}

async function rpc(url: string, signal?: AbortSignal): Promise<AurPackage[]> {
  const res = await get(url, signal);
  if (res.status === 429) throw new Error("The AUR is limiting requests from your address: try again later");
  if (res.status >= 500) throw new Error(`The AUR is having trouble (${res.status}): try again later`);
  // Errors come back as JSON too, often with a 4xx status.
  const json = await res.json().catch(() => undefined);
  if (json === undefined) throw new Error(`The AUR answered ${res.status}`);
  return parseRpc(json);
}

/** Packages whose name or description has every word, best matches first. */
export async function search(query: string, signal?: AbortSignal): Promise<AurPackage[]> {
  const terms = searchTerms(query);
  if (!terms) return [];
  return rank(await rpc(searchUrl(terms.term), signal), query);
}

/** Full details (dependencies, licenses…) of these packages, by name. */
export async function info(names: string[], signal?: AbortSignal): Promise<Map<string, AurPackage>> {
  const found = await Promise.all(infoUrls([...new Set(names)]).map((u) => rpc(u, signal)));
  return new Map(found.flat().map((p) => [p.Name, p]));
}

export async function pkgbuild(base: string, signal?: AbortSignal): Promise<string> {
  const res = await get(pkgbuildUrl(base), signal);
  if (!res.ok) throw new Error(`The AUR has no PKGBUILD for ${base} (${res.status})`);
  const text = await res.text();
  // cgit answers 200 with an HTML error page for unknown bases.
  if (/^\s*<!DOCTYPE html|<html/i.test(text)) throw new Error(`The AUR has no PKGBUILD for ${base}`);
  return text;
}
