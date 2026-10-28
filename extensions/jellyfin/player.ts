// Playing in mpv or VLC as a transient systemd user unit, so the player keeps
// running once the launcher is hidden.

import { exec } from "@backslash/api";
import { type Family, osFamily, type Player, playerArgs, unitArgs } from "./lib.ts";

async function installed(name: string): Promise<boolean> {
  try {
    await new Deno.Command(name, {
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

export async function findPlayer(choices: Player[]): Promise<Player | undefined> {
  for (const p of choices) if (await installed(p)) return p;
  return undefined;
}

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

export class NoPlayer extends Error {}

export const PLAYER_NAMES: Record<Player, string> = { mpv: "mpv", vlc: "VLC" };

/** Starts `urls` in the player; the unit's description shows the title, never the tokenized address. */
export async function play(choices: Player[], urls: string[], o: { title: string; start?: number }): Promise<Player> {
  const player = await findPlayer(choices);
  if (!player) throw new NoPlayer("Install mpv or VLC to play from your library");
  if (!urls.length) throw new Error("Nothing to play");
  const unit = `backslash-media-${Date.now().toString(36)}`;
  const display = Object.fromEntries(
    ["WAYLAND_DISPLAY", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"].map((k) => [k, env(k)]),
  );
  try {
    await exec("systemd-run", unitArgs(unit, `Backslash: ${o.title}`, display, playerArgs(player, urls, o)));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to start the player");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: the player starts with systemd-run --user");
    }
    throw e;
  }
  return player;
}

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}
