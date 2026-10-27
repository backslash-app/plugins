// Finds browser profiles and reads their history, bookmarks and favicons.

import { DatabaseSync } from "node:sqlite";
import { chromeBookmarks, chromeTime, firefoxTime, imageExtension } from "./lib.ts";

const HOME = Deno.env.get("HOME") ?? "";
export const TMP = "/tmp/backslash-browser";

export interface Profile {
  browser: string;
  kind: "firefox" | "chromium";
  dir: string;
}

const FIREFOX_ROOTS: [string, string][] = [
  ["Firefox", ".mozilla/firefox"],
  ["Firefox", "snap/firefox/common/.mozilla/firefox"],
  ["Firefox", ".var/app/org.mozilla.firefox/.mozilla/firefox"],
  ["LibreWolf", ".librewolf"],
];

const CHROMIUM_ROOTS: [string, string][] = [
  ["Chrome", ".config/google-chrome"],
  ["Chrome", ".var/app/com.google.Chrome/config/google-chrome"],
  ["Chromium", ".config/chromium"],
  ["Chromium", ".var/app/org.chromium.Chromium/config/chromium"],
  ["Brave", ".config/BraveSoftware/Brave-Browser"],
  ["Brave", ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"],
  ["Edge", ".config/microsoft-edge"],
  ["Vivaldi", ".config/vivaldi"],
];

function subdirs(path: string): string[] {
  try {
    return [...Deno.readDirSync(path)].filter((e) => e.isDirectory).map((e) => `${path}/${e.name}`);
  } catch {
    return [];
  }
}

const exists = (path: string) => {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
};

export function profiles(): Profile[] {
  const out: Profile[] = [];
  for (const [browser, root] of FIREFOX_ROOTS) {
    for (const dir of subdirs(`${HOME}/${root}`)) {
      if (exists(`${dir}/places.sqlite`)) out.push({ browser, kind: "firefox", dir });
    }
  }
  for (const [browser, root] of CHROMIUM_ROOTS) {
    for (const dir of subdirs(`${HOME}/${root}`)) {
      if (exists(`${dir}/History`) || exists(`${dir}/Bookmarks`)) out.push({ browser, kind: "chromium", dir });
    }
  }
  return out;
}

/**
 * Opens a copy of a database: browsers keep theirs locked while running.
 * The write-ahead log is copied too, so recent visits are included.
 */
function openCopy(path: string): DatabaseSync | undefined {
  if (!exists(path)) return undefined;
  const key = path.replace(/[^a-zA-Z0-9]/g, "_").slice(-120);
  Deno.mkdirSync(TMP, { recursive: true });
  const copy = `${TMP}/${key}`;
  try {
    Deno.copyFileSync(path, copy);
    try {
      Deno.copyFileSync(`${path}-wal`, `${copy}-wal`);
    } catch {
      try {
        Deno.removeSync(`${copy}-wal`);
      } catch { /* none */ }
    }
    return new DatabaseSync(copy);
  } catch (err) {
    console.error(`cannot read ${path}: ${err}`);
    return undefined;
  }
}

export interface Page {
  url: string;
  title: string;
  /** Unix ms of the last visit (or when bookmarked). */
  time: number;
  visits: number;
  bookmark: boolean;
  browser: string;
  icon?: string;
}

const LIMIT = 1500;

function firefoxPages(p: Profile): Page[] {
  const db = openCopy(`${p.dir}/places.sqlite`);
  if (!db) return [];
  try {
    const history = db.prepare(
      `SELECT url, title, visit_count AS visits, last_visit_date AS last FROM moz_places
       WHERE hidden = 0 AND frecency > 0 AND url LIKE 'http%' ORDER BY frecency DESC LIMIT ${LIMIT}`,
    ).all() as any[];
    const bookmarks = db.prepare(
      `SELECT p.url, COALESCE(b.title, p.title) AS title, p.visit_count AS visits, b.dateAdded AS last
       FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk WHERE b.type = 1 AND p.url LIKE 'http%'`,
    ).all() as any[];
    return [
      ...bookmarks.map((r) => page(p, r, true, firefoxTime)),
      ...history.map((r) => page(p, r, false, firefoxTime)),
    ];
  } finally {
    db.close();
  }
}

function chromiumPages(p: Profile): Page[] {
  const pages: Page[] = [];
  try {
    const json = JSON.parse(Deno.readTextFileSync(`${p.dir}/Bookmarks`));
    pages.push(
      ...chromeBookmarks(json).map((b) => ({ ...b, time: b.added, visits: 0, bookmark: true, browser: p.browser })),
    );
  } catch { /* no bookmarks */ }
  const db = openCopy(`${p.dir}/History`);
  if (db) {
    try {
      const rows = db.prepare(
        `SELECT url, title, visit_count AS visits, last_visit_time / 1000 AS last FROM urls
         WHERE hidden = 0 AND url LIKE 'http%' ORDER BY visit_count * 2 + typed_count * 5 DESC, last_visit_time DESC
         LIMIT ${LIMIT}`,
      ).all() as any[];
      pages.push(...rows.map((r) => page(p, r, false, chromeTime)));
    } finally {
      db.close();
    }
  }
  return pages;
}

function page(p: Profile, r: any, bookmark: boolean, time: (n: number) => number): Page {
  return {
    url: String(r.url),
    title: String(r.title || r.url),
    time: time(Number(r.last ?? 0)),
    visits: Number(r.visits ?? 0),
    bookmark,
    browser: p.browser,
  };
}

/** Bookmarks and history of every profile, one entry per URL. */
export function pages(): Page[] {
  const all = profiles().flatMap((p) => (p.kind === "firefox" ? firefoxPages(p) : chromiumPages(p)));
  const byUrl = new Map<string, Page>();
  for (const pg of all) {
    const seen = byUrl.get(pg.url);
    if (!seen) {
      byUrl.set(pg.url, pg);
    } else {
      seen.bookmark ||= pg.bookmark;
      seen.visits += pg.visits;
      seen.time = Math.max(seen.time, pg.time);
      if (pg.bookmark) seen.title = pg.title;
    }
  }
  return [...byUrl.values()];
}

/** Writes favicons of `urls` to files, returning url → path. Best effort. */
export function favicons(urls: string[]): Map<string, string> {
  const icons = new Map<string, string>();
  const wanted = new Set(urls);
  const save = (url: string, data: Uint8Array | undefined) => {
    if (!data || icons.has(url)) return;
    const ext = imageExtension(data);
    if (!ext) return;
    const name = `${TMP}/icons/${hash(url)}.${ext}`;
    try {
      Deno.mkdirSync(`${TMP}/icons`, { recursive: true });
      Deno.writeFileSync(name, data);
      icons.set(url, name);
    } catch { /* ignore */ }
  };
  for (const p of profiles()) {
    const db = openCopy(`${p.dir}/${p.kind === "firefox" ? "favicons.sqlite" : "Favicons"}`);
    if (!db) continue;
    try {
      const rows = p.kind === "firefox"
        ? db.prepare(
          `SELECT pg.page_url AS url, i.data AS data FROM moz_pages_w_icons pg
           JOIN moz_icons_to_pages ip ON ip.page_id = pg.id JOIN moz_icons i ON i.id = ip.icon_id
           WHERE i.width <= 64 ORDER BY i.width DESC`,
        ).all()
        : db.prepare(
          `SELECT m.page_url AS url, b.image_data AS data FROM icon_mapping m
           JOIN favicon_bitmaps b ON b.icon_id = m.icon_id ORDER BY b.width DESC`,
        ).all();
      for (const r of rows as any[]) {
        if (wanted.has(r.url)) save(r.url, r.data as Uint8Array);
      }
    } catch (err) {
      console.error(`favicons of ${p.dir}: ${err}`);
    } finally {
      db.close();
    }
  }
  return icons;
}

function hash(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}
