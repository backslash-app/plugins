// The session, installed pickers, the background job and the history.

import { exec, storage } from "@backslash/api";
import {
  detectSession,
  type Env,
  type Family,
  mergeHistory,
  osFamily,
  parsePicks,
  type Picked,
  type Picker,
  pickerCandidates,
  pickScript,
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

const HOME = env("HOME") ?? "";
/** Colors picked in the background land here until a view imports them. */
export const PICKS = `${HOME}/.cache/backslash/color-picker/picks`;
const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());

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

const PROBES: Record<Picker, [string, string[]][]> = {
  hyprpicker: [["hyprpicker", ["--help"]]],
  grim: [["grim", ["-h"]], ["slurp", ["-h"]]],
  gpick: [["gpick", ["--version"]]],
  xcolor: [["xcolor", ["--version"]]],
  portal: [["gdbus", ["help"]]],
};

/** The first picker that works here. */
export async function picker(): Promise<{ session: Session; tool?: Picker }> {
  const s = session();
  for (const tool of pickerCandidates(s)) {
    const ok = await Promise.all(PROBES[tool].map(([p, a]) => installed(p, a)));
    if (ok.every(Boolean)) return { session: s, tool };
  }
  return { session: s };
}

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

export class Missing extends Error {}

/** Picks in the background, once the launcher is hidden. */
export async function pick(o: { upper?: boolean; wait?: number } = {}): Promise<void> {
  const p = await picker();
  if (!p.tool) throw new Missing("No color picker found");
  const script = pickScript({ tool: p.tool, log: PICKS, wayland: p.session.wayland, ...o });
  try {
    await exec("systemd-run", systemdRunArgs(`backslash-color-picker-${Date.now()}`, script, sessionEnv()));
  } catch (e) {
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: the picker runs in the background with systemd-run --user");
    }
    throw e;
  }
}

/** The history, with the colors picked since the last time imported. */
export async function history(): Promise<Picked[]> {
  const saved = ((await storage.get("history")) ?? []) as unknown as Picked[];
  const added = parsePicks(await Deno.readTextFile(PICKS).catch(() => ""));
  if (!added.length) return saved;
  const merged = mergeHistory(saved, added);
  await storage.set("history", merged as any);
  await Deno.writeTextFile(PICKS, "").catch(() => {});
  return merged;
}

export async function saveHistory(list: Picked[]): Promise<void> {
  await storage.set("history", list as any);
}

export async function remember(hex: string): Promise<void> {
  await saveHistory(mergeHistory(await history(), [{ hex, at: Date.now() }]));
}
