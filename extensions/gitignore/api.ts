// Templates from github/gitignore (GitHub API for the list, raw.githubusercontent.com for the files),
// cached in storage; the selection; and projects on disk.

import { storage } from "@backslash/api";
import {
  MARKERS,
  mergeGitignore,
  type MergeResult,
  parseFolders,
  rawUrl,
  SKIP_DIRS,
  type Template,
  templateFromPath,
  templatesFromTree,
  TREE_URL,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const WEEK = 7 * 86_400_000;

type Json = Parameters<typeof storage.set>[1];

interface Stamped<T> {
  at: number;
  value: T;
}

async function getStamped<T>(key: string): Promise<Stamped<T> | undefined> {
  return await storage.get(key).catch(() => undefined) as Stamped<T> | undefined;
}

const setStamped = (key: string, value: unknown) =>
  storage.set(key, { at: Date.now(), value } as unknown as Json).catch(() => {});

/** Every template of the repository, cached for a week (an older copy if GitHub can't be reached). */
export async function listTemplates(signal?: AbortSignal, force = false): Promise<Template[]> {
  const cached = await getStamped<string[]>("templates");
  if (cached && !force && Date.now() - cached.at < WEEK) return cached.value.map((p) => templateFromPath(p));
  try {
    const res = await fetch(TREE_URL, { headers: { Accept: "application/vnd.github+json" }, signal });
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub's rate limit for anonymous requests is reached: try again in an hour");
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status} for the template list`);
    const templates = templatesFromTree(await res.json());
    if (!templates.length) throw new Error("GitHub returned no template");
    await setStamped("templates", templates.map((t) => t.path));
    return templates;
  } catch (e) {
    if (signal?.aborted) throw e;
    if (cached) return cached.value.map((p) => templateFromPath(p));
    if (e instanceof TypeError) throw new Error("Couldn't reach GitHub: check your connection");
    throw e;
  }
}

// Template texts live in one storage entry, read once per run.
let memo: Record<string, Stamped<string>> | undefined;

async function contentCache(): Promise<Record<string, Stamped<string>>> {
  memo ??= ((await storage.get("contents").catch(() => undefined)) as Record<string, Stamped<string>> | undefined) ??
    {};
  return memo;
}

const saveCache = async () => {
  if (memo) await storage.set("contents", memo as unknown as Json).catch(() => {});
};

/** The cached text of a template, if any (no network). */
export async function cachedContent(path: string): Promise<string | undefined> {
  return (await contentCache())[path]?.value;
}

async function download(path: string, signal?: AbortSignal): Promise<string> {
  let res: Response;
  try {
    res = await fetch(rawUrl(path), { signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Couldn't download ${path}: check your connection`);
  }
  if (!res.ok) {
    await res.body?.cancel();
    throw new Error(`Couldn't download ${path} (GitHub answered ${res.status})`);
  }
  return await res.text();
}

/** A template's text, cached for a week (an older copy when the download fails). */
export async function templateContent(path: string, signal?: AbortSignal): Promise<string> {
  const cache = await contentCache();
  const hit = cache[path];
  if (hit && Date.now() - hit.at < WEEK) return hit.value;
  try {
    const text = await download(path, signal);
    cache[path] = { at: Date.now(), value: text };
    await saveCache();
    return text;
  } catch (e) {
    if (hit && !signal?.aborted) return hit.value;
    throw e;
  }
}

/** Downloads the texts that aren't cached yet, `batch` at a time, calling `progress` after each batch. */
export async function prefetch(
  paths: string[],
  signal: AbortSignal,
  progress: () => Promise<void> | void,
  batch = 24,
): Promise<void> {
  const cache = await contentCache();
  const missing = paths.filter((p) => !cache[p] || Date.now() - cache[p].at >= WEEK);
  for (let i = 0; i < missing.length && !signal.aborted; i += batch) {
    const chunk = missing.slice(i, i + batch);
    const texts = await Promise.all(chunk.map((p) => download(p, signal).catch(() => undefined)));
    chunk.forEach((p, j) => {
      if (texts[j] !== undefined) cache[p] = { at: Date.now(), value: texts[j]! };
    });
    await saveCache();
    await progress();
  }
}

export async function contents(templates: Template[], signal?: AbortSignal) {
  return await Promise.all(
    templates.map(async (t) => ({ name: t.name, path: t.path, content: await templateContent(t.path, signal) })),
  );
}

// ---------------------------------------------------------------------------
// Selection

const SELECTION = "selection";

export async function selection(): Promise<string[]> {
  return ((await storage.get(SELECTION).catch(() => undefined)) as string[] | undefined) ?? [];
}

export async function setSelection(paths: string[]): Promise<void> {
  await storage.set(SELECTION, [...new Set(paths)]);
}

export async function toggleSelection(path: string): Promise<boolean> {
  const current = await selection();
  const on = !current.includes(path);
  await setSelection(on ? [...current, path] : current.filter((p) => p !== path));
  return on;
}

// ---------------------------------------------------------------------------
// Projects

export interface Project {
  path: string;
  /** Names at its root. */
  files: string[];
  modified: number;
  /** Lines of its .gitignore, when it has one. */
  gitignoreLines?: number;
}

/** Folders with a project marker (.git, package.json, Cargo.toml…) below the configured ones, newest first. */
export async function findProjects(folders: string | undefined, depth = 2): Promise<Project[]> {
  const out: Project[] = [];
  const visit = async (dir: string, level: number): Promise<void> => {
    const names: string[] = [];
    const subdirs: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        names.push(e.name);
        if (e.isDirectory && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) subdirs.push(e.name);
      }
    } catch {
      return;
    }
    if (level > 0 && names.some((n) => MARKERS.has(n))) {
      const [info, gitignore] = await Promise.all([
        Deno.stat(names.includes(".git") ? `${dir}/.git` : dir).catch(() => undefined),
        names.includes(".gitignore") ? Deno.readTextFile(`${dir}/.gitignore`).catch(() => undefined) : undefined,
      ]);
      out.push({
        path: dir,
        files: names,
        modified: info?.mtime?.getTime() ?? 0,
        gitignoreLines: gitignore === undefined ? undefined : gitignore.split("\n").filter((l) => l.trim()).length,
      });
      return; // a project's subfolders are its own business
    }
    if (level >= depth) return;
    await Promise.all(subdirs.map((s) => visit(`${dir}/${s}`, level + 1)));
  };
  await Promise.all(parseFolders(folders, HOME).map((root) => visit(root, 0)));
  return out.sort((a, b) => b.modified - a.modified);
}

/** Appends the templates to `<folder>/.gitignore`, skipping lines it already has. */
export async function writeGitignore(
  folder: string,
  templates: { name: string; content: string }[],
): Promise<MergeResult & { created: boolean; path: string }> {
  const path = `${folder.replace(/\/+$/, "")}/.gitignore`;
  let existing = "";
  let created = false;
  try {
    existing = await Deno.readTextFile(path);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
    created = true;
  }
  const result = mergeGitignore(existing, templates);
  if (result.added) await Deno.writeTextFile(path, result.text);
  return { ...result, created, path };
}
