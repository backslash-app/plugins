// Jupyter servers, sessions and kernels: parsing what Jupyter writes and answers, and URLs.

import type { Color } from "@backslash/api";
import { Icons } from "@backslash/api";

// ---------------------------------------------------------------------------
// Servers

/** What `jupyter server list --json` prints and `jpserver-<pid>.json` holds. */
export interface Server {
  url: string;
  /** Where its API is reached: always this computer. */
  base: string;
  port: number;
  token: string;
  password: boolean;
  root: string;
  version: string;
  pid?: number;
  sock?: string;
  /** "server" (Jupyter Server) or "notebook" (classic Notebook < 7). */
  flavor: "server" | "notebook";
  /** Confirmed by `jupyter server list`, which drops servers that exited. */
  listed: boolean;
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));

/** One server description, from the CLI or a runtime file; undefined when it isn't one. */
export function parseServer(raw: unknown, listed = false): Server | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const port = Number(o.port);
  if (!Number.isInteger(port) || port <= 0) return undefined;
  const secure = o.secure === true;
  const baseUrl = `/${str(o.base_url).replace(/^\/+|\/+$/g, "")}/`.replace(/^\/\/$/, "/");
  const hostname = str(o.hostname);
  const local = ["localhost", "127.0.0.1"].includes(hostname) ? hostname : "127.0.0.1";
  let url = str(o.url);
  if (!url) {
    url = `${secure ? "https" : "http"}://${
      hostname && hostname !== "0.0.0.0" ? hostname : "localhost"
    }:${port}${baseUrl}`;
  }
  url = url.replace("//0.0.0.0:", "//localhost:");
  if (!url.endsWith("/")) url += "/";
  return {
    url,
    base: `${secure ? "https" : "http"}://${local}:${port}${baseUrl}`,
    port,
    token: str(o.token),
    password: o.password === true,
    root: str(o.root_dir ?? o.notebook_dir),
    version: str(o.version),
    pid: Number.isInteger(o.pid) ? o.pid as number : undefined,
    sock: str(o.sock) || undefined,
    flavor: "root_dir" in o || !("notebook_dir" in o) ? "server" : "notebook",
    listed,
  };
}

/**
 * `jupyter server list --json`: one JSON object per line (or one array with
 * `--jsonlist`). Lines that aren't JSON (warnings) are skipped.
 */
export function parseServerList(out: string): Server[] {
  const text = out.trim();
  if (text.startsWith("[")) {
    try {
      return (JSON.parse(text) as unknown[]).map((s) => parseServer(s, true)).filter((s): s is Server => !!s);
    } catch { /* fall back to lines */ }
  }
  return text.split("\n").flatMap((line) => {
    if (!line.trim().startsWith("{")) return [];
    try {
      const s = parseServer(JSON.parse(line), true);
      return s ? [s] : [];
    } catch {
      return [];
    }
  });
}

/** Runtime files that describe a server (not kernels, not the -open.html pages). */
export const isServerFile = (name: string) => /^(jpserver|nbserver)-\d+\.json$/.test(name);

/** Servers from both sources, the CLI's first, one per port. */
export function mergeServers(listed: Server[], files: Server[]): Server[] {
  const byPort = new Map<number, Server>();
  for (const s of [...listed, ...files]) {
    const known = byPort.get(s.port);
    if (!known) byPort.set(s.port, s);
    else if (!known.token && s.token) byPort.set(s.port, { ...known, token: s.token });
  }
  return [...byPort.values()].sort((a, b) => a.port - b.port);
}

/** The server URL with its token, as Jupyter prints it to log in. */
export function tokenUrl(s: Server, path = ""): string {
  return `${s.url}${path}${s.token ? `${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(s.token)}` : ""}`;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** A notebook in JupyterLab (`lab/tree/…`) or Jupyter Notebook (`notebooks/…`). */
export function notebookUrl(s: Server, path: string, ui: string): string {
  const prefix = ui === "notebook" || s.flavor === "notebook" ? "notebooks/" : "lab/tree/";
  return tokenUrl(s, prefix + encodePath(path.replace(/^\/+/, "")));
}

/** `/home/ada/work` → `~/work`. */
export function tilde(path: string, home: string): string {
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

/** `~/work` → `/home/ada/work`. */
export function expand(path: string, home: string): string {
  return path === "~" ? home : path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
}

/** The server whose root holds `abs`, with the path relative to that root. */
export function serverFor(servers: Server[], abs: string, home: string): { server: Server; rel: string } | undefined {
  let best: { server: Server; rel: string } | undefined;
  for (const server of servers) {
    const root = expand(server.root, home).replace(/\/+$/, "");
    if (!root || !(abs === root || abs.startsWith(`${root}/`))) continue;
    const rel = abs.slice(root.length + 1);
    if (!best || rel.length < best.rel.length) best = { server, rel };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Sessions and kernels (the server's REST API)

export interface Kernel {
  id: string;
  name: string;
  last_activity?: string;
  execution_state?: string;
  connections?: number;
}

export interface Session {
  id: string;
  path: string;
  name?: string;
  type?: string;
  kernel: Kernel | null;
}

export interface KernelSpecs {
  default?: string;
  kernelspecs?: Record<string, { name?: string; spec?: { display_name?: string; language?: string } }>;
}

export interface ServerStatus {
  started?: string;
  last_activity?: string;
  connections?: number;
  kernels?: number;
}

/** `python3` → `Python 3 (ipykernel)`, from the server's kernel specs. */
export function kernelName(name: string, specs?: KernelSpecs): string {
  return specs?.kernelspecs?.[name]?.spec?.display_name || name;
}

export function kernelLanguage(name: string, specs?: KernelSpecs): string {
  return specs?.kernelspecs?.[name]?.spec?.language || "";
}

/** Kernels that no notebook, console or file session uses. */
export function orphanKernels(kernels: Kernel[], sessions: Session[]): Kernel[] {
  const used = new Set(sessions.map((s) => s.kernel?.id).filter(Boolean));
  return kernels.filter((k) => !used.has(k.id));
}

export function stateLook(state: string | undefined): { icon: string; tint: Color; text: string } {
  switch (state) {
    case "busy":
      return { icon: Icons.inProgress, tint: "yellow", text: "Busy" };
    case "idle":
      return { icon: Icons.done, tint: "green", text: "Idle" };
    case "starting":
    case "restarting":
    case "autorestarting":
      return { icon: Icons.backlog, tint: "blue", text: state === "starting" ? "Starting" : "Restarting" };
    case "dead":
      return { icon: Icons.canceled, tint: "red", text: "Dead" };
    default:
      return { icon: Icons.todo, tint: "gray", text: state ? state[0].toUpperCase() + state.slice(1) : "Unknown" };
  }
}

/** "busy" first, then the most recently active. */
export function sortSessions(sessions: Session[]): Session[] {
  const rank = (s: Session) => (s.kernel?.execution_state === "busy" ? 0 : 1);
  const time = (s: Session) => Date.parse(s.kernel?.last_activity ?? "") || 0;
  return [...sessions].sort((a, b) => rank(a) - rank(b) || time(b) - time(a) || a.path.localeCompare(b.path));
}

/** "just now", "5m", "3h", "2d", "25 Oct". */
export function since(iso: string | undefined, now = new Date()): string {
  const t = Date.parse(iso ?? "");
  if (!t) return "";
  const s = Math.max(0, (now.getTime() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)}d`;
  return new Date(t).toLocaleDateString("en", { day: "numeric", month: "short" });
}

/** `analysis/sales.ipynb` → { name: "sales.ipynb", dir: "analysis" }. */
export function splitPath(path: string): { name: string; dir: string } {
  const clean = path.replace(/\/+$/, "");
  const i = clean.lastIndexOf("/");
  return i < 0 ? { name: clean, dir: "" } : { name: clean.slice(i + 1), dir: clean.slice(0, i) };
}

// ---------------------------------------------------------------------------
// Recent notebooks (JupyterLab workspaces)

export interface Recent {
  /** Absolute when the workspace recorded the server root, else relative to it. */
  path: string;
  absolute: boolean;
  /** Unix ms of the workspace's last change. */
  when: number;
  workspace: string;
}

/**
 * A `*.jupyterlab-workspace` file: the `docmanager:recents` list (JupyterLab 4,
 * with the server root) and the `notebook:<path>` widgets left open.
 */
export function parseWorkspace(text: string, home: string): Recent[] {
  let ws: { data?: Record<string, unknown>; metadata?: { id?: string; last_modified?: string } };
  try {
    ws = JSON.parse(text);
  } catch {
    return [];
  }
  const data = ws.data ?? {};
  const when = Date.parse(ws.metadata?.last_modified ?? "") || 0;
  const workspace = str(ws.metadata?.id) || "default";
  const out: Recent[] = [];
  const add = (path: string, root?: string) => {
    if (!path.endsWith(".ipynb")) return;
    const r = root ? expand(root, home).replace(/\/+$/, "") : "";
    const full = r ? `${r}/${path.replace(/^\/+/, "")}` : path;
    out.push({ path: full, absolute: full.startsWith("/"), when, workspace });
  };
  const recents = data["docmanager:recents"] as
    | { opened?: { path?: string; root?: string }[]; closed?: { path?: string; root?: string }[] }
    | undefined;
  for (const r of [...(recents?.opened ?? []), ...(recents?.closed ?? [])]) {
    if (r && typeof r.path === "string") add(r.path, typeof r.root === "string" ? r.root : undefined);
  }
  for (const key of Object.keys(data)) {
    if (!key.startsWith("notebook:")) continue;
    const path = (data[key] as { data?: { path?: string } } | undefined)?.data?.path ?? key.slice("notebook:".length);
    add(str(path));
  }
  return out;
}

/** One entry per notebook, the newest first; absolute paths win over relative ones. */
export function mergeRecents(lists: Recent[][], max = 30): Recent[] {
  const all = lists.flat().sort((a, b) => b.when - a.when || Number(b.absolute) - Number(a.absolute));
  const absolutes = all.filter((r) => r.absolute);
  const seen = new Set<string>();
  const out: Recent[] = [];
  for (const r of all) {
    // A relative path also known with its root is the same notebook.
    if (!r.absolute && absolutes.some((a) => a.path.endsWith(`/${r.path}`))) continue;
    if (seen.has(r.path)) continue;
    seen.add(r.path);
    out.push(r);
  }
  return out.slice(0, max);
}
