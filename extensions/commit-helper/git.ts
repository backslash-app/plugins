// Running git and find. Never asks for credentials or an editor: a prompt would hang the launcher.

import { storage } from "@backslash/api";
import {
  findArgs,
  type History,
  learnHistory,
  parseFolders,
  parseNames,
  parseShortstat,
  reposFromFind,
  type RepoState,
  type Shortstat,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export class GitMissing extends Error {}

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", LC_ALL: "C" };

export async function run(
  program: string,
  args: string[],
  options: { signal?: AbortSignal; allowFailure?: boolean; stdin?: string } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    const child = new Deno.Command(program, {
      args,
      stdin: options.stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      signal: options.signal,
      env: ENV,
    }).spawn();
    if (options.stdin !== undefined) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(options.stdin));
      await writer.close();
    }
    out = await child.output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new GitMissing(`${program} is not installed`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/^\n+/, "").trimEnd();
  if (!out.success && !options.allowFailure) {
    const message = text(out.stderr) || text(out.stdout) || `${program} failed`;
    throw new Error(message.replace(/^(fatal|error): /gm, "").split("\n").slice(0, 6).join("\n"));
  }
  return text(out.stdout);
}

export const git = (dir: string, args: string[], options: { signal?: AbortSignal; stdin?: string } = {}) =>
  run("git", ["-C", dir, ...args], options);

export interface Prefs {
  folders?: string;
  depth?: number;
  gitmoji?: boolean;
  gitmojiStyle?: string;
}

/** Runs `fn` on every item, `limit` at a time. */
async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/** Every repository in the configured folders, with its staged file count and last commit time. */
export async function scanRepos(prefs: Prefs, signal?: AbortSignal): Promise<RepoState[]> {
  const roots = parseFolders(prefs.folders, HOME);
  // find exits with 1 when a folder doesn't exist; what it found is still good.
  const paths = reposFromFind(
    await run("find", findArgs(roots, Number(prefs.depth ?? 3)), { signal, allowFailure: true }),
  );
  return await pool(paths, 8, async (path) => {
    const [names, last] = await Promise.all([
      git(path, ["diff", "--cached", "--name-only", "-z"], { signal }).catch(() => ""),
      git(path, ["log", "-1", "--format=%ct"], { signal }).catch(() => "0"),
    ]);
    return { path, staged: parseNames(names).length, lastCommit: Number(last) || 0 };
  });
}

export interface RepoInfo {
  path: string;
  branch: string;
  staged: string[];
  stat: Shortstat;
  history: History;
}

export async function repoInfo(path: string, signal?: AbortSignal): Promise<RepoInfo> {
  const [branch, names, shortstat, subjects] = await Promise.all([
    git(path, ["branch", "--show-current"], { signal }).catch(() => ""),
    git(path, ["diff", "--cached", "--name-only", "-z"], { signal }).catch(() => ""),
    git(path, ["diff", "--cached", "--shortstat"], { signal }).catch(() => ""),
    git(path, ["log", "--format=%s", "-n", "200"], { signal }).catch(() => ""),
  ]);
  return {
    path,
    branch: branch || "(detached HEAD)",
    staged: parseNames(names),
    stat: parseShortstat(shortstat),
    history: learnHistory(subjects.split("\n")),
  };
}

const LAST_REPO = "lastRepo";

export const lastRepo = () => storage.get<string>(LAST_REPO).catch(() => undefined);
export const rememberRepo = (path: string) => storage.set(LAST_REPO, path).catch(() => {});
