// What is copied (files or text), and croc transfers running as systemd user units.

import { clipboard, exec } from "@backslash/api";
import { crocArgs, crocCode, crocProgress, crocWebUrl, parseFileList } from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/file-share`;
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[], timeout = 1500): Promise<string | undefined> {
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

export interface Copied {
  files: { path: string; name: string; bytes: number; dir: boolean }[];
  text?: string;
}

/** Files copied in the file manager (wl-paste on Wayland, xclip on X11), else the copied text. */
export async function copied(): Promise<Copied> {
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
  let text: string | undefined;
  if (!paths.length) {
    text = await clipboard.read().catch(() => "");
    // A copied path in plain text is a file too.
    const asFiles = parseFileList(text, HOME);
    if (asFiles.length && asFiles.join("\n") === text.trim().split(/\r?\n/).map((l) => l.trim()).join("\n")) {
      paths = asFiles;
      text = undefined;
    }
  }
  const files = (await Promise.all(paths.map(async (path) => {
    const st = await Deno.stat(path).catch(() => undefined);
    return st
      ? { path, name: path.replace(/\/+$/, "").split("/").pop() || path, bytes: st.size, dir: st.isDirectory }
      : undefined;
  }))).filter((f): f is Copied["files"][number] => !!f);
  return { files, text: files.length ? undefined : text?.trim() ? text : undefined };
}

// ---------------------------------------------------------------------------
// croc

let hasCroc: Promise<boolean> | undefined;

export function crocInstalled(): Promise<boolean> {
  hasCroc ??= new Deno.Command("croc", { args: ["--version"], stdin: "null", stdout: "null", stderr: "null" })
    .output().then(() => true, () => false);
  return hasCroc;
}

export interface Transfer {
  unit: string;
  log: string;
  code: string;
  webUrl?: string;
}

/** Starts `croc send` in the background and waits for its code phrase (up to 20 s). */
export async function crocSend(what: { files?: string[]; text?: string }): Promise<Transfer> {
  const unit = `backslash-croc-${Date.now()}`;
  const log = `${CACHE}/${unit}.log`;
  await Deno.mkdir(CACHE, { recursive: true });
  await Deno.writeTextFile(log, "");
  try {
    await exec("systemd-run", crocArgs(unit, log, what));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      throw new Error("systemd-run is needed to keep croc running in the background");
    }
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: croc transfers run in the background with systemd-run --user");
    }
    throw new Error(String((e as Error).message).replace(/^.*exited with \d+: /, ""));
  }
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
    const text = await Deno.readTextFile(log).catch(() => "");
    const code = crocCode(text);
    if (code) return { unit, log, code, webUrl: crocWebUrl(text) };
    if (!(await active(unit))) {
      const last = text.trim().split("\n").at(-1);
      throw new Error(`croc stopped${last ? `: ${last}` : ""}`);
    }
  }
  await stop(unit);
  throw new Error("croc didn't print a code phrase in 20 seconds: is the relay reachable?");
}

export async function active(unit: string): Promise<boolean> {
  try {
    return (await exec("systemctl", ["--user", "is-active", `${unit}.service`])) === "active";
  } catch {
    return false;
  }
}

export async function stop(unit: string): Promise<void> {
  await exec("systemctl", ["--user", "stop", `${unit}.service`]).catch(() => {});
}

export interface TransferState {
  running: boolean;
  state: ReturnType<typeof crocProgress>["state"] | "stopped";
  text?: string;
}

export async function transferState(unit: string, log: string): Promise<TransferState> {
  const [running, text] = await Promise.all([active(unit), Deno.readTextFile(log).catch(() => "")]);
  const p = crocProgress(text);
  if (running) return { running, ...p };
  // croc exits once the receiver has everything, after a progress bar at 100 %.
  if (p.state === "failed" || p.state === "done") return { running, ...p };
  return { running, state: p.state === "sending" ? "failed" : "stopped", text: p.text };
}

export async function forgetLog(log: string | undefined): Promise<void> {
  if (log) await Deno.remove(log).catch(() => {});
}
