// The track playing in any MPRIS player (Spotify, browsers, mpv, VLC…), read
// and driven with playerctl.

import { exec } from "@backslash/api";
import { type Family, osFamily, parsePlayerctl, pickTrack, PLAYERCTL_FORMAT, type Track } from "./lib.ts";

export class NoPlayerctl extends Error {}

/** Every player's track; [] when none runs. */
export async function tracks(signal?: AbortSignal): Promise<Track[]> {
  try {
    return parsePlayerctl(await exec("playerctl", ["-a", "metadata", "--format", PLAYERCTL_FORMAT], { signal }));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NoPlayerctl("Install playerctl to follow the track playing");
    if (signal?.aborted) throw e;
    return []; // "No players found" exits with 1.
  }
}

export async function current(preferred: string, signal?: AbortSignal): Promise<Track | undefined> {
  return pickTrack(await tracks(signal), preferred);
}

const player = (t: Track) => ["--player", t.player];

export const playPause = (t: Track) => exec("playerctl", [...player(t), "play-pause"]);
export const next = (t: Track) => exec("playerctl", [...player(t), "next"]);
export const previous = (t: Track) => exec("playerctl", [...player(t), "previous"]);
/** Jumps to `seconds` from the start of the track. */
export const seekTo = (t: Track, seconds: number) =>
  exec("playerctl", [...player(t), "position", String(Math.max(0, seconds).toFixed(2))]);

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}
