// URLs, what `yt-dlp -J` says about a video or a playlist, the quality choices
// and their yt-dlp arguments, the background job's script and its progress.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// URLs

/** The first http(s) link in a text (a copied URL, or a message containing one). */
export function findUrl(text: string): string | undefined {
  const m = text.match(/https?:\/\/[^\s<>"'`]+/i);
  if (!m) return undefined;
  const url = m[0].replace(/[),.;:!?\]]+$/, "");
  try {
    const u = new URL(url);
    return u.hostname.includes(".") || u.hostname === "localhost" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** "https://www.youtube.com/watch?v=…" → "youtube.com". */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^(www|m|music|mobile)\./, "");
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// yt-dlp -J

export interface Format {
  id: string;
  ext: string;
  height?: number;
  fps?: number;
  vcodec?: string;
  acodec?: string;
  /** Bytes, exact or approximate. */
  size?: number;
  /** Kbit/s. */
  tbr?: number;
  abr?: number;
}

export interface Info {
  id: string;
  title: string;
  url: string;
  uploader?: string;
  /** Seconds. */
  duration?: number;
  thumbnail?: string;
  site: string;
  uploadDate?: string;
  views?: number;
  description?: string;
  live?: boolean;
  formats: Format[];
  /** A playlist or a channel: how many entries. */
  playlist?: { count: number; title: string };
}

// deno-lint-ignore no-explicit-any
type Raw = any;

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const codec = (v: unknown): string | undefined => {
  const s = str(v);
  return s && s !== "none" ? s : undefined;
};

/** The biggest JPEG thumbnail no wider than 1280 px (WebP previews don't show everywhere). */
export function pickThumbnail(info: Raw): string | undefined {
  const list: Raw[] = Array.isArray(info?.thumbnails) ? info.thumbnails : [];
  const jpgs = list
    .filter((t) => typeof t?.url === "string" && /\.jpe?g(\?|$)/i.test(t.url))
    .filter((t) => !t.width || t.width <= 1280)
    .sort((a, b) => (num(b.width) ?? num(b.preference) ?? 0) - (num(a.width) ?? num(a.preference) ?? 0));
  return jpgs[0]?.url ?? str(info?.thumbnail);
}

/** "20240131" → "2024-01-31". */
export function uploadDate(text?: string): string | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(text ?? "");
  return m ? `${m[1]}-${m[2]}-${m[3]}` : undefined;
}

export function parseInfo(json: string, requested: string): Info {
  let raw: Raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("yt-dlp's answer couldn't be read");
  }
  const isList = raw?._type === "playlist" || raw?._type === "multi_video";
  const entries: Raw[] = Array.isArray(raw?.entries) ? raw.entries : [];
  const formats: Format[] = (Array.isArray(raw?.formats) ? raw.formats : [])
    .filter((f: Raw) => typeof f?.format_id === "string" && !/^(sb|storyboard)/i.test(f.format_id))
    .filter((f: Raw) => f.protocol !== "mhtml")
    .map((f: Raw) => ({
      id: f.format_id,
      ext: String(f.ext ?? ""),
      height: num(f.height),
      fps: num(f.fps),
      vcodec: codec(f.vcodec),
      acodec: codec(f.acodec),
      size: num(f.filesize) ?? num(f.filesize_approx),
      tbr: num(f.tbr),
      abr: num(f.abr),
    }));
  // Single-format sites (no `formats`) still describe the one they have.
  if (!formats.length && !isList && (raw?.ext || raw?.url)) {
    formats.push({
      id: String(raw.format_id ?? "0"),
      ext: String(raw.ext ?? ""),
      height: num(raw.height),
      vcodec: codec(raw.vcodec) ?? (raw.vcodec === "none" ? undefined : raw.height ? "video" : undefined),
      acodec: codec(raw.acodec) ?? "audio",
      size: num(raw.filesize) ?? num(raw.filesize_approx),
    });
  }
  const url = str(raw?.webpage_url) ?? str(raw?.original_url) ?? requested;
  return {
    id: String(raw?.id ?? ""),
    title: str(raw?.title) ?? str(raw?.fulltitle) ?? siteName(url),
    url,
    uploader: str(raw?.uploader) ?? str(raw?.channel) ?? str(raw?.artist) ?? str(raw?.creator),
    duration: num(raw?.duration),
    thumbnail: pickThumbnail(raw) ?? (isList ? pickThumbnail(entries[0]) : undefined),
    site: str(raw?.extractor_key) ?? str(raw?.extractor) ?? siteName(url),
    uploadDate: uploadDate(raw?.upload_date),
    views: num(raw?.view_count),
    description: str(raw?.description),
    live: raw?.is_live === true || raw?.live_status === "is_live",
    formats,
    playlist: isList
      ? { count: num(raw?.playlist_count) ?? entries.length, title: str(raw?.title) ?? "Playlist" }
      : undefined,
  };
}

/** The useful line of yt-dlp's stderr, as a sentence. */
export function ytdlpError(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const error = lines.filter((l) => l.startsWith("ERROR:")).at(-1) ?? lines.at(-1) ?? "";
  const text = error.replace(/^ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*([\w-]+:\s*)?/, "").trim();
  if (/Unsupported URL/i.test(error)) return "yt-dlp doesn't know how to download from this page";
  if (/confirm you.re not a bot|Sign in to confirm/i.test(error)) {
    return "The site asks to sign in: set “Use cookies from” in Settings (firefox, chrome…)";
  }
  if (/Private video|members-only|This video is private/i.test(error)) {
    return "This video is private or for members: set “Use cookies from” in Settings to use your account";
  }
  if (/age|inappropriate/i.test(error) && /sign in|confirm/i.test(error)) {
    return "This video is age-restricted: set “Use cookies from” in Settings to use your account";
  }
  if (/Video unavailable|has been removed|does not exist|HTTP Error 404/i.test(error)) {
    return "This video is unavailable";
  }
  if (/Unable to download webpage|Failed to resolve|Name or service not known|timed out/i.test(error)) {
    return "The site can't be reached: check your connection";
  }
  if (/ffmpeg.*not (found|installed)|ffprobe.*not found/i.test(error)) {
    return "ffmpeg is needed for this: install it, or pick a lower quality";
  }
  return text.slice(0, 240) || "yt-dlp failed";
}

// ---------------------------------------------------------------------------
// Quality choices

export type Choice =
  | { kind: "video"; height?: number }
  | { kind: "audio"; format: "mp3" | "m4a" | "best" };

export interface Option {
  key: string;
  choice: Choice;
  title: string;
  subtitle: string;
  /** Estimated bytes. */
  size?: number;
}

export const HEIGHTS = [2160, 1440, 1080, 720, 480, 360];

export const resolutionName = (h: number) =>
  h >= 2160 ? "4K" : h >= 1440 ? "1440p" : h >= 1080 ? "1080p" : h >= 720 ? "720p" : `${h}p`;

/** Bytes of a format, from its size or its bitrate and the duration. */
export function formatSize(f: Format | undefined, duration?: number): number | undefined {
  if (!f) return undefined;
  if (f.size) return f.size;
  const kbps = f.tbr ?? f.abr;
  return kbps && duration ? Math.round((kbps * 1000 / 8) * duration) : undefined;
}

const bestBy = (list: Format[], score: (f: Format) => number) => [...list].sort((a, b) => score(b) - score(a))[0];

/** The video qualities on offer, then audio only. */
export function options(info: Info, hasFfmpeg = true): Option[] {
  const out: Option[] = [];
  const video = info.formats.filter((f) => f.vcodec && f.height);
  const audio = info.formats.filter((f) => f.acodec && !f.vcodec);
  const muxed = info.formats.filter((f) => f.vcodec && f.acodec);
  const bestAudio = bestBy(audio, (f) => (f.abr ?? f.tbr ?? 0) + (f.ext === "m4a" ? 1 : 0));
  const usable = hasFfmpeg ? video : muxed.filter((f) => f.height);
  const maxHeight = Math.max(0, ...usable.map((f) => f.height!));
  const sizeFor = (h?: number) => {
    const fits = usable.filter((f) => !h || f.height! <= h);
    const v = bestBy(fits, (f) => f.height! * 1000 + (f.tbr ?? 0) / 1000);
    if (!v) return undefined;
    const vs = formatSize(v, info.duration);
    if (v.acodec || !hasFfmpeg) return vs;
    const as = formatSize(bestAudio, info.duration);
    return vs && as ? vs + as : vs;
  };
  if (info.playlist) {
    out.push({
      key: "video",
      choice: { kind: "video", height: 1080 },
      title: info.playlist.count ? `All ${info.playlist.count} Videos` : "All Videos",
      subtitle: "Up to 1080p, MP4",
    });
    out.push({
      key: "mp3",
      choice: { kind: "audio", format: "mp3" },
      title: info.playlist.count ? `All ${info.playlist.count} as MP3` : "All as MP3",
      subtitle: hasFfmpeg ? "Audio only, best quality" : "Needs ffmpeg",
    });
    return out;
  }

  if (usable.length || !info.formats.length) {
    out.push({
      key: "best",
      choice: { kind: "video" },
      title: "Best Quality",
      subtitle: maxHeight ? `${resolutionName(maxHeight)}${hasFfmpeg ? "" : " (without ffmpeg)"}` : "Video",
      size: sizeFor(),
    });
    for (const [i, h] of HEIGHTS.entries()) {
      const below = HEIGHTS[i + 1] ?? 0;
      if (h >= maxHeight || !usable.some((f) => f.height! <= h && f.height! > below)) continue;
      out.push({
        key: `${h}`,
        choice: { kind: "video", height: h },
        title: resolutionName(h),
        subtitle: "Video",
        size: sizeFor(h),
      });
    }
  }
  if (audio.length || muxed.length || !info.formats.length) {
    const audioSize = formatSize(bestAudio, info.duration) ??
      (info.duration ? Math.round(info.duration * 320_000 / 8) : undefined);
    if (hasFfmpeg) {
      out.push({
        key: "mp3",
        choice: { kind: "audio", format: "mp3" },
        title: "Audio Only: MP3",
        subtitle: "Plays everywhere",
        size: audioSize,
      });
      out.push({
        key: "m4a",
        choice: { kind: "audio", format: "m4a" },
        title: "Audio Only: M4A",
        subtitle: "AAC, smaller, no re-encoding when available",
        size: formatSize(audio.find((f) => f.ext === "m4a"), info.duration) ?? audioSize,
      });
    } else if (audio.length) {
      out.push({
        key: "audio",
        choice: { kind: "audio", format: "best" },
        title: "Audio Only",
        subtitle: `As the site has it (${bestAudio?.ext || "original"}); install ffmpeg for MP3`,
        size: formatSize(bestAudio, info.duration),
      });
    }
  }
  return out;
}

/** The quality preference: "best", "1080", "720p", "mp3", "m4a" → a choice. */
export function parseQuality(text: unknown): Choice {
  const t = String(text ?? "").trim().toLowerCase();
  if (t === "mp3" || t === "m4a") return { kind: "audio", format: t };
  if (t === "audio") return { kind: "audio", format: "mp3" };
  if (t === "4k") return { kind: "video", height: 2160 };
  const h = Number(t.replace(/p$/, ""));
  if (Number.isInteger(h) && h >= 144 && h <= 4320) return { kind: "video", height: h };
  return { kind: "video" };
}

export function describeChoice(c: Choice): string {
  if (c.kind === "audio") return c.format === "best" ? "Audio" : c.format.toUpperCase();
  return c.height ? resolutionName(c.height) : "Best quality";
}

// ---------------------------------------------------------------------------
// The download

export interface DownloadPlan {
  url: string;
  choice: Choice;
  /** Where the file goes. */
  folder: string;
  /** The job's folder: progress log, status, written paths. */
  dir: string;
  playlist: boolean;
  /** Prefer H.264/AAC in MP4, which every player and editor opens. */
  compatible: boolean;
  hasFfmpeg: boolean;
  cookiesFrom?: string;
}

export const PROGRESS_TEMPLATE =
  "download:[bs] %(progress.status)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s %(progress.speed)s %(progress.eta)s %(info.playlist_index)s %(info.n_entries)s";

/** A browser name for --cookies-from-browser, or nothing. */
export function cookiesBrowser(text: unknown): string | undefined {
  const t = String(text ?? "").trim().toLowerCase();
  return /^(brave|chrome|chromium|edge|firefox|opera|safari|vivaldi|whale)([+:][\w.:/-]+)?$/.test(t) ? t : undefined;
}

export function ytdlpArgs(p: DownloadPlan): string[] {
  const name = p.playlist
    ? "%(playlist_title|Playlist).100B/%(playlist_index|0)03d - %(title).150B [%(id)s].%(ext)s"
    : "%(title).180B [%(id)s].%(ext)s";
  const args = [
    "--newline",
    "--progress",
    "--progress-template",
    PROGRESS_TEMPLATE,
    "--no-mtime",
    "--no-overwrites",
    "--continue",
    p.playlist ? "--yes-playlist" : "--no-playlist",
    "--print-to-file",
    "after_move:filepath",
    `${p.dir}/files`,
    "-P",
    p.folder,
    "-o",
    name,
  ];
  if (p.choice.kind === "audio") {
    if (p.choice.format === "best" || !p.hasFfmpeg) {
      args.push("-f", "ba/b");
    } else if (p.choice.format === "m4a") {
      args.push("-f", "ba[ext=m4a]/ba/b", "-x", "--audio-format", "m4a", "--embed-metadata");
    } else {
      args.push("-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--embed-metadata");
      args.push("--embed-thumbnail", "--convert-thumbnails", "jpg");
    }
  } else {
    const h = p.choice.height;
    if (!p.hasFfmpeg) {
      // Without ffmpeg, video and audio can't be merged: only files that have both.
      args.push("-f", h ? `b[height<=${h}]/b` : "b");
    } else {
      args.push("-f", "bv*+ba/b");
      const sort = [h ? `res:${h}` : "res", ...(p.compatible ? ["vcodec:h264", "acodec:aac"] : [])];
      args.push("-S", sort.join(","));
      args.push("--merge-output-format", "mp4");
    }
  }
  if (p.cookiesFrom) args.push("--cookies-from-browser", p.cookiesFrom);
  args.push("--", p.url);
  return args;
}

const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;
export const shellLine = (argv: string[]) => argv.map(q).join(" ");

/** The job: yt-dlp, its exit code in `status`, and a desktop notification. */
export function jobScript(args: string[], dir: string, title: string): string {
  const notify = (summary: string, body: string, icon: string) =>
    `command -v notify-send >/dev/null && notify-send -a Backslash -i ${icon} ${summary} ${body}`;
  return [
    shellLine(["yt-dlp", ...args]),
    "code=$?",
    `echo "$code" > ${q(`${dir}/status`)}`,
    `if [ "$code" -eq 0 ]; then ${notify(q("Download finished"), q(title), "folder-download")}; ` +
    `else msg=$(grep '^ERROR:' ${q(`${dir}/log`)} | tail -n 1 | cut -c 8-200); ` +
    `${notify(q("Download failed"), `"${title.replace(/["$`\\]/g, "\\$&")}: $msg"`, "dialog-error")}; fi`,
    "exit 0",
  ].join("; ");
}

export interface Progress {
  status: string;
  downloaded?: number;
  total?: number;
  speed?: number;
  eta?: number;
  /** Playlist entry being downloaded, and how many there are. */
  index?: number;
  count?: number;
  /** Which file of the video (video, then audio). */
  part: number;
  /** Merging, converting to MP3, embedding the thumbnail. */
  postprocessing?: string;
}

const val = (s?: string) => {
  if (!s || s === "NA" || s === "None") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

/** The last progress line of the log, and what yt-dlp does after downloading. */
export function parseProgress(log: string): Progress | undefined {
  const lines = log.split(/\r?\n/);
  let progress: Progress | undefined;
  let part = 0;
  let post: string | undefined;
  for (const line of lines) {
    if (line.startsWith("[download] Destination:")) {
      part++;
      post = undefined;
    } else if (line.startsWith("[bs] ")) {
      const [status, done, total, estimate, speed, eta, index, count] = line.slice(5).trim().split(/\s+/);
      progress = {
        status,
        downloaded: val(done),
        total: val(total) ?? val(estimate),
        speed: val(speed),
        eta: val(eta),
        index: val(index),
        count: val(count),
        part: Math.max(1, part),
      };
      post = undefined;
    } else if (/^\[Merger\]/.test(line)) post = "Merging video and audio";
    else if (/^\[ExtractAudio\]/.test(line)) post = "Converting the audio";
    else if (/^\[(EmbedThumbnail|Metadata|ThumbnailsConvertor)\]/.test(line)) post = "Adding the cover and tags";
    else if (/^\[VideoConvertor|^\[VideoRemuxer|^\[FixupM3u8/.test(line)) post = "Remuxing";
  }
  if (!progress && !post) return undefined;
  return { ...(progress ?? { status: "processing", part: Math.max(1, part) }), postprocessing: post };
}

/** 0 to 1 for the current file. */
export function fraction(p?: Progress): number {
  if (!p) return 0;
  if (p.postprocessing) return 1;
  if (!p.downloaded || !p.total) return p.status === "finished" ? 1 : 0;
  return Math.max(0, Math.min(1, p.downloaded / p.total));
}

/** "45 % · 3.2 MB/s · 1:12 left · part 2", "3/12 · 45 %", "Merging video and audio". */
export function progressText(p?: Progress): string {
  if (!p) return "Starting…";
  if (p.postprocessing) return p.count ? `${p.index ?? "?"}/${p.count} · ${p.postprocessing}` : p.postprocessing;
  const parts = [
    p.count ? `${p.index ?? "?"}/${p.count}` : "",
    p.total ? `${Math.round(fraction(p) * 100)} %` : p.downloaded ? formatBytes(p.downloaded) : "Starting…",
    p.speed ? `${formatBytes(p.speed)}/s` : "",
    p.eta !== undefined && p.eta > 0 ? `${formatDuration(p.eta)} left` : "",
    !p.count && p.part > 1 ? "audio" : "",
  ];
  return parts.filter(Boolean).join(" · ");
}

/** The useful end of yt-dlp's log. */
export function lastError(log: string): string | undefined {
  if (!/^ERROR:/m.test(log)) return undefined;
  return ytdlpError(log);
}

/** The paths yt-dlp wrote (one per line), without duplicates. */
export function parseFiles(text: string): string[] {
  return [...new Set(text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("/")))];
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1024) return `${Math.round(n)} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Seconds → "4:05" or "1:02:09". */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatCount(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h`;
  return `${Math.floor(s / 86400)} d`;
}

export const basename = (p: string) => p.split("/").pop() ?? p;
export const dirname = (p: string) => p.split("/").slice(0, -1).join("/") || "/";
export const fileUri = (path: string) => `file://${path.split("/").map(encodeURIComponent).join("/")}`;

/** "~/Videos" → "/home/me/Videos". */
export const expandHome = (p: string, home: string) => p.trim().replace(/^~(?=\/|$)/, home).replace(/\/+$/, "") || "/";
export const tilde = (p: string, home: string) => (home && p.startsWith(home) ? `~${p.slice(home.length)}` : p);

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

/** yt-dlp changes every few weeks to keep up with sites: distribution packages are often too old. */
export function installMarkdown(missing: { ytdlp: boolean; ffmpeg: boolean }, family?: Family): string {
  const lines: string[] = [];
  if (missing.ytdlp) {
    lines.push(
      "**yt-dlp** downloads the videos. The most up-to-date way:",
      "",
      "`pipx install yt-dlp` (then `pipx upgrade yt-dlp` now and then)",
      "",
      "or from your distribution, which can lag behind sites:",
      "",
      `\`${
        {
          arch: "sudo pacman -S yt-dlp",
          debian: "sudo apt install yt-dlp",
          fedora: "sudo dnf install yt-dlp",
          suse: "sudo zypper install yt-dlp",
        }[family ?? "debian"]
      }\``,
    );
  }
  if (missing.ffmpeg) {
    if (lines.length) lines.push("");
    lines.push(
      "**ffmpeg** joins the best video with its audio and makes MP3s. Without it, only files that already have both are offered (often 720p at most).",
      "",
      `\`${
        {
          arch: "sudo pacman -S ffmpeg",
          debian: "sudo apt install ffmpeg",
          fedora: "sudo dnf install ffmpeg (from RPM Fusion)",
          suse: "sudo zypper install ffmpeg (from Packman)",
        }[family ?? "debian"]
      }\``,
    );
  }
  return lines.join("\n");
}
