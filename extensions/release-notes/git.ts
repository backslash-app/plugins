// Running git, find, gh and glab. Never asks for credentials or an editor: a prompt would hang the launcher.

import { storage } from "@backslash/api";
import {
  type Commit,
  findArgs,
  LOG_FORMAT,
  parseFolders,
  parseLog,
  parseRemote,
  parseVersion,
  type Remote,
  reposFromFind,
  versionTags,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** A program that isn't installed; `program` says which. */
export class Missing extends Error {
  constructor(readonly program: string) {
    super(`${program} is not installed`);
  }
}

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", LC_ALL: "C" };

export async function run(
  program: string,
  args: string[],
  options: { signal?: AbortSignal; allowFailure?: boolean; stdin?: string; cwd?: string } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    const child = new Deno.Command(program, {
      args,
      cwd: options.cwd,
      stdin: options.stdin === undefined ? "null" : "piped",
      stdout: "piped",
      stderr: "piped",
      signal: options.signal,
      // gh and glab must not open a pager or prompt either.
      env: { ...ENV, GH_PROMPT_DISABLED: "1", GH_PAGER: "cat", GLAB_PAGER: "cat", NO_COLOR: "1" },
    }).spawn();
    if (options.stdin !== undefined) {
      const writer = child.stdin.getWriter();
      await writer.write(new TextEncoder().encode(options.stdin));
      await writer.close();
    }
    out = await child.output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Missing(program);
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
  hideMinor?: boolean;
  links?: boolean;
  remote?: string;
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

export interface RepoSummary {
  path: string;
  /** Unix seconds. */
  lastCommit: number;
  /** The newest version tag reachable from HEAD. */
  tag?: string;
  /** Commits since that tag (or in the whole history). */
  pending: number;
}

/** The newest version tag reachable from HEAD, if any. */
export async function latestTag(path: string, signal?: AbortSignal): Promise<string | undefined> {
  const merged = await git(path, ["tag", "--merged", "HEAD", "--sort=-v:refname"], { signal }).catch(() => "");
  return versionTags(merged.split("\n").map((t) => t.trim()).filter(Boolean))[0];
}

export async function summarize(path: string, signal?: AbortSignal): Promise<RepoSummary> {
  const [last, tag] = await Promise.all([
    git(path, ["log", "-1", "--format=%ct"], { signal }).catch(() => "0"),
    latestTag(path, signal),
  ]);
  const count = await git(path, ["rev-list", "--count", "--no-merges", tag ? `${tag}..HEAD` : "HEAD"], { signal })
    .catch(() => "0");
  return { path, lastCommit: Number(last) || 0, tag, pending: Number(count) || 0 };
}

/** Every repository in the configured folders, the most recently committed first. */
export async function scanRepos(prefs: Prefs, signal?: AbortSignal): Promise<RepoSummary[]> {
  const roots = parseFolders(prefs.folders, HOME);
  // find exits with 1 when a folder doesn't exist; what it found is still good.
  const paths = reposFromFind(
    await run("find", findArgs(roots, Number(prefs.depth ?? 3)), { signal, allowFailure: true }),
  );
  const repos = await pool(paths, 8, (p) => summarize(p, signal));
  return repos.filter((r) => r.lastCommit > 0).sort((a, b) => b.lastCommit - a.lastCommit);
}

export interface RepoInfo {
  path: string;
  branch: string;
  head: string;
  /** Version tags reachable from HEAD, newest first. */
  tags: string[];
  remote?: Remote;
  remoteName?: string;
}

export async function repoInfo(path: string, preferredRemote?: string, signal?: AbortSignal): Promise<RepoInfo> {
  const [branch, head, merged, remotes] = await Promise.all([
    git(path, ["branch", "--show-current"], { signal }).catch(() => ""),
    git(path, ["rev-parse", "--short", "HEAD"], { signal }),
    git(path, ["tag", "--merged", "HEAD", "--sort=-v:refname"], { signal }).catch(() => ""),
    git(path, ["remote"], { signal }).catch(() => ""),
  ]);
  const names = remotes.split("\n").map((r) => r.trim()).filter(Boolean);
  const remoteName = [preferredRemote, "origin", "upstream", names[0]].find((n) => n && names.includes(n));
  const url = remoteName ? await git(path, ["remote", "get-url", remoteName], { signal }).catch(() => "") : "";
  return {
    path,
    branch: branch || "(detached HEAD)",
    head,
    tags: versionTags(merged.split("\n").map((t) => t.trim()).filter(Boolean)),
    remote: url ? parseRemote(url) : undefined,
    remoteName,
  };
}

export async function commitsIn(path: string, from: string | undefined, to: string, signal?: AbortSignal) {
  const out = await git(path, ["log", `--format=${LOG_FORMAT}`, "--no-merges", from ? `${from}..${to}` : to], {
    signal,
  });
  return parseLog(out) as Commit[];
}

export async function tagExists(path: string, tag: string): Promise<boolean> {
  return (await git(path, ["tag", "--list", tag]).catch(() => "")).trim() === tag;
}

/** The day a ref was committed, `YYYY-MM-DD`; today for HEAD with no tag. */
export async function refDate(path: string, ref: string): Promise<string> {
  const out = await git(path, ["log", "-1", "--format=%cs", ref]).catch(() => "");
  return out || new Date().toISOString().slice(0, 10);
}

export const isVersionTag = (t: string) => parseVersion(t) !== undefined;

const RECENT = "recentRepos";

export const recentRepos = async () => (await storage.get<string[]>(RECENT).catch(() => undefined)) ?? [];

export async function rememberRepo(path: string): Promise<void> {
  const list = (await recentRepos()).filter((p) => p !== path);
  await storage.set(RECENT, [path, ...list].slice(0, 8)).catch(() => {});
}
