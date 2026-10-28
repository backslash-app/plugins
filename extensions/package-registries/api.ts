// One search per registry, over their public JSON APIs.

import {
  escapeModule,
  looksLikeModule,
  mapCrates,
  mapGems,
  mapGo,
  mapHex,
  mapMaven,
  mapNuget,
  mapPackagist,
  mapPub,
  mapPypi,
  mavenQuery,
  type Package,
  packagistLatest,
  pubNames,
  pypiCandidates,
  type RegistryId,
} from "./lib.ts";

// crates.io refuses requests without a User-Agent saying who is calling.
const USER_AGENT = "Backslash launcher package search (https://github.com/backslash-app/plugins)";

export class NotFound extends Error {}

async function get(url: string, signal: AbortSignal, accept = "application/json"): Promise<any> {
  const res = await fetch(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: accept } });
  if (res.status === 404) throw new NotFound(url);
  if (res.status === 429) throw new Error(`${new URL(url).host} is rate limiting: wait a little`);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return await res.json();
}

const optional = (p: Promise<any>) => p.catch((e) => (e instanceof NotFound ? undefined : Promise.reject(e)));
const q = encodeURIComponent;

const SEARCHES: Record<RegistryId, (query: string, signal: AbortSignal) => Promise<Package[]>> = {
  async crates(query, signal) {
    return mapCrates(await get(`https://crates.io/api/v1/crates?q=${q(query)}&per_page=20`, signal));
  },

  async pypi(query, signal) {
    // No search API: exact JSON lookups for the likely names.
    const names = pypiCandidates(query);
    const found = await Promise.all(names.map((n) => optional(get(`https://pypi.org/pypi/${n}/json`, signal))));
    return found.filter(Boolean).map(mapPypi);
  },

  async go(query, signal) {
    const path = query.trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
    if (!looksLikeModule(path)) return [];
    // Also the newer major versions, which are separate modules (/v2, /v3…).
    const paths = /\/v\d+$/.test(path) ? [path] : [path, `${path}/v2`, `${path}/v3`, `${path}/v4`, `${path}/v5`];
    const latest = await Promise.all(
      paths.map((p) =>
        optional(get(`https://proxy.golang.org/${escapeModule(p)}/@latest`, signal)).catch(() => undefined)
      ),
    );
    return paths.flatMap((p, i) => latest[i] ? [mapGo(p, latest[i])] : []).reverse();
  },

  async gems(query, signal) {
    return mapGems(await get(`https://rubygems.org/api/v1/search.json?query=${q(query)}`, signal)).slice(0, 20);
  },

  async packagist(query, signal) {
    const json = await get(`https://packagist.org/search.json?q=${q(query)}&per_page=15`, signal);
    // Versions and licenses come from the static metadata files, top results only.
    const names: string[] = (json.results ?? []).slice(0, 8).map((r: any) => r.name);
    const files = await Promise.all(
      names.map((n) => get(`https://repo.packagist.org/p2/${n}.json`, signal).catch(() => undefined)),
    );
    const latest = Object.fromEntries(names.map((n, i) => [n, packagistLatest(files[i], n)]));
    return mapPackagist(json, latest);
  },

  async maven(query, signal) {
    const json = await get(
      `https://search.maven.org/solrsearch/select?q=${q(mavenQuery(query))}&rows=20&wt=json`,
      signal,
    );
    return mapMaven(json);
  },

  async hex(query, signal) {
    return mapHex(await get(`https://hex.pm/api/packages?search=${q(query)}&sort=recent_downloads`, signal)).slice(
      0,
      20,
    );
  },

  async pub(query, signal) {
    const names = pubNames(await get(`https://pub.dev/api/search?q=${q(query)}`, signal)).slice(0, 8);
    const details = await Promise.all(names.map((n) =>
      Promise.all([
        get(`https://pub.dev/api/packages/${n}`, signal, "application/vnd.pub.v2+json"),
        get(`https://pub.dev/api/packages/${n}/score`, signal).catch(() => undefined),
      ]).catch(() => undefined)
    ));
    return details.filter((d): d is [any, any] => !!d).map(([pkg, score]) => mapPub(pkg, score));
  },

  async nuget(query, signal) {
    return mapNuget(
      await get(`https://azuresearch-usnc.nuget.org/query?q=${q(query)}&take=20&semVerLevel=2.0.0`, signal),
    );
  },
};

export const searchRegistry = (id: RegistryId, query: string, signal: AbortSignal) => SEARCHES[id](query, signal);
