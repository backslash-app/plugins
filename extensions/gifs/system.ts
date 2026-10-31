// Fetching from Tenor and Giphy, downloading a GIF, and putting it on the
// clipboard as a file or an image (wl-copy, xclip).

import { storage } from "@backslash/api";
import {
  addRecent,
  apiError,
  fileName,
  fileUri,
  freeName,
  type Gif,
  giphyUrl,
  mapGiphy,
  mapTenor,
  type Provider,
  type Settings,
  tenorShareUrl,
  tenorUrl,
} from "./lib.ts";

const env = (key: string): string | undefined => {
  try {
    return Deno.env.get(key);
  } catch {
    return undefined;
  }
};

export const HOME = env("HOME") ?? "";
export const CACHE = `${HOME}/.cache/backslash/gifs`;

export class SetupError extends Error {}

/** One page of GIFs: search results, or trending when `query` is empty. */
export async function searchGifs(
  provider: Provider,
  query: string,
  settings: Settings,
  signal?: AbortSignal,
): Promise<Gif[]> {
  const name = provider === "tenor" ? "Tenor" : "Giphy";
  if (!settings.key) throw new SetupError(`Add your ${name} API key in Settings`);
  const url = provider === "tenor" ? tenorUrl(query, settings) : giphyUrl(query, settings);
  let res: Response;
  try {
    res = await fetch(url, { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${name} can't be reached: check your connection`);
  }
  if (!res.ok) throw new Error(apiError(provider, res.status, await res.text().catch(() => "")));
  const json = await res.json();
  return provider === "tenor" ? mapTenor(json) : mapGiphy(json);
}

/** Tells Tenor a GIF was shared (it ranks search with it); never fails. */
export async function registerShare(gif: Gif, query: string, key: string): Promise<void> {
  if (gif.provider !== "tenor" || !key) return;
  try {
    const res = await fetch(tenorShareUrl(gif.id, query, key), { signal: AbortSignal.timeout(2000) });
    await res.body?.cancel();
  } catch {
    // Only a ranking hint.
  }
}

/** The GIF in the cache folder, downloaded the first time. */
export async function download(gif: Gif): Promise<string> {
  if (!HOME) throw new Error("HOME is not set: nowhere to keep the GIF");
  const path = `${CACHE}/${fileName(gif)}`;
  const st = await Deno.stat(path).catch(() => undefined);
  if (st?.isFile && st.size > 0) return path;
  let res: Response;
  try {
    res = await fetch(gif.url, { signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new Error("The GIF couldn't be downloaded: check your connection");
  }
  if (!res.ok) throw new Error(`The GIF couldn't be downloaded (HTTP ${res.status})`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  await Deno.mkdir(CACHE, { recursive: true });
  await Deno.writeFile(`${path}.part`, bytes);
  await Deno.rename(`${path}.part`, path);
  await prune();
  return path;
}

/** Keeps the cache to the 60 newest GIFs. */
async function prune(keep = 60): Promise<void> {
  const files: { path: string; time: number }[] = [];
  try {
    for await (const e of Deno.readDir(CACHE)) {
      if (!e.isFile || !e.name.endsWith(".gif")) continue;
      const st = await Deno.stat(`${CACHE}/${e.name}`).catch(() => undefined);
      files.push({ path: `${CACHE}/${e.name}`, time: st?.mtime?.getTime() ?? 0 });
    }
  } catch {
    return;
  }
  files.sort((a, b) => b.time - a.time);
  for (const f of files.slice(keep)) await Deno.remove(f.path).catch(() => {});
}

/** Saves the GIF in the Downloads folder, never over a file; returns its path. */
export async function save(gif: Gif): Promise<string> {
  const cached = await download(gif);
  const folders = [`${HOME}/Downloads`, `${HOME}/Téléchargements`];
  let dir = folders[0];
  for (const f of folders) {
    if (await Deno.stat(f).then((s) => s.isDirectory).catch(() => false)) {
      dir = f;
      break;
    }
  }
  await Deno.mkdir(dir, { recursive: true });
  const name = freeName(fileName(gif), (n) => {
    try {
      Deno.lstatSync(`${dir}/${n}`);
      return true;
    } catch {
      return false;
    }
  });
  await Deno.copyFile(cached, `${dir}/${name}`);
  return `${dir}/${name}`;
}

async function pipe(program: string, args: string[], input: Uint8Array): Promise<boolean> {
  try {
    const child = new Deno.Command(program, { args, stdin: "piped", stdout: "null", stderr: "null" }).spawn();
    const w = child.stdin.getWriter();
    await w.write(input);
    await w.close();
    // wl-copy and xclip stay in the background to serve the clipboard.
    const done = await Promise.race([
      child.status.then((s) => s.success),
      new Promise((r) => setTimeout(r, 400, true)),
    ]);
    return Boolean(done);
  } catch {
    return false;
  }
}

async function toClipboard(type: string, data: Uint8Array): Promise<boolean> {
  const wl = () => pipe("wl-copy", ["--type", type], data);
  const x = () => pipe("xclip", ["-selection", "clipboard", "-t", type], data);
  return env("WAYLAND_DISPLAY") ? (await wl()) || (await x()) : (await x()) || (await wl());
}

/** The GIF as a file (text/uri-list): chat apps and file managers paste the file itself. */
export async function copyAsFile(gif: Gif): Promise<boolean> {
  const path = await download(gif);
  return toClipboard("text/uri-list", new TextEncoder().encode(`${fileUri(path)}\r\n`));
}

/** The GIF as an image/gif: apps that paste pictures get the animation. */
export async function copyAsImage(gif: Gif): Promise<boolean> {
  const path = await download(gif);
  return toClipboard("image/gif", await Deno.readFile(path));
}

// ---------------------------------------------------------------------------
// Recently copied

type Json = Parameters<typeof storage.set>[1];

export async function recent(): Promise<Gif[]> {
  return ((await storage.get("recent")) as unknown as Gif[] | undefined) ?? [];
}

export async function remember(gif: Gif): Promise<void> {
  await storage.set("recent", addRecent(await recent(), gif) as unknown as Json);
}

export async function forget(gif?: Gif): Promise<void> {
  const list = gif ? (await recent()).filter((g) => !(g.provider === gif.provider && g.id === gif.id)) : [];
  await storage.set("recent", list as unknown as Json);
}
