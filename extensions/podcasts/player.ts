// Playing an episode in the background: mpv in a transient systemd user unit,
// so it keeps playing once the launcher is hidden. Pause, resume and seek go
// through mpv's JSON IPC socket; a small mpv script saves the position to a
// file, so it is remembered even when mpv ends on its own.

import { exec, storage } from "@backslash/api";
import { setProgress } from "./api.ts";
import {
  type Episode,
  type Family,
  ipcCommand,
  ipcReply,
  isFinished,
  mpvArgs,
  osFamily,
  parsePositionFile,
  positionScript,
  unitArgs,
} from "./lib.ts";

export const UNIT = "backslash-podcasts";

export interface Playing {
  episode: Episode;
  started: number;
  speed: number;
}

export interface PlayerState {
  playing: Playing;
  position?: number;
  duration?: number;
  paused: boolean;
}

const home = () => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
};
const dir = () => `${home()}/.cache/backslash/podcasts`;
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

/** Sends one command to mpv and returns its answer's data (undefined when mpv isn't there). */
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

async function positionFile() {
  return parsePositionFile(await Deno.readTextFile(positionPath()).catch(() => undefined));
}

/** Saves where the episode is: from mpv while it runs, from the script's file once it ended. */
async function remember(p: Playing, live?: { position?: number; duration?: number }): Promise<void> {
  const file = await positionFile();
  const position = live?.position ?? file?.position;
  const duration = live?.duration ?? file?.duration ?? p.episode.duration;
  if (file?.ended && live?.position === undefined) {
    await setProgress(p.episode, { position: duration ?? 0, duration, played: true });
  } else if (position !== undefined && position > 0) {
    await setProgress(p.episode, { position, duration, played: isFinished(position, duration) });
  }
}

/** What is playing, if the unit still runs; saves the position of an episode that ended. */
export async function nowPlaying(): Promise<PlayerState | undefined> {
  const playing = await storage.get<never>("playing") as Playing | undefined;
  if (!playing) return undefined;
  if (await unitActive()) {
    const [pos, dur, pause] = await Promise.all([
      ipc(["get_property", "time-pos"]),
      ipc(["get_property", "duration"]),
      ipc(["get_property", "pause"]),
    ]);
    const file = await positionFile();
    return {
      playing,
      position: num(pos?.data) ?? file?.position,
      duration: num(dur?.data) ?? file?.duration ?? playing.episode.duration,
      paused: pause ? pause.data === true : !!file?.paused,
    };
  }
  await remember(playing);
  await storage.delete("playing");
  return undefined;
}

export async function stop(): Promise<Playing | undefined> {
  const playing = await storage.get<never>("playing") as Playing | undefined;
  if (playing) {
    const [pos, dur] = await Promise.all([ipc(["get_property", "time-pos"]), ipc(["get_property", "duration"])]);
    await remember(playing, { position: num(pos?.data), duration: num(dur?.data) });
  }
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  await storage.delete("playing");
  return playing;
}

export class NoPlayer extends Error {}

/** Starts the episode at `start` seconds, replacing what was playing. */
export async function play(episode: Episode, start: number, speed: number): Promise<Playing> {
  if (!await mpvInstalled()) throw new NoPlayer("Install mpv to play podcasts");
  await stop();
  if (!home()) throw new Error("HOME isn't set: mpv's control socket can't be created");
  await Deno.mkdir(dir(), { recursive: true });
  await Deno.remove(positionPath()).catch(() => {});
  await Deno.remove(socketPath()).catch(() => {});
  await Deno.writeTextFile(scriptPath(), positionScript(positionPath()));
  const argv = mpvArgs(episode.audio, {
    start,
    speed,
    socket: socketPath(),
    script: scriptPath(),
    title: `${episode.show}: ${episode.title}`,
  });
  try {
    await exec("systemd-run", unitArgs(UNIT, `Backslash Podcasts: ${episode.title}`, argv));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to play in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: episodes play in the background with systemd-run --user");
    }
    throw e;
  }
  // An address that can't be opened makes mpv quit at once.
  await new Promise((r) => setTimeout(r, 1200));
  if (!await unitActive()) throw new Error(`“${episode.title}” could not be played: the audio file is unavailable`);
  const playing: Playing = { episode: { ...episode, notes: "" }, started: Date.now(), speed };
  await storage.set("playing", playing as never);
  return playing;
}

/** Pauses or resumes; true when now paused. */
export async function togglePause(): Promise<boolean | undefined> {
  const r = await ipc(["cycle", "pause"]);
  if (!r?.ok) return undefined;
  const pause = await ipc(["get_property", "pause"]);
  return pause?.data === true;
}

export async function seek(seconds: number): Promise<boolean> {
  return !!(await ipc(["seek", seconds, "relative"]))?.ok;
}

export async function setSpeed(speed: number): Promise<boolean> {
  return !!(await ipc(["set_property", "speed", speed]))?.ok;
}
