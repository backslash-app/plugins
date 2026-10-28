// Pure helpers for System Logs: journalctl JSON parsing, grouping and formatting.

/** journald priorities (syslog levels). */
export const PRIORITIES = ["Emergency", "Alert", "Critical", "Error", "Warning", "Notice", "Info", "Debug"];

/** The fields asked from journalctl (`--output-fields`); cursor and timestamps always come along. */
export const FIELDS = [
  "MESSAGE",
  "PRIORITY",
  "_SYSTEMD_UNIT",
  "_SYSTEMD_USER_UNIT",
  "UNIT",
  "USER_UNIT",
  "SYSLOG_IDENTIFIER",
  "_PID",
  "_EXE",
  "_COMM",
  "_CMDLINE",
  "_TRANSPORT",
  "_HOSTNAME",
  "_BOOT_ID",
  "_UID",
  "CODE_FILE",
  "CODE_FUNC",
];

export interface Entry {
  cursor: string;
  /** Milliseconds since the epoch. */
  time: number;
  priority: number;
  message: string;
  /** systemd unit, user unit, or the identifier for processes outside units. */
  unit?: string;
  userUnit: boolean;
  identifier?: string;
  pid?: number;
  exe?: string;
  comm?: string;
  cmdline?: string;
  transport?: string;
  hostname?: string;
  bootId?: string;
  uid?: number;
}

type Field = string | number[] | null | undefined | (string | number[])[];

/** journald gives binary or non-UTF-8 values as byte arrays, and repeated fields as arrays. */
export function fieldText(v: Field): string | undefined {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v;
  if (Array.isArray(v) && v.every((x) => typeof x === "number")) {
    return new TextDecoder().decode(new Uint8Array(v as number[]));
  }
  if (Array.isArray(v)) return fieldText((v as (string | number[])[])[0]);
  return String(v);
}

/** One `journalctl -o json` line. */
export function parseEntry(line: string): Entry | undefined {
  let raw: Record<string, Field>;
  try {
    raw = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (!raw || typeof raw !== "object") return undefined;
  const text = (k: string) => fieldText(raw[k])?.trim() || undefined;
  const num = (k: string) => {
    const n = Number(text(k));
    return text(k) !== undefined && Number.isFinite(n) ? n : undefined;
  };
  const userUnit = text("_SYSTEMD_USER_UNIT");
  const sysUnit = text("_SYSTEMD_UNIT");
  const transport = text("_TRANSPORT");
  // A user's units all run under user@UID.service: the user unit says more.
  let unit = userUnit ?? (sysUnit && !/^user@\d+\.service$/.test(sysUnit) ? sysUnit : undefined);
  // systemd's own messages about a unit ("Failed to start nginx.service") belong to that unit.
  const about = sysUnit === "init.scope" ? text("UNIT") : userUnit === "init.scope" ? text("USER_UNIT") : undefined;
  if (about) unit = about;
  return {
    cursor: text("__CURSOR") ?? `${text("__REALTIME_TIMESTAMP")}:${text("MESSAGE")}`,
    time: Math.floor(Number(text("__REALTIME_TIMESTAMP") ?? 0) / 1000),
    priority: num("PRIORITY") ?? 6,
    message: fieldText(raw.MESSAGE)?.replace(/\s+$/, "") ?? "",
    unit,
    userUnit: about ? userUnit === "init.scope" : !!userUnit,
    identifier: text("SYSLOG_IDENTIFIER") ?? (transport === "kernel" ? "kernel" : undefined),
    pid: num("_PID"),
    exe: text("_EXE"),
    comm: text("_COMM"),
    cmdline: text("_CMDLINE"),
    transport,
    hostname: text("_HOSTNAME"),
    bootId: text("_BOOT_ID"),
    uid: num("_UID"),
  };
}

export function parseJournal(out: string): Entry[] {
  return out.split("\n").filter((l) => l.startsWith("{")).map(parseEntry).filter((e): e is Entry => !!e);
}

/** Entries of several journalctl runs (system and --user), each once, newest first. */
export function mergeEntries(...runs: Entry[][]): Entry[] {
  const seen = new Map<string, Entry>();
  for (const run of runs) for (const e of run) if (!seen.has(e.cursor)) seen.set(e.cursor, e);
  return [...seen.values()].sort((a, b) => b.time - a.time);
}

/** Where an entry comes from, as a short name: the unit, else the program. */
export function source(e: Entry): string {
  if (e.transport === "kernel") return "Kernel";
  return e.unit ?? e.identifier ?? e.comm ?? "Unknown";
}

/** A unit name without its `.service` suffix. */
export function shortUnit(name: string): string {
  return name.replace(/\.service$/, "");
}

/** Repeated messages of a source, shown once with a count. */
export interface Group {
  key: string;
  source: string;
  /** The newest entry. */
  latest: Entry;
  count: number;
  first: number;
  pids: number[];
  /** Highest severity among them (lowest number). */
  priority: number;
}

/** Numbers that change from one repetition to the next (pids, addresses, counters) don't split a group. */
export function messageKey(message: string): string {
  return message.replace(/0x[0-9a-f]+/gi, "#").replace(/\d+/g, "#").slice(0, 300);
}

export function groupEntries(entries: Entry[]): Group[] {
  const groups = new Map<string, Group>();
  for (const e of entries) {
    const src = source(e);
    const key = `${src}\u0001${messageKey(e.message)}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, {
        key,
        source: src,
        latest: e,
        count: 1,
        first: e.time,
        pids: e.pid ? [e.pid] : [],
        priority: e.priority,
      });
      continue;
    }
    g.count++;
    if (e.time > g.latest.time) g.latest = e;
    g.first = Math.min(g.first, e.time);
    g.priority = Math.min(g.priority, e.priority);
    if (e.pid && !g.pids.includes(e.pid)) g.pids.push(e.pid);
  }
  return [...groups.values()];
}

/** Groups ordered by source, the sources with the most errors first, then newest first inside each. */
export function orderGroups(groups: Group[]): Group[] {
  const score = new Map<string, { errors: number; total: number; newest: number }>();
  for (const g of groups) {
    const s = score.get(g.source) ?? { errors: 0, total: 0, newest: 0 };
    if (g.priority <= 3) s.errors += g.count;
    s.total += g.count;
    s.newest = Math.max(s.newest, g.latest.time);
    score.set(g.source, s);
  }
  return [...groups].sort((a, b) => {
    const sa = score.get(a.source)!;
    const sb = score.get(b.source)!;
    return sb.errors - sa.errors || sb.total - sa.total || sb.newest - sa.newest ||
      a.source.localeCompare(b.source) || b.latest.time - a.latest.time;
  });
}

export interface Boot {
  index: number;
  id: string;
  /** Milliseconds since the epoch. */
  first: number;
  last: number;
}

/** `journalctl --list-boots -o json` (systemd 251+), newest first. */
export function parseBoots(out: string): Boot[] {
  let raw: unknown;
  try {
    raw = JSON.parse(out);
  } catch {
    return parseBootsText(out);
  }
  if (!Array.isArray(raw)) return [];
  return raw.map((b) => ({
    index: Number(b.index),
    id: String(b.boot_id ?? ""),
    first: Math.floor(Number(b.first_entry) / 1000),
    last: Math.floor(Number(b.last_entry) / 1000),
  })).filter((b) => b.id && Number.isFinite(b.index)).sort((a, b) => b.index - a.index);
}

/** The plain `--list-boots` table of older systemd: `-1 3a5f… Tue 2026-10-27 08:01:12 CET—Tue 2026-10-27 23:40:02 CET`. */
function parseBootsText(out: string): Boot[] {
  const boots: Boot[] = [];
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(-?\d+)\s+([0-9a-f]{32})\s/);
    const times = line.match(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d/g);
    if (!m || !times || times.length < 2) continue;
    const at = (t: string) => Date.parse(t.replace(" ", "T"));
    boots.push({ index: Number(m[1]), id: m[2], first: at(times[0]), last: at(times[1]) });
  }
  return boots.sort((a, b) => b.index - a.index);
}

/** journalctl's arguments to show the logs of an entry's source. */
export function sourceArgs(e: Entry): string[] {
  if (e.transport === "kernel") return ["-k"];
  if (e.unit) return e.userUnit ? ["--user", "-u", e.unit] : ["-u", e.unit];
  if (e.identifier) return ["-t", e.identifier];
  if (e.comm) return [`_COMM=${e.comm}`];
  return [];
}

// ---------------------------------------------------------------------------
// Formatting

const pad = (n: number) => String(n).padStart(2, "0");

/** "14:03" today, "Mon 14:03" this week, "12 Oct 14:03" before. */
export function shortTime(ms: number, now = Date.now()): string {
  const d = new Date(ms);
  const n = new Date(now);
  const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (d.toDateString() === n.toDateString()) return hm;
  if (now - ms < 6 * 86400_000) return `${d.toLocaleDateString("en-GB", { weekday: "short" })} ${hm}`;
  return `${d.getDate()} ${d.toLocaleDateString("en-GB", { month: "short" })} ${hm}`;
}

export function fullTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${
    pad(d.getSeconds())
  }`;
}

/** "3 h 12 min", "45 s". */
export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h${m % 60 ? ` ${m % 60} min` : ""}`;
  return `${Math.floor(h / 24)} days`;
}

/** The first line, shortened for a list row. */
export function firstLine(message: string, max = 140): string {
  const line = message.split("\n").find((l) => l.trim()) ?? "";
  return line.length > max ? line.slice(0, max - 1) + "…" : line;
}

/** "Oct 28 14:03:12 nginx.service[812]: message", like journalctl's short output. */
export function logLine(e: Entry): string {
  return `${fullTime(e.time)} ${source(e)}${e.pid ? `[${e.pid}]` : ""}: ${e.message}`;
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Text safe inside a markdown code block. */
export function codeBlock(text: string): string {
  return "```\n" + text.replace(/```/g, "ˋˋˋ") + "\n```";
}
