// bundlephobia.com (bundle size, similar packages, history), packagephobia.com (install size), npm search.

import {
  bundlephobiaError,
  type BundleSize,
  type InstallSize,
  parseHistory,
  parseInstall,
  parseSearch,
  parseSimilar,
  parseSize,
  type SimilarPackage,
  type Suggestion,
} from "./lib.ts";

const BUNDLEPHOBIA = "https://bundlephobia.com/api";
// Bundlephobia asks API clients to say who they are.
const HEADERS = { Accept: "application/json", "X-Bundlephobia-User": "Backslash launcher" };

const message = (e: unknown) => e instanceof Error ? e.message : String(e);

async function getJson(service: string, url: string, signal?: AbortSignal, headers: HeadersInit = HEADERS) {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach ${service}: ${message(e)}`);
  }
  if (res.status === 429) throw new Error(`${service} is rate limiting: try again in a minute`);
  const text = await res.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    if (!res.ok) throw new Error(`${service} answered ${res.status}`);
    throw new Error(`${service} sent something unexpected`);
  }
  return { ok: res.ok, status: res.status, json: json as any };
}

/** Builds (or reads bundlephobia's cache of) the package: can take a while for a new version. */
export async function bundleSize(spec: string, signal?: AbortSignal): Promise<BundleSize> {
  const { ok, status, json } = await getJson(
    "Bundlephobia",
    `${BUNDLEPHOBIA}/size?package=${encodeURIComponent(spec)}&record=true`,
    signal,
  );
  const size = ok ? parseSize(json) : undefined;
  if (size) return size;
  if (json?.error) throw new Error(bundlephobiaError(json, spec));
  throw new Error(`Bundlephobia answered ${status} for ${spec}`);
}

/** What `npm install` downloads; undefined when packagephobia doesn't know. */
export async function installSize(spec: string, signal?: AbortSignal): Promise<InstallSize | undefined> {
  const { ok, json } = await getJson(
    "Packagephobia",
    `https://packagephobia.com/v2/api.json?p=${encodeURIComponent(spec)}`,
    signal,
    { Accept: "application/json" },
  );
  return ok ? parseInstall(json) : undefined;
}

export async function similar(name: string, signal?: AbortSignal) {
  const { ok, json } = await getJson(
    "Bundlephobia",
    `${BUNDLEPHOBIA}/similar-packages?package=${encodeURIComponent(name)}`,
    signal,
  );
  return ok ? parseSimilar(json) : { packages: [] };
}

export async function history(name: string, signal?: AbortSignal) {
  const { ok, json } = await getJson(
    "Bundlephobia",
    `${BUNDLEPHOBIA}/package-history?package=${encodeURIComponent(name)}`,
    signal,
  );
  return ok ? parseHistory(json) : [];
}

export async function search(text: string, signal?: AbortSignal): Promise<Suggestion[]> {
  const { ok, status, json } = await getJson(
    "npm",
    `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(text)}&size=12`,
    signal,
    { Accept: "application/json" },
  );
  if (!ok) throw new Error(`npm search answered ${status}`);
  return parseSearch(json);
}

/** Sizes of the similar packages that don't come with one, a few at a time, never failing. */
export async function measure(
  packages: SimilarPackage[],
  signal?: AbortSignal,
  max = 6,
): Promise<SimilarPackage[]> {
  return await Promise.all(
    packages.slice(0, max).map(async (p) => {
      if (p.gzip !== undefined) return p;
      try {
        const b = await bundleSize(p.name, AbortSignal.any([AbortSignal.timeout(15_000), ...(signal ? [signal] : [])]));
        return { ...p, gzip: b.gzip, size: b.size, description: p.description ?? b.description };
      } catch {
        return p;
      }
    }),
  );
}
