// Uptime Kuma's Prometheus metrics and status pages, Better Stack monitors. No I/O here.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Prometheus text format

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const re = /\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*"((?:[^"\\]|\\.)*)"\s*,?/gy;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    labels[m[1]] = m[2].replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
  }
  return labels;
}

/** The samples of a `/metrics` page (comments and malformed lines skipped). */
export function parsePrometheus(text: string): Sample[] {
  const out: Sample[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const m = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$/.exec(line);
    if (!m) continue;
    const value = m[3] === "NaN" ? NaN : m[3] === "+Inf" ? Infinity : m[3] === "-Inf" ? -Infinity : Number(m[3]);
    if (m[3] !== "NaN" && Number.isNaN(value)) continue;
    out.push({ name: m[1], labels: m[2] ? parseLabels(m[2]) : {}, value });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Monitors

export type Status = "down" | "pending" | "up" | "maintenance" | "paused" | "unknown";

export const STATUS: Record<Status, { title: string; color: Color; order: number }> = {
  down: { title: "Down", color: "red", order: 0 },
  pending: { title: "Pending", color: "orange", order: 1 },
  unknown: { title: "Unknown", color: "gray", order: 2 },
  maintenance: { title: "Maintenance", color: "blue", order: 3 },
  paused: { title: "Paused", color: "gray", order: 4 },
  up: { title: "Up", color: "green", order: 5 },
};

/** Uptime Kuma's heartbeat status: 0 down, 1 up, 2 pending, 3 maintenance. */
export function kumaStatus(n: number | undefined): Status {
  return n === 0 ? "down" : n === 1 ? "up" : n === 2 ? "pending" : n === 3 ? "maintenance" : "unknown";
}

export interface Beat {
  status: Status;
  time: number;
  msg?: string;
  ping?: number;
}

export interface Monitor {
  key: string;
  source: "kuma" | "betterstack";
  id?: string;
  name: string;
  status: Status;
  type?: string;
  /** What is checked: a URL, or host:port. */
  target?: string;
  /** Milliseconds. */
  responseTime?: number;
  certDays?: number;
  certValid?: boolean;
  /** 0–1, last 24 hours. */
  uptime24?: number;
  lastChecked?: number;
  beats?: Beat[];
  group?: string;
  /** Status page slugs it appears on. */
  pages?: string[];
  checkEvery?: number;
  paused?: boolean;
}

const useful = (v?: string) => v && v !== "null" && v !== "undefined" ? v : undefined;

/** `monitor_status`, `monitor_response_time`, `monitor_cert_days_remaining`, `monitor_cert_is_valid` per monitor. */
export function kumaFromMetrics(samples: Sample[]): Monitor[] {
  const byKey = new Map<string, Monitor>();
  for (const s of samples) {
    if (!s.name.startsWith("monitor_")) continue;
    const name = s.labels.monitor_name;
    if (!name) continue;
    const id = useful(s.labels.monitor_id);
    const key = `kuma:${id ?? name}`;
    let m = byKey.get(key);
    if (!m) {
      const host = useful(s.labels.monitor_hostname);
      const port = useful(s.labels.monitor_port);
      m = {
        key,
        source: "kuma",
        id,
        name,
        status: "unknown",
        type: useful(s.labels.monitor_type),
        target: useful(s.labels.monitor_url) && s.labels.monitor_url !== "https://"
          ? s.labels.monitor_url
          : host
          ? (port ? `${host}:${port}` : host)
          : undefined,
      };
      byKey.set(key, m);
    }
    if (s.name === "monitor_status") m.status = kumaStatus(s.value);
    else if (s.name === "monitor_response_time" && s.value >= 0) m.responseTime = s.value;
    else if (s.name === "monitor_cert_days_remaining") m.certDays = s.value;
    else if (s.name === "monitor_cert_is_valid") m.certValid = s.value === 1;
  }
  return [...byKey.values()];
}

/** Kuma's `2026-10-28 09:12:44.213` heartbeat times are UTC. */
export function kumaTime(t: string): number {
  const iso = t.includes("T") ? t : t.replace(" ", "T");
  return Date.parse(/Z|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
}

export interface StatusPage {
  slug: string;
  title: string;
  groups: { name: string; monitors: { id: number; name: string; type?: string; url?: string }[] }[];
  incident?: { title: string; content: string; style?: string };
}

/** `GET /api/status-page/<slug>`. */
export function parseStatusPage(slug: string, json: any): StatusPage {
  return {
    slug,
    title: json?.config?.title ?? slug,
    groups: (json?.publicGroupList ?? []).map((g: any) => ({
      name: g.name ?? "",
      monitors: (g.monitorList ?? []).map((m: any) => ({ id: m.id, name: m.name, type: m.type, url: m.url })),
    })),
    incident: json?.incident
      ? { title: json.incident.title, content: json.incident.content, style: json.incident.style }
      : undefined,
  };
}

/** `GET /api/status-page/heartbeat/<slug>`: beats oldest first, and the 24 h uptime of each monitor id. */
export function parseHeartbeats(json: any): { beats: Record<string, Beat[]>; uptime: Record<string, number> } {
  const beats: Record<string, Beat[]> = {};
  for (const [id, list] of Object.entries(json?.heartbeatList ?? {})) {
    beats[id] = (list as any[]).map((b) => ({
      status: kumaStatus(b.status),
      time: kumaTime(String(b.time)),
      msg: b.msg || undefined,
      ping: typeof b.ping === "number" ? b.ping : undefined,
    })).sort((a, b) => a.time - b.time);
  }
  const uptime: Record<string, number> = {};
  for (const [k, v] of Object.entries(json?.uptimeList ?? {})) {
    const m = /^(\d+)_24$/.exec(k);
    if (m && typeof v === "number") uptime[m[1]] = v;
  }
  return { beats, uptime };
}

/**
 * Merges the status pages into the metrics' monitors (matched by id, else by
 * name), adding the ones only status pages show.
 */
export function mergeStatusPages(
  monitors: Monitor[],
  pages: { page: StatusPage; beats: Record<string, Beat[]>; uptime: Record<string, number> }[],
): Monitor[] {
  const out = [...monitors];
  for (const { page, beats, uptime } of pages) {
    for (const g of page.groups) {
      for (const pm of g.monitors) {
        const id = String(pm.id);
        let m = out.find((x) => x.source === "kuma" && (x.id === id || (!x.id && x.name === pm.name)));
        const history = beats[id] ?? [];
        const last = history[history.length - 1];
        if (!m) {
          m = {
            key: `kuma:${id}`,
            source: "kuma",
            id,
            name: pm.name,
            status: last?.status ?? "unknown",
            type: pm.type,
            target: pm.url,
            responseTime: last?.ping,
          };
          out.push(m);
        }
        m.id ??= id;
        m.group ??= g.name || undefined;
        m.pages = [...new Set([...(m.pages ?? []), page.slug])];
        if (history.length && (!m.beats || history.length > m.beats.length)) m.beats = history;
        if (last) m.lastChecked = Math.max(m.lastChecked ?? 0, last.time);
        if (uptime[id] !== undefined) m.uptime24 = uptime[id];
      }
    }
  }
  return out;
}

/** Heartbeats as a bar of squares, newest on the right. */
export function beatBar(beats: Beat[], count = 40): string {
  const glyph: Record<Status, string> = {
    up: "🟩",
    down: "🟥",
    pending: "🟧",
    maintenance: "🟦",
    paused: "⬜",
    unknown: "⬜",
  };
  return beats.slice(-count).map((b) => glyph[b.status]).join("");
}

/** The outages in the heartbeats: when each started and how long it lasted. */
export function outages(beats: Beat[]): { start: number; end?: number; msg?: string }[] {
  const out: { start: number; end?: number; msg?: string }[] = [];
  let open: { start: number; end?: number; msg?: string } | undefined;
  for (const b of beats) {
    if (b.status === "down" && !open) {
      open = { start: b.time, msg: b.msg };
      out.push(open);
    } else if (b.status === "up" && open) {
      open.end = b.time;
      open = undefined;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Better Stack

export interface BetterStackMonitor {
  id: string;
  type: string;
  attributes: {
    url?: string;
    pronounceable_name?: string;
    monitor_type?: string;
    status?: string;
    paused?: boolean;
    paused_at?: string | null;
    last_checked_at?: string | null;
    check_frequency?: number;
    ssl_expiration?: number | null;
    domain_expiration?: number | null;
    verify_ssl?: boolean;
    port?: string | null;
    created_at?: string;
  };
}

/** Better Stack statuses: up, down, validating, paused, pending, maintenance. */
export function betterStackStatus(s?: string, paused?: boolean): Status {
  if (paused || s === "paused") return "paused";
  if (s === "up") return "up";
  if (s === "down") return "down";
  if (s === "validating" || s === "pending") return "pending";
  if (s === "maintenance") return "maintenance";
  return "unknown";
}

export function fromBetterStack(m: BetterStackMonitor): Monitor {
  const a = m.attributes;
  return {
    key: `betterstack:${m.id}`,
    source: "betterstack",
    id: m.id,
    name: a.pronounceable_name || a.url || `Monitor ${m.id}`,
    status: betterStackStatus(a.status, a.paused),
    type: a.monitor_type,
    target: a.url ? (a.port ? `${a.url}:${a.port}` : a.url) : undefined,
    lastChecked: a.last_checked_at ? Date.parse(a.last_checked_at) : undefined,
    checkEvery: a.check_frequency,
    paused: !!a.paused,
  };
}

/** The latest response time (ms) of `/monitors/<id>/response-times`, averaged over regions. */
export function latestResponseTime(json: any): { ms?: number; regions: { region: string; ms: number }[] } {
  const regions: { region: string; ms: number }[] = [];
  for (const r of json?.data?.attributes?.regions ?? []) {
    const times = [...(r.response_times ?? [])].sort((a: any, b: any) => Date.parse(a.at) - Date.parse(b.at));
    const last = times[times.length - 1];
    if (last && typeof last.response_time === "number") {
      regions.push({ region: r.region, ms: Math.round(last.response_time * 1000) });
    }
  }
  const ms = regions.length ? Math.round(regions.reduce((s, r) => s + r.ms, 0) / regions.length) : undefined;
  return { ms, regions };
}

// ---------------------------------------------------------------------------
// Formatting

export function sortMonitors(list: Monitor[]): Monitor[] {
  return [...list].sort((a, b) => STATUS[a.status].order - STATUS[b.status].order || a.name.localeCompare(b.name));
}

export const ms = (n?: number) =>
  n === undefined ? "—" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${Math.round(n)} ms`;

export function percent(ratio?: number): string {
  if (ratio === undefined) return "—";
  const p = ratio * 100;
  return p >= 99.995 ? "100 %" : `${p.toFixed(p >= 99 ? 2 : 1)} %`;
}

export function certColor(days?: number, valid?: boolean): Color | undefined {
  if (valid === false || (days !== undefined && days < 0)) return "red";
  if (days === undefined) return undefined;
  if (days < 7) return "red";
  if (days < 21) return "orange";
  return undefined;
}

export function ago(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const duration = (msTotal: number) => {
  const m = Math.round(msTotal / 60000);
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.floor(m / 1440)} d`;
};

/** `main, home-lab` → `["main", "home-lab"]`. */
export const parseSlugs = (
  text: unknown,
) => [
  ...new Set(
    String(text ?? "").split(/[\s,]+/).map((s) => s.trim().replace(/^.*\/status\//, "")).filter((s) =>
      /^[\w-]+$/.test(s)
    ),
  ),
];
