// Container registries: image references, Docker Hub / Quay / OCI registry JSON mapping, pull commands.
// Pure, tested in lib_test.ts.

export type RegistryId = "docker" | "ghcr" | "quay";

export type Tint = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export interface Registry {
  id: RegistryId;
  title: string;
  host: string;
  tint: Tint;
}

export const REGISTRIES: Record<RegistryId, Registry> = {
  docker: { id: "docker", title: "Docker Hub", host: "docker.io", tint: "blue" },
  ghcr: { id: "ghcr", title: "GitHub Container Registry", host: "ghcr.io", tint: "purple" },
  quay: { id: "quay", title: "Quay.io", host: "quay.io", tint: "red" },
};

export interface ImageRef {
  registry: RegistryId;
  /** `library/nginx`, `owner/image`, `ns/name`. */
  repository: string;
  /** What follows `:`, to filter the tags with (may be empty: `nginx:`). */
  tag?: string;
  digest?: string;
}

const HOSTS: Record<string, RegistryId> = {
  "docker.io": "docker",
  "index.docker.io": "docker",
  "registry-1.docker.io": "docker",
  "hub.docker.com": "docker",
  "ghcr.io": "ghcr",
  "quay.io": "quay",
};

const NAME = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*$/;

/**
 * Reads what was typed: `nginx:1.27`, `grafana/grafana`, `docker.io/library/nginx`,
 * `ghcr.io/owner/image:tag`, `quay.io/ns/name@sha256:…`, or a registry web page URL.
 * Returns undefined for words to search for (`nginx`, `node exporter`).
 */
export function parseImageRef(input: string): ImageRef | undefined {
  let s = input.trim();
  if (!s || /\s/.test(s)) return undefined;
  // Web pages.
  let m = s.match(/^https?:\/\/hub\.docker\.com\/(?:_\/([^/?#]+)|r\/([^/?#]+\/[^/?#]+))/);
  if (m) return { registry: "docker", repository: m[1] ? `library/${m[1]}` : m[2] };
  m = s.match(/^https?:\/\/quay\.io\/repository\/([^/?#]+\/[^/?#]+)/);
  if (m) return { registry: "quay", repository: m[1] };
  m = s.match(/^https?:\/\/github\.com\/(?:orgs|users)\/([^/]+)\/packages\/container\/(?:package\/)?([^/?#]+)/);
  if (m) return { registry: "ghcr", repository: `${m[1]}/${decodeURIComponent(m[2])}`.toLowerCase() };
  s = s.replace(/^https?:\/\//, "");

  let digest: string | undefined;
  const at = s.indexOf("@");
  if (at >= 0) {
    digest = s.slice(at + 1);
    s = s.slice(0, at);
  }
  let tag: string | undefined;
  const colon = s.lastIndexOf(":");
  if (colon > s.lastIndexOf("/")) {
    tag = s.slice(colon + 1);
    s = s.slice(0, colon);
  }
  const parts = s.split("/");
  let registry: RegistryId = "docker";
  let explicit = tag !== undefined || digest !== undefined;
  if (parts.length > 1 && (parts[0].includes(".") || parts[0].includes(":") || parts[0] === "localhost")) {
    const id = HOSTS[parts[0].toLowerCase()];
    if (!id) return undefined;
    registry = id;
    parts.shift();
    explicit = true;
  }
  const repository = parts.join("/").toLowerCase();
  if (!repository || !NAME.test(repository)) return undefined;
  if (!explicit) return undefined;
  if (registry !== "docker" && !repository.includes("/")) return undefined;
  return {
    registry,
    repository: registry === "docker" && !repository.includes("/") ? `library/${repository}` : repository,
    ...(tag !== undefined ? { tag } : {}),
    ...(digest ? { digest } : {}),
  };
}

/** How `docker pull` writes it: `nginx`, `grafana/grafana`, `ghcr.io/owner/image`. */
export function shortName(registry: RegistryId, repository: string): string {
  if (registry === "docker") return repository.replace(/^library\//, "");
  return `${REGISTRIES[registry].host}/${repository}`;
}

/** Fully qualified, as podman wants it (no short-name prompt): `docker.io/library/nginx`. */
export const fullName = (registry: RegistryId, repository: string) => `${REGISTRIES[registry].host}/${repository}`;

export interface PullCommand {
  title: string;
  command: string;
}

export function pullCommands(registry: RegistryId, repository: string, tag: string, digest?: string): PullCommand[] {
  const short = shortName(registry, repository);
  const full = fullName(registry, repository);
  return [
    { title: "docker pull", command: `docker pull ${short}:${tag}` },
    ...(digest ? [{ title: "docker pull by digest", command: `docker pull ${short}@${digest}` }] : []),
    { title: "podman pull", command: `podman pull ${full}:${tag}` },
    ...(digest ? [{ title: "podman pull by digest", command: `podman pull ${full}@${digest}` }] : []),
  ];
}

/** The image's (or tag's) page on the registry's website. */
export function webUrl(registry: RegistryId, repository: string, tag?: string): string {
  const q = tag ? encodeURIComponent(tag) : "";
  switch (registry) {
    case "docker": {
      const base = repository.startsWith("library/")
        ? `https://hub.docker.com/_/${repository.slice(8)}`
        : `https://hub.docker.com/r/${repository}`;
      return tag ? `${base}/tags?name=${q}` : base;
    }
    case "ghcr":
      // ghcr.io sends browsers to the package's page on GitHub.
      return `https://ghcr.io/${repository}`;
    case "quay":
      return `https://quay.io/repository/${repository}${tag ? `?tab=tags&tag=${q}` : ""}`;
  }
}

// ---------------------------------------------------------------------------
// Search results

export interface ImageSummary {
  registry: RegistryId;
  repository: string;
  description?: string;
  official?: boolean;
  stars?: number;
  pulls?: number;
  updated?: string;
}

/** Docker Hub `/v2/search/repositories`: official images first, then the API's order. */
export function mapHubSearch(json: any): ImageSummary[] {
  const items: ImageSummary[] = (json?.results ?? []).map((r: any) => {
    const name = String(r.repo_name ?? "");
    return {
      registry: "docker" as const,
      repository: name.includes("/") ? name : `library/${name}`,
      description: r.short_description || undefined,
      official: !!r.is_official,
      stars: r.star_count ?? undefined,
      pulls: r.pull_count ?? undefined,
    };
  }).filter((i: ImageSummary) => i.repository && NAME.test(i.repository));
  return [...items.filter((i) => i.official), ...items.filter((i) => !i.official)];
}

/** Quay `/api/v1/find/repositories`. */
export function mapQuaySearch(json: any): ImageSummary[] {
  return (json?.results ?? [])
    .filter((r: any) => (r.kind ?? "repository") === "repository" && r.name && r.namespace)
    .map((r: any) => ({
      registry: "quay" as const,
      repository: `${typeof r.namespace === "string" ? r.namespace : r.namespace.name}/${r.name}`,
      description: firstLine(r.description),
      stars: r.stars ?? undefined,
      updated: typeof r.last_modified === "number" ? new Date(r.last_modified * 1000).toISOString() : undefined,
    }));
}

/** The first line of a markdown description, without markup. */
export function firstLine(md: string | undefined | null): string | undefined {
  const line = (md ?? "").split("\n").map((l) => l.replace(/^#+\s*|[*_`]/g, "").trim()).find(Boolean);
  if (!line) return undefined;
  return line.length > 140 ? `${line.slice(0, 139)}…` : line;
}

// ---------------------------------------------------------------------------
// Tags

export interface Platform {
  os: string;
  architecture: string;
  variant?: string;
  digest?: string;
  /** Compressed size, in bytes. */
  size?: number;
}

export interface Tag {
  name: string;
  /** Of the tag (an index for multi-arch images). */
  digest?: string;
  /** Compressed size of the main platform, in bytes. */
  size?: number;
  platforms: Platform[];
  /** ISO dates. */
  pushed?: string;
  pulled?: string;
  multiArch?: boolean;
  /** Details still to load (GHCR lists names only). */
  partial?: boolean;
}

export const platformLabel = (p: Platform) => [p.os, p.architecture, p.variant].filter(Boolean).join("/");

/** Attestations and signatures ride along in indexes as `unknown/unknown`: not platforms. */
const realPlatform = (p: Platform) => p.os !== "unknown" && p.architecture !== "unknown";

export function mapHubTags(json: any): Tag[] {
  return (json?.results ?? []).map((r: any) => {
    const platforms: Platform[] = (r.images ?? []).map((i: any) => ({
      os: i.os ?? "",
      architecture: i.architecture ?? "",
      ...(i.variant ? { variant: i.variant } : {}),
      ...(i.digest ? { digest: i.digest } : {}),
      ...(typeof i.size === "number" ? { size: i.size } : {}),
    })).filter(realPlatform);
    return {
      name: String(r.name),
      ...(r.digest ? { digest: r.digest } : {}),
      ...(typeof r.full_size === "number" ? { size: r.full_size } : {}),
      platforms,
      ...(r.tag_last_pushed || r.last_updated ? { pushed: r.tag_last_pushed ?? r.last_updated } : {}),
      ...(r.tag_last_pulled ? { pulled: r.tag_last_pulled } : {}),
      multiArch: /index|list/.test(String(r.media_type ?? "")) || platforms.length > 1,
    };
  });
}

/** Quay `/api/v1/repository/{ns}/{name}/tag/`. */
export function mapQuayTags(json: any): Tag[] {
  return (json?.tags ?? []).map((t: any) => ({
    name: String(t.name),
    ...(t.manifest_digest ? { digest: t.manifest_digest } : {}),
    ...(typeof t.size === "number" ? { size: t.size } : {}),
    platforms: [],
    ...(t.last_modified ? { pushed: toIso(t.last_modified) } : t.start_ts ? { pushed: toIso(t.start_ts) } : {}),
    multiArch: !!t.is_manifest_list,
    ...(t.is_manifest_list ? { partial: true } : {}),
  }));
}

function toIso(v: string | number): string | undefined {
  const d = typeof v === "number" ? new Date(v * 1000) : new Date(v);
  return isNaN(d.getTime()) ? undefined : d.toISOString();
}

/** The platforms of an OCI index or Docker manifest list. */
export function platformsOf(index: any): Platform[] {
  return (index?.manifests ?? [])
    .map((m: any) => ({
      os: m.platform?.os ?? "unknown",
      architecture: m.platform?.architecture ?? "unknown",
      ...(m.platform?.variant ? { variant: m.platform.variant } : {}),
      ...(m.digest ? { digest: m.digest } : {}),
    }))
    .filter(realPlatform);
}

export const isIndex = (manifest: any) =>
  Array.isArray(manifest?.manifests) || /index|list/.test(String(manifest?.mediaType ?? ""));

/** Compressed size of an image manifest: its layers and config. */
export function imageSize(manifest: any): number | undefined {
  const layers = manifest?.layers;
  if (!Array.isArray(layers)) return undefined;
  return layers.reduce((n: number, l: any) => n + (Number(l.size) || 0), 0) + (Number(manifest.config?.size) || 0);
}

export interface ImageConfig {
  created?: string;
  labels: Record<string, string>;
  os?: string;
  architecture?: string;
}

export function mapConfig(config: any): ImageConfig {
  return {
    ...(config?.created ? { created: config.created } : {}),
    labels: config?.config?.Labels ?? {},
    ...(config?.os ? { os: config.os } : {}),
    ...(config?.architecture ? { architecture: config.architecture } : {}),
  };
}

/** `Bearer realm="https://ghcr.io/token",service="ghcr.io",scope="repository:x/y:pull"` */
export function parseChallenge(header: string | null): { realm: string; service?: string; scope?: string } | undefined {
  if (!header || !/^bearer\s/i.test(header)) return undefined;
  const params: Record<string, string> = {};
  for (const m of header.matchAll(/(\w+)="([^"]*)"/g)) params[m[1].toLowerCase()] = m[2];
  if (!params.realm) return undefined;
  return { realm: params.realm, service: params.service, scope: params.scope };
}

/** The `next` URL of a `Link: </v2/x/tags/list?last=a&n=1000>; rel="next"` header, relative to `base`. */
export function nextLink(header: string | null, base: string): string | undefined {
  const m = header?.match(/<([^>]+)>\s*;\s*rel="?next"?/);
  return m ? new URL(m[1], base).toString() : undefined;
}

/** Splits a tag into numbers and words, to sort versions naturally. */
function versionKey(tag: string): (number | string)[] {
  return tag.replace(/^v(?=\d)/, "").split(/(\d+)/).filter(Boolean).map((p) => /^\d+$/.test(p) ? Number(p) : p);
}

/** Whether a tag looks like a release version (`1.27.3`, `v2.1`), not a build or a branch. */
const isVersion = (tag: string) => /^v?\d+(\.\d+)*$/.test(tag);

/**
 * Registries without dates (GHCR) list tags alphabetically: show `latest` and the
 * like first, then release versions newest first, then the rest, newest-looking first.
 */
export function sortTagNames(names: string[]): string[] {
  const pinned = ["latest", "stable", "main", "master", "edge", "nightly", "dev"];
  const cmp = (a: string, b: string) => {
    const ka = versionKey(a);
    const kb = versionKey(b);
    for (let i = 0; i < Math.max(ka.length, kb.length); i++) {
      const x = ka[i];
      const y = kb[i];
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      if (x === y) continue;
      if (typeof x === "number" && typeof y === "number") return y - x;
      if (typeof x === "number") return -1;
      if (typeof y === "number") return 1;
      return x < y ? 1 : -1;
    }
    return 0;
  };
  const first = pinned.filter((p) => names.includes(p));
  const rest = names.filter((n) => !pinned.includes(n));
  return [
    ...first,
    ...rest.filter(isVersion).sort(cmp),
    ...rest.filter((n) => !isVersion(n) && !/^sha256-/.test(n)).sort(cmp),
    // Cosign signatures and attestations.
    ...rest.filter((n) => /^sha256-/.test(n)).sort(),
  ];
}

/** Tags matching what follows `:` (prefix first, then substring). */
export function filterTags<T extends { name: string }>(tags: T[], filter: string | undefined): T[] {
  const f = (filter ?? "").toLowerCase();
  if (!f) return tags;
  return [
    ...tags.filter((t) => t.name.toLowerCase().startsWith(f)),
    ...tags.filter((t) => !t.name.toLowerCase().startsWith(f) && t.name.toLowerCase().includes(f)),
  ];
}

// ---------------------------------------------------------------------------
// Repository details

export interface RepoDetails {
  description?: string;
  readme?: string;
  stars?: number;
  pulls?: number;
  updated?: string;
  created?: string;
  categories: string[];
}

export function mapHubRepo(json: any): RepoDetails {
  return {
    description: json?.description || undefined,
    readme: json?.full_description || undefined,
    stars: json?.star_count ?? undefined,
    pulls: json?.pull_count ?? undefined,
    updated: json?.last_updated ?? undefined,
    created: json?.date_registered ?? undefined,
    categories: (json?.categories ?? []).map((c: any) => String(c.name ?? c)).filter(Boolean),
  };
}

export function mapQuayRepo(json: any): RepoDetails {
  return {
    description: firstLine(json?.description),
    readme: json?.description || undefined,
    stars: undefined,
    categories: [],
  };
}

/** A README for the side panel: the first `maxLines` lines, HTML comments and badges removed. */
export function trimReadme(md: string, maxLines = 80): string {
  const lines = md.replace(/<!--[\s\S]*?-->/g, "").replace(/\r\n?/g, "\n").split("\n")
    // Badge rows: lines made only of images or linked images.
    .filter((l) => !/^\s*(\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?\s*)+$/.test(l));
  const out: string[] = [];
  let blank = false;
  let cut = false;
  for (const [i, l] of lines.entries()) {
    if (!l.trim()) {
      if (!blank && out.length) out.push("");
      blank = true;
      continue;
    }
    blank = false;
    out.push(l);
    if (out.length >= maxLines) {
      cut = lines.slice(i + 1).some((rest) => rest.trim());
      break;
    }
  }
  // Close a code block cut in the middle.
  if (out.filter((l) => l.trim().startsWith("```")).length % 2) out.push("```");
  const text = out.join("\n").trim();
  return cut ? `${text}\n\n…` : text;
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1000) return `${n} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let v = n / 1000;
  let i = 0;
  while (v >= 1000 && i < units.length - 1) v /= 1000, i++;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function compact(n: number | undefined): string {
  if (n === undefined) return "";
  if (n < 1000) return String(n);
  const units = ["K", "M", "B"];
  let v = n;
  let i = -1;
  while (v >= 1000 && i < units.length - 1) v /= 1000, i++;
  return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}${units[i]}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 days ago", "3 months ago", "2 years ago". */
export function relativeDate(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d === 1) return "yesterday";
  if (d < 45) return `${d} days ago`;
  const months = Math.floor(d / 30);
  if (d < 730) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.floor(d / 365)} years ago`;
}

export const shortDigest = (d: string | undefined) => d ? d.replace(/^sha256:/, "").slice(0, 12) : "";
