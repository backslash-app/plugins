// Running the scanners and the cleanups.

import { exec, openExternal } from "@backslash/api";
import {
  type BigFile,
  type ContainerUsage,
  type Disk,
  type Entry,
  osFamily,
  parseDf,
  parseDu,
  parseDuLine,
  parseFindLine,
  parseJournalUsage,
  parseSystemDf,
} from "./lib.ts";
import { runInTerminal, shellLine } from "./terminal.ts";

export const HOME = (() => {
  try {
    return Deno.env.get("HOME") ?? "";
  } catch {
    return "";
  }
})();

export async function family() {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

/** Runs a program and calls `onLine` for each line of its output as it comes. Stops at `signal`. */
export async function stream(
  program: string,
  args: string[],
  signal: AbortSignal,
  onLine: (line: string) => void,
): Promise<void> {
  const child = new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "null", signal }).spawn();
  let rest = "";
  try {
    for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
      const lines = (rest + chunk).split("\n");
      rest = lines.pop() ?? "";
      for (const l of lines) onLine(l);
    }
    if (rest) onLine(rest);
  } catch {
    // Aborted: keep what was read.
  }
  await child.status.catch(() => {});
}

/** `du -x -d <depth> -b <path>`, entries streamed as du finishes each folder. */
export function du(path: string, depth: number, signal: AbortSignal, onEntry: (e: Entry) => void) {
  return stream("du", ["-x", "-d", String(depth), "-b", path], signal, (l) => {
    const e = parseDuLine(l);
    if (e) onEntry(e);
  });
}

/** Files over `minMb` MB on the same file system, as `find` meets them. */
export function bigFiles(path: string, minMb: number, signal: AbortSignal, onFile: (f: BigFile) => void) {
  return stream(
    "find",
    [path, "-xdev", "-type", "f", "-size", `+${minMb}M`, "-printf", "%s\\t%T@\\t%p\\n"],
    signal,
    (l) => {
      const f = parseFindLine(l);
      if (f) onFile(f);
    },
  );
}

const quiet = <T>(p: Promise<T>) => p.catch(() => undefined);

export const disk = async (path: string): Promise<Disk | undefined> =>
  parseDf((await quiet(exec("df", ["-B1", "--output=size,used,avail,target", path]))) ?? "");

/** Size of one folder (or 0 when it doesn't exist), within `ms`. */
export async function sizeOf(path: string, ms = 15000): Promise<number | undefined> {
  const out = await quiet(exec("du", ["-s", "-x", "-b", path], { signal: AbortSignal.timeout(ms) }));
  return out === undefined ? undefined : parseDu(out)[0]?.size ?? 0;
}

export const journalSize = async () =>
  parseJournalUsage((await quiet(exec("journalctl", ["--disk-usage"], { signal: AbortSignal.timeout(5000) }))) ?? "");

export async function containers(tool: "docker" | "podman"): Promise<ContainerUsage[] | undefined> {
  const out = await quiet(
    exec(tool, ["system", "df", "--format", "{{json .}}"], { signal: AbortSignal.timeout(8000) }),
  );
  if (out === undefined) return undefined;
  try {
    return parseSystemDf(out);
  } catch {
    return undefined;
  }
}

export async function installed(program: string, args = ["--version"]): Promise<boolean> {
  try {
    await exec(program, args, { signal: AbortSignal.timeout(3000) });
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.NotCapable ||
      e instanceof Deno.errors.PermissionDenied);
  }
}

/** Deletes what is inside a folder, keeping the folder. Returns the bytes freed (as du counted them). */
export async function emptyFolder(path: string): Promise<void> {
  for await (const e of Deno.readDir(path)) {
    await Deno.remove(`${path}/${e.name}`, { recursive: true }).catch(() => {});
  }
}

/** Runs a command in a terminal that stays open on the result (sudo asks there). */
export function inTerminal(argv: string[], terminal?: string): string {
  const script = `${shellLine(argv)}; echo; printf 'Done. Press Enter to close.'; read _`;
  return runInTerminal(["sh", "-c", script], terminal || undefined);
}

/** Opens the folder with the file selected (FileManager1), or the folder. */
export async function showInFolder(path: string): Promise<void> {
  const uri = `file://${path.split("/").map(encodeURIComponent).join("/")}`;
  try {
    await exec("gdbus", [
      "call",
      "--session",
      "--dest",
      "org.freedesktop.FileManager1",
      "--object-path",
      "/org/freedesktop/FileManager1",
      "--method",
      "org.freedesktop.FileManager1.ShowItems",
      `['${uri.replace(/'/g, "%27")}']`,
      "",
    ]);
  } catch {
    await openExternal(path.split("/").slice(0, -1).join("/") || "/");
  }
}

export async function trash(path: string): Promise<void> {
  try {
    await exec("gio", ["trash", path]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("gio (GLib) is needed to move files to the trash");
    throw e;
  }
}
