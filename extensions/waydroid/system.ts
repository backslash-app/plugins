// Running waydroid: its status and apps as the user, the session and the full UI in systemd user units (so
// they outlive the launcher), the container's restart as root through pkexec, and the copied APK files.

import { clipboard } from "@backslash/api";
import {
  type App,
  isApk,
  mergeApps,
  packageOfDesktopFile,
  parseAppList,
  parseDesktopEntry,
  parseFileList,
  parseStatus,
  SESSION_UNIT,
  type Status,
  UI_UNIT,
  unitArgs,
  waydroidError,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
const APPLICATIONS = `${HOME}/.local/share/applications`;
const ICONS = `${HOME}/.local/share/waydroid/data/icons`;

export class NotInstalled extends Error {
  constructor() {
    super("Waydroid isn't installed");
  }
}

interface Output {
  code: number;
  stdout: string;
  stderr: string;
}

async function sh(program: string, args: string[], timeout = 20_000): Promise<Output> {
  try {
    const { code, stdout, stderr } = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeout),
    }).output();
    const text = (b: Uint8Array) => new TextDecoder().decode(b);
    return { code, stdout: text(stdout), stderr: text(stderr).trim() };
  } catch (e) {
    if (e instanceof Deno.errors.NotFound && program === "waydroid") throw new NotInstalled();
    if (e instanceof Deno.errors.NotFound) throw new Error(`${program} was not found`);
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`${program} took too long`);
    throw e;
  }
}

async function waydroid(args: string[], timeout?: number): Promise<string> {
  const o = await sh("waydroid", args, timeout);
  // waydroid often exits with 0 and logs the problem: look at what it said too.
  const said = `${o.stderr}\n${o.stdout}`;
  if (o.code !== 0 || /^\[\d\d:\d\d:\d\d\]\s*(error|failed)/im.test(said)) throw new Error(waydroidError(said));
  return o.stdout;
}

export async function status(): Promise<Status> {
  const o = await sh("waydroid", ["status"]);
  return parseStatus(`${o.stdout}\n${o.stderr}`);
}

/** Launchers Waydroid exported, with their icons: they are there even when the session is stopped. */
async function exported(): Promise<App[]> {
  const apps: App[] = [];
  try {
    for await (const f of Deno.readDir(APPLICATIONS)) {
      if (!f.isFile || !packageOfDesktopFile(f.name)) continue;
      const app = parseDesktopEntry(await Deno.readTextFile(`${APPLICATIONS}/${f.name}`).catch(() => ""));
      if (app) apps.push(app);
    }
  } catch {
    // No launcher exported yet.
  }
  await Promise.all(apps.map(async (a) => {
    const png = `${ICONS}/${a.package}.png`;
    if (!a.icon?.startsWith("/")) a.icon = (await Deno.stat(png).then(() => true, () => false)) ? png : undefined;
  }));
  return apps;
}

export async function apps(running: boolean): Promise<App[]> {
  const listed = running ? await waydroid(["app", "list"]).then(parseAppList).catch(() => []) : [];
  return mergeApps(listed, await exported());
}

const sessionEnv = () => ({
  WAYLAND_DISPLAY: env("WAYLAND_DISPLAY") ?? "",
  XDG_RUNTIME_DIR: env("XDG_RUNTIME_DIR") ?? "",
  XDG_SESSION_TYPE: env("XDG_SESSION_TYPE") ?? "",
});

/** Starts a waydroid command in a systemd user unit, or detached when systemd-run isn't there. */
async function background(unit: string, description: string, argv: string[]): Promise<void> {
  await sh("systemctl", ["--user", "reset-failed", `${unit}.service`]).catch(() => {});
  try {
    const o = await sh("systemd-run", unitArgs(unit, description, argv, sessionEnv()), 10_000);
    if (o.code === 0) return;
    // Already running in that unit: nothing to do.
    if (/already (loaded|exists)|Unit .* was already/i.test(o.stderr)) return;
  } catch {
    // No systemd-run: start it detached below.
  }
  try {
    new Deno.Command(argv[0], { args: argv.slice(1), stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled();
    throw e;
  }
}

/** Starts the session and waits until it runs (up to a minute). */
export async function startSession(): Promise<void> {
  const s = await status();
  if (s.uninitialized) throw new Error("Waydroid isn't set up yet: run sudo waydroid init");
  if (s.session === "RUNNING") return;
  await background(SESSION_UNIT, "Backslash: Waydroid session", ["waydroid", "session", "start"]);
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if ((await status()).session === "RUNNING") return;
  }
  throw new Error("The Waydroid session didn't start: is the waydroid-container service running?");
}

export async function stopSession(): Promise<void> {
  await waydroid(["session", "stop"], 30_000).catch((e) => {
    if (!/isn't running/.test((e as Error).message)) throw e;
  });
  await sh("systemctl", ["--user", "stop", `${SESSION_UNIT}.service`, `${UI_UNIT}.service`]).catch(() => {});
}

/** The whole Android screen in a window; waydroid starts the session itself when needed. */
export const showFullUi = () => background(UI_UNIT, "Backslash: Waydroid", ["waydroid", "show-full-ui"]);

export async function launch(pkg: string): Promise<void> {
  await startSession();
  await waydroid(["app", "launch", pkg]);
}

export async function install(path: string): Promise<void> {
  await startSession();
  await waydroid(["app", "install", path], 5 * 60_000);
}

export async function remove(pkg: string): Promise<void> {
  await startSession();
  await waydroid(["app", "remove", pkg], 60_000);
}

/** pkexec's exit codes and messages, in words. */
function pkexecError(code: number, stderr: string): string | undefined {
  if (code === 126) return "Authentication was cancelled";
  if (code === 127 && /not authorized|authentication/i.test(stderr)) return "Not authorized";
  if (/No authentication agent/i.test(stderr)) return "No polkit agent to ask for your password";
  return undefined;
}

/** Restarts the container as root, for when the session is stuck. */
export async function restartContainer(): Promise<void> {
  await sh("waydroid", ["session", "stop"]).catch(() => {});
  const o = await sh("pkexec", ["waydroid", "container", "restart"], 120_000);
  const denied = pkexecError(o.code, o.stderr);
  if (denied) throw new Error(denied);
  if (o.code !== 0) throw new Error(waydroidError(o.stderr || o.stdout));
}

const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[]): Promise<string | undefined> {
  try {
    const o = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(1500),
    }).output();
    return o.success ? new TextDecoder().decode(o.stdout) : undefined;
  } catch {
    return undefined;
  }
}

/** APK files copied in the file manager (or paths copied as text). */
export async function copiedApks(): Promise<{ apks: string[]; others: string[] }> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  let paths: string[] = [];
  for (const [program, args] of tries) {
    const out = await output(program, args);
    paths = out ? parseFileList(out, HOME) : [];
    if (paths.length) break;
  }
  if (!paths.length) paths = parseFileList(await clipboard.read().catch(() => ""), HOME);
  return { apks: paths.filter(isApk), others: paths.filter((p) => !isApk(p)) };
}

/** Installs the copied APKs; returns what to tell the user. */
export async function installCopied(): Promise<string> {
  const { apks, others } = await copiedApks();
  if (!apks.length) {
    throw new Error(
      others.length
        ? "The copied file isn't an APK: copy an .apk file in your file manager first"
        : "Copy an .apk file in your file manager first",
    );
  }
  const failed: string[] = [];
  for (const apk of apks) {
    try {
      await install(apk);
    } catch (e) {
      if (apks.length === 1) throw e;
      failed.push(`${apk.split("/").pop()}: ${(e as Error).message}`);
    }
  }
  if (failed.length) throw new Error(`${apks.length - failed.length} installed; ${failed.join("; ")}`);
  return apks.length === 1 ? `${apks[0].split("/").pop()} installed in Waydroid` : `${apks.length} APKs installed`;
}
