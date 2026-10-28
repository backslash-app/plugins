// Finding the session logs on disk and reading them, with summaries cached by file size and change time.

import { storage } from "@backslash/api";
import {
  AIDER_HISTORY,
  byRecency,
  claudeFolder,
  ClaudeReader,
  codexIdFromName,
  CodexReader,
  parseAiderHistory,
  type Session,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";

type Json = Parameters<typeof storage.set>[1];

interface LogFile {
  path: string;
  agent: Session["agent"];
  size: number;
  /** Unix milliseconds. */
  modified: number;
}

/** Folders that hold nothing but code dependencies and build output. */
const SKIP_DIRS = new Set(["node_modules", "vendor", "target", "dist", "build", "venv", ".venv", "__pycache__"]);

const stat = async (path: string) => {
  try {
    return await Deno.stat(path);
  } catch {
    return undefined;
  }
};

async function* dirEntries(dir: string): AsyncGenerator<Deno.DirEntry> {
  try {
    for await (const e of Deno.readDir(dir)) yield e;
  } catch {
    // missing or unreadable: nothing there
  }
}

/** Splits a file into lines as it streams in, without holding it all. */
export async function* readLines(path: string, signal?: AbortSignal): AsyncGenerator<string> {
  const file = await Deno.open(path, { read: true });
  const decoder = new TextDecoder();
  let rest = "";
  try {
    for await (const chunk of file.readable) {
      signal?.throwIfAborted();
      rest += decoder.decode(chunk, { stream: true });
      let start = 0;
      let i: number;
      while ((i = rest.indexOf("\n", start)) !== -1) {
        yield rest.slice(start, i);
        start = i + 1;
      }
      rest = rest.slice(start);
    }
    rest += decoder.decode();
    if (rest) yield rest;
  } finally {
    try {
      file.close();
    } catch {
      // already closed by the stream
    }
  }
}

/** `~/.claude/projects/*\/*.jsonl` (subagent logs, one level deeper, are left out). */
async function claudeFiles(): Promise<LogFile[]> {
  const root = `${HOME}/.claude/projects`;
  const out: LogFile[] = [];
  const dirs: string[] = [];
  for await (const d of dirEntries(root)) if (d.isDirectory) dirs.push(`${root}/${d.name}`);
  await Promise.all(dirs.map(async (dir) => {
    for await (const f of dirEntries(dir)) {
      if (!f.isFile || !f.name.endsWith(".jsonl")) continue;
      const path = `${dir}/${f.name}`;
      const st = await stat(path);
      if (st && st.size > 0) out.push({ path, agent: "claude", size: st.size, modified: st.mtime?.getTime() ?? 0 });
    }
  }));
  return out;
}

/** `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`, newest days first, at most `max` files. */
async function codexFiles(max: number): Promise<LogFile[]> {
  const root = `${HOME}/.codex/sessions`;
  const out: LogFile[] = [];
  const sortedDirs = async (dir: string) => {
    const names: string[] = [];
    for await (const e of dirEntries(dir)) if (e.isDirectory && /^\d+$/.test(e.name)) names.push(e.name);
    return names.sort().reverse().map((n) => `${dir}/${n}`);
  };
  for (const year of await sortedDirs(root)) {
    for (const month of await sortedDirs(year)) {
      for (const day of await sortedDirs(month)) {
        for await (const f of dirEntries(day)) {
          if (!f.isFile || !/^rollout-.*\.jsonl$/.test(f.name)) continue;
          const path = `${day}/${f.name}`;
          const st = await stat(path);
          if (st && st.size > 0) out.push({ path, agent: "codex", size: st.size, modified: st.mtime?.getTime() ?? 0 });
        }
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** `.aider.chat.history.md` at most `depth` folders below each root. */
async function aiderFiles(roots: string[], depth: number, signal?: AbortSignal): Promise<LogFile[]> {
  const out: LogFile[] = [];
  await Promise.all(roots.map(async (root) => {
    const queue: [string, number][] = [[root, 0]];
    while (queue.length) {
      signal?.throwIfAborted();
      const [dir, level] = queue.shift()!;
      for await (const e of dirEntries(dir)) {
        if (e.isFile && e.name === AIDER_HISTORY) {
          const path = `${dir}/${e.name}`;
          const st = await stat(path);
          if (st && st.size > 0) out.push({ path, agent: "aider", size: st.size, modified: st.mtime?.getTime() ?? 0 });
        } else if (e.isDirectory && level < depth && !e.name.startsWith(".") && !SKIP_DIRS.has(e.name)) {
          queue.push([`${dir}/${e.name}`, level + 1]);
        }
      }
    }
  }));
  return out;
}

/** Aider histories are markdown that only grows; the last chat is at the end. */
const AIDER_TAIL = 512 * 1024;

async function readAider(f: LogFile): Promise<Session> {
  let text: string;
  if (f.size <= AIDER_TAIL) text = await Deno.readTextFile(f.path);
  else {
    const file = await Deno.open(f.path, { read: true });
    try {
      await file.seek(-AIDER_TAIL, Deno.SeekMode.End);
      const buf = new Uint8Array(AIDER_TAIL);
      let read = 0;
      while (read < buf.length) {
        const n = await file.read(buf.subarray(read));
        if (n === null) break;
        read += n;
      }
      text = new TextDecoder().decode(buf.subarray(0, read));
      // Start at a chat boundary when there is one in the tail.
      const at = text.indexOf("\n# aider chat started at ");
      if (at !== -1) text = text.slice(at + 1);
    } finally {
      file.close();
    }
  }
  return parseAiderHistory(text, f.path, f.modified);
}

export async function readSession(f: LogFile, signal?: AbortSignal): Promise<Session> {
  if (f.agent === "aider") return readAider(f);
  const name = f.path.split("/").pop()!;
  const reader = f.agent === "claude"
    ? new ClaudeReader(f.path, name.replace(/\.jsonl$/, ""))
    : new CodexReader(f.path, codexIdFromName(name) ?? name);
  for await (const line of readLines(f.path, signal)) reader.add(line);
  const s = reader.finish();
  if (f.agent === "claude" && !s.cwd) s.cwd = claudeFolder(f.path.split("/").slice(-2)[0]);
  s.updated = Math.max(s.updated ?? 0, f.modified) || undefined;
  return s;
}

interface CacheEntry {
  size: number;
  modified: number;
  session: Session;
}

const CACHE = "sessions-v1";

export interface Options {
  folders: string[];
  depth: number;
  /** How many of the most recent sessions to read, per agent. */
  max: number;
  agents: Set<Session["agent"]>;
}

/** The most recent sessions of every agent, newest first. */
export async function recentSessions(o: Options, signal?: AbortSignal): Promise<Session[]> {
  const [claude, codex, aider] = await Promise.all([
    o.agents.has("claude") ? claudeFiles() : [],
    o.agents.has("codex") ? codexFiles(o.max * 2) : [],
    o.agents.has("aider") ? aiderFiles(o.folders, o.depth, signal) : [],
  ]);
  const newest = (files: LogFile[]) => files.sort((a, b) => b.modified - a.modified).slice(0, o.max);
  const files = [...newest(claude), ...newest(codex), ...newest(aider)];
  const cache = (await storage.get(CACHE).catch(() => undefined) ?? {}) as unknown as Record<string, CacheEntry>;
  const next: Record<string, CacheEntry> = {};
  const sessions = await Promise.all(files.map(async (f) => {
    const hit = cache[f.path];
    if (hit && hit.size === f.size && hit.modified === f.modified) {
      next[f.path] = hit;
      return hit.session;
    }
    try {
      const session = await readSession(f, signal);
      next[f.path] = { size: f.size, modified: f.modified, session };
      return session;
    } catch (e) {
      if (signal?.aborted) throw e;
      return undefined;
    }
  }));
  await storage.set(CACHE, next as unknown as Json).catch(() => {});
  return sessions.filter((s): s is Session => !!s && (s.promptCount > 0 || !!s.title)).sort(byRecency);
}
