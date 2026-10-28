// The espanso command and its configuration folder.

import { exec } from "@backslash/api";
import { type Match, parseMatchFile, parsePaths, parseStatus, type Var } from "./lib.ts";

export class NotInstalled extends Error {
  constructor() {
    super("Espanso is not installed: see espanso.org/install for your distribution");
  }
}

export const HOME = (() => {
  try {
    return Deno.env.get("HOME");
  } catch {
    return undefined;
  }
})();

export async function espanso(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec("espanso", args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new NotInstalled();
    throw e;
  }
}

export type Paths = { config: string; match: string; packages: string };

let paths: Promise<Paths> | undefined;

/** Where espanso keeps its files (`espanso path`), else the defaults. */
export function espansoPaths(): Promise<Paths> {
  return paths ??= (async () => {
    let found: { config?: string; packages?: string } = {};
    try {
      found = parsePaths(await espanso(["path"]));
    } catch (e) {
      if (e instanceof NotInstalled) throw e;
    }
    const config = found.config ?? `${HOME}/.config/espanso`;
    return { config, match: `${config}/match`, packages: found.packages ?? `${config}/match/packages` };
  })();
}

/** Whether espanso's daemon runs (`espanso status` exits 1 when it doesn't). */
export async function running(): Promise<boolean> {
  try {
    return parseStatus(await espanso(["status"]));
  } catch (e) {
    if (e instanceof NotInstalled) throw e;
    return false;
  }
}

async function* yamlFiles(dir: string, skip = "", depth = 0): AsyncGenerator<string> {
  let entries: Deno.DirEntry[] = [];
  try {
    entries = await Array.fromAsync(Deno.readDir(dir));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return;
    if (e instanceof Deno.errors.NotCapable || (e as Error).name === "NotCapable") {
      throw new Error(`Backslash may not read ${dir}: espanso's folder must be ~/.config/espanso`);
    }
    throw e;
  }
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory && depth < 4 && path !== skip) yield* yamlFiles(path, skip, depth + 1);
    else if (e.isFile && /\.ya?ml$/i.test(e.name)) yield path;
  }
}

export type Loaded = { matches: Match[]; globals: Var[]; errors: string[]; paths: Paths };

/** Every match of the user's files and installed packages. */
export async function loadMatches(): Promise<Loaded> {
  const p = await espansoPaths();
  const matches: Match[] = [];
  const globals: Var[] = [];
  const errors: string[] = [];
  const read = async (file: string, pkg?: string) => {
    try {
      const parsed = parseMatchFile(await Deno.readTextFile(file), file, pkg);
      matches.push(...parsed.matches);
      globals.push(...parsed.globalVars);
    } catch (e) {
      errors.push(`${file.split("/").pop()}: ${(e as Error).message.split("\n")[0]}`);
    }
  };
  // The user's own files first, then installed packages.
  for await (const file of yamlFiles(p.match, p.packages)) await read(file);
  for await (const file of yamlFiles(p.packages)) {
    const pkg = file.slice(p.packages.length + 1).split("/")[0];
    await read(file, pkg);
  }
  return { matches, globals, errors, paths: p };
}
