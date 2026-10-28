// Jellyfin (API key, or user name and password) and Plex (X-Plex-Token) on the
// user's own servers, and their posters cached on disk.

import {
  cacheName,
  fromJellyfin,
  fromPlex,
  isAllowedHost,
  jellyfinAuth,
  jellyfinStreamUrl,
  jellyfinWebUrl,
  type Kind,
  type MediaItem,
  normalizeUrl,
  plexImagePath,
  plexSearchItems,
  plexStreamUrl,
  plexWebUrl,
  WANTED,
} from "./lib.ts";

export class SetupError extends Error {
  constructor(message: string, readonly server: Kind, readonly kind: "token" | "url" | "host", readonly base?: string) {
    super(message);
  }
}

export interface Server {
  kind: Kind;
  /** "Jellyfin" or "Plex": the product, for labels. */
  product: string;
  base: string;
  /** The server's own name, once connected. */
  name: string;
  connect(signal?: AbortSignal): Promise<void>;
  continueWatching(signal?: AbortSignal): Promise<MediaItem[]>;
  nextUp(signal?: AbortSignal): Promise<MediaItem[]>;
  recentlyAdded(signal?: AbortSignal): Promise<MediaItem[]>;
  search(query: string, signal?: AbortSignal): Promise<MediaItem[]>;
  /** Episodes of a series or season, tracks of an album. */
  children(item: MediaItem, signal?: AbortSignal): Promise<MediaItem[]>;
  setPlayed(item: MediaItem, played: boolean): Promise<void>;
  /** What a player opens: the file, or an album's tracks. They carry the token. */
  streamUrls(item: MediaItem): Promise<string[]>;
  webUrl(item: MediaItem): string;
  /** The poster's address and the headers to fetch it. */
  imageRequest(item: MediaItem): { url: string; headers: Record<string, string> } | undefined;
}

const describe = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function request(
  kind: Kind,
  base: string,
  path: string,
  o: { method?: string; headers: Record<string, string>; body?: unknown; signal?: AbortSignal },
): Promise<Response> {
  let res: Response;
  const product = kind === "plex" ? "Plex" : "Jellyfin";
  try {
    res = await fetch(`${base}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", ...o.headers, ...(o.body ? { "Content-Type": "application/json" } : {}) },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(base).hostname} is outside the networks this extension may reach`, kind, "host");
    }
    throw new Error(`Can't reach ${product} at ${base}: ${describe(e)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new SetupError(`${product} rejected the ${kind === "plex" ? "token" : "credentials"}`, kind, "token", base);
  }
  return res;
}

async function json<T>(res: Response, product: string): Promise<T> {
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 160);
    throw new Error(`${product} answered ${res.status}${text ? `: ${text}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return await res.json() as T;
}

function checkBase(kind: Kind, input: unknown): string {
  const product = kind === "plex" ? "Plex" : "Jellyfin";
  const base = normalizeUrl(input, kind);
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${input}” is not a ${product} address`, kind, "url");
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(`${host} is outside the networks this extension may reach`, kind, "host", base);
  }
  return base;
}

// ---------------------------------------------------------------------------
// Jellyfin

const FIELDS =
  "Fields=Overview,Genres,DateCreated,PremiereDate,MediaStreams,Studios,People,ChildCount,RecursiveItemCount&EnableUserData=true&EnableImageTypes=Primary&ImageTypeLimit=1";

class Jellyfin implements Server {
  kind = "jellyfin" as const;
  product = "Jellyfin";
  name = "Jellyfin";
  #token = "";
  #user = "";
  #serverId?: string;

  constructor(
    readonly base: string,
    private creds: { apiKey?: string; user?: string; password?: string },
    private deviceId: string,
  ) {}

  #headers() {
    return { Authorization: jellyfinAuth(this.deviceId, this.#token || undefined) };
  }

  async #get<T>(paths: string[], signal?: AbortSignal): Promise<T> {
    // Jellyfin 10.9 moved user routes (/Users/{id}/Items → /Items?userId=); the old ones remain on most servers.
    let last: Response | undefined;
    for (const path of paths) {
      last = await request("jellyfin", this.base, path, { headers: this.#headers(), signal });
      if (last.status !== 404) return await json<T>(last, "Jellyfin");
    }
    return await json<T>(last!, "Jellyfin");
  }

  async connect(signal?: AbortSignal) {
    if (this.#token) return;
    const info = await request("jellyfin", this.base, "/System/Info/Public", { headers: this.#headers(), signal })
      .then((r) => json<{ ServerName?: string; Id?: string }>(r, "Jellyfin"));
    this.name = info.ServerName || "Jellyfin";
    this.#serverId = info.Id;
    if (this.creds.apiKey) {
      this.#token = this.creds.apiKey;
      const users = await this.#get<{ Name: string; Id: string; Policy?: { IsAdministrator?: boolean } }[]>(
        ["/Users"],
        signal,
      );
      const wanted = this.creds.user?.toLowerCase();
      const user = (wanted ? users.find((u) => u.Name.toLowerCase() === wanted) : undefined) ??
        users.find((u) => u.Policy?.IsAdministrator) ?? users[0];
      if (!user) {
        throw new SetupError(
          `No Jellyfin user${wanted ? ` named ${this.creds.user}` : ""}`,
          "jellyfin",
          "token",
          this.base,
        );
      }
      if (wanted && user.Name.toLowerCase() !== wanted) {
        throw new SetupError(`No Jellyfin user named ${this.creds.user}`, "jellyfin", "token", this.base);
      }
      this.#user = user.Id;
      return;
    }
    const res = await request("jellyfin", this.base, "/Users/AuthenticateByName", {
      method: "POST",
      headers: this.#headers(),
      body: { Username: this.creds.user, Pw: this.creds.password ?? "" },
      signal,
    });
    const auth = await json<{ AccessToken: string; User: { Id: string } }>(res, "Jellyfin");
    this.#token = auth.AccessToken;
    this.#user = auth.User.Id;
  }

  async #items(paths: string[], signal?: AbortSignal): Promise<MediaItem[]> {
    const answer = await this.#get<{ Items?: unknown[] } | unknown[]>(paths, signal);
    const list = Array.isArray(answer) ? answer : answer?.Items ?? [];
    return (list as Record<string, unknown>[]).map(fromJellyfin);
  }

  continueWatching(signal?: AbortSignal) {
    const u = this.#user;
    return this.#items([
      `/Users/${u}/Items/Resume?Limit=20&MediaTypes=Video&${FIELDS}`,
      `/UserItems/Resume?userId=${u}&Limit=20&MediaTypes=Video&${FIELDS}`,
    ], signal);
  }

  nextUp(signal?: AbortSignal) {
    return this.#items([`/Shows/NextUp?userId=${this.#user}&Limit=20&EnableResumable=false&${FIELDS}`], signal);
  }

  async recentlyAdded(signal?: AbortSignal) {
    const u = this.#user;
    const items = await this.#items([
      `/Users/${u}/Items/Latest?Limit=30&GroupItems=true&${FIELDS}`,
      `/Items/Latest?userId=${u}&Limit=30&GroupItems=true&${FIELDS}`,
    ], signal);
    return items.filter((i) => WANTED.includes(i.type));
  }

  search(query: string, signal?: AbortSignal) {
    const u = this.#user;
    const q = `searchTerm=${
      encodeURIComponent(query)
    }&Recursive=true&IncludeItemTypes=Movie,Series,Episode,MusicAlbum&Limit=40&${FIELDS}`;
    return this.#items([`/Users/${u}/Items?${q}`, `/Items?userId=${u}&${q}`], signal);
  }

  children(item: MediaItem, signal?: AbortSignal) {
    const u = this.#user;
    if (item.type === "series") return this.#items([`/Shows/${item.id}/Episodes?userId=${u}&${FIELDS}`], signal);
    const q = `ParentId=${item.id}&SortBy=ParentIndexNumber,IndexNumber,SortName&${FIELDS}`;
    return this.#items([`/Users/${u}/Items?${q}`, `/Items?userId=${u}&${q}`], signal);
  }

  async setPlayed(item: MediaItem, played: boolean) {
    const method = played ? "POST" : "DELETE";
    for (
      const path of [`/Users/${this.#user}/PlayedItems/${item.id}`, `/UserPlayedItems/${item.id}?userId=${this.#user}`]
    ) {
      const res = await request("jellyfin", this.base, path, { method, headers: this.#headers() });
      if (res.status !== 404) {
        await json(res, "Jellyfin");
        return;
      }
    }
    throw new Error("Jellyfin couldn't change the watched state");
  }

  async streamUrls(item: MediaItem) {
    if (item.type === "album") {
      const tracks = (await this.children(item)).filter((t) => t.type === "track");
      return tracks.map((t) => jellyfinStreamUrl(this.base, t, this.#token));
    }
    return [jellyfinStreamUrl(this.base, item, this.#token)];
  }

  webUrl(item: MediaItem) {
    return jellyfinWebUrl(this.base, item.id, this.#serverId);
  }

  imageRequest(item: MediaItem) {
    return item.image ? { url: `${this.base}${item.image}`, headers: this.#headers() } : undefined;
  }
}

// ---------------------------------------------------------------------------
// Plex

class Plex implements Server {
  kind = "plex" as const;
  product = "Plex";
  name = "Plex";
  #machine = "";

  constructor(readonly base: string, private token: string, private deviceId: string) {}

  #headers() {
    return {
      "X-Plex-Token": this.token,
      "X-Plex-Client-Identifier": this.deviceId,
      "X-Plex-Product": "Backslash",
      "X-Plex-Version": "1.0.0",
    };
  }

  async #get<T>(path: string, signal?: AbortSignal): Promise<T> {
    return await json<T>(await request("plex", this.base, path, { headers: this.#headers(), signal }), "Plex");
  }

  async #metadata(path: string, signal?: AbortSignal): Promise<MediaItem[]> {
    const answer = await this.#get<{ MediaContainer?: { Metadata?: Record<string, unknown>[] } }>(path, signal);
    return (answer?.MediaContainer?.Metadata ?? []).map(fromPlex);
  }

  async connect(signal?: AbortSignal) {
    if (this.#machine) return;
    const root = await this.#get<{ MediaContainer?: { friendlyName?: string; machineIdentifier?: string } }>(
      "/",
      signal,
    );
    this.name = root?.MediaContainer?.friendlyName || "Plex";
    this.#machine = root?.MediaContainer?.machineIdentifier ?? "";
  }

  // On Deck holds both: started items (with a viewOffset), and the next episode
  // of shows in progress. Asked once per load for both sections.
  #deck?: { at: number; items: Promise<MediaItem[]> };
  #onDeck(signal?: AbortSignal) {
    if (!this.#deck || Date.now() - this.#deck.at > 3000) {
      const items = this.#metadata("/library/onDeck?X-Plex-Container-Start=0&X-Plex-Container-Size=40", signal);
      this.#deck = { at: Date.now(), items };
      items.catch(() => (this.#deck = undefined));
    }
    return this.#deck.items;
  }

  async continueWatching(signal?: AbortSignal) {
    return (await this.#onDeck(signal)).filter((i) => i.position);
  }

  async nextUp(signal?: AbortSignal) {
    return (await this.#onDeck(signal)).filter((i) => !i.position && i.type === "episode");
  }

  async recentlyAdded(signal?: AbortSignal) {
    const items = await this.#metadata(
      "/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30",
      signal,
    );
    return items.filter((i) => WANTED.includes(i.type));
  }

  async search(query: string, signal?: AbortSignal) {
    const answer = await this.#get<unknown>(
      `/hubs/search?query=${encodeURIComponent(query)}&limit=15&includeCollections=0`,
      signal,
    );
    return plexSearchItems(answer);
  }

  children(item: MediaItem, signal?: AbortSignal) {
    const path = item.type === "series" ? "allLeaves" : "children";
    return this.#metadata(`/library/metadata/${item.id}/${path}`, signal);
  }

  async setPlayed(item: MediaItem, played: boolean) {
    await this.#get(`/:/${played ? "scrobble" : "unscrobble"}?identifier=com.plexapp.plugins.library&key=${item.id}`);
  }

  async streamUrls(item: MediaItem) {
    if (item.type === "album") {
      const tracks = await this.children(item);
      return tracks.filter((t) => t.partKey).map((t) => plexStreamUrl(this.base, t.partKey!, this.token));
    }
    let part = item.partKey;
    if (!part) part = (await this.#metadata(`/library/metadata/${item.id}`))[0]?.partKey;
    if (!part) throw new Error("Plex has no file to play for this item");
    return [plexStreamUrl(this.base, part, this.token)];
  }

  webUrl(item: MediaItem) {
    return plexWebUrl(this.base, this.#machine, item.id);
  }

  imageRequest(item: MediaItem) {
    return item.image ? { url: `${this.base}${plexImagePath(item.image)}`, headers: this.#headers() } : undefined;
  }
}

// ---------------------------------------------------------------------------
// Preferences

const text = (v: unknown) => String(v ?? "").trim();

/** The configured servers, and why the others can't be used. */
export function serversFrom(
  prefs: Record<string, unknown>,
  deviceId: string,
): { servers: Server[]; problems: SetupError[] } {
  const servers: Server[] = [];
  const problems: SetupError[] = [];
  const jfUrl = text(prefs.jellyfinUrl);
  const jf = {
    apiKey: text(prefs.jellyfinApiKey),
    user: text(prefs.jellyfinUser),
    password: String(prefs.jellyfinPassword ?? ""),
  };
  if (jfUrl || jf.apiKey || jf.password) {
    try {
      if (!jfUrl) throw new SetupError("Add the address of your Jellyfin server", "jellyfin", "url");
      const base = checkBase("jellyfin", jfUrl);
      if (!jf.apiKey && !jf.user) {
        throw new SetupError("Add a Jellyfin API key, or your user name and password", "jellyfin", "token", base);
      }
      servers.push(new Jellyfin(base, jf, deviceId));
    } catch (e) {
      if (e instanceof SetupError) problems.push(e);
      else throw e;
    }
  }
  const plexUrl = text(prefs.plexUrl);
  const token = text(prefs.plexToken);
  if (plexUrl || token) {
    try {
      if (!plexUrl) throw new SetupError("Add the address of your Plex server", "plex", "url");
      const base = checkBase("plex", plexUrl);
      if (!token) throw new SetupError("Add your X-Plex-Token", "plex", "token", base);
      servers.push(new Plex(base, token, deviceId));
    } catch (e) {
      if (e instanceof SetupError) problems.push(e);
      else throw e;
    }
  }
  return { servers, problems };
}

// ---------------------------------------------------------------------------
// Posters

const home = () => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
};
export const cacheDir = () => `${home()}/.cache/backslash/jellyfin`;

async function exists(path: string) {
  try {
    return (await Deno.stat(path)).size > 0;
  } catch {
    return false;
  }
}

/**
 * Posters as local files (the launcher shows only pictures from exact hosts,
 * and these need the token): those already cached at once, the others
 * downloaded until `deadline` ms, a few at a time.
 */
export async function posters(
  entries: { server: Server; item: MediaItem }[],
  o: { deadline?: number; signal?: AbortSignal } = {},
): Promise<Map<MediaItem, string>> {
  const out = new Map<MediaItem, string>();
  if (!home()) return out;
  await Deno.mkdir(cacheDir(), { recursive: true }).catch(() => {});
  const missing: { item: MediaItem; path: string; req: { url: string; headers: Record<string, string> } }[] = [];
  await Promise.all(entries.map(async ({ server, item }) => {
    const req = server.imageRequest(item);
    if (!req) return;
    const path = `${cacheDir()}/${await cacheName(`${server.base}${item.image}`)}`;
    if (await exists(path)) out.set(item, path);
    else missing.push({ item, path, req });
  }));
  const until = Date.now() + (o.deadline ?? 2500);
  const seen = new Set<string>();
  const queue = missing.filter((m) => !seen.has(m.path) && seen.add(m.path));
  const worker = async () => {
    while (queue.length && Date.now() < until && !o.signal?.aborted) {
      const m = queue.shift()!;
      try {
        const res = await fetch(m.req.url, {
          headers: m.req.headers,
          signal: AbortSignal.timeout(Math.max(500, until - Date.now())),
        });
        if (!res.ok || !(res.headers.get("content-type") ?? "image/").startsWith("image/")) continue;
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length < 100 || bytes.length > 4_000_000) continue;
        await Deno.writeFile(`${m.path}.tmp`, bytes);
        await Deno.rename(`${m.path}.tmp`, m.path);
      } catch {
        // Shown without a poster this time.
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  for (const m of missing) if (await exists(m.path)) out.set(m.item, m.path);
  return out;
}
