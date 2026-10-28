// Files, programs and the background scan.

import { exec, storage } from "@backslash/api";
import {
  areaTools,
  detectSession,
  type Entry,
  type Env,
  type Family,
  fileKey,
  mergeHistory,
  osFamily,
  picturesDir,
  saveName,
  scaleFor,
  scanEntry,
  scanScript,
  type Session,
  SESSION_ENV,
  type ShotTool,
  systemdRunArgs,
} from "./lib.ts";
import { type Ecc, encode, type QrCode } from "./qr.ts";
import { png, svg } from "./png.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/qr`;
export const sessionEnv = (): Env => Object.fromEntries(SESSION_ENV.map((k) => [k, env(k)]));
export const session = (): Session => detectSession(sessionEnv());
export const tilde = (p: string) => (HOME && p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p);

export async function family(): Promise<Family | undefined> {
  return osFamily(await Deno.readTextFile("/etc/os-release").catch(() => ""));
}

/** Whether a program can be started (installed and allowed). */
export async function installed(program: string, args = ["--version"]): Promise<boolean> {
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

const PROBE: Record<string, string[]> = { import: ["-version"], slurp: ["-h"], grim: ["-h"] };

// ---------------------------------------------------------------------------
// Generating

export interface Generated {
  code: QrCode;
  /** The PNG in the cache, shown in the detail panel. */
  file: string;
}

/** Encodes the text and writes its PNG to the cache (reused when it is already there). */
export async function generate(text: string, ecc: Ecc): Promise<Generated> {
  const code = encode(text, { ecc });
  const file = `${CACHE}/${fileKey(text, ecc)}.png`;
  const exists = await Deno.stat(file).then((s) => s.size > 0).catch(() => false);
  if (!exists) {
    await Deno.mkdir(CACHE, { recursive: true });
    await Deno.writeFile(file, await png(code.modules, { scale: scaleFor(code.size) }));
  }
  return { code, file };
}

export async function picturesFolder(): Promise<string> {
  const dirs = await Deno.readTextFile(`${HOME}/.config/user-dirs.dirs`).catch(() => "");
  return `${picturesDir(dirs, HOME)}/QR Codes`;
}

/** Saves a PNG (large, for printing) or an SVG in ~/Pictures/QR Codes. */
export async function save(text: string, g: Generated, format: "png" | "svg"): Promise<string> {
  const folder = await picturesFolder();
  await Deno.mkdir(folder, { recursive: true });
  const path = `${folder}/${saveName(text, new Date(), format)}`;
  if (format === "svg") await Deno.writeTextFile(path, svg(g.code.modules));
  else await Deno.writeFile(path, await png(g.code.modules, { scale: Math.max(10, scaleFor(g.code.size, 1200)) }));
  return path;
}

async function pipe(program: string, args: string[], input?: Uint8Array): Promise<boolean> {
  try {
    const child = new Deno.Command(program, {
      args,
      stdin: input ? "piped" : "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    if (input) {
      const w = child.stdin.getWriter();
      await w.write(input);
      await w.close();
    }
    // wl-copy forks to serve the clipboard; its first process exits right away.
    return (await child.status).success;
  } catch {
    return false;
  }
}

/** Copies a PNG to the clipboard (wl-copy, then xclip). */
export async function copyImage(file: string): Promise<boolean> {
  const wl = async () => pipe("wl-copy", ["--type", "image/png"], await Deno.readFile(file));
  const x = () => pipe("xclip", ["-selection", "clipboard", "-t", "image/png", "-i", file]);
  return session().wayland ? (await wl()) || (await x()) : (await x()) || (await wl());
}

// ---------------------------------------------------------------------------
// History

export const history = async (): Promise<Entry[]> => ((await storage.get("history")) ?? []) as unknown as Entry[];

export async function remember(entries: Entry[]): Promise<void> {
  await storage.set("history", mergeHistory(await history(), entries) as any);
}

export async function forget(entry?: Entry): Promise<void> {
  if (!entry) {
    await storage.delete("history");
    await Deno.remove(`${CACHE}/scans`, { recursive: true }).catch(() => {});
    return;
  }
  await storage.set(
    "history",
    (await history()).filter((e) => !(e.kind === entry.kind && e.text === entry.text)) as any,
  );
}

/** Moves the scans written by the background script into the history. Returns them, newest first. */
export async function importScans(): Promise<Entry[]> {
  const added: Entry[] = [];
  try {
    for await (const f of Deno.readDir(`${CACHE}/scans`)) {
      if (!f.isFile || !f.name.endsWith(".txt")) continue;
      const path = `${CACHE}/scans/${f.name}`;
      const e = scanEntry(f.name, await Deno.readTextFile(path).catch(() => ""));
      const picture = path.replace(/\.txt$/, ".png");
      if (e && (await Deno.stat(picture).catch(() => undefined))) e.image = picture;
      if (e) added.push(e);
      await Deno.remove(path).catch(() => {});
    }
  } catch {
    // No scan yet.
  }
  if (added.length) await remember(added);
  return added.sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------------------
// Scanning

export class MissingTool extends Error {
  constructor(message: string, public packages: string[]) {
    super(message);
  }
}

export async function captureTool(s: Session): Promise<ShotTool | undefined> {
  for (const t of areaTools(s)) {
    if (!(await installed(t, PROBE[t]))) continue;
    if (t === "grim" && !(await installed("slurp", PROBE.slurp))) continue;
    return t;
  }
  return undefined;
}

export const hasZbar = () => installed("zbarimg", ["--version"]);

/** Starts the background job: select an area, decode, notify. */
export async function scanScreen(o: { openLinks?: boolean; copy?: boolean }): Promise<void> {
  const s = session();
  const [tool, zbar] = await Promise.all([captureTool(s), hasZbar()]);
  if (!zbar) throw new MissingTool("zbarimg is needed to read QR codes", ["zbarimg"]);
  if (!tool) throw new MissingTool("No screenshot tool to select an area", []);
  const script = scanScript({ tool, cache: CACHE, wayland: s.wayland, openLinks: o.openLinks, copy: o.copy });
  await Deno.mkdir(CACHE, { recursive: true });
  try {
    await exec("systemd-run", systemdRunArgs(`backslash-qr-scan-${Date.now()}`, script, sessionEnv()));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("systemd-run is needed to scan in the background");
    if (String(e).includes("Failed to connect to bus")) {
      throw new Error("No systemd user session: scans run in the background with systemd-run --user");
    }
    throw e;
  }
}

/** Decodes the codes in a picture; empty when there is none. */
export async function decodeFile(path: string): Promise<string[]> {
  try {
    const out = await exec("zbarimg", ["--raw", "-q", "--", path]);
    return out ? [out] : [];
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new MissingTool("zbarimg is needed to read QR codes", ["zbarimg"]);
    // zbarimg exits with 4 when it finds nothing.
    if (/exited with 4/.test(String(e))) return [];
    throw e;
  }
}

/** Saves the picture in the clipboard (if any) to the cache. */
export async function clipboardImage(): Promise<string | undefined> {
  const file = `${CACHE}/clipboard.png`;
  await Deno.mkdir(CACHE, { recursive: true });
  const tries: [string, string[]][] = session().wayland
    ? [["wl-paste", ["--no-newline", "--type", "image/png"]], ["xclip", [
      "-selection",
      "clipboard",
      "-t",
      "image/png",
      "-o",
    ]]]
    : [["xclip", ["-selection", "clipboard", "-t", "image/png", "-o"]], ["wl-paste", [
      "--no-newline",
      "--type",
      "image/png",
    ]]];
  for (const [program, args] of tries) {
    try {
      const out = await new Deno.Command(program, { args, stdin: "null", stdout: "piped", stderr: "null" }).output();
      // A PNG starts with \x89PNG.
      if (out.success && out.stdout.length > 8 && out.stdout[0] === 0x89 && out.stdout[1] === 0x50) {
        await Deno.writeFile(file, out.stdout);
        return file;
      }
    } catch {
      // Not installed: try the next one.
    }
  }
  return undefined;
}
