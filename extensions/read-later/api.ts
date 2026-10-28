// Wallabag (OAuth password grant), Readeck (API token) and Instapaper (Simple API, add only).

import {
  type Article,
  type BackendId,
  BACKENDS,
  chooseBackend,
  type Filter,
  fromReadeck,
  fromWallabag,
  isAllowedHost,
  normalizeUrl,
  type ReadeckBookmark,
  readeckQuery,
  type WallabagEntry,
  wallabagQuery,
  wallabagTokenBody,
} from "./lib.ts";

export class SetupError extends Error {}

export type Backend = {
  id: BackendId;
  name: string;
  /** Instapaper's Simple API can only add. */
  canList: boolean;
  list(filter: Filter, signal?: AbortSignal): Promise<Article[]>;
  /** The article's HTML as the service extracted it. */
  content(a: Article, signal?: AbortSignal): Promise<string>;
  archive(a: Article, value: boolean): Promise<void>;
  star(a: Article, value: boolean): Promise<void>;
  remove(a: Article): Promise<void>;
  add(url: string): Promise<void>;
  /** The article in the service's own reader. */
  readerUrl(a: Article): string;
  home: string;
};

async function request(
  service: string,
  url: string,
  init: RequestInit & { signal?: AbortSignal },
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    if ((e as Error).name === "NotCapable") {
      throw new SetupError(`${service} is at a host this extension may not reach: ${new URL(url).host}`);
    }
    throw new Error(`${service} is unreachable: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new SetupError(`${service} refused the credentials: check them in Settings → Extensions → Read Later`);
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = "";
    try {
      const j = JSON.parse(text);
      message = j.error_description ?? j.message ?? j.error ?? "";
    } catch {
      message = text.length < 200 ? text : "";
    }
    if (res.status === 404) {
      throw new Error(`${service} doesn't know this article any more${message ? `: ${message}` : ""}`);
    }
    throw new Error(`${service} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return res;
}

function checkHost(url: string) {
  const host = new URL(url).hostname;
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${host} is outside the hosts this extension may reach: app.wallabag.it, or a server on your network or Tailscale`,
    );
  }
}

// ---------------------------------------------------------------------------

function wallabag(prefs: Record<string, unknown>): Backend {
  const base = normalizeUrl(prefs.url || "https://app.wallabag.it");
  checkHost(base);
  for (const k of ["clientId", "clientSecret", "username", "password"]) {
    if (!String(prefs[k] ?? "").trim()) {
      throw new SetupError("Add your Wallabag client ID, client secret, user name and password");
    }
  }
  let token: Promise<string> | undefined;
  const auth = () =>
    token ??= request("Wallabag", `${base}/oauth/v2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: wallabagTokenBody(prefs),
    }).then(async (r) => (await r.json()).access_token as string).catch((e) => {
      token = undefined;
      // The token endpoint answers 400 (invalid_grant, invalid_client) for wrong credentials.
      if (/answered 400/.test((e as Error).message)) {
        throw new SetupError("Wallabag refused the client or the password: check them in Settings → Extensions");
      }
      throw e;
    });
  // Bodies are sent as a form, which every wallabag version reads.
  const call = async (method: string, path: string, body?: Record<string, string | number>, signal?: AbortSignal) => {
    const res = await request("Wallabag", `${base}/api${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${await auth()}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/x-www-form-urlencoded" }),
      },
      body: body === undefined ? undefined : new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  };
  return {
    id: "wallabag",
    name: BACKENDS.wallabag,
    canList: true,
    home: `${base}/unread/list`,
    readerUrl: (a) => `${base}/view/${a.id}`,
    async list(filter, signal) {
      const r = await call("GET", `/entries.json?${wallabagQuery(filter)}`, undefined, signal) as {
        _embedded?: { items?: WallabagEntry[] };
      };
      return (r._embedded?.items ?? []).map(fromWallabag);
    },
    async content(a, signal) {
      const e = await call("GET", `/entries/${a.id}.json`, undefined, signal) as WallabagEntry;
      return e.content ?? "";
    },
    async archive(a, value) {
      await call("PATCH", `/entries/${a.id}.json`, { archive: value ? 1 : 0 });
    },
    async star(a, value) {
      await call("PATCH", `/entries/${a.id}.json`, { starred: value ? 1 : 0 });
    },
    async remove(a) {
      await call("DELETE", `/entries/${a.id}.json`);
    },
    async add(url) {
      await call("POST", "/entries.json", { url });
    },
  };
}

// ---------------------------------------------------------------------------

function readeck(prefs: Record<string, unknown>): Backend {
  const base = normalizeUrl(prefs.url);
  const token = String(prefs.token ?? "").trim();
  if (!base || !token) throw new SetupError("Add your Readeck address and API token");
  checkHost(base);
  const call = (method: string, path: string, body?: unknown, signal?: AbortSignal, accept = "application/json") =>
    request("Readeck", `${base}/api${path}`, {
      method,
      signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: accept,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    id: "readeck",
    name: BACKENDS.readeck,
    canList: true,
    home: `${base}/bookmarks/unread`,
    readerUrl: (a) => `${base}/bookmarks/${a.id}`,
    async list(filter, signal) {
      const res = await call("GET", `/bookmarks?${readeckQuery(filter)}`, undefined, signal);
      return ((await res.json()) as ReadeckBookmark[]).map(fromReadeck);
    },
    async content(a, signal) {
      const res = await call("GET", `/bookmarks/${a.id}/article`, undefined, signal, "text/html");
      return await res.text();
    },
    async archive(a, value) {
      await (await call("PATCH", `/bookmarks/${a.id}`, { is_archived: value })).body?.cancel();
    },
    async star(a, value) {
      await (await call("PATCH", `/bookmarks/${a.id}`, { is_marked: value })).body?.cancel();
    },
    async remove(a) {
      await (await call("DELETE", `/bookmarks/${a.id}`)).body?.cancel();
    },
    async add(url) {
      await (await call("POST", "/bookmarks", { url })).body?.cancel();
    },
  };
}

// ---------------------------------------------------------------------------

function instapaper(prefs: Record<string, unknown>): Backend {
  const username = String(prefs.username ?? "").trim();
  const password = String(prefs.password ?? "");
  if (!username) throw new SetupError("Add your Instapaper email or user name");
  const addOnly = () => {
    throw new SetupError(
      "Instapaper only lets apps add articles: its full API needs a key Instapaper grants on request",
    );
  };
  return {
    id: "instapaper",
    name: BACKENDS.instapaper,
    canList: false,
    home: "https://www.instapaper.com/u",
    readerUrl: () => "https://www.instapaper.com/u",
    list: () => Promise.resolve(addOnly()),
    content: () => Promise.resolve(addOnly()),
    archive: () => Promise.resolve(addOnly()),
    star: () => Promise.resolve(addOnly()),
    remove: () => Promise.resolve(addOnly()),
    async add(url) {
      // Simple API: 201 when added, 403 for wrong credentials (an account without password sends none).
      const res = await request("Instapaper", "https://www.instapaper.com/api/add", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ username, password, url }),
      });
      await res.body?.cancel();
    },
  };
}

// ---------------------------------------------------------------------------

export function backendOf(prefs: Record<string, unknown>): Backend {
  const id = chooseBackend(prefs);
  if (!id) {
    const asked = String(prefs.backend ?? "").trim();
    if (asked && asked.toLowerCase() !== "auto") {
      throw new SetupError(`Unknown service “${asked}”: use wallabag, readeck or instapaper`);
    }
    throw new SetupError("Connect Wallabag, Readeck or Instapaper");
  }
  return id === "wallabag" ? wallabag(prefs) : id === "readeck" ? readeck(prefs) : instapaper(prefs);
}
