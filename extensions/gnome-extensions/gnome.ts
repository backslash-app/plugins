// Talking to GNOME Shell: gnome-extensions, gsettings, gdbus, and extensions.gnome.org.

import { storage } from "@backslash/api";
import {
  type Extension,
  infoUrl,
  installArgs,
  isGnomeDesktop,
  parseBool,
  parseDetails,
  parseInstallResult,
  parseQuery,
  parseRemote,
  parseShellVersion,
  parseUuids,
  queryUrl,
  type Remote,
  shellError,
} from "./lib.ts";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";

async function sh(program: string, args: string[], timeout = 30_000): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      env: { LC_ALL: "C" },
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: AbortSignal.timeout(timeout),
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error(
        program === "gnome-extensions"
          ? "gnome-extensions is missing: this needs GNOME Shell (install gnome-shell or gnome-shell-extensions)"
          : `${program} is not installed`,
      );
    }
    if (e instanceof DOMException && e.name === "TimeoutError") throw new Error(`${program} didn't answer in time`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b);
  if (out.code !== 0) throw new Error(shellError(text(out.stderr) || text(out.stdout)));
  return text(out.stdout);
}

/** Refuses clearly outside GNOME, where gnome-extensions can't do anything. */
export function requireGnome(): void {
  const desktop = env("XDG_CURRENT_DESKTOP");
  if (desktop !== undefined && !isGnomeDesktop(desktop)) {
    throw new Error(`GNOME extensions need GNOME Shell: this session is ${desktop}`);
  }
}

export interface Installed {
  extensions: Extension[];
  userDisabled: boolean;
  shell?: string;
}

/** The Shell's version, kept for a day: it only changes with an upgrade. */
export async function shellVersion(): Promise<string | undefined> {
  const cached = await storage.get<{ at: number; version: string }>("shell").catch(() => undefined);
  if (cached && Date.now() - cached.at < 86400_000) return cached.version;
  const version = parseShellVersion(await sh("gnome-shell", ["--version"]).catch(() => ""));
  if (version) await storage.set("shell", { at: Date.now(), version }).catch(() => {});
  return version;
}

export async function installed(): Promise<Installed> {
  requireGnome();
  const [details, prefs, updates, disabled, shell] = await Promise.all([
    sh("gnome-extensions", ["list", "--details"]),
    sh("gnome-extensions", ["list", "--prefs"]).catch(() => ""),
    sh("gnome-extensions", ["list", "--updates"]).catch(() => ""),
    sh("gsettings", ["get", "org.gnome.shell", "disable-user-extensions"]).catch(() => "false"),
    shellVersion(),
  ]);
  const withPrefs = parseUuids(prefs), withUpdates = parseUuids(updates);
  const extensions = parseDetails(details, HOME).map((e) => ({
    ...e,
    hasPrefs: withPrefs.has(e.uuid),
    hasUpdate: withUpdates.has(e.uuid),
  }));
  return { extensions, userDisabled: parseBool(disabled), shell };
}

export const enable = (uuid: string) => sh("gnome-extensions", ["enable", uuid]);
export const disable = (uuid: string) => sh("gnome-extensions", ["disable", uuid]);
export const uninstall = (uuid: string) => sh("gnome-extensions", ["uninstall", uuid]);

export function openPrefs(uuid: string): void {
  try {
    new Deno.Command("gnome-extensions", { args: ["prefs", uuid], stdin: "null", stdout: "null", stderr: "null" })
      .spawn().unref();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("gnome-extensions is missing");
    throw e;
  }
}

export async function setUserExtensions(disabled: boolean): Promise<void> {
  await sh("gsettings", ["set", "org.gnome.shell", "disable-user-extensions", String(disabled)]);
}

/** Asks GNOME Shell to install an extension; it shows its own confirmation dialog. */
export async function install(uuid: string): Promise<"successful" | "cancelled" | string> {
  requireGnome();
  return parseInstallResult(await sh("gdbus", installArgs(uuid), 300_000));
}

// --- extensions.gnome.org -------------------------------------------------------------------

async function ego(url: string, signal?: AbortSignal): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new Error("extensions.gnome.org can't be reached: check your connection");
  }
  return res;
}

export async function search(query: string, shell: string | undefined, signal?: AbortSignal) {
  const res = await ego(queryUrl(query, shell), signal);
  if (!res.ok) throw new Error(`extensions.gnome.org answered ${res.status}`);
  return parseQuery(await res.text(), shell);
}

/** The page of an installed extension on extensions.gnome.org, if it is there. */
export async function remoteInfo(uuid: string, shell?: string): Promise<Remote | undefined> {
  const res = await ego(infoUrl(uuid));
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`extensions.gnome.org answered ${res.status}`);
  return parseRemote(await res.json(), shell);
}
