// Reading the libraries on disk (and running `lutris`). Everything is
// best effort: a launcher that isn't installed simply contributes nothing.

import { exec, storage } from "@backslash/api";
import {
  type Game,
  heroicGame,
  heroicInstalled,
  heroicLibrary,
  heroicPlaytimes,
  type HeroicRunner,
  isTool,
  libraryFolders,
  lutrisGame,
  parseAppManifest,
  parseLutrisJson,
  playtimes,
  protonDbApi,
  type ProtonSummary,
  steamGame,
  steamHeader,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

const STEAM_ROOTS = [
  ".local/share/Steam",
  ".steam/debian-installation",
  ".var/app/com.valvesoftware.Steam/.local/share/Steam",
  ".steam/steam",
];

const HEROIC_ROOTS = [".config/heroic", ".var/app/com.heroicgameslauncher.hgl/config/heroic"];

async function readText(path: string): Promise<string | undefined> {
  try {
    return await Deno.readTextFile(path);
  } catch {
    return undefined;
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = await readText(path);
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isFile;
  } catch {
    return false;
  }
}

async function list(dir: string): Promise<Deno.DirEntry[]> {
  const out: Deno.DirEntry[] = [];
  try {
    for await (const e of Deno.readDir(dir)) out.push(e);
  } catch {
    // Missing, or outside the read permission.
  }
  return out;
}

async function firstFile(paths: string[]): Promise<string | undefined> {
  for (const p of paths) if (await isFile(p)) return p;
  return undefined;
}

// ---------------------------------------------------------------------------
// Steam

/** Steam's picture cache: `<id>_header.jpg` (old) or `<id>/header.jpg`, maybe in a hashed folder (2024+). */
async function steamArt(root: string, appid: string): Promise<{ cover?: string; icon?: string }> {
  const cache = `${root}/appcache/librarycache`;
  let cover = await firstFile([`${cache}/${appid}_header.jpg`, `${cache}/${appid}/header.jpg`]);
  let icon = await firstFile([`${cache}/${appid}_icon.jpg`]);
  if (!cover || !icon) {
    const entries = await list(`${cache}/${appid}`);
    // The icon is the file named by a 40-character hash.
    icon ??= entries.filter((e) =>
      e.isFile && /^[0-9a-f]{40}\.jpg$/.test(e.name)
    ).map((e) => `${cache}/${appid}/${e.name}`)[0];
    for (
      const d of entries.filter((e) =>
        e.isDirectory
      )
    ) {
      cover ??= await firstFile([`${cache}/${appid}/${d.name}/header.jpg`]);
    }
  }
  return { cover, icon };
}

async function latestLocalConfig(root: string): Promise<string | undefined> {
  let best: { path: string; mtime: number } | undefined;
  for (const user of await list(`${root}/userdata`)) {
    const path = `${root}/userdata/${user.name}/config/localconfig.vdf`;
    try {
      const mtime = (await Deno.stat(path)).mtime?.getTime() ?? 0;
      if (!best || mtime > best.mtime) best = { path, mtime };
    } catch {
      // No config for this account.
    }
  }
  return best ? await readText(best.path) : undefined;
}

export interface Scan {
  games: Game[];
  /** Library folders Steam knows about but the extension may not read. */
  unreadable: string[];
  found: string[];
}

export async function steam(): Promise<Scan> {
  const roots: string[] = [];
  for (const rel of STEAM_ROOTS) {
    const path = `${HOME}/${rel}`;
    try {
      const real = await Deno.realPath(path);
      if (!roots.includes(real) && await isFile(`${real}/steamapps/libraryfolders.vdf`)) roots.push(real);
    } catch {
      // Not there.
    }
  }
  const games = new Map<string, Game>();
  const unreadable: string[] = [];
  for (const root of roots) {
    const vdf = await readText(`${root}/steamapps/libraryfolders.vdf`) ?? "";
    const folders = libraryFolders(vdf);
    if (!folders.some((f) => f.path === root)) folders.unshift({ path: root, apps: {} });
    const local = await latestLocalConfig(root);
    const played = local ? playtimes(local) : new Map();
    for (const folder of folders) {
      const entries = await list(`${folder.path}/steamapps`);
      if (!entries.length && Object.keys(folder.apps).length) unreadable.push(folder.path);
      for (const e of entries) {
        if (!/^appmanifest_\d+\.acf$/.test(e.name)) continue;
        const app = parseAppManifest(await readText(`${folder.path}/steamapps/${e.name}`) ?? "");
        if (!app || isTool(app) || games.has(app.appid)) continue;
        const game = steamGame(app, folder.path, played.get(app.appid));
        game.sizeBytes ??= folder.apps[app.appid] || undefined;
        const art = await steamArt(root, app.appid);
        // The local cache first; Steam's CDN for games it hasn't cached yet.
        game.cover = art.cover ?? steamHeader(app.appid);
        game.icon = art.icon;
        games.set(app.appid, game);
      }
    }
  }
  return { games: [...games.values()], unreadable, found: roots };
}

// ---------------------------------------------------------------------------
// Lutris

const LUTRIS_ART = [
  ".cache/lutris/coverart",
  ".local/share/lutris/coverart",
  ".cache/lutris/banners",
  ".local/share/lutris/banners",
];

export async function lutris(signal?: AbortSignal): Promise<Scan> {
  let out: string;
  try {
    out = await exec("lutris", ["--list-games", "--installed", "--json"], { signal });
  } catch {
    return { games: [], unreadable: [], found: [] };
  }
  const games = await Promise.all(
    parseLutrisJson(out).map(async (entry) => {
      const g = lutrisGame(entry);
      g.cover = await firstFile(
        LUTRIS_ART.flatMap((d) => [`${HOME}/${d}/${entry.slug}.jpg`, `${HOME}/${d}/${entry.slug}.png`]),
      );
      g.icon = await firstFile([`${HOME}/.local/share/icons/hicolor/128x128/apps/lutris_${entry.slug}.png`]);
      return g;
    }),
  );
  return { games, unreadable: [], found: games.length ? ["lutris"] : [] };
}

// ---------------------------------------------------------------------------
// Heroic

const HEROIC_FILES: Record<HeroicRunner, { library: string; installed: string[] }> = {
  legendary: {
    library: "store_cache/legendary_library.json",
    installed: ["legendaryConfig/legendary/installed.json"],
  },
  gog: { library: "store_cache/gog_library.json", installed: ["gog_store/installed.json"] },
  nile: { library: "store_cache/nile_library.json", installed: ["nile_config/nile/installed.json"] },
};

/** Heroic keeps downloaded art in `images-cache/<sha256 of the URL>`. */
async function cachedImage(root: string, url: string | undefined): Promise<string | undefined> {
  if (!url) return undefined;
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(url))))
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return await firstFile([
    `${root}/images-cache/${hash}`,
    `${root}/images-cache/${hash}.jpg`,
    `${root}/images-cache/${hash}.png`,
  ]);
}

export async function heroic(): Promise<Scan> {
  const games: Game[] = [];
  const found: string[] = [];
  for (const rel of HEROIC_ROOTS) {
    const root = `${HOME}/${rel}`;
    const played = heroicPlaytimes(await readJson(`${root}/store/timestamp.json`));
    for (const runner of Object.keys(HEROIC_FILES) as HeroicRunner[]) {
      const files = HEROIC_FILES[runner];
      const library = heroicLibrary(await readJson(`${root}/${files.library}`));
      if (!library.length) continue;
      found.push(`${root}/${files.library}`);
      const installed = new Map();
      for (const f of files.installed) {
        for (const [k, v] of heroicInstalled(await readJson(`${root}/${f}`))) installed.set(k, v);
      }
      for (const g of library) {
        if (!g.is_installed && !installed.has(g.app_name)) continue;
        if (games.some((x) => x.slug === g.app_name)) continue;
        const game = heroicGame(g, runner, installed.get(g.app_name), played.get(g.app_name));
        game.cover = await cachedImage(root, game.cover) ?? game.cover;
        games.push(game);
      }
    }
  }
  return { games, unreadable: [], found };
}

// ---------------------------------------------------------------------------
// ProtonDB, cached a week (a day when it has nothing for the game)

const WEEK = 7 * 86_400_000;
const DAY = 86_400_000;

type Json = Parameters<typeof storage.set>[1];

export async function cachedProton(appid: string): Promise<ProtonSummary | null | undefined> {
  const hit = await storage.get(`proton:${appid}`).catch(() => undefined) as
    | { at: number; summary: ProtonSummary | null }
    | undefined;
  if (!hit) return undefined;
  const ttl = hit.summary ? WEEK : DAY;
  return Date.now() - hit.at < ttl ? hit.summary : undefined;
}

export async function fetchProton(appid: string, signal?: AbortSignal): Promise<ProtonSummary | null> {
  let summary: ProtonSummary | null = null;
  try {
    const res = await fetch(protonDbApi(appid), { signal });
    if (res.ok) summary = await res.json() as ProtonSummary;
    else await res.body?.cancel();
    if (!res.ok && res.status !== 404) return null;
  } catch (e) {
    if (signal?.aborted) throw e;
    return null;
  }
  await storage.set(`proton:${appid}`, { at: Date.now(), summary } as unknown as Json).catch(() => {});
  return summary;
}
