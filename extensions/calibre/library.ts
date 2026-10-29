// Finding the Calibre library and reading its metadata.db (read-only, with
// node:sqlite); calibredb and the e-book viewer for what changes or opens it.

import { exec } from "@backslash/api";
import { DatabaseSync } from "node:sqlite";
import {
  addArgs,
  addedIds,
  authArgs,
  type Book,
  expandHome,
  exportArgs,
  type Family,
  fromRow,
  isLocked,
  libraryArg,
  libraryFromGlobal,
  libraryIdOf,
  osFamily,
  QUERY,
  removeArgs,
  type Row,
} from "./lib.ts";

const env = (k: string) => {
  try {
    return Deno.env.get(k);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";

export class SetupError extends Error {
  constructor(message: string, readonly reason: "no-library" | "unreadable", readonly path?: string) {
    super(message);
  }
}

export interface Library {
  path: string;
  /** Where the path came from, for the empty state. */
  from: "preference" | "calibre" | "default";
  /** The content server's library id. */
  id: string;
}

/** The `library` preference, else the library Calibre opened last, else ~/Calibre Library. */
export async function locate(preference: unknown): Promise<Library> {
  const own = String(preference ?? "").trim();
  if (own) {
    const path = expandHome(own, HOME).replace(/\/metadata\.db$/, "");
    return { path, from: "preference", id: libraryIdOf(path) };
  }
  const global = libraryFromGlobal(
    await Deno.readTextFile(`${HOME}/.config/calibre/global.py.json`).catch(() => undefined),
  );
  if (global) return { path: global.replace(/\/+$/, ""), from: "calibre", id: libraryIdOf(global) };
  const path = `${HOME}/Calibre Library`;
  return { path, from: "default", id: libraryIdOf(path) };
}

const mtime = (path: string) => Deno.stat(path).then((s) => s.mtime?.getTime() ?? 0, () => -1);

let cached: { path: string; stamp: number; books: Book[] } | undefined;

/** Every book, read again only when Calibre changed the database. */
export async function books(lib: Library): Promise<Book[]> {
  const db = `${lib.path}/metadata.db`;
  const stamp = await mtime(db);
  if (stamp < 0) throw new SetupError(`No Calibre library in ${lib.path}`, "no-library", lib.path);
  if (cached?.path === db && cached.stamp === stamp) return cached.books;
  let conn: DatabaseSync;
  try {
    conn = new DatabaseSync(db, { readOnly: true });
  } catch (e) {
    throw new SetupError(`metadata.db can't be opened: ${(e as Error).message}`, "unreadable", lib.path);
  }
  try {
    const rows = conn.prepare(QUERY).all() as unknown as Row[];
    const list = rows.map(fromRow);
    cached = { path: db, stamp, books: list };
    return list;
  } catch (e) {
    // Calibre may be in the middle of a write: the previous read is still good.
    if (cached?.path === db) return cached.books;
    throw new SetupError(`metadata.db can't be read: ${(e as Error).message}`, "unreadable", lib.path);
  } finally {
    conn.close();
  }
}

// ---------------------------------------------------------------------------
// calibredb

export interface Server {
  url?: string;
  user?: string;
  password?: string;
}

export class NoCalibre extends Error {}

/**
 * Runs calibredb on the library. While the Calibre window has it open,
 * calibredb refuses: it then goes through the content server when one is set.
 */
async function calibredb(lib: Library, server: Server, args: (target: string, auth: string[]) => string[]) {
  try {
    return await exec("calibredb", args(lib.path, []));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NoCalibre("calibredb isn't installed: install Calibre");
    const message = (e as Error).message;
    if (!isLocked(message)) throw e;
    if (!server.url) {
      throw new Error(
        "Calibre has the library open: close it, or turn on its content server and set its address in the preferences",
      );
    }
    return await exec(
      "calibredb",
      args(
        libraryArg({ library: lib.path, server: server.url, libraryId: lib.id }),
        authArgs(server.user, server.password),
      ),
    );
  }
}

export async function addBooks(lib: Library, server: Server, files: string[]): Promise<number[]> {
  return addedIds(await calibredb(lib, server, (t, a) => addArgs(t, files, a)));
}

export async function exportBook(lib: Library, server: Server, id: number, dir: string): Promise<void> {
  await Deno.mkdir(dir, { recursive: true }).catch(() => {});
  await calibredb(lib, server, (t, a) => exportArgs(t, id, dir, a));
}

/** Moves the book to Calibre's trash (it can be restored from Calibre for a while). */
export async function removeBook(lib: Library, server: Server, id: number): Promise<void> {
  await calibredb(lib, server, (t, a) => removeArgs(t, id, a));
  cached = undefined;
}

// ---------------------------------------------------------------------------
// The e-book viewer

/** Opens a file in Calibre's viewer, in a transient systemd unit so it outlives the launcher. */
export async function view(path: string, title: string): Promise<void> {
  const setenv = ["WAYLAND_DISPLAY", "DISPLAY", "XAUTHORITY", "XDG_RUNTIME_DIR"]
    .map((k) => [k, env(k)] as const)
    .filter(([, v]) => v)
    .map(([k, v]) => `--setenv=${k}=${v}`);
  try {
    await exec("systemd-run", [
      "--user",
      "--quiet",
      "--collect",
      `--unit=backslash-calibre-${Date.now().toString(36)}`,
      `--description=Calibre viewer: ${title}`,
      ...setenv,
      "ebook-viewer",
      path,
    ]);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to start the viewer");
    throw e;
  }
}

/** Whether a program can be started: installed and allowed. */
export async function installed(name: string): Promise<boolean> {
  try {
    await new Deno.Command(name, {
      args: ["--version"],
      stdin: "null",
      stdout: "null",
      stderr: "null",
      signal: AbortSignal.timeout(5000),
    }).output();
    return true;
  } catch (e) {
    return !(e instanceof Deno.errors.NotFound || e instanceof Deno.errors.PermissionDenied ||
      e instanceof Deno.errors.NotCapable);
  }
}

export async function distro(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}
