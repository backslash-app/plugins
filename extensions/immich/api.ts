// Immich's API with an API key (x-api-key), and thumbnails cached on disk:
// they need the key in a header, which a picture shown by the launcher
// can't carry.

import { Icons, type Item, open } from "@backslash/api";
import { type Album, type Asset, freePath, isAllowedHost, type Memory, type MemoryLane, normalizeUrl } from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly kind: "url" | "key" | "host" | "down", readonly base?: string) {
    super(message);
  }
}

/** A request the server refused as invalid (400): an older Immich without this option. */
export class BadRequest extends Error {}
/** An API route this server doesn't have (404 from Immich itself): an older or newer version. */
export class NotFound extends Error {}

export interface Server {
  base: string;
  key: string;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function server(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.url);
  if (!base) throw new SetupError("Add the address of your Immich server", "url");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${preferences.url}” is not an address`, "url");
  }
  if (!isAllowedHost(host)) throw new SetupError(`${host} is outside the networks this extension may reach`, "host");
  const key = String(preferences.apiKey ?? "").trim();
  if (!key) throw new SetupError("Add an Immich API key", "key", base);
  return { base, key };
}

export async function request(
  s: Server,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; timeout?: number; accept?: string } = {},
): Promise<Response> {
  const timeout = AbortSignal.timeout(o.timeout ?? 20_000);
  let res: Response;
  try {
    res = await fetch(`${s.base}/api${path}`, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        "x-api-key": s.key,
        Accept: o.accept ?? "application/json",
        ...(o.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(s.base).hostname} is outside the networks this extension may reach`, "host");
    }
    throw new SetupError(`Can't reach Immich at ${new URL(s.base).host}: ${describe(e)}`, "down", s.base);
  }
  if (res.status === 401) {
    await res.body?.cancel();
    throw new SetupError("Immich refused the API key: check it in Settings", "key", s.base);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    let detail = "";
    let fromImmich = false;
    try {
      const body = JSON.parse(text);
      fromImmich = true;
      detail = Array.isArray(body.message) ? body.message.join(", ") : String(body.message ?? body.error ?? "");
    } catch {
      detail = /^\s*</.test(text) ? "" : text.slice(0, 160);
    }
    if (res.status === 403) {
      throw new Error(`Immich: the API key lacks a permission${detail ? ` (${detail})` : ""}`);
    }
    if (res.status === 400) throw new BadRequest(`Immich refused the request${detail ? `: ${detail}` : ""}`);
    if (res.status === 404) {
      if (fromImmich) throw new NotFound(`Immich has no ${path.split("?")[0]}${detail ? `: ${detail}` : ""}`);
      throw new SetupError(`No Immich API at ${s.base}: check the address`, "url", s.base);
    }
    throw new Error(`Immich answered ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res;
}

export async function json<T>(s: Server, path: string, o: Parameters<typeof request>[2] = {}): Promise<T> {
  const res = await request(s, path, o);
  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new SetupError(`${s.base} answers, but not as Immich: check the address`, "url", s.base);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

interface SearchResponse {
  assets: { items: Asset[]; total?: number; nextPage?: string | null };
}

/** CLIP search: "dog on the beach", "receipts", "sunset in Lisbon". */
export async function smartSearch(s: Server, query: string, signal?: AbortSignal, size = 48): Promise<Asset[]> {
  const r = await json<SearchResponse>(s, "/search/smart", {
    method: "POST",
    body: { query, size, withExif: true },
    signal,
  });
  return r.assets.items;
}

export async function metadataSearch(
  s: Server,
  filters: Record<string, unknown>,
  signal?: AbortSignal,
  size = 48,
): Promise<Asset[]> {
  const r = await json<SearchResponse>(s, "/search/metadata", {
    method: "POST",
    body: { size, withExif: true, withPeople: true, order: "desc", ...filters },
    signal,
  });
  return r.assets.items;
}

export const albums = (s: Server, signal?: AbortSignal) => json<Album[]>(s, "/albums", { signal });

/** An album's pictures, newest first: the metadata search by album, or the album's own list on older servers. */
export async function albumAssets(s: Server, id: string, signal?: AbortSignal): Promise<Asset[]> {
  try {
    return await metadataSearch(s, { albumIds: [id] }, signal, 250);
  } catch (e) {
    if (!(e instanceof BadRequest)) throw e;
    const album = await json<Album & { assets?: Asset[] }>(s, `/albums/${id}`, { signal });
    return [...(album.assets ?? [])].reverse();
  }
}

/** Today's memories: `/memories?for=` (1.119+), or the old memory lane. */
export async function memories(
  s: Server,
  now: Date,
  signal?: AbortSignal,
): Promise<{ kind: "memories"; list: Memory[] } | { kind: "lane"; list: MemoryLane[] }> {
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${
    String(now.getDate()).padStart(2, "0")
  }`;
  try {
    try {
      return { kind: "memories", list: await json<Memory[]>(s, `/memories?for=${day}`, { signal }) };
    } catch (e) {
      // Before `for` existed, the list holds every memory; showAt and hideAt pick today's.
      if (!(e instanceof BadRequest)) throw e;
      return { kind: "memories", list: await json<Memory[]>(s, "/memories", { signal }) };
    }
  } catch (e) {
    if (!(e instanceof NotFound)) throw e;
    const list = await json<MemoryLane[]>(s, `/assets/memory-lane?day=${now.getDate()}&month=${now.getMonth() + 1}`, {
      signal,
    });
    return { kind: "lane", list };
  }
}

let external: { base: string; domain?: string } | undefined;

/** The public address for shared links, when the admin set one. */
export async function externalDomain(s: Server): Promise<string | undefined> {
  if (external?.base === s.base) return external.domain;
  const config = await json<{ externalDomain?: string }>(s, "/server/config").catch(() => undefined);
  external = { base: s.base, domain: config?.externalDomain || undefined };
  return external.domain;
}

export async function createShareLink(s: Server, assetId: string): Promise<{ key: string; slug?: string | null }> {
  return await json<{ key: string; slug?: string | null }>(s, "/shared-links", {
    method: "POST",
    body: { type: "INDIVIDUAL", assetIds: [assetId], allowDownload: true, showMetadata: true },
  });
}

export async function setFavorite(s: Server, id: string, isFavorite: boolean): Promise<void> {
  await request(s, "/assets", { method: "PUT", body: { ids: [id], isFavorite } }).then((r) => r.body?.cancel());
}

// ---------------------------------------------------------------------------
// Files

const env = (k: string) => {
  try {
    return Deno.env.get(k) ?? "";
  } catch {
    return "";
  }
};
export const HOME = env("HOME");
export const CACHE = `${HOME}/.cache/backslash/immich`;
export const PICTURES = `${HOME}/Pictures`;

const exists = (p: string) => {
  try {
    return Deno.statSync(p).size > 0;
  } catch {
    return false;
  }
};

/** The original file in ~/Pictures under its own name; returns the path. */
export async function downloadOriginal(s: Server, asset: { id: string; name: string }): Promise<string> {
  const res = await request(s, `/assets/${asset.id}/original`, {
    timeout: 600_000,
    accept: "application/octet-stream",
  });
  await Deno.mkdir(PICTURES, { recursive: true });
  const path = freePath(PICTURES, asset.name, (p) => {
    try {
      Deno.statSync(p);
      return true;
    } catch {
      return false;
    }
  });
  const file = await Deno.open(path, { write: true, createNew: true });
  try {
    await res.body!.pipeTo(file.writable);
  } catch (e) {
    await Deno.remove(path).catch(() => {});
    throw e;
  }
  return path;
}

/**
 * Pictures as files: the JPEG preview (`size=preview`; the small thumbnail
 * is WebP, which not every GTK can show), cached per server.
 * Cached ones at once, the others until `deadline` ms.
 */
export async function thumbnails(
  s: Server,
  ids: string[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!HOME) return out;
  const dir = `${CACHE}/${encodeURIComponent(new URL(s.base).host)}`;
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  const missing: string[] = [];
  for (const id of new Set(ids)) {
    if (!/^[\w-]+$/.test(id)) continue;
    const file = `${dir}/${id}.jpg`;
    if (exists(file)) out.set(id, file);
    else missing.push(id);
  }
  const until = Date.now() + (o.deadline ?? 3000);
  const worker = async () => {
    while (missing.length && Date.now() < until && !o.signal?.aborted) {
      const id = missing.shift()!;
      const file = `${dir}/${id}.jpg`;
      try {
        const res = await fetch(`${s.base}/api/assets/${id}/thumbnail?size=preview`, {
          headers: { "x-api-key": s.key },
          signal: AbortSignal.timeout(Math.max(800, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) {
          await res.body?.cancel();
          continue;
        }
        const data = new Uint8Array(await res.arrayBuffer());
        if (data.length < 100) continue;
        await Deno.writeFile(`${file}.tmp`, data);
        await Deno.rename(`${file}.tmp`, file);
        out.set(id, file);
      } catch {
        // Shown without a picture this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return out;
}

// ---------------------------------------------------------------------------
// Setup

const CONFIGURE = "**Settings → Extensions → Immich → Configure**";

export function setupItem(e: SetupError): Item {
  const md: Record<SetupError["kind"], string[]> = {
    url: [
      "## Connect Immich",
      "",
      `In ${CONFIGURE}, set the address you open in the browser, e.g. \`http://immich.local:2283\` or \`http://192.168.1.20:2283\`, and an API key.`,
    ],
    key: [
      "## Create an API key",
      "",
      "In Immich, open **Account Settings → API Keys → New API Key**. Give it at least `asset.read`, `asset.view`, `asset.download`, `asset.update`, `album.read`, `memory.read`, `sharedLink.create` and `server.about`, or all permissions.",
      "",
      `Paste it in ${CONFIGURE}.`,
    ],
    host: [
      "## Address not reachable from Backslash",
      "",
      "Extensions declare the hosts they may reach. This one covers this computer, local names (`*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`, `immich`), private networks (`192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`), Tailscale (`100.64.x.x`, `*.ts.net`) and DuckDNS (`*.duckdns.org`).",
      "",
      `Use the server's local or Tailscale address in ${CONFIGURE}.`,
    ],
    down: [
      "## Immich doesn't answer",
      "",
      `Check that it is running and opens at \`${e.base ?? "http://…:2283"}\`. The address is in ${CONFIGURE}.`,
    ],
  };
  return {
    id: "setup",
    title: e.message,
    subtitle: "Immich settings",
    icon: { source: e.kind === "key" ? Icons.key : Icons.plug, tint: "orange" },
    detail: { markdown: md[e.kind].join("\n") },
    actions: e.base && e.kind !== "host" ? [open(e.base, "Open Immich", { icon: Icons.globe })] : [],
  };
}
