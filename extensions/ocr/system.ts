// Environment, installed tools, the background job and the history folder.

import { exec } from "@backslash/api";
import {
  detectSession,
  type Env,
  type Family,
  type Grabber,
  grabberCandidates,
  normalizeLanguages,
  ocrScript,
  osFamily,
  parseLanguages,
  parseVersion,
  type Session,
  SESSION_ENV,
  systemdRunArgs,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const HISTORY = `${HOME}/.cache/backslash/ocr`;
const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());

/** Whether a program can be started: installed and allowed. */
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

export interface Setup {
  session: Session;
  grabber?: Grabber;
  slurp: boolean;
  tesseract?: string;
  languages: string[];
}

/** What is installed: the area grabber, tesseract (its version) and its languages. */
export async function setup(): Promise<Setup> {
  const s = session();
  const candidates = grabberCandidates(s);
  const [found, slurp, version, langs] = await Promise.all([
    Promise.all(
      candidates.map((c) => installed(c, c === "import" ? ["-version"] : c === "grim" ? ["-h"] : ["--version"])),
    ),
    installed("slurp", ["-h"]),
    exec("tesseract", ["--version"]).catch((e) => e instanceof Deno.errors.NotFound ? undefined : String(e)),
    exec("tesseract", ["--list-langs"]).catch(() => ""),
  ]);
  return {
    session: s,
    grabber: candidates.find((_, i) => found[i]),
    slurp,
    tesseract: version === undefined ? undefined : parseVersion(version) ?? "installed",
    languages: parseLanguages(langs),
  };
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

/** The languages to read: the preference, else English. */
export const preferredLanguages = (prefs: Record<string, unknown>) =>
  normalizeLanguages(String(prefs.languages ?? "")) ?? "eng";

export class Missing extends Error {}

/** Starts the selection in the background, once the launcher is hidden. */
export async function recognize(languages: string, o: { known?: Setup; wait?: number } = {}): Promise<void> {
  const s = o.known ?? await setup();
  if (!s.tesseract) throw new Missing("Tesseract is not installed");
  if (!s.grabber) throw new Missing("No screenshot tool to select an area");
  if (s.grabber === "grim" && !s.slurp) throw new Missing("slurp is needed to select an area");
  const absent = languages.split("+").filter((l) => s.languages.length && !s.languages.includes(l));
  if (absent.length) throw new Missing(`Tesseract has no ${absent.join(", ")} model installed`);
  const script = ocrScript({
    tool: s.grabber,
    languages,
    historyDir: HISTORY,
    wayland: s.session.wayland,
    wait: o.wait,
  });
  try {
    await exec("systemd-run", systemdRunArgs(`backslash-ocr-${Date.now()}`, script, sessionEnv()));
  } catch (e) {
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: the selection runs in the background with systemd-run --user");
    }
    throw e;
  }
}

export interface Recognized {
  path: string;
  text: string;
  date: number;
}

/** Recognized texts, newest first. */
export async function history(): Promise<Recognized[]> {
  const out: Recognized[] = [];
  try {
    for await (const e of Deno.readDir(HISTORY)) {
      const m = e.name.match(/^(\d+)\.txt$/);
      if (!e.isFile || !m) continue;
      const path = `${HISTORY}/${e.name}`;
      const text = (await Deno.readTextFile(path).catch(() => "")).trim();
      if (text) out.push({ path, text, date: Number(m[1]) * 1000 });
    }
  } catch {
    // Nothing recognized yet.
  }
  return out.sort((a, b) => b.date - a.date);
}
