// Linkding (Authorization: Token) and Linkwarden (Authorization: Bearer) behind one interface.

import {
  BACKENDS,
  type Bookmark,
  chooseBackend,
  collectionPaths,
  type Filter,
  fromLinkding,
  fromLinkwarden,
  isAllowedHost,
  linkdingBody,
  type LinkdingBookmark,
  linkdingSearch,
  linkwardenBody,
  type LinkwardenCollection,
  type LinkwardenLink,
  linkwardenSearch,
  type NewBookmark,
  normalizeUrl,
  sameUrl,
  SetupError,
} from "./lib.ts";

export { SetupError };

export type Collection = { id: string; name: string; count: number };

export interface Service {
  id: "linkding" | "linkwarden";
  name: string;
  base: string;
  /** The filter chips this service has. */
  filters: { value: Filter; title: string }[];
  canArchive: boolean;
  search(query: string, filter: Filter, signal?: AbortSignal): Promise<{ items: Bookmark[]; total?: number }>;
  find(url: string, signal?: AbortSignal): Promise<Bookmark | undefined>;
  save(b: NewBookmark): Promise<Bookmark>;
  setArchived(b: Bookmark, archived: boolean): Promise<void>;
  remove(b: Bookmark): Promise<void>;
  collections(signal?: AbortSignal): Promise<Collection[]>;
  /** The bookmark in the service's web interface. */
  webUrl(b: Bookmark): string;
  /** A readable or archived copy, when there is one. */
  copyUrl(b: Bookmark): string | undefined;
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
    throw new SetupError(`${service} refused the token: check it in Settings → Extensions → Linkding & Linkwarden`);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    let message = "";
    try {
      const j = JSON.parse(text);
      message = typeof j.response === "string"
        ? j.response
        : j.detail ?? j.message ?? Object.entries(j).map(([k, v]) => `${k}: ${[v].flat().join(" ")}`).join("; ");
    } catch {
      message = /^\s*</.test(text) ? "" : text.slice(0, 160);
    }
    if (res.status === 404) throw new Error(`Not found on ${service}${message ? `: ${message}` : ": it may be gone"}`);
    throw new Error(`${service} answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return res;
}

function baseOf(prefs: Record<string, unknown>, fallback = ""): string {
  const base = normalizeUrl(prefs.url || fallback);
  if (!base) throw new SetupError("Add the address of your Linkding or Linkwarden");
  let host: string;
  try {
    host = new URL(base).hostname;
  } catch {
    throw new SetupError(`“${prefs.url}” is not an address`);
  }
  if (!isAllowedHost(host)) {
    throw new SetupError(
      `${host} is outside the hosts this extension may reach: cloud.linkwarden.app, or a server on your network or Tailscale`,
    );
  }
  return base;
}

function caller(service: string, base: string, auth: string) {
  return async <T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> => {
    const res = await request(service, `${base}${path}`, {
      method,
      signal,
      headers: {
        Authorization: auth,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

function tokenOf(prefs: Record<string, unknown>, service: string): string {
  const token = String(prefs.token ?? "").trim();
  if (!token) throw new SetupError(`Add your ${service} API token`);
  return token;
}

// ---------------------------------------------------------------------------

function linkding(prefs: Record<string, unknown>): Service {
  const base = baseOf(prefs);
  const call = caller("Linkding", base, `Token ${tokenOf(prefs, "Linkding")}`);
  type Page = { count: number; results: LinkdingBookmark[] };
  return {
    id: "linkding",
    name: BACKENDS.linkding,
    base,
    filters: [
      { value: "all", title: "Bookmarks" },
      { value: "unread", title: "Unread" },
      { value: "archived", title: "Archived" },
    ],
    canArchive: true,
    webUrl: (b) => `${base}/bookmarks/${b.id}/edit`,
    copyUrl: (b) => b.snapshot,
    async search(query, filter, signal) {
      const r = await call<Page>("GET", linkdingSearch(query, filter), undefined, signal);
      return { items: r.results.map(fromLinkding), total: r.count };
    },
    async find(url, signal) {
      const r = await call<{ bookmark?: LinkdingBookmark | null }>(
        "GET",
        `/api/bookmarks/check/?${new URLSearchParams({ url })}`,
        undefined,
        signal,
      );
      return r.bookmark ? fromLinkding(r.bookmark) : undefined;
    },
    async save(b) {
      return fromLinkding(await call<LinkdingBookmark>("POST", "/api/bookmarks/", linkdingBody(b)));
    },
    async setArchived(b, archived) {
      await call("POST", `/api/bookmarks/${b.id}/${archived ? "archive" : "unarchive"}/`);
    },
    async remove(b) {
      await call("DELETE", `/api/bookmarks/${b.id}/`);
    },
    collections: () => Promise.resolve([]),
  };
}

// ---------------------------------------------------------------------------

function linkwarden(prefs: Record<string, unknown>): Service {
  const base = baseOf(prefs, "https://cloud.linkwarden.app");
  const call = caller("Linkwarden", base, `Bearer ${tokenOf(prefs, "Linkwarden")}`);
  // Older servers answer { response: [...] }, newer ones { data: { links } } on /search.
  type Links = { response?: LinkwardenLink[]; data?: { links?: LinkwardenLink[] } };
  const links = async (query: string, filter: Filter, signal?: AbortSignal) => {
    const qs = linkwardenSearch(query, filter);
    try {
      const r = await call<Links>("GET", `/api/v1/links?${qs}`, undefined, signal);
      return r.response ?? r.data?.links ?? [];
    } catch (e) {
      if (!/^Not found/.test((e as Error).message)) throw e;
      const r = await call<Links>("GET", `/api/v1/search?${qs}`, undefined, signal);
      return r.data?.links ?? r.response ?? [];
    }
  };
  let named: Promise<Collection[]> | undefined;
  const collections = (signal?: AbortSignal) =>
    named ??= call<{ response: LinkwardenCollection[] }>("GET", "/api/v1/collections", undefined, signal)
      .then((r) => collectionPaths(r.response ?? []))
      .catch((e) => {
        named = undefined;
        throw e;
      });
  const withCollection = async (items: Bookmark[]) => {
    const all = await collections().catch(() => []);
    return items.map((b) =>
      b.collection && !b.collection.name
        ? { ...b, collection: { id: b.collection.id, name: all.find((c) => c.id === b.collection!.id)?.name ?? "" } }
        : b
    );
  };
  return {
    id: "linkwarden",
    name: BACKENDS.linkwarden,
    base,
    filters: [{ value: "all", title: "Links" }, { value: "pinned", title: "Pinned" }],
    canArchive: false,
    webUrl: (b) => b.collection ? `${base}/collections/${b.collection.id}` : `${base}/dashboard`,
    // Linkwarden's preserved formats: 3 is the readable view.
    copyUrl: (b) => b.readable ? `${base}/preserved/${b.id}?format=3` : undefined,
    async search(query, filter, signal) {
      return { items: await withCollection((await links(query, filter, signal)).map(fromLinkwarden)) };
    },
    async find(url, signal) {
      const host = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "");
      const found = (await links(host, "all", signal)).map(fromLinkwarden).find((b) => sameUrl(b.url, url));
      return found ? (await withCollection([found]))[0] : undefined;
    },
    async save(b) {
      const r = await call<{ response: LinkwardenLink }>("POST", "/api/v1/links", linkwardenBody(b));
      return (await withCollection([fromLinkwarden(r.response)]))[0];
    },
    setArchived() {
      return Promise.reject(new Error("Linkwarden keeps every link: it has no archive to move it to"));
    },
    async remove(b) {
      await call("DELETE", `/api/v1/links/${b.id}`);
    },
    collections,
  };
}

// ---------------------------------------------------------------------------

export function serviceOf(prefs: Record<string, unknown>): Service {
  const id = chooseBackend(prefs);
  if (!id) {
    const asked = String(prefs.backend ?? "").trim();
    if (asked && asked.toLowerCase() !== "auto") {
      throw new SetupError(`Unknown service “${asked}”: use linkding or linkwarden`);
    }
    throw new SetupError("Connect Linkding or Linkwarden");
  }
  return id === "linkding" ? linkding(prefs) : linkwarden(prefs);
}
