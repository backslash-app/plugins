// DevDocs: the list of documentations (cached a week), their indexes (kept for the session), what is enabled.

import { storage } from "@backslash/api";
import { compactDoc, DEFAULT_DOCS, type Doc, type Entry, resolveDocs, splitList } from "./lib.ts";

const WEEK = 7 * 86400_000;

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await reach(url, signal);
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return await res.json() as T;
}

/** fetch(), with an error that says which site could not be reached. */
export async function reach(url: string, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { signal });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error(`Can't reach ${new URL(url).host}: check your connection (${(err as Error).message})`);
  }
}

let docsPromise: Promise<Doc[]> | undefined;

/** Every documentation DevDocs has, from storage when fresh enough. */
export function allDocs(force = false): Promise<Doc[]> {
  if (!docsPromise || force) {
    docsPromise = (async () => {
      const cached = (await storage.get("docs")) as unknown as { at: number; docs: Doc[] } | undefined;
      if (!force && cached && Date.now() - cached.at < WEEK && cached.docs.length) return cached.docs;
      try {
        const docs = (await getJson<Doc[]>("https://devdocs.io/docs.json")).map(compactDoc);
        await storage.set("docs", JSON.parse(JSON.stringify({ at: Date.now(), docs })));
        return docs;
      } catch (err) {
        if (cached?.docs.length) return cached.docs; // offline: an old list is better than none
        throw err;
      }
    })();
    docsPromise.catch(() => (docsPromise = undefined));
  }
  return docsPromise;
}

/** Slugs picked with "Choose DevDocs"; undefined until the user picks. */
export const chosen = () => storage.get<string[]>("enabled");
export const setChosen = (slugs: string[]) => storage.set("enabled", slugs);

/** Preferences plus the picked ones; the defaults until either says something. */
export async function enabledDocs(prefs: { docs?: string }): Promise<{ docs: Doc[]; fromPrefs: Set<string> }> {
  const docs = await allDocs();
  const fromPrefs = resolveDocs(splitList(prefs.docs), docs);
  const picked = await chosen();
  const slugs = picked ?? (fromPrefs.length ? [] : resolveDocs(DEFAULT_DOCS, docs));
  const all = [...new Set([...fromPrefs, ...slugs])];
  const bySlug = new Map(docs.map((d) => [d.slug, d]));
  return { docs: all.flatMap((s) => bySlug.get(s) ?? []), fromPrefs: new Set(fromPrefs) };
}

const indexes = new Map<string, Promise<Entry[]>>();

/** A doc's index. Not tied to a keystroke's signal: it keeps loading while the user types. */
export function docIndex(doc: Doc): Promise<Entry[]> {
  let p = indexes.get(doc.slug);
  if (!p) {
    p = getJson<{ entries: Entry[] }>(`https://documents.devdocs.io/${doc.slug}/index.json?${doc.mtime ?? ""}`)
      .then((r) => r.entries ?? []);
    p.catch(() => indexes.delete(doc.slug));
    indexes.set(doc.slug, p);
  }
  return p;
}
