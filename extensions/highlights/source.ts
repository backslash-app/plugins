// Loading highlights: Readwise's export API (synced incrementally), the
// Kindle's My Clippings.txt, Hypothes.is' search API. What was loaded last
// time is kept so the list shows at once and a Kindle can be unplugged.

import { storage } from "@backslash/api";
import {
  clippingCandidates,
  expandHome,
  fromHypothesis,
  fromReadwise,
  type Highlight,
  hypothesisAccount,
  type HypothesisRow,
  kindleHighlights,
  mergeHighlights,
  parseClippings,
  type ReadwiseBook,
  SetupError,
  type Source,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];
const HOME = Deno.env.get("HOME") ?? "";
const USER = Deno.env.get("USER") ?? "";

async function saved<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}
const save = (key: string, value: unknown) => storage.set(key, value as Json).catch(() => {});

async function getJson<T>(
  service: string,
  url: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0;; attempt++) {
    const timeout = AbortSignal.timeout(30_000);
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch (e) {
      if (signal?.aborted) throw e;
      throw new Error(`${service} is unreachable: ${(e as Error).message}`);
    }
    if (res.status === 429 && attempt < 2) {
      // Readwise allows 20 export calls a minute and says how long to wait.
      const wait = Number(res.headers.get("Retry-After") ?? 5);
      await res.body?.cancel();
      if (wait > 20) throw new Error(`${service} is rate limiting: try again in ${Math.ceil(wait / 60)} min`);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 401 || res.status === 403) {
      await res.body?.cancel();
      throw new SetupError(`${service} refused the token: check it in Settings → Extensions → Highlights`);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      let message = "";
      try {
        const j = JSON.parse(body);
        message = j.detail ?? j.reason ?? j.message ?? "";
      } catch { /* not JSON */ }
      throw new Error(`${service} answered ${res.status}${message ? `: ${message}` : ""}`);
    }
    return await res.json() as T;
  }
}

// ---------------------------------------------------------------------------
// Readwise

const FULL_SYNC_DAYS = 7;

/** Changes since the last sync, plus a full sync once a week to forget deleted highlights. */
export async function readwise(token: string, signal?: AbortSignal): Promise<Highlight[]> {
  const old = await saved<Highlight[]>("readwise:items") ?? [];
  const syncedAt = await saved<string>("readwise:syncedAt");
  const fullAt = await saved<string>("readwise:fullAt");
  const full = !old.length || !fullAt || Date.now() - Date.parse(fullAt) > FULL_SYNC_DAYS * 86_400_000;
  const started = new Date().toISOString();
  const books: ReadwiseBook[] = [];
  let cursor: string | number | null = null;
  for (let page = 0; page < 50; page++) {
    const params = new URLSearchParams();
    if (!full && syncedAt) params.set("updatedAfter", syncedAt);
    if (cursor !== null) params.set("pageCursor", String(cursor));
    const r: { results: ReadwiseBook[]; nextPageCursor: string | number | null } = await getJson(
      "Readwise",
      `https://readwise.io/api/v2/export/?${params}`,
      { Authorization: `Token ${token}` },
      signal,
    );
    books.push(...r.results);
    cursor = r.nextPageCursor;
    if (cursor === null || cursor === undefined) break;
  }
  const update = fromReadwise(books);
  const items = full ? update.keep : mergeHighlights(old, update);
  await save("readwise:items", items);
  await save("readwise:syncedAt", started);
  if (full) await save("readwise:fullAt", started);
  return items;
}

// ---------------------------------------------------------------------------
// Kindle

async function exists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

/** Mounted drives under /run/media/$USER and /media/$USER (a Kindle may be named otherwise). */
async function mounts(): Promise<string[]> {
  const out: string[] = [];
  for (const root of [`/run/media/${USER}`, `/media/${USER}`]) {
    try {
      for await (const d of Deno.readDir(root)) if (d.isDirectory) out.push(`${root}/${d.name}`);
    } catch { /* not there */ }
  }
  return out;
}

export async function clippingsPath(pref: unknown): Promise<string | undefined> {
  const p = String(pref ?? "").trim();
  if (p) return expandHome(p, HOME);
  for (const c of clippingCandidates(HOME, USER, await mounts())) if (await exists(c)) return c;
  return undefined;
}

/** The clippings file, else the highlights read from it last time. */
export async function kindle(pref: unknown): Promise<{ items: Highlight[]; path?: string; stale: boolean }> {
  const path = await clippingsPath(pref);
  if (path) {
    let text: string;
    try {
      text = await Deno.readTextFile(path);
    } catch (e) {
      if (e instanceof Deno.errors.NotFound) {
        const cached = await saved<Highlight[]>("kindle:items");
        if (cached?.length) return { items: cached, stale: true };
        throw new SetupError(`No My Clippings.txt at ${path.replace(HOME, "~")}`);
      }
      if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
        throw new SetupError(
          `Highlights may only read My Clippings.txt on a Kindle or in ~, ~/Documents or ~/Downloads, not ${
            path.replace(HOME, "~")
          }`,
        );
      }
      throw e;
    }
    const items = kindleHighlights(parseClippings(text));
    await save("kindle:items", items);
    return { items, path, stale: false };
  }
  const cached = await saved<Highlight[]>("kindle:items");
  return { items: cached ?? [], stale: true };
}

// ---------------------------------------------------------------------------
// Hypothes.is

export async function hypothesis(user: string, token: string, signal?: AbortSignal): Promise<Highlight[]> {
  const headers: Record<string, string> = { Accept: "application/vnd.hypothesis.v1+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  let account = hypothesisAccount(user);
  if (!account && token) {
    const profile = await getJson<{ userid?: string | null }>(
      "Hypothes.is",
      "https://api.hypothes.is/api/profile",
      headers,
      signal,
    );
    account = profile.userid ?? undefined;
  }
  if (!account) throw new SetupError("Add your Hypothes.is username or token");
  const rows: HypothesisRow[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const params = new URLSearchParams({ user: account, limit: "200", sort: "updated", order: "desc" });
    if (after) params.set("search_after", after);
    const r = await getJson<{ rows: HypothesisRow[]; total: number }>(
      "Hypothes.is",
      `https://api.hypothes.is/api/search?${params}`,
      headers,
      signal,
    );
    rows.push(...r.rows);
    if (r.rows.length < 200) break;
    after = r.rows.at(-1)?.updated;
    if (!after) break;
  }
  const items = fromHypothesis(rows);
  await save("hypothesis:items", items);
  return items;
}

// ---------------------------------------------------------------------------
// All of them

export interface Loaded {
  items: Highlight[];
  /** The sources set up. */
  sources: Source[];
  errors: { source: Source; error: Error }[];
  /** Still loading the fresh copy. */
  partial: boolean;
}

export function sourcesOf(prefs: Record<string, unknown>): Source[] {
  const out: Source[] = [];
  if (String(prefs.readwiseToken ?? "").trim()) out.push("readwise");
  out.push("kindle"); // found on its own; dropped below when there is none
  if (String(prefs.hypothesisUser ?? "").trim() || String(prefs.hypothesisToken ?? "").trim()) out.push("hypothesis");
  return out;
}

/** Last time's highlights first, then the fresh ones. */
export async function* loadAll(prefs: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<Loaded> {
  const wanted = sourcesOf(prefs);
  const cached = await Promise.all(wanted.map(async (s) => await saved<Highlight[]>(`${s}:items`) ?? []));
  const first = cached.flat();
  if (first.length) yield { items: first, sources: wanted, errors: [], partial: true };

  const token = String(prefs.readwiseToken ?? "").trim().replace(/^Token\s+/i, "");
  const results = await Promise.allSettled(wanted.map(async (s): Promise<Highlight[] | undefined> => {
    if (s === "readwise") return await readwise(token, signal);
    if (s === "kindle") {
      const k = await kindle(prefs.clippings);
      return k.items.length || k.path ? k.items : undefined;
    }
    return await hypothesis(
      String(prefs.hypothesisUser ?? ""),
      String(prefs.hypothesisToken ?? "").trim().replace(/^Bearer\s+/i, ""),
      signal,
    );
  }));
  const items: Highlight[] = [];
  const sources: Source[] = [];
  const errors: Loaded["errors"] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      if (r.value === undefined) return; // no Kindle, ever
      sources.push(wanted[i]);
      items.push(...r.value);
    } else {
      sources.push(wanted[i]);
      errors.push({ source: wanted[i], error: r.reason });
      items.push(...cached[i]);
    }
  });
  yield { items, sources, errors, partial: false };
}
