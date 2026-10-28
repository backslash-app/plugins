// Files to upload: copied in the file manager (wl-paste on Wayland, xclip
// on X11, as text/uri-list), and recent ones in the usual folders. Uploads
// in progress are remembered to follow their consumption task.

import { clipboard, storage } from "@backslash/api";
import { HOME } from "./api.ts";
import { CONSUMABLE, parseFileList, type TaskState } from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

const wayland = () =>
  env("XDG_SESSION_TYPE") === "wayland" || (!!env("WAYLAND_DISPLAY") && env("XDG_SESSION_TYPE") !== "x11");

async function output(program: string, args: string[]): Promise<string | undefined> {
  try {
    const out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "null",
      signal: AbortSignal.timeout(1500),
    }).output();
    return out.success ? new TextDecoder().decode(out.stdout) : undefined;
  } catch {
    return undefined;
  }
}

export async function clipboardFiles(): Promise<string[]> {
  const tries: [string, string[]][] = [
    ["wl-paste", ["--no-newline", "--type", "text/uri-list"]],
    ["wl-paste", ["--no-newline", "--type", "x-special/gnome-copied-files"]],
    ["xclip", ["-selection", "clipboard", "-t", "text/uri-list", "-o"]],
    ["xclip", ["-selection", "clipboard", "-t", "x-special/gnome-copied-files", "-o"]],
  ];
  if (!wayland()) tries.push(...tries.splice(0, 2));
  for (const [program, args] of tries) {
    const out = await output(program, args);
    const paths = out ? parseFileList(out, HOME) : [];
    if (paths.length) return paths;
  }
  try {
    return parseFileList(await clipboard.read(), HOME);
  } catch {
    return [];
  }
}

export interface LocalFile {
  path: string;
  name: string;
  size: number;
  modified: number;
}

export async function localFile(path: string): Promise<LocalFile | undefined> {
  const st = await Deno.stat(path).catch(() => undefined);
  if (!st?.isFile) return undefined;
  return { path, name: path.split("/").pop()!, size: st.size, modified: st.mtime?.getTime() ?? 0 };
}

const RECENT_FOLDERS = () => [
  `${HOME}/Downloads`,
  `${HOME}/Téléchargements`,
  `${HOME}/Documents`,
  `${HOME}/Desktop`,
  `${HOME}/Bureau`,
  `${HOME}/Pictures/Screenshots`,
];

/** Documents changed in the last two weeks in the usual folders, newest first. */
export async function recentFiles(limit = 15): Promise<LocalFile[]> {
  const since = Date.now() - 14 * 86_400_000;
  const found: LocalFile[] = [];
  await Promise.all(
    RECENT_FOLDERS().map(async (dir) => {
      try {
        for await (const e of Deno.readDir(dir)) {
          if (!e.isFile || e.name.startsWith(".") || !CONSUMABLE.test(e.name)) continue;
          const f = await localFile(`${dir}/${e.name}`);
          if (f && f.modified > since) found.push(f);
        }
      } catch {
        // No such folder.
      }
    }),
  );
  return found.sort((a, b) => b.modified - a.modified).slice(0, limit);
}

export interface Upload {
  taskId: string;
  name: string;
  path: string;
  /** Unix ms. */
  at: number;
  last?: TaskState;
}

export const uploads = async (): Promise<Upload[]> =>
  ((await storage.get("uploads").catch(() => undefined)) as unknown as Upload[] | undefined) ?? [];

export async function saveUploads(list: Upload[]): Promise<void> {
  // The last 15, from the last week.
  const week = Date.now() - 7 * 86_400_000;
  const keep = list.filter((u) => u.at > week).slice(0, 15);
  await storage.set("uploads", keep as unknown as Record<string, never>[]).catch(() => {});
}
