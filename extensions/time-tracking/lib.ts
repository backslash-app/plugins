// Time entries of Toggl Track, Clockify, Timewarrior and Kimai in one shape, and how to show them.

export type BackendId = "toggl" | "clockify" | "timewarrior" | "kimai";

export const BACKENDS: Record<BackendId, string> = {
  toggl: "Toggl Track",
  clockify: "Clockify",
  timewarrior: "Timewarrior",
  kimai: "Kimai",
};

export type Project = {
  /** Toggl/Clockify project id; Kimai `project:activity`; Timewarrior the tag itself. */
  id: string;
  name: string;
  client?: string;
  /** `#rrggbb`. */
  color?: string;
  /** Kimai only: an activity of the project. */
  activity?: string;
};

export type Entry = {
  id: string;
  description: string;
  project?: Project;
  tags: string[];
  /** ISO 8601. */
  start: string;
  /** ISO 8601; missing while it runs. */
  stop?: string;
  billable?: boolean;
};

/** What starting a timer needs. */
export interface StartRequest {
  description: string;
  project?: Project;
  tags?: string[];
  billable?: boolean;
}

/** The backend picked in the preferences, or the one whose credentials are set. */
export function chooseBackend(prefs: Record<string, unknown>, timewInstalled = false): BackendId | undefined {
  const asked = String(prefs.backend ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "");
  const aliases: Record<string, BackendId> = {
    toggl: "toggl",
    toggltrack: "toggl",
    clockify: "clockify",
    timewarrior: "timewarrior",
    timew: "timewarrior",
    kimai: "kimai",
  };
  if (asked && asked !== "auto") return aliases[asked];
  if (String(prefs.togglToken ?? "").trim()) return "toggl";
  if (String(prefs.clockifyKey ?? "").trim()) return "clockify";
  if (String(prefs.kimaiUrl ?? "").trim() && String(prefs.kimaiToken ?? "").trim()) return "kimai";
  if (timewInstalled) return "timewarrior";
  return undefined;
}

// ---------------------------------------------------------------------------
// Durations and dates

/** Seconds an entry lasted, or has lasted so far. */
export function seconds(e: Entry, now = Date.now()): number {
  const end = e.stop ? Date.parse(e.stop) : now;
  return Math.max(0, Math.round((end - Date.parse(e.start)) / 1000));
}

/** 4500 → "1h 15m", 300 → "5m", 20 → "0m". */
export function formatDuration(total: number): string {
  const minutes = Math.floor(total / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (!h) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** 4500 → "1:15:00", a clock-like elapsed time. */
export function formatClock(total: number): string {
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = Math.floor(total % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Hours as a decimal, for timesheets: 4500 → "1.25". */
export function decimalHours(total: number): string {
  return (Math.round(total / 36) / 100).toFixed(2);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The local calendar day of a date: "2026-10-28". */
export function dayKey(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local midnight of `date`. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local midnight of the Monday of `date`'s week. */
export function startOfWeek(date: Date): Date {
  const d = startOfDay(date);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/** "2026-10-28T09:15:00", the local time as Kimai and Timewarrior expect it. */
export function localIso(date: Date): string {
  return `${dayKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** "2026-10-28T08:15:00Z", UTC without milliseconds as Clockify requires. */
export function utcIso(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** "09:15". */
export function clockTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Today", "Yesterday", or "Monday 26 October". */
export function dayTitle(key: string, now = new Date()): string {
  if (key === dayKey(now)) return "Today";
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y)) return "Yesterday";
  const [yy, mm, dd] = key.split("-").map(Number);
  return new Date(yy, mm - 1, dd).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}

// ---------------------------------------------------------------------------
// Grouping and summaries

export interface Day {
  key: string;
  entries: Entry[];
  seconds: number;
}

/** Entries by the local day they started, newest day first, newest entry first. */
export function groupByDay(entries: Entry[], now = Date.now()): Day[] {
  const days = new Map<string, Entry[]>();
  for (const e of entries) {
    const k = dayKey(e.start);
    days.set(k, [...(days.get(k) ?? []), e]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([key, list]) => ({
      key,
      entries: list.sort((a, b) => b.start.localeCompare(a.start)),
      seconds: list.reduce((n, e) => n + seconds(e, now), 0),
    }));
}

/** Seconds tracked on the local day of `now`, the running entry included. */
export function totalToday(entries: Entry[], now = Date.now()): number {
  const today = dayKey(new Date(now));
  return entries.filter((e) => dayKey(e.start) === today).reduce((n, e) => n + seconds(e, now), 0);
}

export function runningEntry(entries: Entry[]): Entry | undefined {
  return entries.find((e) => !e.stop);
}

/** "Write report · Acme" */
export function entryLabel(e: Entry | StartRequest): string {
  const name = e.description.trim() || "(no description)";
  return e.project ? `${name} · ${e.project.name}` : name;
}

/** Totals per description and project, longest first: what a timesheet wants. */
export function summarize(entries: Entry[], now = Date.now()): { label: string; seconds: number }[] {
  const sums = new Map<string, number>();
  for (const e of entries) sums.set(entryLabel(e), (sums.get(entryLabel(e)) ?? 0) + seconds(e, now));
  return [...sums.entries()].map(([label, s]) => ({ label, seconds: s })).sort((a, b) => b.seconds - a.seconds);
}

/** A plain-text summary of some days, to paste in a timesheet or a chat. */
export function summaryText(days: Day[], now = Date.now()): string {
  const lines: string[] = [];
  for (const day of [...days].sort((a, b) => a.key.localeCompare(b.key))) {
    lines.push(`${day.key} (${dayTitle(day.key, new Date(now))}): ${formatDuration(day.seconds)}`);
    for (const s of summarize(day.entries, now)) {
      lines.push(`  - ${s.label}: ${formatDuration(s.seconds)} (${decimalHours(s.seconds)} h)`);
    }
  }
  if (days.length > 1) {
    lines.push(`Total: ${formatDuration(days.reduce((n, d) => n + d.seconds, 0))}`);
  }
  return lines.join("\n");
}

/** The entries worth resuming: one per description and project, most recent first. */
export function recentEntries(entries: Entry[], limit = 15): Entry[] {
  const seen = new Set<string>();
  const out: Entry[] = [];
  for (const e of [...entries].sort((a, b) => b.start.localeCompare(a.start))) {
    if (!e.description.trim() && !e.project) continue;
    const key = `${e.description.trim().toLowerCase()}\u0000${e.project?.id ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** A Backslash tint close to a project color. */
export function tintOf(
  hex: string | undefined,
): "red" | "orange" | "yellow" | "green" | "teal" | "blue" | "purple" | "pink" | "gray" {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max - min < 0.12) return "gray";
  let h: number;
  if (max === r) h = ((g - b) / (max - min) + 6) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h *= 60;
  if (h < 15 || h >= 340) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 160) return "green";
  if (h < 195) return "teal";
  if (h < 255) return "blue";
  if (h < 300) return "purple";
  return "pink";
}

// ---------------------------------------------------------------------------
// Toggl Track (API v9)

export interface TogglEntry {
  id: number;
  workspace_id: number;
  project_id?: number | null;
  description?: string | null;
  start: string;
  stop?: string | null;
  duration: number;
  tags?: string[] | null;
  billable?: boolean;
  project_name?: string;
  project_color?: string;
  client_name?: string;
}

export interface TogglProject {
  id: number;
  workspace_id: number;
  name: string;
  color?: string;
  client_id?: number | null;
  active?: boolean;
}

export function togglProjects(projects: TogglProject[], clients: { id: number; name: string }[] = []): Project[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  return projects
    .filter((p) => p.active !== false)
    .map((p) => ({
      id: String(p.id),
      name: p.name,
      color: p.color,
      client: p.client_id ? names.get(p.client_id) : undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fromToggl(e: TogglEntry, projects: Project[] = []): Entry {
  const known = e.project_id ? projects.find((p) => p.id === String(e.project_id)) : undefined;
  const project = e.project_id
    ? known ?? {
      id: String(e.project_id),
      name: e.project_name ?? `Project ${e.project_id}`,
      color: e.project_color,
      client: e.client_name,
    }
    : undefined;
  return {
    id: String(e.id),
    description: e.description ?? "",
    project,
    tags: e.tags ?? [],
    start: e.start,
    stop: e.duration < 0 || !e.stop ? undefined : e.stop,
    billable: e.billable,
  };
}

export function togglBody(r: StartRequest, workspace: number, now = new Date()) {
  return {
    created_with: "Backslash",
    description: r.description,
    workspace_id: workspace,
    ...(r.project ? { project_id: Number(r.project.id) } : {}),
    ...(r.tags?.length ? { tags: r.tags } : {}),
    ...(r.billable ? { billable: true } : {}),
    start: utcIso(now),
    duration: -1,
  };
}

// ---------------------------------------------------------------------------
// Clockify (API v1)

export interface ClockifyEntry {
  id: string;
  description?: string | null;
  projectId?: string | null;
  project?: { id: string; name: string; color?: string; clientName?: string } | null;
  tagIds?: string[] | null;
  tags?: { id: string; name: string }[] | null;
  billable?: boolean;
  timeInterval: { start: string; end?: string | null; duration?: string | null };
}

export interface ClockifyProject {
  id: string;
  name: string;
  color?: string;
  clientName?: string;
  archived?: boolean;
}

export function clockifyProjects(projects: ClockifyProject[]): Project[] {
  return projects
    .filter((p) => !p.archived)
    .map((p) => ({ id: p.id, name: p.name, color: p.color, client: p.clientName || undefined }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fromClockify(e: ClockifyEntry, projects: Project[] = []): Entry {
  const pid = e.project?.id ?? e.projectId ?? undefined;
  const project = pid
    ? projects.find((p) => p.id === pid) ??
      (e.project
        ? { id: pid, name: e.project.name, color: e.project.color, client: e.project.clientName || undefined }
        : { id: pid, name: "Project" })
    : undefined;
  return {
    id: e.id,
    description: e.description ?? "",
    project,
    tags: (e.tags ?? []).map((t) => t.name),
    start: e.timeInterval.start,
    stop: e.timeInterval.end ?? undefined,
    billable: e.billable,
  };
}

export function clockifyBody(r: StartRequest & { tagIds?: string[] }, now = new Date()) {
  return {
    start: utcIso(now),
    description: r.description,
    ...(r.project ? { projectId: r.project.id } : {}),
    ...(r.tagIds?.length ? { tagIds: r.tagIds } : {}),
    billable: r.billable ?? false,
  };
}

// ---------------------------------------------------------------------------
// Timewarrior (`timew export`)

export interface TimewInterval {
  id?: number;
  start: string;
  end?: string;
  tags?: string[];
  annotation?: string;
}

/** "20261028T081500Z" → "2026-10-28T08:15:00Z". */
export function timewDate(text: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(text);
  if (!m) return text;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

/**
 * `timew export` output, oldest first. Timewarrior numbers intervals from the
 * newest (`@1`); older versions don't export the id, so it is computed from
 * the order when the export reaches the present.
 */
export function parseTimew(json: string): Entry[] {
  const text = json.trim();
  if (!text) return [];
  const intervals = JSON.parse(text) as TimewInterval[];
  return intervals.map((t, i) => {
    const tags = t.tags ?? [];
    return {
      id: `@${t.id ?? intervals.length - i}`,
      description: t.annotation?.trim() || tags.join(" "),
      tags,
      start: timewDate(t.start),
      stop: t.end ? timewDate(t.end) : undefined,
    };
  });
}

/** Tags used recently, the most used first: the "projects" of Timewarrior. */
export function timewTags(entries: Entry[]): Project[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of e.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => ({
    id: t,
    name: t,
  }));
}

/** `timew start` arguments: the description and the project as tags. */
export function timewStartArgs(r: StartRequest): string[] {
  const tags = [r.description.trim(), r.project?.id ?? "", ...(r.tags ?? [])].filter(Boolean);
  return ["start", ...new Set(tags)];
}

// ---------------------------------------------------------------------------
// Kimai (API of Kimai 2)

export interface KimaiTimesheet {
  id: number;
  begin: string;
  end?: string | null;
  duration?: number | null;
  description?: string | null;
  tags?: string[];
  billable?: boolean;
  project: number | { id: number; name: string; color?: string | null; customer?: { name: string } | number };
  activity: number | { id: number; name: string };
}

export interface KimaiProject {
  id: number;
  name: string;
  parentTitle?: string;
  color?: string | null;
  visible?: boolean;
}

export interface KimaiActivity {
  id: number;
  name: string;
  project?: number | null;
  visible?: boolean;
}

/** Each project with each of its activities and the global ones: what a Kimai timesheet needs. */
export function kimaiChoices(projects: KimaiProject[], activities: KimaiActivity[], limit = 300): Project[] {
  const out: Project[] = [];
  const visible = activities.filter((a) => a.visible !== false);
  for (const p of projects.filter((p) => p.visible !== false).sort((a, b) => a.name.localeCompare(b.name))) {
    const own = visible.filter((a) => a.project === p.id);
    const global = visible.filter((a) => a.project === null || a.project === undefined);
    for (const a of [...own, ...global]) {
      out.push({
        id: `${p.id}:${a.id}`,
        name: `${p.name} › ${a.name}`,
        client: p.parentTitle,
        color: p.color ?? undefined,
        activity: a.name,
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function fromKimai(t: KimaiTimesheet, choices: Project[] = []): Entry {
  const pid = typeof t.project === "number" ? t.project : t.project.id;
  const aid = typeof t.activity === "number" ? t.activity : t.activity.id;
  const known = choices.find((c) => c.id === `${pid}:${aid}`);
  const pname = typeof t.project === "object" ? t.project.name : undefined;
  const aname = typeof t.activity === "object" ? t.activity.name : undefined;
  const customer = typeof t.project === "object" && typeof t.project.customer === "object"
    ? t.project.customer.name
    : undefined;
  return {
    id: String(t.id),
    description: t.description ?? "",
    project: known ?? {
      id: `${pid}:${aid}`,
      name: pname && aname ? `${pname} › ${aname}` : pname ?? `Project ${pid}`,
      color: typeof t.project === "object" ? t.project.color ?? undefined : undefined,
      client: customer,
      activity: aname,
    },
    tags: t.tags ?? [],
    start: t.begin,
    stop: t.end ?? undefined,
    billable: t.billable,
  };
}

export function kimaiBody(r: StartRequest, now = new Date()) {
  if (!r.project) throw new Error("Kimai needs a project and an activity: pick one in the list");
  const [project, activity] = r.project.id.split(":").map(Number);
  return {
    begin: localIso(now),
    project,
    activity,
    description: r.description,
    ...(r.tags?.length ? { tags: r.tags.join(",") } : {}),
  };
}

// ---------------------------------------------------------------------------
// Hosts

/**
 * Where a Kimai can be: Kimai Cloud, or a server of the local network or
 * Tailscale. Toggl and Clockify have fixed hosts. Same list as
 * `[permissions] net` (a test checks it).
 */
export const KIMAI_HOSTS = [
  "*.kimai.cloud",
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export const HOSTS = ["api.track.toggl.com", "api.clockify.me", ...KIMAI_HOSTS];

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether `[permissions] net` lets the extension reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `kimai.example.lan/` → `https://kimai.example.lan`, without `/api`. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, "").replace(/\/api$/, "").replace(/\/+$/, "");
}
