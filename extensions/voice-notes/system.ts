// Files, programs and background units. The logic is in lib.ts.

import { type Context, exec, storage } from "@backslash/api";
import {
  chooseTranscriber,
  cleanTranscript,
  dateOfName,
  errorLine,
  expandHome,
  isModelPath,
  languageOf,
  noteFileName,
  noteText,
  osFamily,
  type Recorder,
  RECORDERS,
  RECORDING_UNIT,
  recordingName,
  recordScript,
  stemOf,
  systemdRunArgs,
  tildify,
  titleFrom,
  type Transcriber,
  transcribeScript,
  transcribeUnit,
  uniqueFileName,
  wavDuration,
  WHISPER_CPP,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const DIR = `${HOME}/.local/share/backslash/voice-notes`;
const UNIT_ENV = ["XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "PULSE_SERVER", "PIPEWIRE_REMOTE"];
const unitEnv = () => Object.fromEntries(UNIT_ENV.map((k) => [k, env(k)]));

export const tilde = (p: string) => tildify(p, HOME);

/** Whether a program can be started: spawned and killed at once, so slow ones (Python) cost nothing. */
async function startable(program: string): Promise<boolean> {
  try {
    const child = new Deno.Command(program, { stdin: "null", stdout: "null", stderr: "null" }).spawn();
    try {
      child.kill("SIGKILL");
    } catch {
      // Already gone.
    }
    await child.status;
    return true;
  } catch {
    return false;
  }
}

export async function installed(programs: string[]): Promise<Set<string>> {
  const ok = await Promise.all(programs.map(startable));
  return new Set(programs.filter((_, i) => ok[i]));
}

export const family = async () => osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));

const MODEL_DIRS = [
  `${HOME}/.local/share/whisper.cpp`,
  `${HOME}/.local/share/whisper.cpp/models`,
  `${HOME}/.local/share/whisper`,
  `${HOME}/.cache/whisper.cpp`,
  "/usr/share/whisper.cpp",
  "/usr/share/whisper.cpp/models",
  "/usr/local/share/whisper.cpp",
  "/usr/local/share/whisper.cpp/models",
];

async function models(): Promise<string[]> {
  const out: string[] = [];
  for (const dir of MODEL_DIRS) {
    try {
      for await (const e of Deno.readDir(dir)) if (e.isFile && /\.bin$/i.test(e.name)) out.push(`${dir}/${e.name}`);
    } catch {
      // Missing: skipped.
    }
  }
  return out;
}

export interface Tools {
  recorder?: Recorder;
  transcriber?: Transcriber;
  /** whisper.cpp is there but no model was found. */
  needsModel: boolean;
}

export async function tools(ctx: Pick<Context, "preferences">): Promise<Tools> {
  const [found, ggml] = await Promise.all([installed([...RECORDERS, ...WHISPER_CPP, "whisper"]), models()]);
  const pref = expandHome(String(ctx.preferences.model ?? "").trim(), HOME);
  const transcriber = chooseTranscriber({
    installed: found,
    modelPref: pref,
    models: ggml,
    language: languageOf(ctx.preferences.language),
  });
  return {
    recorder: RECORDERS.find((r) => found.has(r)),
    transcriber,
    needsModel: !transcriber && WHISPER_CPP.some((p) => found.has(p)) && !(pref && isModelPath(pref)),
  };
}

async function detach(unit: string, script: string, description: string, killSignal?: string) {
  try {
    await exec("systemd-run", systemdRunArgs(unit, script, { description, killSignal, env: unitEnv() }));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to record in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: Voice Notes records with systemd-run --user");
    }
    throw e;
  }
}

const unitActive = async (unit: string) => {
  const state = await exec("systemctl", ["--user", "is-active", unit]).catch(() => "inactive");
  return state === "active" || state === "activating";
};

// ---------------------------------------------------------------------------
// Recording

export interface Recording {
  file: string;
  started: number;
  tool: Recorder;
}

export async function recording(): Promise<Recording | undefined> {
  const saved = (await storage.get("recording").catch(() => undefined)) as unknown as Recording | undefined;
  if (!saved) return undefined;
  if (await unitActive(RECORDING_UNIT)) return saved;
  await storage.delete("recording").catch(() => {});
  return undefined;
}

export class MissingTool extends Error {}

export async function startRecording(ctx: Pick<Context, "preferences">): Promise<Recording> {
  if (await recording()) throw new Error("Already recording");
  const t = await tools(ctx);
  if (!t.recorder) throw new MissingTool("No recorder found: install pw-record (PipeWire), ffmpeg or arecord");
  const file = `${DIR}/${recordingName(new Date())}`;
  await exec("systemctl", ["--user", "reset-failed", RECORDING_UNIT]).catch(() => {});
  await detach(RECORDING_UNIT, recordScript(t.recorder, file), "Backslash: voice note recording", "SIGINT");
  const rec = { file, started: Date.now(), tool: t.recorder };
  await storage.set("recording", rec as any);
  return rec;
}

/** Stops the recorder (SIGINT, the file is finished), then transcribes if asked. */
export async function stopRecording(
  ctx: Pick<Context, "preferences">,
): Promise<{ rec?: Recording; transcribing: boolean }> {
  const rec = await recording();
  await exec("systemctl", ["--user", "stop", RECORDING_UNIT]).catch(() => {});
  await storage.delete("recording").catch(() => {});
  if (!rec) return { transcribing: false };
  const size = await Deno.stat(rec.file).then((s) => s.size, () => 0);
  if (size <= 44) {
    await Deno.remove(rec.file).catch(() => {});
    throw new Error("Nothing was recorded: check the microphone in your sound settings");
  }
  if (ctx.preferences.autoTranscribe === false) return { rec, transcribing: false };
  const t = await tools(ctx);
  if (!t.transcriber) return { rec, transcribing: false };
  await transcribe(ctx, rec.file, t.transcriber);
  return { rec, transcribing: true };
}

// ---------------------------------------------------------------------------
// Transcribing

export async function transcribe(ctx: Pick<Context, "preferences">, wav: string, t?: Transcriber, language?: string) {
  const tr = t ?? (await tools(ctx)).transcriber;
  if (!tr) throw new MissingTool("No transcriber found: install whisper.cpp with a ggml model, or openai-whisper");
  const unit = transcribeUnit(wav);
  if (await unitActive(unit)) throw new Error("Already transcribing this recording");
  await exec("systemctl", ["--user", "reset-failed", unit]).catch(() => {});
  await detach(
    unit,
    transcribeScript(tr, wav, language ?? languageOf(ctx.preferences.language)),
    "Backslash: voice note transcription",
  );
}

export async function cancelTranscription(wav: string) {
  await exec("systemctl", ["--user", "stop", transcribeUnit(wav)]).catch(() => {});
  await Deno.remove(`${stemOf(wav)}.log`).catch(() => {});
}

async function transcribingUnits(): Promise<Set<string>> {
  const out = await exec("systemctl", [
    "--user",
    "list-units",
    "--plain",
    "--no-legend",
    "--state=active,activating",
    "backslash-voice-transcribe-*",
  ]).catch(() => "");
  return new Set([...out.matchAll(/backslash-voice-transcribe-[\w.-]+?(?=\.service)/g)].map((m) => m[0]));
}

// ---------------------------------------------------------------------------
// Recordings

export interface Note {
  wav: string;
  name: string;
  recorded: number;
  size: number;
  seconds?: number;
  transcript?: string;
  error?: string;
  transcribing: boolean;
  recording: boolean;
}

async function head(path: string): Promise<Uint8Array> {
  const f = await Deno.open(path, { read: true });
  try {
    const buf = new Uint8Array(4096);
    const n = await f.read(buf);
    return buf.subarray(0, n ?? 0);
  } finally {
    f.close();
  }
}

export async function notes(current?: Recording): Promise<Note[]> {
  const [busy, entries] = await Promise.all([
    transcribingUnits(),
    (async () => {
      const out: Deno.DirEntry[] = [];
      try {
        for await (const e of Deno.readDir(DIR)) out.push(e);
      } catch (e) {
        if (!(e instanceof Deno.errors.NotFound)) throw e;
      }
      return out;
    })(),
  ]);
  const names = new Set(entries.map((e) => e.name));
  const wavs = entries.filter((e) => e.isFile && /\.wav$/i.test(e.name));
  const out = await Promise.all(wavs.map(async (e): Promise<Note> => {
    const wav = `${DIR}/${e.name}`;
    const stem = e.name.replace(/\.wav$/i, "");
    const [stat, bytes, text, error] = await Promise.all([
      Deno.stat(wav),
      head(wav).catch(() => new Uint8Array()),
      names.has(`${stem}.txt`) ? Deno.readTextFile(`${DIR}/${stem}.txt`).catch(() => undefined) : undefined,
      names.has(`${stem}.error`) ? Deno.readTextFile(`${DIR}/${stem}.error`).catch(() => "") : undefined,
    ]);
    return {
      wav,
      name: e.name,
      recorded: dateOfName(e.name) ?? stat.mtime?.getTime() ?? 0,
      size: stat.size,
      seconds: wavDuration(bytes, stat.size),
      transcript: text === undefined ? undefined : cleanTranscript(text),
      error: error === undefined ? undefined : errorLine(error),
      transcribing: busy.has(transcribeUnit(wav)),
      recording: current?.file === wav,
    };
  }));
  return out.sort((a, b) => b.recorded - a.recorded);
}

export async function remove(n: Note): Promise<void> {
  await cancelTranscription(n.wav);
  const stem = stemOf(n.wav);
  await Deno.remove(n.wav);
  for (const ext of ["txt", "error", "log"]) await Deno.remove(`${stem}.${ext}`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Notes folder

export function notesDir(ctx: Pick<Context, "preferences">): string {
  const raw = String(ctx.preferences.notesFolder ?? "").trim() || "~/Documents/Notes";
  return expandHome(raw, HOME).replace(/\/+$/, "");
}

/** Saves the transcript as a markdown note; returns its path. */
export async function saveNote(ctx: Pick<Context, "preferences">, n: Note): Promise<string> {
  if (!n.transcript) throw new Error("No transcript yet");
  const dir = notesDir(ctx);
  const taken: string[] = [];
  try {
    await Deno.mkdir(dir, { recursive: true });
    for await (const e of Deno.readDir(dir)) taken.push(e.name);
  } catch (e) {
    if (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied) {
      throw new Error(`Notes may only be saved inside ~/Documents; ${tilde(dir)} is outside: change it in Settings`);
    }
    throw e;
  }
  const title = titleFrom(n.transcript) || `Voice note ${new Date(n.recorded).toLocaleString("en")}`;
  const file = uniqueFileName(noteFileName(title), taken);
  const path = `${dir}/${file}`;
  await Deno.writeTextFile(path, noteText(n.transcript, new Date(n.recorded), tilde(n.wav)), { createNew: true });
  return path;
}
