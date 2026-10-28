// OSV.dev API (https://google.github.io/osv.dev/api/): no key, JSON over HTTPS. And finding projects on disk.

import { storage } from "@backslash/api";
import {
  type Dependency,
  type Finding,
  type Lockfile,
  LOCKFILE_NAMES,
  type OsvVuln,
  parseFolders,
  pickLockfiles,
  SKIP_DIRS,
} from "./lib.ts";

export const API = "https://api.osv.dev";
export const HOME = Deno.env.get("HOME") ?? "";

type Json = Parameters<typeof storage.set>[1];

async function osv<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T | undefined> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error("Couldn't reach OSV.dev: check your connection");
  }
  if (res.status === 404) {
    await res.body?.cancel();
    return undefined;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message = "";
    try {
      message = (JSON.parse(text) as { message?: string }).message ?? "";
    } catch {
      message = text.slice(0, 200);
    }
    if (res.status === 400) throw new Error(`OSV.dev didn't understand the query${message ? `: ${message}` : ""}`);
    if (res.status === 429) throw new Error("OSV.dev is rate limiting: try again in a minute");
    throw new Error(`OSV.dev answered ${res.status}${message ? `: ${message}` : ""}`);
  }
  return await res.json() as T;
}

interface PackageQuery {
  package: { ecosystem: string; name: string };
  version?: string;
  page_token?: string;
}

const query = (d: { ecosystem: string; name: string; version?: string }): PackageQuery => ({
  package: { ecosystem: d.ecosystem, name: d.name },
  ...(d.version ? { version: d.version } : {}),
});

/** Advisories of a package, or of one version of it. */
export async function queryPackage(
  p: { ecosystem: string; name: string; version?: string },
  signal?: AbortSignal,
): Promise<OsvVuln[]> {
  const out: OsvVuln[] = [];
  let token: string | undefined;
  for (let page = 0; page < 5; page++) {
    const res = await osv<{ vulns?: OsvVuln[]; next_page_token?: string }>(
      "/v1/query",
      { ...query(p), ...(token ? { page_token: token } : {}) },
      signal,
    );
    out.push(...(res?.vulns ?? []));
    token = res?.next_page_token;
    if (!token) break;
  }
  return out;
}

const CACHE_INDEX = "vulnIndex";
const CACHE_MAX = 400;

interface Cached {
  vuln: OsvVuln;
  at: number;
}

async function cached(id: string): Promise<Cached | undefined> {
  return await storage.get(`vuln:${id}`).catch(() => undefined) as Cached | undefined;
}

async function remember(vulns: OsvVuln[]): Promise<void> {
  if (!vulns.length) return;
  try {
    const now = Date.now();
    await Promise.all(vulns.map((v) => storage.set(`vuln:${v.id}`, { vuln: v, at: now } as unknown as Json)));
    const index = ((await storage.get(CACHE_INDEX)) as string[] | undefined) ?? [];
    const ids = vulns.map((v) => v.id);
    const next = [...ids, ...index.filter((id) => !ids.includes(id))];
    await Promise.all(next.slice(CACHE_MAX).map((id) => storage.delete(`vuln:${id}`)));
    await storage.set(CACHE_INDEX, next.slice(0, CACHE_MAX));
  } catch {
    // The cache is an optimization.
  }
}

/** One advisory by id (OSV, GHSA, CVE, RUSTSEC…); `undefined` when OSV doesn't know it. */
export async function getVuln(id: string, signal?: AbortSignal, modified?: string): Promise<OsvVuln | undefined> {
  const hit = await cached(id);
  if (hit && (modified ? hit.vuln.modified === modified : Date.now() - hit.at < 86_400_000)) return hit.vuln;
  const v = await osv<OsvVuln>(`/v1/vulns/${encodeURIComponent(id)}`, undefined, signal);
  if (v) await remember([v]);
  return v;
}

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

const BATCH = 1000;

/** Every dependency with its advisories: `/v1/querybatch` for the ids, then each advisory once. */
export async function scan(deps: Dependency[], signal?: AbortSignal): Promise<Finding[]> {
  const ids: { id: string; modified: string }[][] = deps.map(() => []);
  for (let start = 0; start < deps.length; start += BATCH) {
    let pending = deps.slice(start, start + BATCH).map((d, i) => ({ index: start + i, q: query(d) }));
    for (let round = 0; pending.length && round < 5; round++) {
      const res = await osv<{ results: { vulns?: { id: string; modified: string }[]; next_page_token?: string }[] }>(
        "/v1/querybatch",
        { queries: pending.map((p) => p.q) },
        signal,
      );
      const results = res?.results ?? [];
      const again: typeof pending = [];
      results.forEach((r, i) => {
        ids[pending[i].index].push(...(r.vulns ?? []));
        if (r.next_page_token) again.push({ ...pending[i], q: { ...pending[i].q, page_token: r.next_page_token } });
      });
      pending = again;
    }
  }
  const unique = new Map<string, string>();
  for (const list of ids) for (const v of list) unique.set(v.id, v.modified);
  const vulns = new Map<string, OsvVuln>();
  await pool([...unique], 12, async ([id, modified]) => {
    const v = await getVuln(id, signal, modified).catch((e) => {
      if (signal?.aborted) throw e;
      return undefined;
    });
    if (v) vulns.set(id, v);
  });
  return deps.map((dependency, i) => ({
    dependency,
    vulns: ids[i].map((v) => vulns.get(v.id)).filter((v): v is OsvVuln => !!v && !v.withdrawn),
  }));
}

// ---------------------------------------------------------------------------
// Projects

export interface Project {
  path: string;
  lockfiles: Lockfile[];
  /** Newest lockfile change, ms. */
  modified: number;
}

/** Folders below the configured ones (up to `depth` levels) that have a lockfile, newest change first. */
export async function findProjects(folders: string | undefined, depth: number): Promise<Project[]> {
  const roots = parseFolders(folders, HOME);
  const projects: Project[] = [];
  const visit = async (dir: string, level: number): Promise<void> => {
    const files: string[] = [];
    const subdirs: string[] = [];
    try {
      for await (const e of Deno.readDir(dir)) {
        if (e.isFile && LOCKFILE_NAMES.has(e.name)) files.push(e.name);
        else if (e.isDirectory && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) subdirs.push(e.name);
      }
    } catch {
      return; // missing or unreadable
    }
    const lockfiles = pickLockfiles(files);
    if (lockfiles.length) {
      const times = await Promise.all(
        lockfiles.map((l) => Deno.stat(`${dir}/${l.file}`).then((s) => s.mtime?.getTime() ?? 0).catch(() => 0)),
      );
      projects.push({ path: dir, lockfiles, modified: Math.max(...times) });
      // Keep looking below it, within the depth: monorepos have a lockfile per package.
    }
    if (level >= depth) return;
    await Promise.all(subdirs.map((s) => visit(`${dir}/${s}`, level + 1)));
  };
  await Promise.all(roots.map((r) => visit(r, 0)));
  const seen = new Set<string>();
  return projects
    .filter((p) => !seen.has(p.path) && seen.add(p.path))
    .sort((a, b) => b.modified - a.modified);
}

/** The dependencies of a project, lockfile by lockfile. */
export async function readDependencies(
  project: Project,
): Promise<{ lockfile: Lockfile; deps: Dependency[]; error?: string }[]> {
  return await Promise.all(project.lockfiles.map(async (lockfile) => {
    try {
      const text = await Deno.readTextFile(`${project.path}/${lockfile.file}`);
      return { lockfile, deps: lockfile.parse(text) };
    } catch (e) {
      return { lockfile, deps: [], error: e instanceof Error ? e.message : String(e) };
    }
  }));
}
