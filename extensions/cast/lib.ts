// What catt and go2tv print (devices, status), what to cast (a link, a
// YouTube video, a copied file) and the command lines. Pure, tested in
// lib_test.ts.

// ---------------------------------------------------------------------------
// Devices

export interface Device {
  kind: "chromecast" | "dlna";
  name: string;
  /** Chromecast: its address, faster than its name for catt -d. */
  ip?: string;
  /** DLNA: the renderer's description URL, for go2tv -t. */
  url?: string;
  model?: string;
}

/** A stable id for a device across scans. */
export const deviceId = (d: Device) => `${d.kind}:${d.kind === "dlna" ? d.url ?? d.name : d.name}`;

// deno-lint-ignore no-explicit-any
type Raw = any;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * `catt scan`: "192.168.1.20 - Living Room TV - Google Inc. Chromecast Ultra"
 * per line, after a "Scanning Chromecasts..." line; or `catt scan -j`, a JSON
 * object of devices keyed by name.
 */
export function parseScan(text: string): Device[] {
  const t = text.trim();
  const json = t.startsWith("{") || t.startsWith("[") ? safeJson(t) : undefined;
  if (json !== undefined) {
    const entries: [string, Raw][] = Array.isArray(json)
      ? json.map((d: Raw) => [String(d?.name ?? ""), d])
      : Object.entries(json ?? {});
    return dedupe(entries.flatMap(([key, d]) => {
      const name = str(d?.name) ?? str(d?.friendly_name) ?? str(key);
      if (!name) return [];
      const model = [str(d?.manufacturer), str(d?.model_name)].filter(Boolean).join(" ") || undefined;
      return [{ kind: "chromecast" as const, name, ip: str(d?.ip) ?? str(d?.host), model }];
    }));
  }
  const out: Device[] = [];
  for (const raw of t.split("\n")) {
    const line = raw.trim();
    const m = /^([\d.]+|[\da-f:]+)\s+-\s+(.+?)(?:\s+-\s+(.+))?$/i.exec(line);
    if (!m || !/[.:]/.test(m[1])) continue;
    out.push({ kind: "chromecast", ip: m[1], name: m[2].trim(), model: m[3]?.trim() || undefined });
  }
  return dedupe(out);
}

function safeJson(text: string): Raw {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function dedupe(list: Device[]): Device[] {
  const seen = new Set<string>();
  return list.filter((d) => (seen.has(deviceId(d)) ? false : (seen.add(deviceId(d)), true)));
}

/**
 * `go2tv -l`: blocks of "Device 1", "--------", "Model: …", "URL: …".
 */
export function parseGo2tv(text: string): Device[] {
  const out: Device[] = [];
  let model: string | undefined;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m = /^(Model|URL)\s*:\s*(.+)$/i.exec(line);
    if (!m) continue;
    if (m[1].toLowerCase() === "model") model = m[2].trim();
    else if (/^https?:\/\//.test(m[2].trim())) {
      out.push({ kind: "dlna", name: model ?? hostOf(m[2].trim()), url: m[2].trim(), model: "DLNA" });
      model = undefined;
    }
  }
  return dedupe(out);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Status

export interface Status {
  title?: string;
  state?: "PLAYING" | "PAUSED" | "BUFFERING" | "IDLE" | string;
  /** Seconds. */
  position?: number;
  duration?: number;
  /** 0 to 100. */
  volume?: number;
  muted?: boolean;
  app?: string;
  idle: boolean;
}

/** "0:01:23" or "1:23" or "83.5" → seconds. */
export function parseClock(text: string): number | undefined {
  const t = text.trim();
  if (/^\d+(\.\d+)?$/.test(t)) return Number(t);
  const parts = t.split(":").map(Number);
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !Number.isFinite(p))) return undefined;
  return parts.reduce((s, p) => s * 60 + p, 0);
}

/**
 * `catt status` ("Title: …", "Time: 0:01:23 / 0:03:33 (39%)", "State: PLAYING",
 * "Volume: 50", "Volume muted: False") or `catt info` (snake_case keys).
 */
export function parseStatus(text: string): Status {
  const s: Status = { idle: false };
  const values = new Map<string, string>();
  for (const raw of text.split("\n")) {
    const m = /^([A-Za-z][\w ]*?)\s*:\s*(.*)$/.exec(raw.trim());
    if (m) values.set(m[1].toLowerCase().replace(/\s+/g, "_"), m[2].trim());
  }
  const get = (...keys: string[]) => keys.map((k) => values.get(k)).find((v) => v !== undefined && v !== "None");
  s.title = get("title", "display_name");
  const time = get("time");
  if (time) {
    const [pos, rest] = time.split("/");
    s.position = parseClock(pos);
    if (rest) s.duration = parseClock(rest.replace(/\(.*\)/, ""));
  }
  s.position ??= num(get("current_time"));
  s.duration ??= num(get("duration"));
  s.state = (get("state", "player_state") ?? "").toUpperCase() || undefined;
  const volume = get("volume");
  if (volume !== undefined) s.volume = num(volume);
  else {
    const level = num(get("volume_level"));
    if (level !== undefined) s.volume = Math.round(level * 100);
  }
  const muted = get("volume_muted");
  if (muted !== undefined) s.muted = /^true$/i.test(muted);
  s.app = get("display_name", "app_display_name");
  if (s.app && s.title === s.app) s.title = undefined;
  s.idle = /nothing is currently playing|idle/i.test(text) && !s.title || s.state === "IDLE" ||
    s.state === "UNKNOWN";
  return s;
}

const num = (v?: string) => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** "Playing · 1:23 / 3:33", "Paused", "Idle". */
export function statusText(s?: Status): string {
  if (!s) return "";
  if (s.idle) return s.app && s.app !== "Backdrop" ? `Idle · ${s.app}` : "Idle";
  const state = s.state === "PLAYING"
    ? "Playing"
    : s.state === "PAUSED"
    ? "Paused"
    : s.state === "BUFFERING"
    ? "Loading"
    : s.state
    ? cap(s.state)
    : "On";
  const time = s.position !== undefined
    ? s.duration ? `${formatTime(s.position)} / ${formatTime(s.duration)}` : formatTime(s.position)
    : "";
  return [state, time].filter(Boolean).join(" · ");
}

const cap = (s: string) => s[0] + s.slice(1).toLowerCase();

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** The useful line of catt's error output. */
export function cattError(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const line = lines.findLast((l) => /^Error:/i.test(l)) ?? lines.at(-1) ?? "";
  const msg = line.replace(/^Error:\s*/i, "").replace(/^.*exited with \d+:\s*/, "");
  if (/No devices found/i.test(msg)) return "No Chromecast found on your network";
  if (/Specified device not found|Device not found/i.test(msg)) return "The device isn't answering: is it on?";
  if (/Nothing is currently playing/i.test(msg)) return "Nothing is playing on this device";
  if (/Remote resource not found|Unsupported URL|yt-dlp|youtube_dl|extract/i.test(msg)) {
    return "This link can't be cast: catt (yt-dlp) found no video in it";
  }
  if (/Local file not found/i.test(msg)) return "The file is gone";
  return msg.slice(0, 200) || "catt failed";
}

// ---------------------------------------------------------------------------
// What to cast

export type Media =
  | { kind: "url"; url: string; youtube: boolean; direct: boolean }
  | { kind: "file"; path: string; type: "video" | "audio" | "image" };

export const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|mpe?g|ts|m2ts|3gp|ogv)$/i;
export const AUDIO = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav|wma|alac|aiff?)$/i;
export const IMAGE = /\.(jpe?g|png|gif|webp|bmp)$/i;

export function isYoutube(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^(www|m|music)\./, "");
    return h === "youtube.com" || h === "youtu.be" || h === "youtube-nocookie.com";
  } catch {
    return false;
  }
}

/** The first http(s) link in a text. */
export function findUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!m) return undefined;
  const url = m[0].replace(/[),.;:!?\]]+$/, "");
  try {
    return new URL(url).toString();
  } catch {
    return undefined;
  }
}

export function urlMedia(url: string): Media {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    // Kept as is.
  }
  return {
    kind: "url",
    url,
    youtube: isYoutube(url),
    direct: VIDEO.test(path) || AUDIO.test(path) || IMAGE.test(path),
  };
}

export function fileMedia(path: string): Media | undefined {
  if (VIDEO.test(path)) return { kind: "file", path, type: "video" };
  if (AUDIO.test(path)) return { kind: "file", path, type: "audio" };
  if (IMAGE.test(path)) return { kind: "file", path, type: "image" };
  return undefined;
}

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line), GNOME's x-special/gnome-copied-files ("copy" then URIs), or plain
 * absolute paths.
 */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue;
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && line.startsWith("~/")) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

export const basename = (p: string) => p.split("/").pop() ?? p;

/** "Movie.mkv" → the subtitles next to it: "Movie.srt", "Movie.en.srt", "Movie.vtt". */
export function subtitleFor(path: string, siblings: string[]): string | undefined {
  const dir = path.split("/").slice(0, -1).join("/");
  const stem = basename(path).replace(/\.[^.]+$/, "");
  const found = siblings
    .filter((n) => n.startsWith(stem) && /\.(srt|vtt)$/i.test(n))
    .sort((a, b) => a.length - b.length);
  return found[0] ? `${dir}/${found[0]}` : undefined;
}

/** What the row says about the media. */
export function describeMedia(m: Media): { title: string; subtitle: string } {
  if (m.kind === "file") {
    return { title: basename(m.path), subtitle: `Copied ${m.type === "image" ? "picture" : m.type}` };
  }
  let host = m.url;
  try {
    host = new URL(m.url).hostname.replace(/^www\./, "");
  } catch {
    // Kept as is.
  }
  return {
    title: m.url.replace(/^https?:\/\/(www\.)?/, "").slice(0, 90),
    subtitle: m.youtube ? "YouTube video" : `Link · ${host}`,
  };
}

// ---------------------------------------------------------------------------
// Command lines

/** catt -d accepts a name or an address; the address skips discovery. */
export const cattDevice = (d: Device) => d.ip ?? d.name;

export function castArgs(d: Device, m: Media, options: { subtitles?: string; site?: boolean } = {}): string[] {
  const target = m.kind === "file" ? m.path : m.url;
  if (options.site && m.kind === "url") return ["-d", cattDevice(d), "cast_site", target];
  const args = ["-d", cattDevice(d), "cast"];
  if (options.subtitles) args.push("-s", options.subtitles);
  args.push(target);
  return args;
}

export function go2tvArgs(d: Device, m: Media, subtitles?: string): string[] {
  const args = ["-t", d.url ?? ""];
  if (m.kind === "file") {
    args.push("-v", m.path);
    if (subtitles) args.push("-s", subtitles);
  } else {
    args.push("-u", m.url);
  }
  return args;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(q).join(" ");

/** go2tv draws a terminal interface: `script` gives it one inside the background unit. */
export function go2tvScript(args: string[]): string {
  const line = shellLine(["go2tv", ...args]);
  return `export TERM=xterm-256color; if command -v script >/dev/null; then exec script -qfec ${
    q(line)
  } /dev/null; else exec ${line}; fi`;
}

export const VOLUMES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
