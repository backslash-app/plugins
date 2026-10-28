// Icon indexes and SVG files from jsDelivr, cached in ~/.cache/backslash/icon-search.

import { HEROICONS } from "./heroicons.ts";
import {
  displayColor,
  fileUrl,
  type Icon,
  MATERIAL_NAMES_URL,
  parseHeroicons,
  parseLucide,
  parseMaterial,
  parsePhosphor,
  parseSimple,
  parseTabler,
  type SetId,
  setOf,
  svgPath,
  viewSvg,
} from "./lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/icon-search`;
const WEEK = 7 * 24 * 60 * 60 * 1000;

async function fetchText(url: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("cdn.jsdelivr.net can't be reached: check your connection");
  }
  if (res.status === 404) throw new NotFound(url);
  if (!res.ok) throw new Error(`cdn.jsdelivr.net answered ${res.status}`);
  return await res.text();
}

export class NotFound extends Error {}

async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await Deno.readTextFile(path)) as T;
  } catch {
    return undefined;
  }
}

async function download(id: SetId, signal?: AbortSignal): Promise<Icon[]> {
  const set = setOf(id)!;
  switch (id) {
    case "heroicons":
      return parseHeroicons(HEROICONS);
    case "material":
      return parseMaterial(await fetchText(MATERIAL_NAMES_URL, signal));
    case "phosphor":
      return parsePhosphor(await fetchText(fileUrl(set, set.index!), signal));
    case "lucide":
      return parseLucide(JSON.parse(await fetchText(fileUrl(set, set.index!), signal)));
    case "tabler":
      return parseTabler(JSON.parse(await fetchText(fileUrl(set, set.index!), signal)));
    case "simple":
      return parseSimple(JSON.parse(await fetchText(fileUrl(set, set.index!), signal)));
  }
}

/** The icons of a set: from the cache when it is less than a week old, else downloaded again. */
export async function loadSet(id: SetId, signal?: AbortSignal): Promise<Icon[]> {
  const file = `${CACHE}/index/${id}.json`;
  const cached = await readJson<{ at: number; icons: Icon[] }>(file);
  if (cached && Date.now() - cached.at < WEEK && cached.icons.length) return cached.icons;
  try {
    const icons = await download(id, signal);
    if (!icons.length) throw new Error(`The ${setOf(id)!.title} index is empty`);
    await Deno.mkdir(`${CACHE}/index`, { recursive: true });
    await Deno.writeTextFile(file, JSON.stringify({ at: Date.now(), icons }));
    return icons;
  } catch (e) {
    if (cached?.icons.length && !signal?.aborted) return cached.icons; // stale beats nothing
    throw e;
  }
}

const safe = (path: string) => path.replace(/[^\w.-]+/g, "_");

/** The SVG file of an icon (or one of its variants) as published. */
export async function svgText(icon: Icon, path = svgPath(icon), signal?: AbortSignal): Promise<string> {
  const file = `${CACHE}/svg/${icon.set}/${safe(path)}`;
  try {
    return await Deno.readTextFile(file);
  } catch {
    const text = await fetchText(fileUrl(setOf(icon.set)!, path), signal);
    if (!text.includes("<svg")) throw new Error(`${icon.name}: not an SVG file`);
    await Deno.mkdir(`${CACHE}/svg/${icon.set}`, { recursive: true });
    await Deno.writeTextFile(file, text);
    return text;
  }
}

/** A picture of the icon for the launcher; undefined when it can't be fetched. */
export async function viewFile(icon: Icon, signal?: AbortSignal): Promise<string | undefined> {
  const file = `${CACHE}/view/${icon.set}/${safe(icon.name)}.svg`;
  try {
    await Deno.stat(file);
    return file;
  } catch {
    try {
      const svg = await svgText(icon, svgPath(icon), signal);
      await Deno.mkdir(`${CACHE}/view/${icon.set}`, { recursive: true });
      await Deno.writeTextFile(file, viewSvg(svg, displayColor(icon)));
      return file;
    } catch (e) {
      if (signal?.aborted) throw e;
      return undefined;
    }
  }
}

/** Runs `fn` on every item, `limit` at a time. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export async function clearCache() {
  await Deno.remove(CACHE, { recursive: true }).catch(() => {});
}
