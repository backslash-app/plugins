// What the commands do with MPD, and album covers.

import { exec } from "@backslash/api";
import { Mpd, withMpd } from "./client.ts";
import {
  coverKey,
  type Family,
  imageExtension,
  osFamily,
  parsePlaylists,
  parseSongs,
  parseStats,
  parseStatus,
  type Playlist,
  quote,
  type Song,
  type Stats,
  type Status,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const COVERS = `${HOME}/.cache/backslash/mpd`;

export interface Prefs {
  password?: string;
  covers?: boolean;
}

export const run = <T>(prefs: Prefs, fn: (mpd: Mpd) => Promise<T>) => withMpd(prefs.password || undefined, fn);

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

export interface Snapshot {
  status: Status;
  current?: Song;
}

export async function snapshot(mpd: Mpd): Promise<Snapshot> {
  const status = parseStatus(await mpd.command("status"));
  const current = status.songId !== undefined ? parseSongs(await mpd.command("currentsong"))[0] : undefined;
  return { status, current };
}

export const queue = async (mpd: Mpd): Promise<Song[]> => parseSongs(await mpd.command("playlistinfo"));
export const playlists = async (mpd: Mpd): Promise<Playlist[]> => parsePlaylists(await mpd.command("listplaylists"));
export const playlistSongs = async (mpd: Mpd, name: string): Promise<Song[]> =>
  parseSongs(await mpd.command(`listplaylistinfo ${quote(name)}`));
export const stats = async (mpd: Mpd): Promise<Stats> => parseStats(await mpd.command("stats"));

/** Songs whose tags or file name contain the text (case-insensitive), at most `limit`. */
export async function search(mpd: Mpd, text: string, limit = 150): Promise<Song[]> {
  return parseSongs(await mpd.command(`search any ${quote(text)} window 0:${limit}`));
}

/** Adds after the song playing (or at the end when nothing plays). */
export async function playNext(mpd: Mpd, uris: string[]): Promise<void> {
  const { status } = await snapshot(mpd);
  const at = status.song !== undefined ? status.song + 1 : status.playlistLength;
  await mpd.commands(uris.map((u, i) => `addid ${quote(u)} ${at + i}`));
}

/** Adds and plays the first one. */
export async function playNow(mpd: Mpd, uris: string[]): Promise<void> {
  const { status } = await snapshot(mpd);
  const at = status.song !== undefined ? status.song + 1 : status.playlistLength;
  const id = Number((await mpd.command(`addid ${quote(uris[0])} ${at}`)).match(/Id: (\d+)/)?.[1]);
  if (uris.length > 1) await mpd.commands(uris.slice(1).map((u, i) => `addid ${quote(u)} ${at + 1 + i}`));
  await mpd.command(`playid ${id}`);
}

export const add = (mpd: Mpd, uris: string[]) => mpd.commands(uris.map((u) => `add ${quote(u)}`));

/** Clears the queue, loads the songs or a playlist, plays from the start. */
export async function replaceAndPlay(mpd: Mpd, what: { uris?: string[]; playlist?: string }): Promise<void> {
  await mpd.commands([
    "clear",
    ...(what.playlist ? [`load ${quote(what.playlist)}`] : (what.uris ?? []).map((u) => `add ${quote(u)}`)),
    "play 0",
  ]);
}

export async function playPause(mpd: Mpd): Promise<Snapshot> {
  const s = await snapshot(mpd);
  if (s.status.state === "play") await mpd.command("pause 1");
  else await mpd.command("play");
  return s;
}

export async function setVolume(mpd: Mpd, volume: number): Promise<void> {
  await mpd.command(`setvol ${Math.max(0, Math.min(100, Math.round(volume)))}`);
}

// ---------------------------------------------------------------------------
// Covers

const missing = new Set<string>();

/** The cover of a song's album: MPD's albumart (cover file in the folder), else readpicture (embedded). */
export async function cover(mpd: Mpd, song: Song | undefined): Promise<string | undefined> {
  if (!song || song.stream || !song.file) return undefined;
  const key = coverKey(song.file);
  if (missing.has(key)) return undefined;
  for (const ext of ["jpg", "png", "webp", "gif"]) {
    const path = `${COVERS}/${key}.${ext}`;
    if ((await Deno.stat(path).catch(() => undefined))?.size) return path;
  }
  try {
    const bytes = (await mpd.picture("albumart", song.file)) ?? (await mpd.picture("readpicture", song.file));
    if (!bytes?.length) {
      missing.add(key);
      return undefined;
    }
    await Deno.mkdir(COVERS, { recursive: true });
    const path = `${COVERS}/${key}.${imageExtension(bytes)}`;
    await Deno.writeFile(path, bytes);
    return path;
  } catch {
    missing.add(key);
    return undefined;
  }
}

/** Starts MPD's user service (systemd), for the "not running" state. */
export async function startService(): Promise<void> {
  await exec("systemctl", ["--user", "start", "mpd.service"]);
  await new Promise((r) => setTimeout(r, 800));
}
