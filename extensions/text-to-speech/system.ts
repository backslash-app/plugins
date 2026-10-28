// Installed engines, voices, and speaking in a background systemd unit.

import { exec, storage } from "@backslash/api";
import {
  type Engine,
  ENGINES,
  type Family,
  guessLanguage,
  osFamily,
  parseEspeakVoices,
  parseSpdVoices,
  piperVoice,
  speakScript,
  systemdRunArgs,
  UNIT,
  type Voice,
  voiceFor,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/tts`;
export const PIPER_DIR = `${HOME}/.local/share/piper`;
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);
const expand = (p: string) => p.replace(/^~(?=\/|$)/, HOME);

export interface Prefs {
  engine?: string;
  voice?: string;
  speed?: number;
  piperModels?: string;
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

async function installed(program: string, args: string[]): Promise<boolean> {
  try {
    await new Deno.Command(program, {
      args,
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

const PROBE: Record<Engine, string[]> = {
  piper: ["--help"],
  "espeak-ng": ["--version"],
  "spd-say": ["--version"],
  festival: ["--version"],
};

/** Engines installed, Piper only when it has a voice model. */
export async function engines(prefs: Prefs): Promise<{ available: Set<Engine>; piperWithoutModel: boolean }> {
  const found = await Promise.all(ENGINES.map((e) => installed(e, PROBE[e])));
  const available = new Set(ENGINES.filter((_, i) => found[i]));
  let piperWithoutModel = false;
  if (available.has("piper") && !(await piperVoices(prefs)).length) {
    available.delete("piper");
    piperWithoutModel = true;
  }
  return { available, piperWithoutModel };
}

/** Models in the Piper folder (or the one model the preference points at). */
export async function piperVoices(prefs: Prefs): Promise<Voice[]> {
  const where = expand(prefs.piperModels?.trim() || PIPER_DIR);
  const paths: string[] = [];
  if (where.endsWith(".onnx")) paths.push(where);
  else {
    const walk = async (dir: string, depth: number) => {
      try {
        for await (const e of Deno.readDir(dir)) {
          const p = `${dir}/${e.name}`;
          if (e.isFile && e.name.endsWith(".onnx")) paths.push(p);
          else if (e.isDirectory && depth < 3) await walk(p, depth + 1);
        }
      } catch {
        // Missing or unreadable.
      }
    };
    await walk(where, 0);
  }
  const voices = await Promise.all(
    paths.map(async (p) => piperVoice(p, await Deno.readTextFile(`${p}.json`).catch(() => undefined))),
  );
  return voices.sort((a, b) => a.language.localeCompare(b.language) || a.name.localeCompare(b.name));
}

export async function voices(engine: Engine, prefs: Prefs): Promise<Voice[]> {
  try {
    switch (engine) {
      case "piper":
        return await piperVoices(prefs);
      case "espeak-ng":
        return parseEspeakVoices(await exec("espeak-ng", ["--voices"]));
      case "spd-say":
        return parseSpdVoices(await exec("spd-say", ["-L"]));
      case "festival":
        return [];
    }
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// The chosen voice (Voices command), per engine

export const chosenVoices = async () => ((await storage.get("voices")) ?? {}) as Record<string, string>;

export async function chooseVoice(v: Voice | { engine: Engine; id: undefined }): Promise<void> {
  const all = await chosenVoices();
  if (v.id) all[v.engine] = v.id;
  else delete all[v.engine];
  await storage.set("voices", all);
}

// ---------------------------------------------------------------------------
// Speaking

export async function speaking(): Promise<boolean> {
  const state = await exec("systemctl", ["--user", "is-active", UNIT]).catch((e) => String(e));
  return /^(active|activating)$/m.test(state.trim());
}

export async function stop(): Promise<void> {
  await exec("systemctl", ["--user", "stop", UNIT]).catch(() => {});
  await exec("systemctl", ["--user", "reset-failed", UNIT]).catch(() => {});
  // Speech Dispatcher keeps talking after spd-say is gone.
  if ((await storage.get("engine")) === "spd-say") await exec("spd-say", ["-C"]).catch(() => {});
}

export interface Spoken {
  engine: Engine;
  voice?: Voice;
  language?: string;
}

/** Starts reading `text` aloud in a systemd user unit, stopping what was being read. */
export async function speak(text: string, engine: Engine, prefs: Prefs, speed: number): Promise<Spoken> {
  await stop();
  await Deno.mkdir(CACHE, { recursive: true });
  const file = `${CACHE}/text.txt`;
  await Deno.writeTextFile(file, text);
  const language = guessLanguage(text);
  const list = engine === "festival" ? [] : await voices(engine, prefs);
  const chosen = prefs.voice?.trim() || (await chosenVoices())[engine];
  const voice = voiceFor(list, chosen, language) ?? (engine === "piper" ? list[0] : undefined);
  if (engine === "piper" && !voice) {
    throw new Error(`No Piper voice in ${tilde(expand(prefs.piperModels?.trim() || PIPER_DIR))}`);
  }
  const script = speakScript({ engine, file, voice, language, speed, cache: CACHE });
  const sessionEnv = Object.fromEntries(
    ["PULSE_SERVER", "PIPEWIRE_REMOTE", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS"].map((k) => [k, env(k)]),
  );
  try {
    await exec("systemd-run", systemdRunArgs(script, sessionEnv));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to speak in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: speech runs in the background with systemd-run --user");
    }
    throw e;
  }
  await storage.set("engine", engine);
  await storage.set("last", { text: text.slice(0, 2000), at: Date.now(), engine, voice: voice?.name ?? null });
  return { engine, voice, language };
}

export interface Last {
  text: string;
  at: number;
  engine: Engine;
  voice: string | null;
}

export const last = async () => (await storage.get("last")) as unknown as Last | undefined;

/** The primary selection (the text selected with the mouse), Wayland or X11. */
export async function selection(): Promise<string> {
  for (
    const [program, args] of [["wl-paste", ["--primary", "--no-newline"]], ["xclip", ["-o", "-selection", "primary"]], [
      "xsel",
      ["-o", "-p"],
    ]] as const
  ) {
    try {
      const out = await new Deno.Command(program, { args: [...args], stdin: "null", stdout: "piped", stderr: "null" })
        .output();
      if (out.success) {
        const text = new TextDecoder().decode(out.stdout);
        if (text.trim()) return text;
      }
    } catch {
      // Not installed.
    }
  }
  return "";
}
