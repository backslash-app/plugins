// Finding running servers and talking to their REST API.

import { exec } from "@backslash/api";
import {
  isServerFile,
  type Kernel,
  type KernelSpecs,
  mergeRecents,
  mergeServers,
  parseServer,
  parseServerList,
  parseWorkspace,
  type Recent,
  type Server,
  type ServerStatus,
  type Session,
} from "./lib.ts";

export const HOME = Deno.env.get("HOME") ?? "";
const RUNTIME = `${HOME}/.local/share/jupyter/runtime`;
const WORKSPACES = `${HOME}/.jupyter/lab/workspaces`;

async function files(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  try {
    for await (const e of Deno.readDir(dir)) if (e.isFile && keep(e.name)) out.push(`${dir}/${e.name}`);
  } catch { /* missing or unreadable */ }
  return out;
}

/** `jupyter server list --json`; empty when Jupyter isn't on the PATH. */
async function listed(signal?: AbortSignal): Promise<Server[]> {
  try {
    return parseServerList(await exec("jupyter", ["server", "list", "--json"], { signal }));
  } catch {
    return [];
  }
}

async function fromRuntime(): Promise<Server[]> {
  const out: Server[] = [];
  for (const path of await files(RUNTIME, isServerFile)) {
    try {
      const s = parseServer(JSON.parse(await Deno.readTextFile(path)));
      if (s) out.push(s);
    } catch { /* being written, or not JSON */ }
  }
  return out;
}

export function discover(signal?: AbortSignal): Promise<Server[]> {
  return Promise.all([listed(signal), fromRuntime()]).then(([a, b]) => mergeServers(a, b));
}

export async function recents(): Promise<Recent[]> {
  const lists = await Promise.all(
    (await files(WORKSPACES, (n) => n.endsWith(".jupyterlab-workspace"))).map((p) =>
      Deno.readTextFile(p).then((t) => parseWorkspace(t, HOME), () => [])
    ),
  );
  return mergeRecents(lists);
}

export class Unreachable extends Error {}

export async function api<T>(
  s: Server,
  path: string,
  options: { method?: string; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  if (s.sock) throw new Unreachable("Listens on a Unix socket, which this extension can't reach");
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout ?? 4000)])
    : AbortSignal.timeout(options.timeout ?? 4000);
  let res: Response;
  try {
    res = await fetch(`${s.base}${path}`, {
      method: options.method ?? "GET",
      signal,
      headers: s.token ? { Authorization: `token ${s.token}` } : {},
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new Unreachable(`Not answering on port ${s.port}`);
  }
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new Error(
      s.password && !s.token ? "This server uses a password: open it in the browser" : "The server refused the token",
    );
  }
  if (!res.ok) {
    const body = await res.json().catch(() => undefined) as { message?: string } | undefined;
    throw new Error(`Jupyter answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  }
  if (res.status === 204) return undefined as T;
  return await res.json().catch(() => undefined) as T;
}

export interface Live {
  server: Server;
  status?: ServerStatus;
  sessions: Session[];
  kernels: Kernel[];
  specs?: KernelSpecs;
  error?: string;
  /** Not answering: a runtime file left behind by a server that exited. */
  stale?: boolean;
}

export async function live(server: Server, signal?: AbortSignal): Promise<Live> {
  try {
    const [status, sessions, kernels, specs] = await Promise.all([
      api<ServerStatus>(server, "api/status", { signal }).catch(() => undefined),
      api<Session[]>(server, "api/sessions", { signal }),
      api<Kernel[]>(server, "api/kernels", { signal }),
      api<KernelSpecs>(server, "api/kernelspecs", { signal }).catch(() => undefined),
    ]);
    return { server, status, sessions: sessions ?? [], kernels: kernels ?? [], specs };
  } catch (e) {
    if (signal?.aborted) throw e;
    return {
      server,
      sessions: [],
      kernels: [],
      error: e instanceof Error ? e.message : String(e),
      stale: e instanceof Unreachable && !server.listed && !server.sock,
    };
  }
}
