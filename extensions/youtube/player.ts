// Playing a video in mpv (which streams it with yt-dlp) as a transient systemd
// user unit, so it keeps playing once the launcher is hidden.

import { exec } from "@backslash/api";
import { load, save } from "./api.ts";
import { type Family, mpvArgs, osFamily, unitArgs, type Video, watchUrl } from "./lib.ts";

export const UNIT = "backslash-youtube";

export interface Playing {
  video: Video;
  audioOnly: boolean;
  started: number;
}

async function installed(name: string): Promise<boolean> {
  try {
    await new Deno.Command(name, {
      args: ["--version"],
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

export interface Tools {
  mpv: boolean;
  ytdlp: boolean;
}

export async function tools(): Promise<Tools> {
  const [mpv, ytdlp] = await Promise.all([installed("mpv"), installed("yt-dlp")]);
  return { mpv, ytdlp };
}

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

async function unitActive(): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${UNIT}.service`])) === "active";
  } catch {
    return false;
  }
}

export async function nowPlaying(): Promise<Playing | undefined> {
  const saved = await load<Playing>("playing");
  if (!saved) return undefined;
  if (await unitActive()) return saved;
  await save("playing", null);
  return undefined;
}

export async function stop(): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  await save("playing", null);
}

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

export class MissingTool extends Error {}

export async function play(video: Video, audioOnly: boolean): Promise<Playing> {
  const t = await tools();
  if (!t.mpv || !t.ytdlp) {
    const missing = [...(t.mpv ? [] : ["mpv"]), ...(t.ytdlp ? [] : ["yt-dlp"])];
    throw new MissingTool(`Playing needs ${missing.join(" and ")}`);
  }
  await exec("systemctl", ["--user", "stop", `${UNIT}.service`]).catch(() => {});
  const display = Object.fromEntries(
    ["WAYLAND_DISPLAY", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"].map((k) => [k, env(k)]),
  );
  try {
    await exec(
      "systemd-run",
      unitArgs(
        UNIT,
        `Backslash YouTube: ${video.title}`,
        display,
        mpvArgs(watchUrl(video.id), { audioOnly, title: video.title }),
      ),
    );
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to play in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: videos play in the background with systemd-run --user");
    }
    throw e;
  }
  const playing = { video, audioOnly, started: Date.now() };
  await save("playing", playing);
  return playing;
}
