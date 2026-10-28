// Docker Hub's and Quay's JSON APIs, and the OCI distribution API (anonymous tokens) for GHCR and Quay.

import {
  type ImageConfig,
  imageSize,
  type ImageSummary,
  isIndex,
  mapConfig,
  mapHubRepo,
  mapHubSearch,
  mapHubTags,
  mapQuayRepo,
  mapQuaySearch,
  mapQuayTags,
  nextLink,
  parseChallenge,
  type Platform,
  platformsOf,
  type RegistryId,
  type RepoDetails,
  sortTagNames,
  type Tag,
} from "./lib.ts";

export class NotFound extends Error {}

const q = encodeURIComponent;

async function getJson(url: string, signal?: AbortSignal, headers: Record<string, string> = {}): Promise<any> {
  const res = await fetch(url, { signal, headers: { Accept: "application/json", ...headers } });
  if (res.status === 404) throw new NotFound(url);
  if (res.status === 429) throw new Error(`${new URL(url).host} is rate limiting: wait a minute`);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return await res.json();
}

// ---------------------------------------------------------------------------
// Search

export async function search(registry: RegistryId, query: string, signal: AbortSignal): Promise<ImageSummary[]> {
  if (registry === "quay") {
    return mapQuaySearch(await getJson(`https://quay.io/api/v1/find/repositories?query=${q(query)}&page=1`, signal));
  }
  return mapHubSearch(
    await getJson(`https://hub.docker.com/v2/search/repositories/?query=${q(query)}&page_size=25`, signal),
  );
}

export async function repoDetails(
  registry: RegistryId,
  repository: string,
  signal?: AbortSignal,
): Promise<RepoDetails> {
  if (registry === "docker") {
    return mapHubRepo(await getJson(`https://hub.docker.com/v2/repositories/${repository}/`, signal));
  }
  if (registry === "quay") return mapQuayRepo(await getJson(`https://quay.io/api/v1/repository/${repository}`, signal));
  return { categories: [] };
}

// ---------------------------------------------------------------------------
// OCI distribution API with anonymous bearer tokens

const HOST: Record<"ghcr" | "quay", string> = { ghcr: "ghcr.io", quay: "quay.io" };
const tokens = new Map<string, string>();

const MANIFEST_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
  "application/vnd.oci.image.manifest.v1+json",
  "application/vnd.docker.distribution.manifest.v2+json",
].join(", ");

/** GETs a registry URL, fetching an anonymous pull token when the registry asks for one. */
async function registryGet(url: string, repository: string, signal?: AbortSignal, accept = "application/json") {
  const host = new URL(url).host;
  const key = `${host}/${repository}`;
  const attempt = () =>
    fetch(url, {
      signal,
      headers: { Accept: accept, ...(tokens.has(key) ? { Authorization: `Bearer ${tokens.get(key)}` } : {}) },
    });
  let res = await attempt();
  if (res.status === 401) {
    const challenge = parseChallenge(res.headers.get("www-authenticate"));
    await res.body?.cancel();
    if (!challenge) throw new Error(`${host} wants credentials`);
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
    tokenUrl.searchParams.set("scope", challenge.scope ?? `repository:${repository}:pull`);
    const t = await fetch(tokenUrl, { signal });
    if (t.status === 401 || t.status === 403) {
      await t.body?.cancel();
      throw new NotFound(`${host}/${repository} doesn't exist or is private`);
    }
    if (!t.ok) throw new Error(`${host} refused a token (${t.status})`);
    const body = await t.json();
    tokens.set(key, body.token ?? body.access_token);
    res = await attempt();
  }
  if (res.status === 404 || res.status === 403) {
    await res.body?.cancel();
    throw new NotFound(`${host}/${repository} doesn't exist or is private`);
  }
  if (res.status === 429) throw new Error(`${host} is rate limiting: wait a minute`);
  if (!res.ok) throw new Error(`${host} answered ${res.status}`);
  return res;
}

/** Every tag name (GHCR lists them alphabetically, 1000 a page). */
async function listTagNames(registry: "ghcr" | "quay", repository: string, signal: AbortSignal): Promise<string[]> {
  const names: string[] = [];
  let url: string | undefined = `https://${HOST[registry]}/v2/${repository}/tags/list?n=1000`;
  for (let page = 0; url && page < 10; page++) {
    const res = await registryGet(url, repository, signal);
    const body = await res.json();
    names.push(...(body.tags ?? []));
    url = nextLink(res.headers.get("link"), url);
  }
  return names;
}

export interface ManifestInfo {
  digest?: string;
  platforms: Platform[];
  multiArch: boolean;
  /** Of the first platform (or the image). */
  size?: number;
  /** The image manifest's config blob digest, for dates and labels. */
  config?: string;
}

export async function manifest(
  registry: "ghcr" | "quay",
  repository: string,
  reference: string,
  signal?: AbortSignal,
): Promise<ManifestInfo> {
  const base = `https://${HOST[registry]}/v2/${repository}/manifests/`;
  const res = await registryGet(base + reference, repository, signal, MANIFEST_TYPES);
  const digest = res.headers.get("docker-content-digest") ?? undefined;
  const body = await res.json();
  if (!isIndex(body)) {
    return { digest, platforms: [], multiArch: false, size: imageSize(body), config: body.config?.digest };
  }
  const platforms = platformsOf(body);
  // The first platform's own manifest gives a size and a config.
  const first = platforms.find((p) => p.os === "linux" && p.architecture === "amd64") ?? platforms[0];
  let size: number | undefined;
  let config: string | undefined;
  if (first?.digest) {
    const image = await (await registryGet(base + first.digest, repository, signal, MANIFEST_TYPES)).json()
      .catch(() => undefined);
    size = imageSize(image);
    config = image?.config?.digest;
    first.size = size;
  }
  return { digest, platforms, multiArch: true, size, config };
}

/** The image config: creation date and labels. Blobs are served from a CDN host (pkg-containers.githubusercontent.com). */
export async function imageConfig(
  registry: "ghcr" | "quay",
  repository: string,
  digest: string,
  signal?: AbortSignal,
): Promise<ImageConfig> {
  const res = await registryGet(`https://${HOST[registry]}/v2/${repository}/blobs/${digest}`, repository, signal);
  return mapConfig(await res.json());
}

/** Runs `fn` on every item, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** How many tags get their manifest fetched up front on GHCR; the others load on demand. */
const DETAILED = 12;

export async function tags(
  registry: RegistryId,
  repository: string,
  signal: AbortSignal,
  filter?: string,
): Promise<Tag[]> {
  if (registry === "docker") {
    const name = filter ? `&name=${q(filter)}` : "";
    return mapHubTags(
      await getJson(
        `https://hub.docker.com/v2/repositories/${repository}/tags?page_size=100&ordering=last_updated${name}`,
        signal,
      ),
    );
  }
  if (registry === "quay") {
    const found = mapQuayTags(
      await getJson(
        `https://quay.io/api/v1/repository/${repository}/tag/?onlyActiveTags=true&limit=100&page=1${
          filter ? `&filter_tag_name=like:${q(filter)}` : ""
        }`,
        signal,
      ),
    );
    // Multi-arch tags: their platforms and sizes from the registry, for the first ones.
    const lists = found.filter((t) => t.partial).slice(0, DETAILED);
    await pool(lists, 4, async (t) => {
      const m = await manifest("quay", repository, t.digest ?? t.name, signal).catch(() => undefined);
      if (!m) return;
      Object.assign(t, { platforms: m.platforms, size: m.size ?? t.size, partial: false });
    });
    return found;
  }
  const names = sortTagNames(await listTagNames("ghcr", repository, signal));
  const list: Tag[] = names.map((name) => ({ name, platforms: [], partial: true }));
  const wanted = (filter ? list.filter((t) => t.name.startsWith(filter)) : list).slice(0, DETAILED);
  await pool(wanted, 4, async (t) => {
    const m = await manifest("ghcr", repository, t.name, signal).catch(() => undefined);
    if (!m) return;
    Object.assign(t, {
      digest: m.digest,
      platforms: m.platforms,
      size: m.size,
      multiArch: m.multiArch,
      partial: false,
    });
  });
  return list;
}

/** Everything about one tag: manifest, platforms, and the config's date and labels when reachable. */
export async function tagDetails(
  registry: RegistryId,
  repository: string,
  tag: Tag,
  signal?: AbortSignal,
): Promise<{ tag: Tag; config?: ImageConfig }> {
  if (registry === "docker") return { tag };
  const m = await manifest(registry, repository, tag.name, signal);
  const full: Tag = {
    ...tag,
    digest: m.digest ?? tag.digest,
    platforms: m.platforms.length ? m.platforms : tag.platforms,
    size: m.size ?? tag.size,
    multiArch: m.multiArch,
    partial: false,
  };
  const config = m.config
    ? await imageConfig(registry, repository, m.config, signal).catch(() => undefined)
    : undefined;
  if (config?.created && !full.pushed) full.pushed = config.created;
  return { tag: full, config };
}
