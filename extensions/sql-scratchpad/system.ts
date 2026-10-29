// Running psql / mysql / sqlite3, the folder of saved queries, and exports to ~/Downloads.

import {
  cleanError,
  type Connection,
  fileNameFor,
  formatQueryFile,
  installHint,
  invocation,
  parseConnections,
  parseOutput,
  parseQueryFile,
  type Query,
  type Result,
  splitStatements,
  statementWrites,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
export const QUERIES_DIR = `${HOME}/.local/share/sql-scratchpad`;
export const DOWNLOADS = `${HOME}/Downloads`;

export interface Prefs {
  connections?: string;
  defaultConnection?: string;
  timeout?: number;
}

export function connectionsOf(prefs: Prefs): { connections: Connection[]; errors: string[] } {
  return parseConnections(prefs.connections, HOME);
}

/** The connection a query runs on: its own, else the default one, else the first. */
export function connectionFor(q: Pick<Query, "connection"> | undefined, prefs: Prefs): Connection | undefined {
  const { connections } = connectionsOf(prefs);
  const byName = (n?: string) => n ? connections.find((c) => c.name.toLowerCase() === n.toLowerCase()) : undefined;
  return byName(q?.connection) ?? byName(prefs.defaultConnection) ?? connections[0];
}

export interface Run {
  result: Result;
  ms: number;
  connection: Connection;
  sql: string;
  writes: boolean;
}

const decode = (b: Uint8Array) => new TextDecoder().decode(b);

/** Runs the query; read-only sessions unless `allowWrites`. */
export async function runQuery(
  c: Connection,
  sql: string,
  options: { allowWrites: boolean; signal?: AbortSignal; timeout?: number },
): Promise<Run> {
  const inv = invocation(c, sql, !options.allowWrites);
  const timeout = Math.max(5, Math.min(600, options.timeout ?? 60)) * 1000;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  // MariaDB installs `mariadb` and sometimes no `mysql` link.
  const programs = inv.program === "mysql" ? ["mysql", "mariadb"] : [inv.program];
  const started = performance.now();
  for (const program of programs) {
    let child: Deno.ChildProcess;
    try {
      child = new Deno.Command(program, {
        args: inv.args,
        env: inv.env,
        stdin: "piped",
        stdout: "piped",
        stderr: "piped",
        signal,
      }).spawn();
    } catch (e) {
      if (e instanceof Deno.errors.NotFound && program !== programs.at(-1)) continue;
      if (e instanceof Deno.errors.NotFound) throw new Error(`${program} isn't installed. ${installHint(c.kind)}`);
      throw e;
    }
    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode(inv.stdin)).catch(() => {});
    await writer.close().catch(() => {});
    const { code, stdout, stderr } = await child.output();
    const ms = Math.round(performance.now() - started);
    if (signal.aborted && !options.signal?.aborted) {
      throw new Error(`No answer after ${timeout / 1000} s: the query was stopped`);
    }
    if (code !== 0) throw new Error(cleanError(decode(stderr) || decode(stdout), program));
    const last = splitStatements(sql, c.kind).at(-1) ?? "";
    const writes = !!statementWrites(last, c.kind);
    return { result: parseOutput(c.kind, decode(stdout), writes), ms, connection: c, sql, writes };
  }
  throw new Error(installHint(c.kind));
}

// ---------------------------------------------------------------------------
// Saved queries

export async function loadQueries(): Promise<Query[]> {
  const out: Query[] = [];
  try {
    for await (const e of Deno.readDir(QUERIES_DIR)) {
      if (!e.isFile || !e.name.endsWith(".sql")) continue;
      try {
        out.push(parseQueryFile(e.name, await Deno.readTextFile(`${QUERIES_DIR}/${e.name}`)));
      } catch {
        // Unreadable file: skipped.
      }
    }
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) throw e;
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/** Writes a query; `previous` is its current file when editing. Returns the file name. */
export async function saveQuery(q: Omit<Query, "file">, previous?: string): Promise<string> {
  await Deno.mkdir(QUERIES_DIR, { recursive: true });
  const taken = (await loadQueries()).map((x) => x.file).filter((f) => f !== previous);
  const file = previous ?? fileNameFor(q.name, taken);
  await Deno.writeTextFile(`${QUERIES_DIR}/${file}`, formatQueryFile(q));
  return file;
}

export async function deleteQuery(file: string): Promise<void> {
  await Deno.remove(`${QUERIES_DIR}/${file}`);
}

export const queryPath = (file: string) => `${QUERIES_DIR}/${file}`;

/** Saves an export to ~/Downloads and returns its path. */
export async function exportFile(base: string, ext: string, text: string): Promise<string> {
  await Deno.mkdir(DOWNLOADS, { recursive: true }).catch(() => {});
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const path = `${DOWNLOADS}/${base}-${stamp}.${ext}`;
  await Deno.writeTextFile(path, text);
  return path;
}
