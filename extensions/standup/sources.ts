// Where the stand-up comes from: git repositories, GitHub and Linear.

import { type Context, exec } from "@backslash/api";
import {
  basename,
  cleanCommits,
  type Commit,
  githubQueries,
  githubSearchUrl,
  gitLogArgs,
  type Issue,
  linearQuery,
  parseGithubSearch,
  parseGitLog,
  parseLinear,
  parsePaths,
  parseWorkdays,
  type PullRequest,
  type Range,
  splitList,
  standupWindow,
  type Window,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

/** The folders that may be searched for repositories, the same list as `[permissions] read`. */
export const ALLOWED = [
  "~/Projects",
  "~/projects",
  "~/Code",
  "~/code",
  "~/dev",
  "~/Developer",
  "~/src",
  "~/git",
  "~/repos",
  "~/workspace",
  "~/work",
  "~/Work",
  "~/Documents/GitHub",
];

export interface Config {
  folders: string[];
  authors: string[];
  github?: string;
  linear?: string;
  workdays: number[];
  blockers: string;
  tidy: boolean;
}

export function config(ctx: Pick<Context, "preferences">): Config {
  const p = ctx.preferences;
  return {
    folders: parsePaths(String(p.folders || ALLOWED.join(",")), HOME),
    authors: splitList(String(p.authors ?? "")),
    github: String(p.githubToken ?? "").trim() || undefined,
    linear: String(p.linearKey ?? "").trim() || undefined,
    workdays: parseWorkdays(String(p.workdays ?? "")),
    blockers: String(p.blockers ?? ""),
    tidy: p.tidy !== false,
  };
}

export const windowFor = (cfg: Config, range: Range, now = new Date()) => standupWindow(now, range, cfg.workdays);

const isDir = async (path: string) => {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
};

/**
 * Repositories in the folders: a folder that is one, or the repositories in
 * it, two levels deep (~/Code/api, ~/Code/acme/web).
 */
export async function findRepos(folders: string[]): Promise<string[]> {
  const repos: string[] = [];
  const visit = async (dir: string, depth: number) => {
    if (await isDir(`${dir}/.git`) || await Deno.stat(`${dir}/.git`).then((s) => s.isFile, () => false)) {
      repos.push(dir);
      return;
    }
    if (depth >= 2) return;
    const children: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.isDirectory && !e.name.startsWith(".") && e.name !== "node_modules") children.push(`${dir}/${e.name}`);
      }
    } catch (e) {
      // A folder this extension may not list: git may still read it, if it is a repository.
      if (depth === 0 && (e instanceof Deno.errors.NotCapable || e instanceof Deno.errors.PermissionDenied)) {
        repos.push(dir);
      }
      return;
    }
    await Promise.all(children.sort().map((c) => visit(c, depth + 1)));
  };
  await Promise.all(folders.map((f) => visit(f, 0)));
  return [...new Set(repos)].sort();
}

async function git(args: string[], signal?: AbortSignal): Promise<string> {
  try {
    return await exec("git", args, { signal });
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) throw new Error("git is not installed");
    throw e;
  }
}

/** Your commits in each repository: the authors set, else the repository's own user.email. */
export async function commits(
  cfg: Config,
  w: Window,
  signal?: AbortSignal,
): Promise<{ commits: Commit[]; repos: number }> {
  const repos = await findRepos(cfg.folders);
  const globalEmail = cfg.authors.length ? "" : await git(["config", "--global", "user.email"]).catch(() => "");
  const found = await Promise.all(repos.map(async (repo) => {
    try {
      let authors = cfg.authors;
      if (!authors.length) {
        const email = await git(["-C", repo, "config", "user.email"], signal).catch(() => globalEmail);
        if (!email) return [];
        authors = [email];
      }
      return parseGitLog(await git(gitLogArgs(repo, w.since, authors), signal), repo);
    } catch {
      return []; // not a repository, or no commit yet
    }
  }));
  return { commits: cleanCommits(found.flat()), repos: repos.length };
}

export async function pullRequests(token: string, w: Window, signal?: AbortSignal): Promise<PullRequest[]> {
  const queries = githubQueries(w.since);
  const results = await Promise.all((Object.keys(queries) as PullRequest["state"][]).map(async (state) => {
    const res = await fetch(githubSearchUrl(queries[state]), {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal,
    });
    if (res.status === 401) throw new Error("GitHub refused the token: check it in Settings → Extensions → Stand-up");
    if (res.status === 403 || res.status === 429) {
      throw new Error("GitHub's rate limit is reached: try again in a minute");
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    return parseGithubSearch(await res.json(), state);
  }));
  // A PR merged in the window is not also "reviewed".
  const merged = new Set(results[0].map((p) => p.url));
  return results.flat().filter((p, i, all) =>
    p.state === "merged" || !merged.has(p.url) && all.findIndex((x) => x.url === p.url) === i
  );
}

export async function linearIssues(key: string, w: Window, signal?: AbortSignal): Promise<Issue[]> {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    // Personal API keys go as they are; OAuth tokens would need "Bearer".
    headers: {
      Authorization: key.startsWith("lin_oauth_") ? `Bearer ${key}` : key,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: linearQuery(w.since) }),
    signal,
  });
  if (res.status === 401 || res.status === 400 && /authenticat/i.test(await res.clone().text())) {
    throw new Error("Linear refused the API key: create one in Linear → Settings → Security & access");
  }
  if (!res.ok) throw new Error(`Linear answered ${res.status}`);
  return parseLinear(await res.json());
}

export const repoName = (path: string) => basename(path);

/** Everything at once, for the copy command; a failing source is reported in `errors`. */
export async function gather(cfg: Config, w: Window, signal?: AbortSignal) {
  const [git, prs, issues] = await Promise.allSettled([
    commits(cfg, w, signal),
    cfg.github ? pullRequests(cfg.github, w, signal) : Promise.resolve([]),
    cfg.linear ? linearIssues(cfg.linear, w, signal) : Promise.resolve([]),
  ]);
  const errors = [git, prs, issues].filter((r): r is PromiseRejectedResult => r.status === "rejected")
    .map((r) => (r.reason as Error).message ?? String(r.reason));
  return {
    commits: git.status === "fulfilled" ? git.value.commits : [],
    repos: git.status === "fulfilled" ? git.value.repos : 0,
    prs: prs.status === "fulfilled" ? prs.value : [],
    issues: issues.status === "fulfilled" ? issues.value : [],
    errors,
  };
}
