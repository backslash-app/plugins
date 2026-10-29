// The arXiv API (no key, one request every few seconds is the polite pace),
// saved papers, and Zotero's local connector.

import { storage } from "@backslash/api";
import { type Feed, type Paper, parseFeed, queryUrl, type Sort, zoteroItem } from "./lib.ts";

const HEADERS = { "User-Agent": "Backslash-arXiv/1.0 (+https://github.com/backslash-app/plugins)" };

type Json = Parameters<typeof storage.set>[1];

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function get(url: string, signal?: AbortSignal): Promise<Feed> {
  const timeout = AbortSignal.timeout(25_000);
  let res: Response;
  try {
    res = await fetch(url, { headers: HEADERS, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(
      timeout.aborted
        ? "arXiv is taking too long to answer, try again"
        : `arXiv is unreachable: ${(e as Error).message}`,
    );
  }
  const body = await res.text();
  // Errors (a malformed query) come back as a feed with one error entry, often with status 400.
  if (!res.ok && !body.includes("<feed")) {
    if (res.status === 429 || res.status === 503) throw new Error("arXiv asks to slow down: wait a few seconds");
    throw new Error(`arXiv answered ${res.status}`);
  }
  return parseFeed(body);
}

export function search(query: string, sort: Sort, signal?: AbortSignal, max = 30): Promise<Feed> {
  return get(queryUrl({ query, sort, max }), signal);
}

export async function byIds(ids: string[], signal?: AbortSignal): Promise<Paper[]> {
  if (!ids.length) return [];
  return (await get(queryUrl({ ids, max: ids.length }), signal)).papers;
}

/** The newest submissions in `categories`, kept for 30 minutes (they change once a day). */
export async function newest(
  categories: string[],
  o: { signal?: AbortSignal; force?: boolean; max?: number } = {},
): Promise<{ papers: Paper[]; fetched: number }> {
  const key = `new:${categories.join(",")}`;
  const cached = await load<{ papers: Paper[]; fetched: number }>(key);
  if (!o.force && cached && Date.now() - cached.fetched < 30 * 60_000) return cached;
  const query = categories.map((c) => `cat:${c}`).join(" OR ");
  const { papers } = await get(queryUrl({ query, sort: "submittedDate", max: o.max ?? 100 }), o.signal);
  const fresh = { papers, fetched: Date.now() };
  await save(key, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Saved papers

export async function saved(): Promise<Paper[]> {
  return (await load<Paper[]>("saved")) ?? [];
}

export async function toggleSaved(p: Paper): Promise<boolean> {
  const all = await saved();
  const has = all.some((s) => s.id === p.id);
  await save("saved", has ? all.filter((s) => s.id !== p.id) : [{ ...p }, ...all].slice(0, 500));
  return !has;
}

// ---------------------------------------------------------------------------
// Zotero

const ZOTERO = "http://127.0.0.1:23119/connector";

/**
 * Saves the paper in the library selected in Zotero, through the connector
 * server Zotero runs while it is open. False when Zotero isn't running.
 */
export async function addToZotero(p: Paper): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch(`${ZOTERO}/saveItems`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Zotero-Connector-API-Version": "3" },
      body: JSON.stringify({
        sessionID: crypto.randomUUID(),
        uri: `https://arxiv.org/abs/${p.id}`,
        items: [zoteroItem(p)],
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return false;
  }
  await res.body?.cancel();
  if (res.status === 201 || res.ok) return true;
  throw new Error(`Zotero refused the item (${res.status})`);
}
