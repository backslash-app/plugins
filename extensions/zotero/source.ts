// Where items come from: Zotero 7's local API while Zotero runs with it
// enabled, else a copy of zotero.sqlite read with the sqlite3 program.

import { exec } from "@backslash/api";
import { API, apiParams, type DbRow, fromApi, fromDb, search, type ZItem } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
export const DATA_DIR = `${HOME}/Zotero`;
export const STORAGE_DIR = `${DATA_DIR}/storage`;
const DB = `${DATA_DIR}/zotero.sqlite`;
/** Zotero locks its database while it runs: it is read from a copy, refreshed when it changes. */
const COPY_DIR = `${HOME}/.cache/backslash-zotero`;

export type Kind = "api" | "db";

export class SetupError extends Error {
  constructor(message: string, readonly reason: "no-sqlite" | "no-library") {
    super(message);
  }
}

// --- Local API ----------------------------------------------------------------

/** `undefined` when the local API can't be used (Zotero closed, too old, or the API is off). */
export async function apiSearch(query: string, signal?: AbortSignal): Promise<ZItem[] | undefined> {
  const url = new URL(`${API}/users/0/items/top`);
  for (const [k, v] of Object.entries(apiParams(query))) {
    for (const x of Array.isArray(v) ? v : [v]) url.searchParams.append(k, x);
  }
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ?? AbortSignal.timeout(5000), headers: { "Zotero-API-Version": "3" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError" && signal?.aborted) throw e;
    return undefined;
  }
  if (!res.ok) {
    await res.body?.cancel();
    return undefined; // 403 "Local API is not enabled", or 404 before Zotero 7
  }
  const raw = (await res.json()) as any[];
  const items = raw.filter((r) => !["note", "attachment", "annotation"].includes(r?.data?.itemType));
  const children = await Promise.all(items.map(async (r) => {
    if (!r?.meta?.numChildren) return [];
    const c = await fetch(`${API}/users/0/items/${r.key}/children?format=json`, { signal }).catch(() => undefined);
    return c?.ok ? await c.json() as any[] : [];
  }));
  return items.map((r, i) => fromApi(r, children[i], STORAGE_DIR));
}

/** Zotero's own BibTeX export of an item, if the local API is on. */
export async function apiBibtex(item: ZItem): Promise<string | undefined> {
  if (item.groupId) return undefined;
  try {
    const res = await fetch(`${API}/users/0/items/${item.key}?format=bibtex`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return undefined;
    const text = (await res.text()).trim();
    return text.startsWith("@") ? text : undefined;
  } catch {
    return undefined;
  }
}

// --- Database -----------------------------------------------------------------

const VALUE = (field: string, item: string) =>
  `(SELECT v.value FROM itemData d JOIN FIELDS f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID WHERE d.itemID = ${item} AND f.fieldName = '${field}')`;

/** Top-level items of every library, not in the trash, with their fields, creators, tags and attachments. */
export const QUERY = `
SELECT i.key AS key, g.groupID AS groupID, t.typeName AS typeName,
  (SELECT json_group_object(f.fieldName, v.value) FROM itemData d
     JOIN FIELDS f ON f.fieldID = d.fieldID JOIN itemDataValues v ON v.valueID = d.valueID
     WHERE d.itemID = i.itemID) AS fields,
  (SELECT json_group_array(json_object('first', c.firstName, 'last', c.lastName, 'mode', c.fieldMode,
       'type', ct.creatorType, 'i', ic.orderIndex)) FROM itemCreators ic
     JOIN creators c ON c.creatorID = ic.creatorID JOIN creatorTypes ct ON ct.creatorTypeID = ic.creatorTypeID
     WHERE ic.itemID = i.itemID) AS creators,
  (SELECT json_group_array(tg.name) FROM itemTags it JOIN tags tg ON tg.tagID = it.tagID
     WHERE it.itemID = i.itemID) AS tags,
  (SELECT json_group_array(json_object('key', ai.key, 'path', a.path, 'contentType', a.contentType,
       'linkMode', a.linkMode, 'title', ${VALUE("title", "a.itemID")})) FROM itemAttachments a
     JOIN items ai ON ai.itemID = a.itemID
     WHERE a.parentItemID = i.itemID AND a.itemID NOT IN (SELECT itemID FROM deletedItems)) AS attachments,
  i.dateAdded AS dateAdded, i.dateModified AS dateModified
FROM items i
JOIN TYPES t ON t.itemTypeID = i.itemTypeID
LEFT JOIN groups g ON g.libraryID = i.libraryID
WHERE t.typeName NOT IN ('attachment', 'note', 'annotation')
  AND i.itemID NOT IN (SELECT itemID FROM deletedItems);
`;

/** Zotero 5+ keeps custom fields and types in the *Combined tables; older schemas only have the plain ones. */
export const queryFor = (combined: boolean) =>
  QUERY.replaceAll("JOIN FIELDS", combined ? "JOIN fieldsCombined" : "JOIN fields")
    .replaceAll("JOIN TYPES", combined ? "JOIN itemTypesCombined" : "JOIN itemTypes");

const mtime = (path: string) => Deno.stat(path).then((s) => s.mtime?.getTime() ?? 0, () => -1);

/** A fresh copy of the database (and its write-ahead log), made only when Zotero changed it. */
async function copyDb(): Promise<string> {
  const source = await mtime(DB);
  if (source < 0) throw new SetupError("No Zotero library in ~/Zotero", "no-library");
  const copy = `${COPY_DIR}/zotero.sqlite`;
  const wal = Math.max(await mtime(`${DB}-wal`), source);
  if ((await mtime(copy)) >= wal) return copy;
  await Deno.mkdir(COPY_DIR, { recursive: true });
  await Deno.copyFile(DB, `${copy}.tmp`);
  await Deno.remove(`${copy}-wal`).catch(() => {});
  await Deno.remove(`${copy}-shm`).catch(() => {});
  if ((await mtime(`${DB}-wal`)) >= 0) await Deno.copyFile(`${DB}-wal`, `${copy}-wal`);
  await Deno.rename(`${copy}.tmp`, copy);
  return copy;
}

async function sqlite(path: string, sql: string, signal?: AbortSignal): Promise<DbRow[]> {
  let out: string;
  try {
    out = await exec("sqlite3", ["-json", path], { stdin: sql, signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new SetupError("Reading the Zotero database needs the sqlite3 program", "no-sqlite");
    }
    throw e;
  }
  return out ? JSON.parse(out) as DbRow[] : [];
}

let cached: { stamp: number; items: ZItem[] } | undefined;

export async function dbItems(signal?: AbortSignal): Promise<ZItem[]> {
  const path = await copyDb();
  const stamp = await mtime(path);
  if (cached?.stamp === stamp) return cached.items;
  let rows: DbRow[];
  try {
    rows = await sqlite(path, queryFor(true), signal);
  } catch (e) {
    if (!(e instanceof Error) || !/no such table/i.test(e.message)) throw e;
    rows = await sqlite(path, queryFor(false), signal);
  }
  const items = rows.map((r) => fromDb(r, STORAGE_DIR));
  cached = { stamp, items };
  return items;
}

/** Results for what is typed, and where they came from. */
export async function find(
  query: string,
  signal?: AbortSignal,
): Promise<{ items: ZItem[]; kind: Kind; total?: number }> {
  const viaApi = await apiSearch(query, signal);
  if (viaApi) return { items: viaApi, kind: "api" };
  const all = await dbItems(signal);
  return { items: search(all, query, 50), kind: "db", total: all.length };
}
