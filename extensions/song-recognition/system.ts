// Recording a few seconds (pw-record or parecord), asking SongRec, and the
// history of recognized songs.

import { storage } from "@backslash/api";
import {
  addToHistory,
  type Family,
  osFamily,
  parseSongrec,
  recordArgs,
  type Recorder,
  type Song,
  songrecError,
  type Source,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/song-recognition`;

async function installed(program: string, args: string[]): Promise<boolean> {
  try {
    await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(5000),
    })
      .output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

export interface Tools {
  songrec: boolean;
  recorder?: Recorder;
}

let found: Promise<Tools> | undefined;
export function tools(): Promise<Tools> {
  found ??= (async () => {
    const [songrec, pw, pa] = await Promise.all([
      installed("songrec", ["--version"]),
      installed("pw-record", ["--version"]),
      installed("parecord", ["--version"]),
    ]);
    return { songrec, recorder: pw ? "pw-record" : pa ? "parecord" : undefined };
  })();
  return found;
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

/** Records `seconds` of sound into the cache folder; `tick` is called every second. */
export async function record(
  recorder: Recorder,
  source: Source,
  seconds: number,
  signal: AbortSignal,
  tick: (elapsed: number) => void,
): Promise<string> {
  if (!HOME) throw new Error("HOME is not set: nowhere to keep the recording");
  await Deno.mkdir(CACHE, { recursive: true });
  const file = `${CACHE}/listen.wav`;
  await Deno.remove(file).catch(() => {});
  const child = new Deno.Command(recorder, {
    args: recordArgs(recorder, source, file),
    stdin: "null",
    stdout: "null",
    stderr: "piped",
  }).spawn();
  const stopChild = () => {
    try {
      child.kill("SIGINT");
    } catch {
      // Already gone.
    }
  };
  signal.addEventListener("abort", stopChild, { once: true });
  let exited = false;
  const done = child.output().finally(() => (exited = true));
  for (let s = 0; s < seconds && !signal.aborted && !exited; s++) {
    tick(s);
    await new Promise((r) => setTimeout(r, 1000));
  }
  stopChild();
  const out = await done;
  signal.removeEventListener("abort", stopChild);
  if (signal.aborted) throw new DOMException("Stopped", "AbortError");
  const size = await Deno.stat(file).then((s) => s.size).catch(() => 0);
  if (size < 8000) {
    const why = new TextDecoder().decode(out.stderr).trim().split("\n").at(-1);
    throw new Error(
      why
        ? `Nothing was recorded: ${why}`
        : source === "mic"
        ? "Nothing was recorded: is a microphone plugged in?"
        : "Nothing was recorded",
    );
  }
  return file;
}

/** SongRec's answer for a recording; undefined when Shazam doesn't know the song. */
export async function recognize(file: string, source: Source): Promise<Song | undefined> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command("songrec", {
      args: ["audio-file-to-recognized-song", file],
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(30_000),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("SongRec is not installed");
    throw new Error("Shazam took too long to answer");
  }
  const stdout = new TextDecoder().decode(out.stdout);
  const stderr = new TextDecoder().decode(out.stderr);
  const song = parseSongrec(stdout);
  if (song) return { ...song, source };
  if (!out.success) {
    const msg = songrecError(stderr || stdout);
    if (msg === "No match") return undefined;
    throw new Error(msg);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// History

type Json = Parameters<typeof storage.set>[1];

export async function history(): Promise<Song[]> {
  return ((await storage.get("history")) as unknown as Song[] | undefined) ?? [];
}

export async function remember(song: Song): Promise<void> {
  await storage.set("history", addToHistory(await history(), song) as unknown as Json);
}

export async function forget(song?: Song): Promise<void> {
  const list = song ? (await history()).filter((s) => !(s.key === song.key && s.at === song.at)) : [];
  await storage.set("history", list as unknown as Json);
}
