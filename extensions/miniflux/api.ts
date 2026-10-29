// Miniflux (REST API, X-Auth-Token) and FreshRSS (Google Reader API, ClientLogin)
// behind one interface.

import {
  BACKENDS,
  chooseBackend,
  editTagBody,
  type Entry,
  type Feed,
  fromGReader,
  fromGReaderSubscription,
  fromMiniflux,
  fromMinifluxFeed,
  type GReaderItem,
  type GReaderSubscription,
  isAllowedHost,
  type MinifluxEntry,
  type MinifluxFeed,
  minifluxQuery,
  normalizeUrl,
  parseClientLogin,
  READ,
  SetupError,
  STARRED,
  streamPath,
  type View,
} from "./lib.ts";

export { SetupError };

export interface Reader {
  id: "miniflux" | "freshrss";
  name: string;
  /** The reader's web interface. */
  home: string;
  entries(view: View, signal?: AbortSignal, feedId?: string): Promise<Entry[]>;
  feeds(signal?: AbortSignal): Promise<Feed[]>;
  setRead(entries: Entry[], read: boolean): Promise<void>;
  setStarred(entry: Entry, starred: boolean): Promise<void>;
  markFeedRead(feedId: string): Promise<void>;
  /** The article in the reader's own interface. */
  entryUrl(entry: Entry): string;
  feedUrl(feedId: string): string;
}

async function request(service: string, url: string, init: RequestInit): Promise<Response> {
  let res: Response;
  const timeout = AbortSignal.timeout(20_000);
  try {
    res = await fetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
  } catch (e) {
    if (init.signal?.aborted) throw e;
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new SetupError(`${new URL(url).hostname} is outside the hosts this extension may reach`);
    }
    throw new Error(`${service} is unreachable at ${new URL(url).host}: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new SetupError(
      `${service} refused the credentials: check them in Settings → Extensions → Miniflux & FreshRSS`,
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    let message = "";
    try {
      message = String(JSON.parse(text).error_message ?? "");
    } catch {
      message = /^\s*</.test(text) ? "" : text.slice(0, 160);
    }
    if (res.status === 404) {
      throw new Error(
        `${service} has no ${new URL(url).pathname}: is the address right${message ? ` (${message})` : ""}?`,
      );
    }
    throw new Error(`${service} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return res;
}

function baseOf(prefs: Record<string, unknown>, fallback = ""): string {
  const base = normalizeUrl(prefs.url || fallback);
  if (!base) throw new SetupError("Add the address of your FreshRSS server");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${prefs.url}” is not an address`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${host} is outside the hosts this extension may reach: reader.miniflux.app, or a server on your network or Tailscale`,
    );
  }
  return base;
}

// ---------------------------------------------------------------------------

function miniflux(prefs: Record<string, unknown>): Reader {
  const base = baseOf(prefs, "https://reader.miniflux.app");
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new SetupError("Add a Miniflux API key");
  const call = async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const res = await request("Miniflux", `${base}/v1${path}`, {
      method,
      signal,
      headers: {
        "X-Auth-Token": token,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
  return {
    id: "miniflux",
    name: BACKENDS.miniflux,
    home: `${base}/unread`,
    entryUrl: (e) => `${base}/feed/${e.feedId}/entry/${e.id}`,
    feedUrl: (id) => `${base}/feed/${id}/entries`,
    async entries(view, signal, feedId) {
      const path = feedId ? `/feeds/${feedId}/entries` : "/entries";
      const r = await call<{ entries: MinifluxEntry[] }>("GET", `${path}?${minifluxQuery(view)}`, undefined, signal);
      return (r.entries ?? []).map(fromMiniflux);
    },
    async feeds(signal) {
      const [feeds, counters] = await Promise.all([
        call<MinifluxFeed[]>("GET", "/feeds", undefined, signal),
        call<{ unreads?: Record<string, number> }>("GET", "/feeds/counters", undefined, signal),
      ]);
      return feeds.map((f) => fromMinifluxFeed(f, counters.unreads ?? {}));
    },
    async setRead(entries, read) {
      if (!entries.length) return;
      await call("PUT", "/entries", { entry_ids: entries.map((e) => Number(e.id)), status: read ? "read" : "unread" });
    },
    async setStarred(entry, starred) {
      // The bookmark route toggles: only call it when the state changes.
      if (entry.starred !== starred) await call("PUT", `/entries/${entry.id}/bookmark`);
    },
    async markFeedRead(feedId) {
      await call("PUT", `/feeds/${feedId}/mark-all-as-read`);
    },
  };
}

// ---------------------------------------------------------------------------

function freshrss(prefs: Record<string, unknown>): Reader {
  const base = baseOf(prefs);
  const api = `${base}/api/greader.php`;
  const username = String(prefs.username ?? "").trim();
  const password = String(prefs.password ?? "");
  if (!username || !password) throw new SetupError("Add your FreshRSS user name and API password");
  let auth: Promise<string> | undefined;
  const login = () =>
    auth ??= request("FreshRSS", `${api}/accounts/ClientLogin`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Email: username, Passwd: password }),
    }).then(async (r) => {
      const key = parseClientLogin(await r.text());
      if (!key) throw new SetupError("FreshRSS refused the API password: check it in Settings");
      return key;
    }).catch((e) => {
      auth = undefined;
      // FreshRSS answers 401 with a wrong password, or when the API is off in its settings.
      if (e instanceof SetupError) {
        throw new SetupError(
          "FreshRSS refused the login: check the user name and API password, and that the API is allowed",
        );
      }
      throw e;
    });
  const call = async (path: string, init: RequestInit = {}) =>
    await request("FreshRSS", `${api}${path}`, {
      ...init,
      headers: { Authorization: `GoogleLogin auth=${await login()}`, ...init.headers },
    });
  let token: Promise<string> | undefined;
  const writeToken = () => token ??= call("/reader/api/0/token").then(async (r) => (await r.text()).trim());
  const post = async (path: string, body: URLSearchParams) => {
    const res = await call(path, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    await res.body?.cancel();
  };
  const subscriptions = async (signal?: AbortSignal) => {
    const [subs, counts] = await Promise.all([
      call("/reader/api/0/subscription/list?output=json", { signal })
        .then((r) => r.json() as Promise<{ subscriptions?: GReaderSubscription[] }>),
      call("/reader/api/0/unread-count?output=json", { signal })
        .then((r) => r.json() as Promise<{ unreadcounts?: { id: string; count: number }[] }>),
    ]);
    const unreads = Object.fromEntries((counts.unreadcounts ?? []).map((c) => [c.id, Number(c.count) || 0]));
    return (subs.subscriptions ?? []).map((s) => fromGReaderSubscription(s, unreads));
  };
  return {
    id: "freshrss",
    name: BACKENDS.freshrss,
    home: `${base}/i/`,
    // FreshRSS has no page per article: the feed's view.
    entryUrl: (e) => `${base}/i/?get=${encodeURIComponent(e.feedId.replace(/^feed\//, "f_"))}`,
    feedUrl: (id) => `${base}/i/?get=${encodeURIComponent(id.replace(/^feed\//, "f_"))}`,
    async entries(view, signal, feedId) {
      const [res, feeds] = await Promise.all([
        call(streamPath(view, feedId), { signal }).then((r) => r.json() as Promise<{ items?: GReaderItem[] }>),
        // Categories come from the subscriptions; without them the list still works.
        subscriptions(signal).catch((e) => {
          if (signal?.aborted) throw e;
          return [] as Feed[];
        }),
      ]);
      const byId = new Map(feeds.map((f) => [f.id, f]));
      return (res.items ?? []).map((i) => fromGReader(i, byId));
    },
    feeds: subscriptions,
    async setRead(entries, read) {
      if (!entries.length) return;
      await post("/reader/api/0/edit-tag", editTagBody(entries.map((e) => e.id), READ, read, await writeToken()));
    },
    async setStarred(entry, starred) {
      await post("/reader/api/0/edit-tag", editTagBody([entry.id], STARRED, starred, await writeToken()));
    },
    async markFeedRead(feedId) {
      // ts is in microseconds: everything older than now.
      await post(
        "/reader/api/0/mark-all-as-read",
        new URLSearchParams({ s: feedId, ts: `${Date.now()}000`, T: await writeToken() }),
      );
    },
  };
}

// ---------------------------------------------------------------------------

export function readerOf(prefs: Record<string, unknown>): Reader {
  const id = chooseBackend(prefs);
  if (!id) {
    const asked = String(prefs.backend ?? "").trim();
    if (asked && asked.toLowerCase() !== "auto") {
      throw new SetupError(`Unknown service “${asked}”: use miniflux or freshrss`);
    }
    throw new SetupError("Connect Miniflux or FreshRSS");
  }
  return id === "miniflux" ? miniflux(prefs) : freshrss(prefs);
}
