// Installed tools, copied and recent files, ffprobe, and the background jobs
// (transient systemd user units running ffmpeg).

import { clipboard, exec, storage } from "@backslash/api";
import {
  describe,
  type Family,
  freePath,
  isMedia,
  jobFraction,
  jobScript,
  lastError,
  type MediaInfo,
  type Operation,
  osFamily,
  outputDuration,
  outputFor,
  parseFileList,
  parseProbe,
  parseProgress,
  plan,
  type Progress,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/media-converter`;
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
export const expandHome = (p: string) => p.trim().replace(/^~(?=\/|$)/, HOME);
const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

async function output(program: string, args: string[], timeout = 3000): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(timeout),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

const has = async (program: string, args = ["--version"]) => {
  try {
    await new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).output();
    return true;
  } catch {
    return false;
  }
};

export interface Tools {
  ffmpeg: boolean;
  ffprobe: boolean;
  systemdRun: boolean;
}

let found: Promise<Tools> | undefined;

export function tools(): Promise<Tools> {
  found ??= (async () => {
    const [ffmpeg, ffprobe, systemdRun] = await Promise.all([
      has("ffmpeg", ["-version"]),
      has("ffprobe", ["-version"]),
      has("systemd-run"),
    ]);
    return { ffmpeg, ffprobe, systemdRun };
  })();
  return found;
}

// ---------------------------------------------------------------------------
// Files

/** Files copied in the file manager (or paths copied as text). */
export async function clipboardFiles(): Promise<string[]> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  for (const [program, args] of tries) {
    const out = await output(program, args, 1500);
    const paths = out ? parseFileList(out, HOME) : [];
    if (paths.length) return paths;
  }
  try {
    return parseFileList(await clipboard.read(), HOME);
  } catch {
    return [];
  }
}

export interface MediaFile {
  path: string;
  name: string;
  size: number;
  modified: number;
  info?: MediaInfo;
  /** ffprobe couldn't read it. */
  error?: string;
}

export async function mediaFile(path: string): Promise<MediaFile | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile) return undefined;
  return { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0 };
}

export const RECENT_FOLDERS = () => [
  `${HOME}/Videos`,
  `${HOME}/Vidéos`,
  `${HOME}/Videos/Screencasts`,
  `${HOME}/Music`,
  `${HOME}/Musique`,
  `${HOME}/Downloads`,
  `${HOME}/Téléchargements`,
  `${HOME}/Desktop`,
  `${HOME}/Bureau`,
];

/** The newest videos and songs of Videos, Music, Downloads and Desktop. */
export async function recentMedia(limit = 20): Promise<MediaFile[]> {
  const found: MediaFile[] = [];
  for (const dir of RECENT_FOLDERS()) {
    try {
      for await (const e of Deno.readDir(dir)) {
        if (!e.isFile || e.name.startsWith(".") || !isMedia(e.name)) continue;
        const f = await mediaFile(`${dir}/${e.name}`);
        if (f) found.push(f);
      }
    } catch {
      // No such folder.
    }
  }
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

export async function probe(f: MediaFile, signal?: AbortSignal): Promise<void> {
  try {
    const out = await exec("ffprobe", [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "--",
      f.path,
    ], { signal: signal ?? AbortSignal.timeout(15_000) });
    f.info = parseProbe(out);
  } catch (e) {
    if (signal?.aborted) return;
    f.error = String((e as Error).message ?? e).replace(/^.*exited with \d+: /s, "").split("\n")[0] ||
      "ffprobe couldn't read it";
  }
}

/** ffprobe on a few files at a time. */
export async function probeAll(files: MediaFile[], signal?: AbortSignal): Promise<void> {
  if (!(await tools()).ffprobe) return;
  const queue = files.filter((f) => !f.info && !f.error);
  const worker = async () => {
    for (let f = queue.shift(); f && !signal?.aborted; f = queue.shift()) await probe(f, signal);
  };
  await Promise.all([worker(), worker(), worker()]);
}

export const exists = (p: string) => {
  try {
    Deno.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------------------
// Jobs

export interface Job {
  id: string;
  unit: string;
  title: string;
  input: string;
  output: string;
  /** The job's folder in the cache: progress files, status, log. */
  dir: string;
  weights: number[];
  /** Seconds of output, to turn progress into a fraction. */
  duration?: number;
  started: number;
}

export type JobState =
  | { state: "running"; fraction: number; speed?: number }
  | { state: "done"; size: number }
  | { state: "failed"; error: string }
  | { state: "stopped" };

export const jobs = async (): Promise<Job[]> => ((await storage.get("jobs")) as unknown as Job[] | undefined) ?? [];
type Json = Parameters<typeof storage.set>[1];
const saveJobs = (list: Job[]) => storage.set("jobs", list as unknown as Json);

/** Starts an operation in the background; the output goes next to the input, never over a file. */
export async function start(op: Operation, f: MediaFile): Promise<Job> {
  const { suffix, ext } = outputFor(op, f.path, f.info);
  const dirOf = f.path.split("/").slice(0, -1).join("/") || "/";
  const stemOf = f.name.replace(/\.[^.]+$/, "");
  const out = freePath(dirOf, `${stemOf}${suffix}`, ext, exists);
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const dir = `${CACHE}/jobs/${id}`;
  const steps = plan(op, f.path, out, f.info, dir);
  await Deno.mkdir(dir, { recursive: true });
  const unit = `backslash-media-${id}`;
  const log = `${dir}/log`;
  await Deno.writeTextFile(log, "");
  try {
    await exec("systemd-run", [
      "--user",
      "--quiet",
      "--collect",
      `--unit=${unit}`,
      `--description=Backslash: ${describe(op)} ${f.name}`,
      `--property=StandardOutput=append:${log}`,
      `--property=StandardError=append:${log}`,
      // Below the desktop: a long encode shouldn't make the computer sluggish.
      "--nice=10",
      "sh",
      "-c",
      jobScript(steps, dir, out),
    ]);
  } catch (e) {
    await Deno.remove(dir, { recursive: true }).catch(() => {});
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to convert in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: conversions run in the background with systemd-run --user");
    }
    throw new Error(String((e as Error).message).replace(/^.*exited with \d+: /, ""));
  }
  const job: Job = {
    id,
    unit,
    title: describe(op),
    input: f.path,
    output: out,
    dir,
    weights: steps.map((s) => s.weight),
    duration: outputDuration(op, f.info),
    started: Date.now(),
  };
  await saveJobs([job, ...(await jobs())].slice(0, 30));
  return job;
}

async function active(unit: string): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${unit}.service`])) === "active";
  } catch {
    return false;
  }
}

/** Where a job is: running with its progress, finished, failed or stopped. */
export async function state(job: Job): Promise<JobState> {
  const status = await Deno.readTextFile(`${job.dir}/status`).catch(() => undefined);
  if (status !== undefined) {
    const code = Number(status.trim());
    if (code === 0) return { state: "done", size: await Deno.stat(job.output).then((s) => s.size).catch(() => 0) };
    if (code === 17) return { state: "failed", error: "A file with the same name appeared: nothing was overwritten" };
    const log = await Deno.readTextFile(`${job.dir}/log`).catch(() => "");
    return { state: "failed", error: lastError(log) ?? `ffmpeg exited with ${code}` };
  }
  const progress: (Progress | undefined)[] = await Promise.all(
    job.weights.map((_, n) => Deno.readTextFile(`${job.dir}/progress-${n}`).then(parseProgress).catch(() => undefined)),
  );
  if (!(await active(job.unit))) {
    // It may have just finished: the status file is written last.
    if (await Deno.stat(`${job.dir}/status`).then(() => true).catch(() => false)) return state(job);
    return { state: "stopped" };
  }
  const current = progress.findLast((p) => p);
  return { state: "running", fraction: jobFraction(job.weights, progress, job.duration), speed: current?.speed };
}

/** Stops a running job; ffmpeg's unfinished output is removed. */
export async function stop(job: Job): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${job.unit}.service`]).catch(() => {});
  if (!(await Deno.stat(`${job.dir}/status`).then(() => true).catch(() => false))) {
    await Deno.remove(job.output).catch(() => {});
  }
}

/** Forgets a job (not its output). */
export async function dismiss(ids: string[]): Promise<void> {
  const list = await jobs();
  for (const j of list.filter((j) => ids.includes(j.id))) await Deno.remove(j.dir, { recursive: true }).catch(() => {});
  await saveJobs(list.filter((j) => !ids.includes(j.id)));
}
