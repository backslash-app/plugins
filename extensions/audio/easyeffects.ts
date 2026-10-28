// EasyEffects presets: found in its folders, loaded through its command line.

import { storage } from "@backslash/api";
import { parsePresetList, presetDirs, presetEffects, type PresetKind } from "./lib.ts";
import { sh } from "./system.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key) || undefined;
  } catch {
    return undefined;
  }
};
const HOME = env("HOME") ?? "";

const FLATPAK_ID = "com.github.wwmm.easyeffects";

export interface Preset {
  name: string;
  kind: PresetKind;
  path?: string;
  effects: string[];
  flatpak: boolean;
}

export type Install = { kind: "native" } | { kind: "flatpak" } | { kind: "missing" };

const missing = (e: unknown) => e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable;

let install: Install | undefined;

export async function detect(): Promise<Install> {
  if (install) return install;
  try {
    await sh("easyeffects", ["--version"]);
    return (install = { kind: "native" });
  } catch (e) {
    // Installed but unhappy without a display is still installed.
    if (!missing(e)) return (install = { kind: "native" });
  }
  try {
    await sh("flatpak", ["info", FLATPAK_ID]);
    return (install = { kind: "flatpak" });
  } catch {
    return (install = { kind: "missing" });
  }
}

async function scan(): Promise<Preset[]> {
  const found = await Promise.all(
    presetDirs(HOME).map(async ({ dir, kind, flatpak }) => {
      const presets: Preset[] = [];
      try {
        for await (const e of Deno.readDir(dir)) {
          if (!e.isFile || !e.name.endsWith(".json")) continue;
          const path = `${dir}/${e.name}`;
          const text = await Deno.readTextFile(path).catch(() => "");
          presets.push({ name: e.name.slice(0, -5), kind, path, effects: presetEffects(text), flatpak });
        }
      } catch {
        // No such folder.
      }
      return presets;
    }),
  );
  const seen = new Set<string>();
  return found.flat().filter((p) => {
    const key = `${p.kind}:${p.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const cli = async (args: string[]) => {
  const i = await detect();
  if (i.kind === "missing") {
    throw new Error("EasyEffects is not installed: install it from your package manager or Flathub");
  }
  return i.kind === "flatpak" ? ["flatpak", ["run", FLATPAK_ID, ...args]] as const : ["easyeffects", args] as const;
};

export async function presets(): Promise<Preset[]> {
  const files = await scan();
  if (files.length) return files;
  // Presets elsewhere (a custom XDG folder): ask EasyEffects.
  const i = await detect();
  if (i.kind === "missing") return [];
  const [program, args] = await cli(["-p"]);
  const listed = parsePresetList(await sh(program, [...args]).catch(() => ""));
  return [
    ...listed.output.map((name): Preset => ({ name, kind: "output", effects: [], flatpak: i.kind === "flatpak" })),
    ...listed.input.map((name): Preset => ({ name, kind: "input", effects: [], flatpak: i.kind === "flatpak" })),
  ];
}

/** The last preset loaded: EasyEffects 7 remembers it in gsettings, else what we loaded last. */
export async function lastLoaded(kind: PresetKind): Promise<string | undefined> {
  const key = kind === "output" ? "last-used-output-preset" : "last-used-input-preset";
  const fromSettings = await sh("gsettings", ["get", FLATPAK_ID, key]).then((v) => v.replace(/^'|'$/g, ""), () => "");
  return fromSettings || await storage.get<string>(`last:${kind}`);
}

/**
 * Runs EasyEffects' command line. When EasyEffects isn't running, this starts it and
 * it keeps running in the background: wait a little for an answer, then let it be.
 */
async function send(args: string[]): Promise<void> {
  const [program, full] = await cli(args);
  const child = new Deno.Command(program, { args: [...full], stdin: "null", stdout: "null", stderr: "piped" }).spawn();
  const timeout = new Promise<"running">((r) => setTimeout(() => r("running"), 4000));
  const result = await Promise.race([child.output(), timeout]);
  if (result === "running") {
    child.unref();
    return;
  }
  if (result.code !== 0) {
    const err = new TextDecoder().decode(result.stderr).trim();
    throw new Error(err || `EasyEffects exited with ${result.code}`);
  }
}

export async function load(p: Preset): Promise<void> {
  await send(["-l", p.name]);
  await storage.set(`last:${p.kind}`, p.name);
}

/** Turns all effects off (bypass) or back on. */
export const bypass = (on: boolean) => send(["-b", on ? "1" : "2"]);
