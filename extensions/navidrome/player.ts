// Playing in the background: mpv in a transient systemd user unit, so it
// keeps playing once the launcher is hidden. Pause, next and the position go
// through mpv's JSON IPC socket; a small mpv script saves the position to a
// file, so an audiobook's progress reaches Audiobookshelf even when mpv
// ended on its own.

import { exec, storage } from "@backslash/api";
import type { Abs } from "./api.ts";
import {
  bookTime,
  type Chapter,
  chapterAt,
  type Entry,
  type Family,
  ipcCommand,
  ipcReply,
  mpvArgs,
  osFamily,
  parsePositionFile,
  positionScript,
  unitArgs,
} from "./lib.ts";

export const UNIT = "backslash-navidrome";

export interface QueueEntry {
  title: string;
  artist?: string;
  album?: string;
  duration?: number;
  /** The Subsonic song id: finds the entry again when the queue is shuffled. */
  songId?: string;
  /** A cached cover, as a local path. */
  cover?: string;
}

export interface Playing {
  source: "subsonic" | "abs";
  /** The album, playlist, book or episode. */
  title: string;
  entries: QueueEntry[];
  started: number;
  shuffle?: boolean;
  cover?: string;
  abs?: {
    itemId: string;
    episodeId?: string;
    /** Where each file starts in the book, in seconds. */
    offsets: number[];
    duration: number;
    chapters?: Chapter[];
  };
}

export interface PlayerState {
  playing: Playing;
  /** The entry playing. */
  index: number;
  entry?: QueueEntry;
  position?: number;
  duration?: number;
  paused: boolean;
  /** Audiobooks: the position in the whole book, and its chapter. */
  bookTime?: number;
  chapter?: Chapter;
}

const home = () => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
};
const dir = () => `${home()}/.cache/backslash/navidrome`;
const socketPath = () => `${dir()}/mpv.sock`;
const positionPath = () => `${dir()}/position.json`;
const scriptPath = () => `${dir()}/position.lua`;

export async function mpvInstalled(): Promise<boolean> {
  try {
    await new Deno.Command("mpv", {
      args: ["--version"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    }).output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

async function unitActive(): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${UNIT}.service`])) === "active";
  } catch {
    return false; // is-active exits 3 when the unit is gone.
  }
}

let requestId = 0;

/** Sends one command to mpv and returns its answer (undefined when mpv isn't there). */
export async function ipc(
  command: (string | number | boolean)[],
): Promise<{ ok: boolean; data?: unknown } | undefined> {
  let conn: Deno.UnixConn;
  try {
    conn = await Deno.connect({ transport: "unix", path: socketPath() });
  } catch {
    return undefined;
  }
  const id = ++requestId;
  const deadline = setTimeout(() => {
    try {
      conn.close();
    } catch {
      // Closed.
    }
  }, 1500);
  try {
    await conn.write(new TextEncoder().encode(ipcCommand(command, id)));
    const buf = new Uint8Array(8192);
    let text = "";
    while (true) {
      const n = await conn.read(buf);
      if (n === null) return undefined;
      text += new TextDecoder().decode(buf.subarray(0, n));
      const reply = ipcReply(text, id);
      if (reply) return reply;
    }
  } catch {
    return undefined;
  } finally {
    clearTimeout(deadline);
    try {
      conn.close();
    } catch {
      // Closed.
    }
  }
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

async function load(): Promise<Playing | undefined> {
  return await storage.get("playing").catch(() => undefined) as Playing | undefined;
}

async function positionFile() {
  return parsePositionFile(await Deno.readTextFile(positionPath()).catch(() => undefined));
}

/** The queue entry mpv plays: by song id when shuffled, else by position. */
function entryAt(p: Playing, index: number, filename: unknown): number {
  if (p.shuffle && typeof filename === "string") {
    const id = filename.match(/[?&]id=([^&]+)/)?.[1];
    const at = id ? p.entries.findIndex((e) => e.songId === decodeURIComponent(id)) : -1;
    if (at >= 0) return at;
  }
  return Math.max(0, Math.min(index, p.entries.length - 1));
}

let lastSync = 0;

/** Sends the book's position to Audiobookshelf, at most every 30 seconds unless `force`. */
async function sync(
  p: Playing,
  abs: Abs | undefined,
  time: number | undefined,
  o: { force?: boolean; finished?: boolean },
) {
  if (!abs || !p.abs || time === undefined) return;
  if (!o.force && Date.now() - lastSync < 30_000) return;
  lastSync = Date.now();
  await abs.saveProgress(p.abs.itemId, p.abs.episodeId, time, p.abs.duration, o.finished).catch(() => {});
}

/** What is playing, if the unit still runs; an audiobook's progress is saved on the way. */
export async function nowPlaying(abs?: Abs): Promise<PlayerState | undefined> {
  const playing = await load();
  if (!playing) return undefined;
  if (await unitActive()) {
    const [pos, dur, pause, idx, file] = await Promise.all([
      ipc(["get_property", "time-pos"]),
      ipc(["get_property", "duration"]),
      ipc(["get_property", "pause"]),
      ipc(["get_property", "playlist-pos"]),
      ipc(["get_property", "filename"]),
    ]);
    const saved = await positionFile();
    const playlistPos = num(idx?.data) ?? saved?.index ?? 0;
    const index = entryAt(playing, playlistPos, file?.data);
    const position = num(pos?.data) ?? saved?.position;
    const state: PlayerState = {
      playing,
      index,
      entry: playing.entries[index],
      position,
      duration: num(dur?.data) ?? playing.entries[index]?.duration,
      paused: pause ? pause.data === true : !!saved?.paused,
    };
    if (playing.abs && position !== undefined) {
      state.bookTime = bookTime(playing.abs.offsets, playlistPos, position);
      state.chapter = chapterAt(playing.abs.chapters, state.bookTime);
      await sync(playing, abs, state.bookTime, {});
    }
    return state;
  }
  // Ended on its own: the script's file says where.
  if (playing.abs) {
    const saved = await positionFile();
    if (saved?.finished) await sync(playing, abs, playing.abs.duration, { force: true, finished: true });
    else if (saved?.position !== undefined) {
      await sync(playing, abs, bookTime(playing.abs.offsets, saved.index ?? 0, saved.position), { force: true });
    }
  }
  await storage.delete("playing").catch(() => {});
  return undefined;
}

export async function stop(abs?: Abs): Promise<Playing | undefined> {
  const playing = await load();
  if (playing?.abs) {
    const [pos, idx] = await Promise.all([ipc(["get_property", "time-pos"]), ipc(["get_property", "playlist-pos"])]);
    const saved = await positionFile();
    const position = num(pos?.data) ?? saved?.position;
    if (position !== undefined) {
      await sync(playing, abs, bookTime(playing.abs.offsets, num(idx?.data) ?? saved?.index ?? 0, position), {
        force: true,
      });
    }
  }
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  await storage.delete("playing").catch(() => {});
  return playing;
}

export class NoPlayer extends Error {}

/** Starts the queue, replacing what was playing. */
export async function play(
  playing: Omit<Playing, "started">,
  files: Entry[],
  o: { startIndex?: number; abs?: Abs; speed?: number } = {},
): Promise<Playing> {
  if (!files.length) throw new Error("Nothing to play");
  if (!await mpvInstalled()) throw new NoPlayer("Install mpv to play your music and audiobooks");
  await stop(o.abs);
  if (!home()) throw new Error("HOME isn't set: mpv's control socket can't be created");
  await Deno.mkdir(dir(), { recursive: true });
  await Deno.remove(positionPath()).catch(() => {});
  await Deno.remove(socketPath()).catch(() => {});
  await Deno.writeTextFile(scriptPath(), positionScript(positionPath()));
  const argv = mpvArgs(files, {
    socket: socketPath(),
    script: scriptPath(),
    title: `Backslash: ${playing.title}`,
    shuffle: playing.shuffle,
    startIndex: o.startIndex,
    speed: o.speed,
  });
  try {
    // The unit's description shows the title, never the addresses (they carry the credentials).
    await exec("systemd-run", unitArgs(UNIT, `Backslash: ${playing.title}`, argv));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to play in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: music plays in the background with systemd-run --user");
    }
    throw e;
  }
  // An address that can't be opened makes mpv quit at once.
  await new Promise((r) => setTimeout(r, 1200));
  if (!await unitActive()) throw new Error(`“${playing.title}” could not be played: the server refused the stream`);
  const saved: Playing = { ...playing, started: Date.now() };
  lastSync = Date.now();
  await storage.set("playing", saved as never);
  return saved;
}

/** Pauses or resumes; true when now paused. */
export async function togglePause(): Promise<boolean | undefined> {
  const r = await ipc(["cycle", "pause"]);
  if (!r?.ok) return undefined;
  return (await ipc(["get_property", "pause"]))?.data === true;
}

/** Next track; in an audiobook, the next chapter (or 30 seconds on). */
export async function next(p: Playing): Promise<boolean> {
  if (p.source === "abs") {
    if ((await ipc(["add", "chapter", 1]))?.ok) return true;
    return !!(await ipc(["seek", 30, "relative"]))?.ok;
  }
  return !!(await ipc(["playlist-next", "weak"]))?.ok;
}

export async function previous(p: Playing): Promise<boolean> {
  if (p.source === "abs") {
    if ((await ipc(["add", "chapter", -1]))?.ok) return true;
    return !!(await ipc(["seek", -30, "relative"]))?.ok;
  }
  return !!(await ipc(["playlist-prev", "weak"]))?.ok;
}

export async function seek(seconds: number): Promise<boolean> {
  return !!(await ipc(["seek", seconds, "relative"]))?.ok;
}
