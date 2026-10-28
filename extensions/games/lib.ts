// Game libraries: Valve's KeyValues (VDF/ACF) format, Lutris and Heroic
// listings, ProtonDB tiers. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// VDF (Valve KeyValues, text form)

export type Vdf = { [key: string]: string | Vdf };

/**
 * Parses text KeyValues: `"key" "value"` pairs and `"key" { … }` blocks,
 * quoted or bare tokens, `\"` escapes, `//` comments and `[$PLATFORM]`
 * conditions (ignored). Later duplicate keys win.
 */
export function parseVdf(text: string): Vdf {
  const tokens: { t: string; brace?: boolean }[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n" || c === "﻿") {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "{" || c === "}") {
      tokens.push({ t: c, brace: true });
      i++;
    } else if (c === "[") {
      // Conditional like [$WIN32]: skipped.
      while (i < n && text[i] !== "]") i++;
      i++;
    } else if (c === '"') {
      let s = "";
      i++;
      while (i < n && text[i] !== '"') {
        if (text[i] === "\\" && i + 1 < n) {
          const e = text[i + 1];
          s += e === "n" ? "\n" : e === "t" ? "\t" : e;
          i += 2;
        } else s += text[i++];
      }
      i++;
      tokens.push({ t: s });
    } else {
      let s = "";
      while (i < n && !/[\s{}"]/.test(text[i])) s += text[i++];
      tokens.push({ t: s });
    }
  }
  let k = 0;
  const block = (): Vdf => {
    const out: Vdf = {};
    while (k < tokens.length) {
      const key = tokens[k++];
      if (key.brace) {
        if (key.t === "}") return out;
        continue;
      }
      const value = tokens[k++];
      if (!value) break;
      if (value.brace && value.t === "{") out[key.t] = block();
      else if (!value.brace) out[key.t] = value.t;
      else return out;
    }
    return out;
  };
  return block();
}

/** Case-insensitive lookup along a path: `get(vdf, "AppState", "name")`. */
export function vdfGet(v: Vdf | string | undefined, ...path: string[]): Vdf | string | undefined {
  let cur: Vdf | string | undefined = v;
  for (const p of path) {
    if (!cur || typeof cur === "string") return undefined;
    const key: string | undefined = Object.keys(cur).find((k) => k.toLowerCase() === p.toLowerCase());
    cur = key === undefined ? undefined : cur[key];
  }
  return cur;
}

const str = (v: Vdf | string | undefined) => typeof v === "string" ? v : undefined;
const int = (v: Vdf | string | undefined) => {
  const n = Number(str(v));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

export interface LibraryFolder {
  path: string;
  /** App ids installed there, with their size, when Steam lists them. */
  apps: Record<string, number>;
}

/** `steamapps/libraryfolders.vdf`, current and pre-2021 formats. */
export function libraryFolders(text: string): LibraryFolder[] {
  const root = vdfGet(parseVdf(text), "libraryfolders");
  if (!root || typeof root === "string") return [];
  const out: LibraryFolder[] = [];
  for (const [key, value] of Object.entries(root)) {
    if (!/^\d+$/.test(key)) continue;
    if (typeof value === "string") out.push({ path: value, apps: {} });
    else {
      const path = str(vdfGet(value, "path"));
      const apps = vdfGet(value, "apps");
      if (path) {
        out.push({
          path,
          apps: apps && typeof apps !== "string"
            ? Object.fromEntries(Object.entries(apps).map(([id, size]) => [id, Number(size) || 0]))
            : {},
        });
      }
    }
  }
  return out;
}

export interface SteamApp {
  appid: string;
  name: string;
  installdir: string;
  sizeOnDisk?: number;
  lastPlayed?: number;
  lastUpdated?: number;
  buildId?: string;
  /** 4 = fully installed. */
  stateFlags?: number;
}

/** `steamapps/appmanifest_<id>.acf`. */
export function parseAppManifest(text: string): SteamApp | undefined {
  const state = vdfGet(parseVdf(text), "AppState");
  if (!state || typeof state === "string") return undefined;
  const appid = str(vdfGet(state, "appid"));
  const name = str(vdfGet(state, "name")) ?? str(vdfGet(state, "UserConfig", "name"));
  if (!appid || !name) return undefined;
  const lastPlayed = int(vdfGet(state, "LastPlayed"));
  const lastUpdated = int(vdfGet(state, "LastUpdated"));
  return {
    appid,
    name,
    installdir: str(vdfGet(state, "installdir")) ?? "",
    sizeOnDisk: int(vdfGet(state, "SizeOnDisk")),
    lastPlayed: lastPlayed ? lastPlayed * 1000 : undefined,
    lastUpdated: lastUpdated ? lastUpdated * 1000 : undefined,
    buildId: str(vdfGet(state, "buildid")),
    stateFlags: int(vdfGet(state, "StateFlags")),
  };
}

/** Proton, runtimes and redistributables are not games. */
const TOOL_IDS = new Set([
  "228980", // Steamworks Common Redistributables
  "1070560", // Steam Linux Runtime 1.0 (scout)
  "1391110", // Steam Linux Runtime 2.0 (soldier)
  "1628350", // Steam Linux Runtime 3.0 (sniper)
  "1493710", // Proton Experimental
  "2180100", // Proton Hotfix
  "961940", // Proton 3.16 (old)
  "1826330", // Proton EasyAntiCheat Runtime
  "1161040", // Proton BattlEye Runtime
  "2348590", // Proton 8.0
  "3658110", // Proton 10.0
]);

export function isTool(app: { appid: string; name: string }): boolean {
  return TOOL_IDS.has(app.appid) ||
    /^(Proton\b|Steam Linux Runtime|Steamworks Common|SteamVR\b|Steam Audio|Proton EasyAntiCheat|Proton BattlEye)/i
      .test(app.name);
}

/** `userdata/<id>/config/localconfig.vdf`: last played and minutes played per app. */
export function playtimes(text: string): Map<string, { lastPlayed?: number; minutes?: number }> {
  const apps = vdfGet(parseVdf(text), "UserLocalConfigStore", "Software", "Valve", "Steam", "apps");
  const out = new Map<string, { lastPlayed?: number; minutes?: number }>();
  if (!apps || typeof apps === "string") return out;
  for (const [id, v] of Object.entries(apps)) {
    if (typeof v === "string") continue;
    const last = int(vdfGet(v, "LastPlayed"));
    const minutes = int(vdfGet(v, "Playtime"));
    if (last || minutes) out.set(id, { lastPlayed: last ? last * 1000 : undefined, minutes });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The common model

export type Source = "steam" | "lutris" | "heroic";

export interface Game {
  id: string;
  source: Source;
  title: string;
  launch: string;
  appid?: string;
  slug?: string;
  sizeBytes?: number;
  lastPlayed?: number;
  playtimeMinutes?: number;
  installDir?: string;
  /** A local file or URL. */
  cover?: string;
  icon?: string;
  /** Lutris runner, Heroic store. */
  runner?: string;
  platform?: string;
  year?: number;
  lastUpdated?: number;
  buildId?: string;
  library?: string;
}

export const SOURCES: Record<Source, { title: string; tint: Color }> = {
  steam: { title: "Steam", tint: "blue" },
  lutris: { title: "Lutris", tint: "orange" },
  heroic: { title: "Heroic", tint: "purple" },
};

export const steamLaunch = (appid: string) => `steam://rungameid/${appid}`;
export const steamStore = (appid: string) => `https://store.steampowered.com/app/${appid}`;
export const steamHeader = (appid: string) =>
  `https://shared.steamstatic.com/store_item_assets/steam/apps/${appid}/header.jpg`;
export const protonDbPage = (appid: string) => `https://www.protondb.com/app/${appid}`;
export const lutrisLaunch = (slug: string) => `lutris:rungame/${slug}`;
export const heroicLaunch = (appName: string, runner: string) =>
  `heroic://launch?appName=${encodeURIComponent(appName)}&runner=${encodeURIComponent(runner)}`;

export function steamGame(
  app: SteamApp,
  libraryPath: string,
  extra: { lastPlayed?: number; minutes?: number } = {},
): Game {
  return {
    id: `steam:${app.appid}`,
    source: "steam",
    title: app.name,
    launch: steamLaunch(app.appid),
    appid: app.appid,
    sizeBytes: app.sizeOnDisk,
    lastPlayed: Math.max(app.lastPlayed ?? 0, extra.lastPlayed ?? 0) || undefined,
    playtimeMinutes: extra.minutes,
    installDir: app.installdir ? `${libraryPath}/steamapps/common/${app.installdir}` : undefined,
    lastUpdated: app.lastUpdated,
    buildId: app.buildId,
    library: libraryPath,
  };
}

// Lutris: `lutris -l -o -j`

export interface LutrisEntry {
  id: number;
  slug: string;
  name: string;
  runner?: string | null;
  platform?: string | null;
  year?: number | null;
  directory?: string | null;
  playtime?: string | number | null;
  lastplayed?: string | number | null;
}

/** Lutris prints logs before the JSON sometimes. */
export function parseLutrisJson(stdout: string): LutrisEntry[] {
  const start = stdout.indexOf("[");
  if (start < 0) return [];
  try {
    const data = JSON.parse(stdout.slice(start, stdout.lastIndexOf("]") + 1));
    return Array.isArray(data) ? data.filter((g) => g && g.slug && g.name) : [];
  } catch {
    return [];
  }
}

/** "2:30:00", "1 day, 2:00:00", "2.5" (hours) → minutes. */
export function parseDuration(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return v > 0 ? Math.round(v * 60) : undefined;
  const days = /(\d+)\s+days?,\s*/.exec(v);
  const rest = days ? v.slice(days[0].length) : v;
  const hms = /^(\d+):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(rest.trim());
  if (hms) {
    const m = (days ? Number(days[1]) * 1440 : 0) + Number(hms[1]) * 60 + Number(hms[2]) +
      Math.round(Number(hms[3] ?? 0) / 60);
    return m > 0 ? m : undefined;
  }
  const hours = Number(rest);
  if (Number.isFinite(hours) && hours > 0) return Math.round(hours * 60);
  const words = /(?:(\d+)\s*hours?)?\D*(?:(\d+)\s*minutes?)?/i.exec(rest);
  const m = Number(words?.[1] ?? 0) * 60 + Number(words?.[2] ?? 0);
  return m > 0 ? m : undefined;
}

/** Lutris' `%x %X` local date ("10/27/26 14:03:00"), a timestamp, or ISO. */
export function parseLooseDate(v: string | number | null | undefined): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number") return v > 0 ? (v < 1e12 ? v * 1000 : v) : undefined;
  if (/^\d{9,13}$/.test(v.trim())) return parseLooseDate(Number(v));
  const m = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/.exec(v.trim());
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    // Month first, unless the first number can't be a month.
    if (a > 12) [a, b] = [b, a];
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(y, a - 1, b, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
  }
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : undefined;
}

export function lutrisGame(g: LutrisEntry): Game {
  return {
    id: `lutris:${g.slug}`,
    source: "lutris",
    title: g.name,
    launch: lutrisLaunch(g.slug),
    slug: g.slug,
    runner: g.runner ?? undefined,
    platform: g.platform ?? undefined,
    year: g.year ?? undefined,
    installDir: g.directory || undefined,
    playtimeMinutes: parseDuration(g.playtime),
    lastPlayed: parseLooseDate(g.lastplayed),
  };
}

// Heroic: store_cache/*_library.json and the installed lists

export interface HeroicEntry {
  app_name: string;
  title: string;
  runner?: string;
  is_installed?: boolean;
  art_cover?: string;
  art_square?: string;
  developer?: string;
  install?: { install_path?: string; install_size?: string | number; platform?: string };
}

export type HeroicRunner = "legendary" | "gog" | "nile";

export const HEROIC_STORES: Record<HeroicRunner, string> = { legendary: "Epic Games", gog: "GOG", nile: "Amazon" };

/** `{ library: [...] }` or `{ games: [...] }`. */
export function heroicLibrary(json: unknown): HeroicEntry[] {
  const j = json as { library?: HeroicEntry[]; games?: HeroicEntry[] } | null;
  const list = j?.library ?? j?.games ?? (Array.isArray(json) ? json as HeroicEntry[] : []);
  return list.filter((g) => g && g.app_name && g.title);
}

export interface HeroicInstall {
  path?: string;
  size?: number;
  platform?: string;
}

/**
 * Installed games: legendary's `installed.json` (`{ appName: {...} }`) or
 * GOG/Amazon's (`{ installed: [...] }`).
 */
export function heroicInstalled(json: unknown): Map<string, HeroicInstall> {
  const out = new Map<string, HeroicInstall>();
  if (!json || typeof json !== "object") return out;
  const j = json as Record<string, any>;
  const entries: any[] = Array.isArray(j.installed) ? j.installed : Object.values(j);
  for (const e of entries) {
    const name = e?.appName ?? e?.app_name ?? e?.id;
    if (!name || typeof e !== "object") continue;
    out.set(name, { path: e.install_path, size: parseSize(e.install_size), platform: e.platform });
  }
  return out;
}

/** Heroic's `store/timestamp.json`: `{ appName: { lastPlayed, totalPlayed } }`. */
export function heroicPlaytimes(json: unknown): Map<string, { lastPlayed?: number; minutes?: number }> {
  const out = new Map<string, { lastPlayed?: number; minutes?: number }>();
  if (!json || typeof json !== "object") return out;
  for (const [name, v] of Object.entries(json as Record<string, any>)) {
    if (!v || typeof v !== "object") continue;
    out.set(name, {
      lastPlayed: parseLooseDate(v.lastPlayed),
      minutes: typeof v.totalPlayed === "number" && v.totalPlayed > 0 ? Math.round(v.totalPlayed) : undefined,
    });
  }
  return out;
}

export function heroicGame(
  g: HeroicEntry,
  runner: HeroicRunner,
  install: HeroicInstall | undefined,
  played: { lastPlayed?: number; minutes?: number } = {},
): Game {
  return {
    id: `heroic:${runner}:${g.app_name}`,
    source: "heroic",
    title: g.title,
    launch: heroicLaunch(g.app_name, runner),
    slug: g.app_name,
    runner: HEROIC_STORES[runner],
    platform: install?.platform ?? g.install?.platform,
    installDir: install?.path ?? g.install?.install_path,
    sizeBytes: install?.size ?? parseSize(g.install?.install_size),
    cover: g.art_square || g.art_cover || undefined,
    lastPlayed: played.lastPlayed,
    playtimeMinutes: played.minutes,
  };
}

// ---------------------------------------------------------------------------
// Formatting

/** 12.3 GiB, "12.3 GiB", "850 MB", bytes → bytes. */
export function parseSize(v: unknown): number | undefined {
  if (typeof v === "number") return v > 0 ? v : undefined;
  if (typeof v !== "string") return undefined;
  const m = /^\s*([\d.,]+)\s*([KMGT]?)(i?)B?\s*$/i.exec(v);
  if (!m) return undefined;
  const n = Number(m[1].replace(",", "."));
  const pow = ["", "K", "M", "G", "T"].indexOf(m[2].toUpperCase());
  const base = m[3] || m[2] ? 1024 : 1;
  const bytes = n * base ** Math.max(0, pow);
  return bytes > 0 ? Math.round(bytes) : undefined;
}

export function formatSize(bytes: number | undefined): string | undefined {
  if (!bytes) return undefined;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = bytes;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024;
    u++;
  }
  return `${v >= 100 || u === 0 ? Math.round(v) : v.toFixed(1)} ${units[u]}`;
}

export function formatPlaytime(minutes: number | undefined): string | undefined {
  if (!minutes) return undefined;
  if (minutes < 60) return `${minutes} min`;
  const h = minutes / 60;
  return `${h >= 10 ? Math.round(h) : h.toFixed(1).replace(/\.0$/, "")} h`;
}

export function ago(ms: number | undefined, now = Date.now()): string | undefined {
  if (!ms) return undefined;
  // Calendar days: last night is "yesterday".
  const day = (t: number) => {
    const d = new Date(t);
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000;
  };
  const d = day(now) - day(ms);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  if (d < 30) return `${d} days ago`;
  if (d < 365) return `${Math.floor(d / 30)} mo ago`;
  return `${Math.floor(d / 365)} y ago`;
}

/** Recently played first, then by title. */
export function sortGames(games: Game[]): Game[] {
  return [...games].sort((a, b) => (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title));
}

/** One entry per game: a Steam game also added to Lutris keeps its Steam entry. */
export function dedupe(games: Game[]): Game[] {
  const seen = new Set<string>();
  const key = (g: Game) => g.title.toLowerCase().replace(/[^a-z0-9]/g, "");
  const out: Game[] = [];
  for (const g of [...games].sort((a, b) => (a.source === "steam" ? -1 : 0) - (b.source === "steam" ? -1 : 0))) {
    if (g.source === "lutris" && g.runner === "steam" && seen.has(key(g))) continue;
    seen.add(key(g));
    out.push(g);
  }
  return out;
}

// ---------------------------------------------------------------------------
// ProtonDB

export interface ProtonSummary {
  tier: string;
  trendingTier?: string;
  bestReportedTier?: string;
  confidence?: string;
  score?: number;
  total?: number;
}

export const protonDbApi = (appid: string) => `https://www.protondb.com/api/v1/reports/summaries/${appid}.json`;

const TIERS: Record<string, { label: string; color: Color }> = {
  native: { label: "Native", color: "green" },
  platinum: { label: "Platinum", color: "teal" },
  gold: { label: "Gold", color: "yellow" },
  silver: { label: "Silver", color: "gray" },
  bronze: { label: "Bronze", color: "orange" },
  borked: { label: "Borked", color: "red" },
  pending: { label: "Pending", color: "gray" },
};

export function tier(name: string | undefined): { label: string; color: Color } | undefined {
  if (!name) return undefined;
  return TIERS[name.toLowerCase()] ?? { label: name[0].toUpperCase() + name.slice(1), color: "gray" };
}

export function sourceIcon(source: Source): { source: string; tint: Color } {
  return { source: Icons.gamepad, tint: SOURCES[source].tint };
}
