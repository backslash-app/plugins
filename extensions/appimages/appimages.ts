// Finding AppImages on disk and changing them: permissions, menu entries, moving, trashing.
// AppImages are never run to inspect them: everything comes from the file and the menu entries.

import {
  type AppImage,
  appImageType,
  describeDesktop,
  desktopEntry,
  type DesktopFile,
  desktopFileName,
  findEntry,
  hasAppImageExtension,
  moveTarget,
  parseFileName,
  runUnit,
  searchFolders,
} from "./lib.ts";

function env(name: string): string | undefined {
  try {
    return Deno.env.get(name) || undefined;
  } catch {
    return undefined;
  }
}

export const HOME = env("HOME") ?? "";
export const APPLICATIONS = `${HOME}/Applications`;
export const MENU_DIR = `${HOME}/.local/share/applications`;

async function head(path: string): Promise<Uint8Array> {
  let f: Deno.FsFile | undefined;
  try {
    f = await Deno.open(path, { read: true });
    const buf = new Uint8Array(16);
    const n = await f.read(buf);
    return buf.subarray(0, n ?? 0);
  } catch {
    return new Uint8Array();
  } finally {
    f?.close();
  }
}

/** Menu entries of the user, where AppImage integrators write theirs. */
export async function menuEntries(): Promise<DesktopFile[]> {
  const out: DesktopFile[] = [];
  try {
    for await (const e of Deno.readDir(MENU_DIR)) {
      if (!e.name.endsWith(".desktop") || e.isDirectory) continue;
      const file = `${MENU_DIR}/${e.name}`;
      const text = await Deno.readTextFile(file).catch(() => "");
      if (/appimage/i.test(text) || /\.appimage/i.test(text) || e.name.startsWith("backslash-appimage-")) {
        out.push(describeDesktop(file, text));
      }
    }
  } catch {
    // No menu folder yet.
  }
  return out;
}

async function candidates(dir: string, deep: boolean, sniff: boolean, out: Map<string, 1 | 2 | undefined>) {
  let entries: Deno.DirEntry[];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch {
    return;
  }
  await Promise.all(entries.map(async (e) => {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) {
      if (deep && !e.name.startsWith(".") && !e.name.endsWith(".AppDir")) await candidates(path, false, sniff, out);
      return;
    }
    if (!e.isFile && !e.isSymlink) return;
    const named = hasAppImageExtension(e.name);
    if (!named && !sniff) return;
    const type = appImageType(await head(path));
    if (named || type) out.set(path, type);
  }));
}

/** Every AppImage of the searched folders, with its menu entry. */
export async function findAppImages(extra: string): Promise<{ apps: AppImage[]; entries: DesktopFile[] }> {
  const found = new Map<string, 1 | 2 | undefined>();
  const [entries] = await Promise.all([
    menuEntries(),
    ...searchFolders(HOME, extra).map((f) => candidates(f.path, f.deep, f.sniff, found)),
  ]);
  const apps = await Promise.all([...found].map(async ([path, type]) => {
    const info = await Deno.stat(path).catch(() => undefined);
    const file = path.split("/").pop()!;
    const parsed = parseFileName(file);
    const entry = findEntry(path, entries);
    return {
      path,
      file,
      name: entry?.name || parsed.name,
      version: parsed.version,
      arch: parsed.arch,
      size: info?.size ?? 0,
      modified: info?.mtime?.getTime(),
      executable: ((info?.mode ?? 0) & 0o111) !== 0,
      type,
      entry,
    } satisfies AppImage;
  }));
  apps.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  return { apps, entries };
}

async function program(name: string, args: string[]): Promise<void> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(name, { args, stdin: "null", stdout: "piped", stderr: "piped" }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error(`${name} is not installed`);
    throw e;
  }
  if (out.code !== 0) {
    const err = new TextDecoder().decode(out.stderr).trim().split("\n").pop();
    throw new Error(err || `${name} exited with ${out.code}`);
  }
}

export const makeExecutable = (a: AppImage) => program("chmod", ["u+x", a.path]);

/** Starts the AppImage in its own systemd scope, so it outlives the launcher. */
export async function runAppImage(a: AppImage): Promise<void> {
  if (!a.executable) await makeExecutable(a);
  const cwd = HOME || undefined;
  try {
    const out = await new Deno.Command("systemd-run", {
      args: [
        "--user",
        "--collect",
        "--quiet",
        `--unit=${runUnit(a.name, Date.now())}`,
        `--description=${a.name}`,
        "--",
        a.path,
      ],
      cwd,
      stdin: "null",
      stdout: "null",
      stderr: "piped",
    }).output();
    if (out.code === 0) return;
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  // No systemd user session: start it directly.
  new Deno.Command(a.path, { cwd, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
}

/** Writes a menu entry for the AppImage (replacing Backslash's own one). */
export async function integrate(a: AppImage): Promise<string> {
  await Deno.mkdir(MENU_DIR, { recursive: true });
  const file = a.entry?.by === "backslash" ? a.entry.file : `${MENU_DIR}/${desktopFileName(a.name)}`;
  const icon = a.entry?.icon;
  await Deno.writeTextFile(file, desktopEntry({ name: a.name, path: a.path, version: a.version, icon }), {
    mode: 0o644,
  });
  if (!a.executable) await makeExecutable(a);
  return file;
}

export async function removeIntegration(a: AppImage): Promise<void> {
  if (!a.entry) return;
  await Deno.remove(a.entry.file);
}

/** Moves the AppImage to ~/Applications, keeping Backslash's menu entry pointing at it. */
export async function moveToApplications(a: AppImage): Promise<string> {
  await Deno.mkdir(APPLICATIONS, { recursive: true });
  const existing = (await Array.fromAsync(Deno.readDir(APPLICATIONS))).map((e) => e.name);
  const target = `${APPLICATIONS}/${moveTarget(a.file, existing)}`;
  await program("mv", ["-n", "--", a.path, target]);
  if (a.entry?.by === "backslash") await integrate({ ...a, path: target });
  return target;
}

/** Moves the AppImage to the trash (gio), and its Backslash menu entry with it. */
export async function trash(a: AppImage): Promise<void> {
  await program("gio", ["trash", "--", a.path]);
  if (a.entry?.by === "backslash") await Deno.remove(a.entry.file).catch(() => {});
}
