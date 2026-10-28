// Calls to the Raindrop.io REST API with the user's test token.

import { storage } from "@backslash/api";
import { API, type Collection, type Folder, folders, type Raindrop, raindropError, UNSORTED } from "./lib.ts";

export async function raindrop<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Raindrop.io is unreachable: ${(e as Error).message}`);
  }
  const json = await res.json().catch(() => undefined) as { result?: boolean; errorMessage?: string } | undefined;
  if (!res.ok || json?.result === false) throw raindropError(res.ok ? 400 : res.status, json);
  return json as T;
}

/** Every collection, as paths ("Dev › Rust"). */
export async function loadFolders(token: string, signal?: AbortSignal): Promise<Folder[]> {
  const [roots, children] = await Promise.all([
    raindrop<{ items: Collection[] }>(token, "/collections", { signal }),
    raindrop<{ items: Collection[] }>(token, "/collections/childrens", { signal }),
  ]);
  const all = folders(roots.items, children.items);
  await storage.set("folders", all).catch(() => {});
  return all;
}

/** The collections saved last time (for the chips, at once), else loaded now. */
export async function cachedFolders(token: string): Promise<Folder[]> {
  const saved = await storage.get<Folder[]>("folders").catch(() => undefined);
  if (saved?.length) return saved;
  return await loadFolders(token).catch(() => []);
}

export async function save(
  token: string,
  bookmark: { link: string; collection?: number; title?: string; tags?: string[]; note?: string },
): Promise<Raindrop> {
  const { item } = await raindrop<{ item: Raindrop }>(token, "/raindrop", {
    method: "POST",
    body: {
      link: bookmark.link,
      collection: { $id: bookmark.collection ?? UNSORTED },
      ...(bookmark.title ? { title: bookmark.title } : {}),
      ...(bookmark.tags?.length ? { tags: bookmark.tags } : {}),
      ...(bookmark.note ? { note: bookmark.note } : {}),
      // Raindrop fetches the title, excerpt and cover in the background.
      pleaseParse: {},
    },
  });
  return item;
}
