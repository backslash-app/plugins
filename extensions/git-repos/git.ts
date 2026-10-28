// Running git and find. Never asks for credentials: a prompt would hang the launcher.

import { type Commit, LOG_FORMAT, parseLog, parseStatus, pickRemote, remotePage, type Status } from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

export class GitMissing extends Error {}

const ENV = { GIT_TERMINAL_PROMPT: "0", GIT_SSH_COMMAND: "ssh -o BatchMode=yes", LC_ALL: "C" };

/** Runs a program; throws its stderr on failure. `allowFailure` returns stdout anyway. */
export async function run(
  program: string,
  args: string[],
  options: { signal?: AbortSignal; allowFailure?: boolean; cwd?: string } = {},
): Promise<string> {
  let out: Deno.CommandOutput;
  try {
    out = await new Deno.Command(program, {
      args,
      stdin: "null",
      stdout: "piped",
      stderr: "piped",
      signal: options.signal,
      env: ENV,
    }).output();
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new GitMissing(`${program} is not installed`);
    throw e;
  }
  const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/^\n+/, "").trimEnd();
  if (!out.success && !options.allowFailure) {
    const message = text(out.stderr) || text(out.stdout) || `${program} failed`;
    throw new Error(message.replace(/^(fatal|error): /gm, "").split("\n").slice(0, 3).join(" "));
  }
  return text(out.stdout);
}

export const git = (dir: string, args: string[], signal?: AbortSignal) => run("git", ["-C", dir, ...args], { signal });

export interface Repo {
  path: string;
  status?: Status;
  /** Files differing from HEAD. */
  changes: number;
  last?: Commit;
  remote?: { name: string; url: string; page?: string };
  error?: string;
}

/** Branch, changes, stashes, last commit and remote: three git calls. */
export async function inspect(path: string, signal?: AbortSignal): Promise<Repo> {
  try {
    const [statusOut, logOut, remotesOut] = await Promise.all([
      git(path, ["status", "--porcelain=v2", "--branch", "--show-stash"], signal),
      git(path, ["log", "-1", `--format=${LOG_FORMAT}`], signal).catch(() => ""),
      git(path, ["config", "--get-regexp", "^remote\\..*\\.url$"], signal).catch(() => ""),
    ]);
    const status = parseStatus(statusOut);
    const remote = pickRemote(remotesOut);
    return {
      path,
      status,
      changes: status.staged + status.modified + status.untracked + status.conflicts,
      last: parseLog(logOut)[0],
      remote: remote ? { ...remote, page: remotePage(remote.url) } : undefined,
    };
  } catch (e) {
    if (e instanceof GitMissing) throw e;
    return { path, changes: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs `fn` on every item, `limit` at a time. */
export async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

export async function recentCommits(path: string, signal?: AbortSignal): Promise<Commit[]> {
  return parseLog(await git(path, ["log", "-n", "30", `--format=${LOG_FORMAT}`], signal));
}
