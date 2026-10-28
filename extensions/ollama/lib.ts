// Pure logic of the Ollama extension: API response mapping, pull progress,
// formatting and install hints. No I/O here.

export const BASE = "http://127.0.0.1:11434";

export interface Model {
  name: string;
  size: number;
  digest: string;
  modified?: Date;
  family?: string;
  families: string[];
  parameters?: string;
  quantization?: string;
  format?: string;
  /** Cloud models run on ollama.com and take no disk space. */
  remote: boolean;
}

export function mapModel(m: any): Model {
  const d = m.details ?? {};
  return {
    name: m.name ?? m.model,
    size: Number(m.size ?? 0),
    digest: String(m.digest ?? ""),
    modified: m.modified_at ? new Date(m.modified_at) : undefined,
    family: d.family || undefined,
    families: d.families ?? (d.family ? [d.family] : []),
    parameters: d.parameter_size || undefined,
    quantization: d.quantization_level || undefined,
    format: d.format || undefined,
    remote: !!m.remote_host || /-cloud$|:cloud$/.test(m.name ?? ""),
  };
}

export function parseTags(body: { models?: unknown[] } | undefined): Model[] {
  return (body?.models ?? []).map(mapModel).sort((a, b) => a.name.localeCompare(b.name));
}

export interface Running {
  name: string;
  size: number;
  vram: number;
  expires?: Date;
  context?: number;
}

export function parsePs(body: { models?: any[] } | undefined): Running[] {
  return (body?.models ?? []).map((m) => ({
    name: m.name ?? m.model,
    size: Number(m.size ?? 0),
    vram: Number(m.size_vram ?? 0),
    expires: m.expires_at ? new Date(m.expires_at) : undefined,
    context: m.context_length || undefined,
  }));
}

/** `100% GPU`, `48%/52% CPU/GPU` like `ollama ps`, or `100% CPU`. */
export function processor(r: Running): string {
  if (!r.size) return "";
  const gpu = Math.round((r.vram / r.size) * 100);
  if (gpu >= 100) return "100% GPU";
  if (gpu <= 0) return "100% CPU";
  return `${100 - gpu}%/${gpu}% CPU/GPU`;
}

/** `in 4 min`, `in 2 h`, `forever` (keep_alive -1 sets a date centuries away). */
export function expiresIn(date: Date | undefined, now = new Date()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = (date.getTime() - now.getTime()) / 1000;
  if (s > 86400 * 365) return "forever";
  if (s <= 0) return "now";
  if (s < 60) return `in ${Math.round(s)} s`;
  if (s < 3600) return `in ${Math.round(s / 60)} min`;
  if (s < 86400) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} d`;
}

export interface ModelInfo {
  architecture?: string;
  parameterCount?: number;
  contextLength?: number;
  embeddingLength?: number;
  capabilities: string[];
  license?: string;
  parameters: string[];
  template?: string;
  system?: string;
}

export function parseShow(body: any): ModelInfo {
  const info = body?.model_info ?? {};
  const arch = info["general.architecture"];
  const license = typeof body?.license === "string" ? body.license.trim().split("\n")[0].trim() : undefined;
  const system = /^SYSTEM\s+"""([\s\S]*?)"""/m.exec(body?.modelfile ?? "")?.[1] ??
    /^SYSTEM\s+(.+)$/m.exec(body?.modelfile ?? "")?.[1];
  return {
    architecture: arch,
    parameterCount: info["general.parameter_count"],
    contextLength: arch ? info[`${arch}.context_length`] : undefined,
    embeddingLength: arch ? info[`${arch}.embedding_length`] : undefined,
    capabilities: body?.capabilities ?? [],
    license: license || undefined,
    parameters: String(body?.parameters ?? "").split("\n").map((l) => l.trim().replace(/\s+/g, " ")).filter(Boolean),
    template: body?.template || undefined,
    system: system?.trim() || undefined,
  };
}

/** `llama3.2:latest` → `llama3.2`; `qwen3:8b` stays. */
export const displayName = (name: string) => name.replace(/:latest$/, "");

/** The library page of a model (namespaced models live under their user). */
export function libraryUrl(name: string): string {
  const base = name.split(":")[0];
  return base.includes("/") ? `https://ollama.com/${base}` : `https://ollama.com/library/${base}`;
}

/** Validates a model name typed by the user. */
export function normalizeModelName(input: string): string {
  let name = input.trim().replace(/^ollama\s+(run|pull)\s+/, "");
  name = name.replace(/^https?:\/\/ollama\.com\/(library\/)?/, "");
  if (!/^[\w.-]+(\/[\w.-]+)?(:[\w.-]+)?$/.test(name)) {
    throw new Error(`“${input.trim()}” is not a model name (e.g. llama3.2, qwen3:8b, gemma3:4b)`);
  }
  return name;
}

// --- Pull progress -----------------------------------------------------------------

export interface Layer {
  digest: string;
  total: number;
  completed: number;
}

export interface PullState {
  status: string;
  layers: Layer[];
  done: boolean;
  error?: string;
}

export const initialPull = (): PullState => ({ status: "Starting", layers: [], done: false });

/** Folds one NDJSON line of `/api/pull` into the state. */
export function reducePull(state: PullState, line: {
  status?: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}): PullState {
  if (line.error) return { ...state, error: line.error, done: true };
  const layers = [...state.layers];
  if (line.digest && line.total) {
    const i = layers.findIndex((l) => l.digest === line.digest);
    const layer = { digest: line.digest, total: line.total, completed: line.completed ?? 0 };
    if (i < 0) layers.push(layer);
    else layers[i] = { ...layer, completed: Math.max(layers[i].completed, layer.completed) };
  }
  const status = line.status ?? state.status;
  return { status, layers, done: status === "success" };
}

export function pullTotals(state: PullState): { completed: number; total: number; ratio: number } {
  const total = state.layers.reduce((n, l) => n + l.total, 0);
  const completed = state.layers.reduce((n, l) => n + Math.min(l.completed, l.total), 0);
  return { completed, total, ratio: total ? completed / total : state.done ? 1 : 0 };
}

/** `pulling 6a0746a1ec1a` → `Downloading layer 6a0746a1`. */
export function statusLabel(status: string): string {
  if (status === "success") return "Done";
  if (status === "pulling manifest") return "Fetching manifest";
  const m = /^pulling ([0-9a-f]{8,})/.exec(status);
  if (m) return `Downloading layer ${m[1].slice(0, 8)}`;
  if (status.startsWith("verifying")) return "Verifying digest";
  if (status.startsWith("writing manifest")) return "Writing manifest";
  if (status.startsWith("removing")) return "Removing unused layers";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/** Splits a stream of chunks into JSON lines. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.map((l) => l.trim()).filter(Boolean), rest };
}

// --- Formatting -------------------------------------------------------------------------

export function bytes(n: number): string {
  if (n < 1000) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n;
  let i = -1;
  do {
    v /= 1000;
    i++;
  } while (v >= 1000 && i < units.length - 1);
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 3212749888 → `3.2B`. */
export function count(n: number | undefined): string {
  if (!n) return "";
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  return `${Math.round(n / 1e3)}K`;
}

export function age(date: Date | undefined, now = new Date()): string {
  if (!date || isNaN(date.getTime())) return "";
  const s = Math.max(0, (now.getTime() - date.getTime()) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400)}d`;
  return `${Math.floor(s / (86400 * 365))}y`;
}

// --- Installing ----------------------------------------------------------------------------

export type Family = "debian" | "fedora" | "arch" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

export const INSTALL_SCRIPT = "curl -fsSL https://ollama.com/install.sh | sh";

export function installCommand(family: Family | undefined): string {
  switch (family) {
    case "arch":
      return "sudo pacman -S ollama   # or ollama-cuda, ollama-rocm";
    case "fedora":
      return "sudo dnf install ollama";
    default:
      return INSTALL_SCRIPT;
  }
}
