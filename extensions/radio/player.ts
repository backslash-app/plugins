// Playing a station in the background: a transient systemd user unit running
// mpv (or ffplay, or VLC), so it keeps playing once the launcher is hidden.

import { exec } from "@backslash/api";
import { click, load, save } from "./api.ts";
import {
  type Family,
  osFamily,
  type Player,
  playerArgs,
  program,
  songScript,
  songTitle,
  type Station,
  unitArgs,
} from "./lib.ts";

export const UNIT = "backslash-radio";

export interface Playing {
  station: Station;
  player: Player;
  started: number;
}

const home = () => Deno.env.get("HOME") ?? "";
const dir = () => `${home()}/.cache/backslash/radio`;
const scriptPath = () => `${dir()}/now-playing.lua`;
const songPath = () => `${dir()}/song.txt`;

/** Whether a program can be started: installed and allowed. */
async function installed(name: string, args: string[]): Promise<boolean> {
  try {
    await new Deno.Command(name, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(3000),
    })
      .output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

const VERSION_ARGS: Record<Player, string[]> = { mpv: ["--version"], ffplay: ["-version"], vlc: ["--version"] };

/** The first of `choices` that is installed. */
export async function findPlayer(choices: Player[]): Promise<Player | undefined> {
  for (const p of choices) if (await installed(program(p), VERSION_ARGS[p])) return p;
  return undefined;
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

/** What is playing, if the unit still runs. */
export async function nowPlaying(): Promise<Playing | undefined> {
  const saved = await load<Playing>("playing");
  if (!saved) return undefined;
  if (await unitActive()) return saved;
  await save("playing", null);
  return undefined;
}

export async function stop(): Promise<boolean> {
  const was = await load<Playing>("playing");
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  await save("playing", null);
  return !!was;
}

export class NoPlayer extends Error {}

/** Starts the station in the background, replacing what was playing. */
export async function play(station: Station, choices: Player[]): Promise<Playing> {
  const player = await findPlayer(choices);
  if (!player) throw new NoPlayer("No player found: install mpv to listen to the radio");
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  const url = await click(station);
  let script: string | undefined;
  if (player === "mpv" && home()) {
    try {
      await Deno.mkdir(dir(), { recursive: true });
      await Deno.remove(songPath()).catch(() => {});
      await Deno.writeTextFile(scriptPath(), songScript(songPath()));
      script = scriptPath();
    } catch {
      // Plays without the song title.
    }
  }
  const argv = playerArgs(player, url, { script, title: station.name });
  try {
    await exec("systemd-run", unitArgs(UNIT, `Backslash Radio: ${station.name}`, argv));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to play in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: stations play in the background with systemd-run --user");
    }
    throw e;
  }
  // A stream that can't be opened makes the player quit at once.
  await new Promise((r) => setTimeout(r, 1200));
  if (!await unitActive()) throw new Error(`${station.name} could not be played: the stream is offline or unsupported`);
  const playing = { station, player, started: Date.now() };
  await save("playing", playing);
  return playing;
}

/** The song mpv read from the stream's ICY metadata, if any. */
export async function song(): Promise<string | undefined> {
  if (!home()) return undefined;
  return songTitle(await Deno.readTextFile(songPath()).catch(() => undefined));
}
