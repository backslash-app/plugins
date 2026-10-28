// Parsing the output of notification daemons. Pure, tested in lib_test.ts.

export type BackendId = "mako" | "dunst" | "swaync" | "gnome" | "kde" | "xfce" | "cinnamon";

export interface Notification {
  id: string;
  app: string;
  summary: string;
  body: string;
  urgency: "low" | "normal" | "critical";
  category?: string;
  /** Milliseconds since the epoch, when the daemon tells. */
  time?: number;
}

/** `gdbus call … GetServerInformation`: `('mako', 'emersion', '1.9.0', '1.2')`. */
export function parseServerInfo(out: string): { name: string; vendor: string; version: string } | undefined {
  const m = out.match(/^\('((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)', '((?:[^'\\]|\\.)*)'/);
  return m ? { name: m[1], vendor: m[2], version: m[3] } : undefined;
}

/** `gdbus call … Properties.Get …`: `(<true>,)`. */
export const parseGdbusBool = (out: string) => /<true>|\btrue\b/.test(out);

/** Which backend drives the notifications, from the D-Bus server name, else the desktop. */
export function detectBackend(server: string | undefined, desktop: string): BackendId | undefined {
  const s = (server ?? "").toLowerCase();
  if (s.includes("mako")) return "mako";
  if (s.includes("dunst")) return "dunst";
  if (s.includes("swaync") || s.includes("swaynotificationcenter")) return "swaync";
  if (s.includes("gnome-shell") || s === "gnome") return "gnome";
  if (s.includes("plasma") || s === "kde") return "kde";
  if (s.includes("xfce")) return "xfce";
  if (s.includes("cinnamon")) return "cinnamon";
  const d = desktop.toLowerCase();
  if (d.includes("gnome") || d.includes("unity") || d.includes("pantheon")) return "gnome";
  if (d.includes("kde")) return "kde";
  if (d.includes("xfce")) return "xfce";
  if (d.includes("cinnamon") || d.includes("x-cinnamon")) return "cinnamon";
  return undefined;
}

/** Unwraps the `{ "type": "s", "data": … }` envelopes of D-Bus JSON dumps (dunstctl, old makoctl). */
function unwrap(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(unwrap);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    if ("type" in o && "data" in o && Object.keys(o).length === 2) return unwrap(o.data);
    return Object.fromEntries(Object.entries(o).map(([k, x]) => [k, unwrap(x)]));
  }
  return v;
}

/** The list of notification records in a JSON dump, whatever its nesting. */
function records(json: string): Record<string, unknown>[] {
  let v = unwrap(JSON.parse(json));
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    v = o.data ?? o.notifications ?? o.history ?? [];
  }
  const flat = (x: unknown): Record<string, unknown>[] =>
    Array.isArray(x) ? x.flatMap(flat) : x && typeof x === "object" ? [x as Record<string, unknown>] : [];
  return flat(v);
}

const text = (v: unknown) => (v === undefined || v === null ? "" : String(v));

const URGENCY: Record<string, Notification["urgency"]> = {
  "0": "low",
  "1": "normal",
  "2": "critical",
  low: "low",
  normal: "normal",
  critical: "critical",
};
const urgency = (v: unknown) => URGENCY[text(v).toLowerCase()] ?? "normal";

/**
 * `dunstctl history`. Timestamps are microseconds of the monotonic clock: `bootTime` (ms since
 * the epoch, from `uptime -s`) turns them into dates.
 */
export function parseDunstHistory(json: string, bootTime?: number): Notification[] {
  return records(json).map((r) => {
    const ts = Number(r.timestamp);
    return {
      id: text(r.id),
      app: text(r.appname) || "Unknown app",
      summary: text(r.summary),
      body: text(r.body),
      urgency: urgency(r.urgency),
      category: text(r.category) || undefined,
      time: bootTime !== undefined && ts > 0 ? bootTime + ts / 1000 : undefined,
    };
  });
}

/** `makoctl history` as JSON: the D-Bus dump of mako < 1.9, or the plain objects of `-j` in 1.9+. */
export function parseMakoJson(json: string): Notification[] {
  return records(json).map((r) => ({
    id: text(r.id),
    app: text(r["app-name"] ?? r.app_name ?? r.appName) || "Unknown app",
    summary: text(r.summary),
    body: text(r.body),
    urgency: urgency(r.urgency),
    category: text(r.category) || undefined,
  }));
}

/**
 * `makoctl history` as text (mako 1.9+):
 * ```
 * Notification 12: Build finished
 *   App name: kitty
 *   Urgency: normal
 * ```
 */
export function parseMakoText(out: string): Notification[] {
  const list: Notification[] = [];
  for (const line of out.split("\n")) {
    const head = line.match(/^Notification (\d+): ?(.*)$/);
    if (head) {
      list.push({ id: head[1], app: "Unknown app", summary: head[2], body: "", urgency: "normal" });
      continue;
    }
    const cur = list.at(-1);
    const kv = line.match(/^\s+([\w ]+?):\s*(.*)$/);
    if (!cur || !kv) continue;
    const key = kv[1].toLowerCase();
    if (key === "app name") cur.app = kv[2];
    else if (key === "urgency") cur.urgency = urgency(kv[2]);
    else if (key === "category") cur.category = kv[2];
    else if (key === "body") cur.body = kv[2];
  }
  return list;
}

/** `makoctl history`, whichever format this mako prints. */
export function parseMakoHistory(out: string): Notification[] {
  const t = out.trim();
  if (!t) return [];
  if (t.startsWith("{") || t.startsWith("[")) return parseMakoJson(t);
  return parseMakoText(t);
}

/** `makoctl mode`: one active mode per line. */
export const parseMakoModes = (out: string) => out.split("\n").map((l) => l.trim()).filter(Boolean);

/** Notification bodies may carry a little markup (`<b>`, `<a href>`, entities): plain text. */
export function plainText(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** Escapes text for the markdown panel. */
export const escapeMarkdown = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, "\\$1");

/** "just now", "5 min ago", "3 h ago", "yesterday", or a date. */
export function ago(time: number, now = Date.now()): string {
  const s = Math.max(0, (now - time) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return "yesterday";
  return new Date(time).toLocaleDateString([], { day: "numeric", month: "short" });
}

/** `uptime -s`: `2026-10-28 08:12:03`, local time. */
export function parseBootTime(out: string): number | undefined {
  const m = out.trim().match(/^(\d{4})-(\d\d)-(\d\d) (\d\d):(\d\d):(\d\d)$/);
  if (!m) return undefined;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}
