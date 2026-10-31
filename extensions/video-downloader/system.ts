// Installed tools, the copied link, `yt-dlp -J`, and the downloads: transient
// systemd user units running yt-dlp, so they go on with the launcher closed.

import { clipboard, type Context, exec, storage } from "@backslash/api";
import {
  type Choice,
  cookiesBrowser,
  describeChoice,
  expandHome,
  type Family,
  findUrl,
  type Info,
  jobScript,
  lastError,
  osFamily,
  parseFiles,
  parseInfo,
  parseProgress,
  type Progress,
  ytdlpArgs,
  ytdlpError,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/video-downloader`;

async function works(program: string, args: string[]): Promise<boolean> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(5000),
    }).output();
    return out.success;
  } catch {
    return false;
  }
}

export interface Tools {
  ytdlp: boolean;
  ffmpeg: boolean;
  systemdRun: boolean;
}

let found: Promise<Tools> | undefined;
export function tools(): Promise<Tools> {
  found ??= Promise.all([
    works("yt-dlp", ["--version"]),
    works("ffmpeg", ["-version"]),
    works("systemd-run", ["--version"]),
  ])
    .then(([ytdlp, ffmpeg, systemdRun]) => ({ ytdlp, ffmpeg, systemdRun }));
  return found;
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

/** A link from the clipboard, if one was copied. */
export async function clipboardUrl(): Promise<string | undefined> {
  try {
    return findUrl(await clipboard.read());
  } catch {
    return undefined;
  }
}

export interface Prefs {
  folder: string;
  audioFolder: string;
  compatible: boolean;
  cookiesFrom?: string;
  quality: string;
}

export function prefs(ctx: Pick<Context, "preferences">): Prefs {
  const p = ctx.preferences;
  return {
    folder: expandHome(String(p.folder || "~/Downloads"), HOME),
    audioFolder: expandHome(String(p.audioFolder || p.folder || "~/Music"), HOME),
    compatible: p.compatible !== false,
    cookiesFrom: cookiesBrowser(p.cookiesFrom),
    quality: String(p.quality ?? "best"),
  };
}

const infos = new Map<string, Promise<Info>>();

/** What yt-dlp knows about the link (title, formats…), asked once per link. */
export function info(url: string, p: Prefs): Promise<Info> {
  let pending = infos.get(url);
  if (!pending) {
    pending = (async () => {
      const args = ["-J", "--no-warnings", "--flat-playlist", "--no-playlist"];
      if (p.cookiesFrom) args.push("--cookies-from-browser", p.cookiesFrom);
      args.push("--", url);
      const out = await new Deno.Command("yt-dlp", {
        args,
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
        signal: AbortSignal.timeout(60_000),
      }).output().catch((e) => {
        if (e instanceof Deno.errors.NotFound) throw new Error("yt-dlp is not installed");
        throw new Error("yt-dlp took too long to answer");
      });
      if (!out.success) throw new Error(ytdlpError(new TextDecoder().decode(out.stderr)));
      return parseInfo(new TextDecoder().decode(out.stdout), url);
    })();
    pending.catch(() => infos.delete(url));
    infos.set(url, pending);
  }
  return pending;
}

// ---------------------------------------------------------------------------
// Downloads

export interface Download {
  id: string;
  unit: string;
  url: string;
  title: string;
  uploader?: string;
  thumbnail?: string;
  duration?: number;
  choice: Choice;
  folder: string;
  playlist: boolean;
  dir: string;
  started: number;
}

export type DownloadState =
  | { state: "running"; progress?: Progress }
  | { state: "done"; files: string[]; size: number }
  | { state: "failed"; error: string }
  | { state: "stopped" };

type Json = Parameters<typeof storage.set>[1];

export const downloads = async (): Promise<Download[]> =>
  ((await storage.get("downloads")) as unknown as Download[] | undefined) ?? [];
const saveDownloads = (list: Download[]) => storage.set("downloads", list as unknown as Json);

/** Starts yt-dlp in the background. */
export async function start(
  target: { url: string; title: string; uploader?: string; thumbnail?: string; duration?: number; playlist?: boolean },
  choice: Choice,
  p: Prefs,
): Promise<Download> {
  const t = await tools();
  if (!t.ytdlp) throw new Error("yt-dlp is not installed");
  if (!HOME) throw new Error("HOME is not set");
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = `${CACHE}/jobs/${id}`;
  const folder = choice.kind === "audio" ? p.audioFolder : p.folder;
  const playlist = !!target.playlist;
  const args = ytdlpArgs({
    url: target.url,
    choice,
    folder,
    dir,
    playlist,
    compatible: p.compatible,
    hasFfmpeg: t.ffmpeg,
    cookiesFrom: p.cookiesFrom,
  });
  await Deno.mkdir(dir, { recursive: true });
  const log = `${dir}/log`;
  await Deno.writeTextFile(log, "");
  const unit = `backslash-ytdlp-${id}`;
  try {
    await exec("systemd-run", [
      "--user",
      "--quiet",
      "--collect",
      `--unit=${unit}`,
      `--description=Backslash: download ${target.title.slice(0, 80)}`,
      `--property=StandardOutput=append:${log}`,
      `--property=StandardError=append:${log}`,
      "--nice=5",
      "sh",
      "-c",
      jobScript(args, dir, target.title),
    ]);
  } catch (e) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to download in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: downloads run in the background with systemd-run --user");
    }
    throw new Error(String((e as Error).message).replace(/^.*exited with \d+: /, ""));
  }
  const d: Download = {
    id,
    unit,
    url: target.url,
    title: target.title,
    uploader: target.uploader,
    thumbnail: target.thumbnail,
    duration: target.duration,
    choice,
    folder,
    playlist,
    dir,
    started: Date.now(),
  };
  await saveDownloads([d, ...(await downloads())].slice(0, 50));
  return d;
}

/** Downloads the same link again with the same quality (yt-dlp resumes a .part file). */
export function retry(d: Download, p: Prefs): Promise<Download> {
  return dismiss([d.id]).then(() => start({ ...d }, d.choice, p));
}

async function active(unit: string): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${unit}.service`])) === "active";
  } catch {
    return false;
  }
}

async function sizeOf(paths: string[]): Promise<number> {
  const sizes = await Promise.all(paths.map((f) => Deno.stat(f).then((s) => s.size).catch(() => 0)));
  return sizes.reduce((a, b) => a + b, 0);
}

export async function state(d: Download): Promise<DownloadState> {
  const status = await Deno.readTextFile(`${d.dir}/status`).catch(() => undefined);
  const log = () => Deno.readTextFile(`${d.dir}/log`).catch(() => "");
  if (status !== undefined) {
    const files = parseFiles(await Deno.readTextFile(`${d.dir}/files`).catch(() => ""));
    if (Number(status.trim()) === 0) return { state: "done", files, size: await sizeOf(files) };
    return { state: "failed", error: lastError(await log()) ?? `yt-dlp exited with ${status.trim()}` };
  }
  if (!(await active(d.unit))) {
    if (await Deno.stat(`${d.dir}/status`).then(() => true).catch(() => false)) return state(d);
    return { state: "stopped" };
  }
  return { state: "running", progress: parseProgress(await log()) };
}

export async function stop(d: Download): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${d.unit}.service`]).catch(() => {});
}

/** Forgets downloads (not their files). */
export async function dismiss(ids: string[]): Promise<void> {
  const list = await downloads();
  for (const d of list.filter((d) => ids.includes(d.id))) await Deno.remove(d.dir, { recursive: true }).catch(() => {});
  await saveDownloads(list.filter((d) => !ids.includes(d.id)));
}

export const label = describeChoice;

// ---------------------------------------------------------------------------
// Clipboard

async function pipe(program: string, args: string[], input: string): Promise<boolean> {
  try {
    const child = new Deno.Command(program, { args, stdin: "piped", stdout: "null", stderr: "null" }).spawn();
    const w = child.stdin.getWriter();
    await w.write(new TextEncoder().encode(input));
    await w.close();
    // wl-copy and xclip stay in the background to serve the clipboard.
    const done = await Promise.race([
      child.status.then((s) => s.success),
      new Promise((r) => setTimeout(r, 400, true)),
    ]);
    return Boolean(done);
  } catch {
    return false;
  }
}

/** Puts files on the clipboard as files: a chat or a file manager pastes them. */
export async function copyFiles(uris: string[]): Promise<boolean> {
  const list = uris.map((u) => `${u}\r\n`).join("");
  const wl = () => pipe("wl-copy", ["--type", "text/uri-list"], list);
  const x = () => pipe("xclip", ["-selection", "clipboard", "-t", "text/uri-list"], list);
  return env("WAYLAND_DISPLAY") ? (await wl()) || (await x()) : (await x()) || (await wl());
}
