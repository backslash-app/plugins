// Picking files (clipboard URIs), what ffprobe reports, times, the ffmpeg
// command lines of each preset, target-size bitrates and ffmpeg's progress.
// Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Files from the clipboard

/**
 * Paths from what a file manager copies: text/uri-list (file:///…, one per
 * line, # comments), GNOME's x-special/gnome-copied-files ("copy" then URIs),
 * or plain absolute paths.
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
        if (url.host && url.host !== "localhost") continue; // another machine
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

export const VIDEO = /\.(mp4|m4v|mkv|webm|mov|avi|wmv|flv|mpe?g|ts|mts|m2ts|3gp|ogv|gif)$/i;
export const AUDIO = /\.(mp3|m4a|aac|opus|ogg|oga|flac|wav|wma|alac|aiff?|ac3|mka|amr)$/i;
export const isMedia = (p: string) => VIDEO.test(p) || AUDIO.test(p);

const trim = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => trim(p).split("/").pop() ?? p;
export const dirname = (p: string) => trim(p).split("/").slice(0, -1).join("/") || "/";
export const extname = (p: string) => basename(p).match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? "";
export const stem = (p: string) => basename(p).replace(/\.[^.]+$/, "");

/** `dir/name.ext`, or `dir/name-2.ext`, `-3`… : never an existing path. */
export function freePath(dir: string, name: string, ext: string, exists: (p: string) => boolean): string {
  const base = `${dir === "/" ? "" : dir}/${name}`;
  let candidate = `${base}.${ext}`;
  for (let i = 2; exists(candidate); i++) candidate = `${base}-${i}.${ext}`;
  return candidate;
}

// ---------------------------------------------------------------------------
// What ffprobe says

export interface VideoStream {
  codec: string;
  width: number;
  height: number;
  fps?: number;
  bitrate?: number;
  pixFmt?: string;
}

export interface AudioStream {
  codec: string;
  channels?: number;
  layout?: string;
  sampleRate?: number;
  bitrate?: number;
  language?: string;
}

export interface MediaInfo {
  /** Seconds. */
  duration?: number;
  /** Bits per second, all streams. */
  bitrate?: number;
  container?: string;
  title?: string;
  artist?: string;
  video?: VideoStream;
  audio?: AudioStream;
  audioTracks: number;
  subtitles: number;
  /** Album art in an audio file. */
  cover: boolean;
}

/** "30000/1001" → 29.97 */
function rate(text: string | undefined): number | undefined {
  if (!text) return undefined;
  const [a, b] = text.split("/").map(Number);
  const v = b ? a / b : a;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : undefined;
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** `ffprobe -v error -print_format json -show_format -show_streams`. */
export function parseProbe(json: string): MediaInfo {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error("ffprobe returned something unexpected");
  }
  const streams: any[] = Array.isArray(data?.streams) ? data.streams : [];
  const format = data?.format ?? {};
  const tags = (o: any) => {
    const t: Record<string, string> = {};
    for (const [k, v] of Object.entries(o?.tags ?? {})) t[k.toLowerCase()] = String(v);
    return t;
  };
  const videos = streams.filter((s) => s.codec_type === "video" && !s.disposition?.attached_pic);
  const audios = streams.filter((s) => s.codec_type === "audio");
  const info: MediaInfo = {
    duration: num(format.duration) ?? num(videos[0]?.duration) ?? num(audios[0]?.duration),
    bitrate: num(format.bit_rate),
    container: format.format_long_name ?? format.format_name,
    audioTracks: audios.length,
    subtitles: streams.filter((s) => s.codec_type === "subtitle").length,
    cover: streams.some((s) => s.codec_type === "video" && s.disposition?.attached_pic),
  };
  const ft = tags(format);
  if (ft.title) info.title = ft.title;
  if (ft.artist) info.artist = ft.artist;
  const v = videos[0];
  if (v) {
    info.video = {
      codec: v.codec_name ?? "unknown",
      width: Number(v.width) || 0,
      height: Number(v.height) || 0,
      fps: rate(v.avg_frame_rate) ?? rate(v.r_frame_rate),
      bitrate: num(v.bit_rate),
      pixFmt: v.pix_fmt,
    };
    // Phones record portrait videos as landscape with a rotation.
    const rotation = Number(v.tags?.rotate ?? v.side_data_list?.find((d: any) => d.rotation !== undefined)?.rotation);
    if (Math.abs(rotation) === 90 || Math.abs(rotation) === 270) {
      [info.video.width, info.video.height] = [info.video.height, info.video.width];
    }
  }
  const a = audios[0];
  if (a) {
    info.audio = {
      codec: a.codec_name ?? "unknown",
      channels: num(a.channels),
      layout: a.channel_layout,
      sampleRate: num(a.sample_rate),
      bitrate: num(a.bit_rate),
      language: tags(a).language && tags(a).language !== "und" ? tags(a).language : undefined,
    };
  }
  return info;
}

const CODECS: Record<string, string> = {
  h264: "H.264",
  hevc: "H.265 (HEVC)",
  av1: "AV1",
  vp9: "VP9",
  vp8: "VP8",
  mpeg4: "MPEG-4",
  mpeg2video: "MPEG-2",
  prores: "ProRes",
  gif: "GIF",
  aac: "AAC",
  mp3: "MP3",
  opus: "Opus",
  vorbis: "Vorbis",
  flac: "FLAC",
  alac: "ALAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  truehd: "TrueHD",
};

export const codecName = (codec: string) =>
  CODECS[codec] ?? (codec.startsWith("pcm_") ? "PCM" : codec.toUpperCase().replace(/_/g, " "));

/** "1080p", "4K", "720p" from the frame size. */
export function resolutionName(width: number, height: number): string {
  const short = Math.min(width, height);
  const long = Math.max(width, height);
  if (long >= 3800 || short >= 2100) return "4K";
  if (long >= 2500 || short >= 1400) return "1440p";
  if (long >= 1900 || short >= 1000) return "1080p";
  if (long >= 1260 || short >= 700) return "720p";
  if (short >= 470) return "480p";
  return `${short}p`;
}

export const channelsName = (n?: number, layout?: string) =>
  n === 1
    ? "mono"
    : n === 2
    ? "stereo"
    : layout && /\d\.\d/.test(layout)
    ? layout.replace(/\(.*\)/, "")
    : n
    ? `${n} channels`
    : "";

// ---------------------------------------------------------------------------
// Times

/** "83", "1:23", "01:01:23.5", "1h2m3s" → seconds. */
export function parseTime(text: string): number {
  const t = text.trim().toLowerCase().replace(",", ".");
  if (!t) throw new Error("Type a time, like 1:23 or 83.5");
  let m = t.match(/^(\d+(?:\.\d+)?)s?$/);
  if (m) return Number(m[1]);
  m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
  if (m) {
    const [h, min, s] = [Number(m[1] ?? 0), Number(m[2]), Number(m[3])];
    if (s >= 60 || (m[1] !== undefined && min >= 60)) throw new Error(`${text.trim()} isn't a time`);
    return h * 3600 + min * 60 + s;
  }
  m = t.match(/^(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:(\d+(?:\.\d+)?)s)?$/);
  if (m && (m[1] || m[2] || m[3])) return Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  throw new Error(`${text.trim()} isn't a time: use 1:23, 01:02:03 or 83.5`);
}

/** 83.5 → "1:23", 3725 → "1:02:05" */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Seconds for ffmpeg's -ss / -t, to the millisecond. */
export const ffTime = (seconds: number) => String(Math.round(seconds * 1000) / 1000);

/** Start and end typed in the trim form, checked against the length. */
export function trimRange(startText: string, endText: string, duration?: number): { start: number; end: number } {
  const start = startText.trim() ? parseTime(startText) : 0;
  let end = endText.trim() ? parseTime(endText) : duration;
  if (end === undefined) throw new Error("Type where it ends");
  if (duration !== undefined && end > duration + 0.5) {
    throw new Error(`It is only ${formatDuration(duration)} long`);
  }
  if (duration !== undefined) end = Math.min(end, duration);
  if (end <= start) throw new Error("The end must come after the start");
  return { start, end };
}

// ---------------------------------------------------------------------------
// Presets

export type AudioFormat = "mp3" | "opus" | "flac" | "m4a";

export type Operation =
  | { kind: "mp4" }
  | { kind: "webm" }
  | { kind: "audio"; format: AudioFormat }
  | { kind: "extract" }
  | { kind: "gif"; width: number; fps: number }
  | { kind: "trim"; start: number; end: number; exact: boolean }
  | { kind: "target"; mb: number }
  | { kind: "resize"; height: 720 | 1080 }
  | { kind: "mute" };

export const TARGET_PRESETS = [8, 25, 50];
export const GIF_PRESETS = [
  { width: 480, fps: 12, title: "480 px, 12 fps" },
  { width: 320, fps: 10, title: "320 px, 10 fps (small)" },
  { width: 720, fps: 15, title: "720 px, 15 fps (sharp)" },
];

/** Where the copied audio of "Extract Audio" fits without re-encoding it. */
export function audioExtension(codec: string | undefined): string {
  if (!codec) return "mka";
  if (codec.startsWith("pcm_")) return "wav";
  return ({ aac: "m4a", alac: "m4a", mp3: "mp3", opus: "opus", vorbis: "ogg", flac: "flac", ac3: "ac3", eac3: "eac3" })[
    codec
  ] ?? "mka";
}

/** The suffix and extension of an operation's output. */
export function outputFor(op: Operation, input: string, info?: MediaInfo): { suffix: string; ext: string } {
  const ext = extname(input);
  switch (op.kind) {
    case "mp4":
      return { suffix: ext === "mp4" ? "-h264" : "", ext: "mp4" };
    case "webm":
      return { suffix: ext === "webm" ? "-vp9" : "", ext: "webm" };
    case "audio":
      return { suffix: ext === op.format ? "-converted" : "", ext: op.format };
    case "extract": {
      const e = audioExtension(info?.audio?.codec);
      return { suffix: e === ext ? "-audio" : "", ext: e };
    }
    case "gif":
      return { suffix: ext === "gif" ? `-${op.width}px` : "", ext: "gif" };
    case "trim":
      return {
        suffix: `-${formatDuration(op.start).replace(/:/g, "")}-${formatDuration(op.end).replace(/:/g, "")}`,
        ext,
      };
    case "target":
      return { suffix: `-${op.mb}mb`, ext: "mp4" };
    case "resize":
      return { suffix: `-${op.height}p`, ext: "mp4" };
    case "mute":
      return { suffix: "-muted", ext };
  }
}

export function describe(op: Operation): string {
  switch (op.kind) {
    case "mp4":
      return "Converting to MP4";
    case "webm":
      return "Converting to WebM";
    case "audio":
      return `Converting to ${op.format.toUpperCase()}`;
    case "extract":
      return "Extracting the audio";
    case "gif":
      return `Making a GIF (${op.width} px)`;
    case "trim":
      return `Trimming ${formatDuration(op.start)}–${formatDuration(op.end)}`;
    case "target":
      return `Compressing to ${op.mb} MB`;
    case "resize":
      return `Resizing to ${op.height}p`;
    case "mute":
      return "Removing the audio";
  }
}

/** Bitrates that make a video of `duration` seconds fit in `mb` megabytes (MiB). */
export function targetBitrate(
  mb: number,
  duration: number,
  o: { audio?: boolean; height?: number } = {},
): { videoKbps: number; audioKbps: number; height?: number } {
  if (!(duration > 0)) throw new Error("The length of the video is unknown");
  if (!(mb > 0)) throw new Error("Type a size in MB");
  // 1 MiB = 8388.608 kbit; keep 4 % for the container and the encoder's overshoot.
  const budget = (mb * 8388.608 * 0.96) / duration;
  const audioKbps = o.audio ? (budget > 1200 ? 128 : budget > 500 ? 96 : 64) : 0;
  const videoKbps = Math.floor(budget - audioKbps);
  if (videoKbps < 60) {
    throw new Error(`${mb} MB is too small for ${formatDuration(duration)}: pick a larger size or trim it first`);
  }
  // Fewer pixels look better than a starved bitrate.
  const h = o.height ?? 0;
  const height = videoKbps < 700 && h > 480
    ? 480
    : videoKbps < 1800 && h > 720
    ? 720
    : videoKbps < 4500 && h > 1080
    ? 1080
    : undefined;
  return { videoKbps, audioKbps, height };
}

/** One ffmpeg run of a job; `weight` is its share of the progress bar. */
export interface Step {
  args: string[];
  weight: number;
}

const H264 = ["-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p"];
const AAC = ["-c:a", "aac", "-b:a", "160k"];
const FASTSTART = ["-movflags", "+faststart"];

/**
 * The ffmpeg runs of an operation. The final one writes `output` with -n
 * (never overwrite); temporary files (two-pass logs, the GIF palette) go in
 * `tmp`, a folder of the job.
 */
export function plan(op: Operation, input: string, output: string, info: MediaInfo | undefined, tmp: string): Step[] {
  const i = ["-i", input];
  const audio = (info?.audioTracks ?? 1) > 0;
  switch (op.kind) {
    case "mp4":
      return [{
        args: ["-n", ...i, "-map", "0:v:0", "-map", "0:a:0?", ...H264, ...AAC, ...FASTSTART, output],
        weight: 1,
      }];
    case "webm":
      return [{
        args: [
          "-n",
          ...i,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-c:v",
          "libvpx-vp9",
          "-crf",
          "32",
          "-b:v",
          "0",
          "-row-mt",
          "1",
          "-c:a",
          "libopus",
          "-b:a",
          "128k",
          output,
        ],
        weight: 1,
      }];
    case "audio": {
      const codec = {
        mp3: ["-c:a", "libmp3lame", "-q:a", "2"],
        opus: ["-c:a", "libopus", "-b:a", "128k"],
        flac: ["-c:a", "flac"],
        m4a: ["-c:a", "aac", "-b:a", "192k"],
      }[op.format];
      return [{ args: ["-n", ...i, "-vn", "-map", "0:a:0", ...codec, output], weight: 1 }];
    }
    case "extract":
      return [{ args: ["-n", ...i, "-vn", "-map", "0:a:0", "-c:a", "copy", output], weight: 1 }];
    case "gif": {
      // Two passes: the best 256 colors of the whole clip, then the frames with that palette.
      const palette = `${tmp}/palette.png`;
      const filters = `fps=${op.fps},scale='min(${op.width},iw)':-1:flags=lanczos`;
      return [
        { args: ["-y", ...i, "-vf", `${filters},palettegen=stats_mode=diff`, "-frames:v", "1", palette], weight: 0.3 },
        {
          args: [
            "-n",
            ...i,
            "-i",
            palette,
            "-lavfi",
            `${filters}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
            "-loop",
            "0",
            output,
          ],
          weight: 0.7,
        },
      ];
    }
    case "trim": {
      const cut = ["-ss", ffTime(op.start), ...i, "-t", ffTime(op.end - op.start)];
      // Fast: copies the streams, cutting at the nearest keyframes. Exact: re-encodes with the defaults of the format.
      return [{
        args: op.exact
          ? ["-n", ...cut, "-map", "0:v:0?", "-map", "0:a?", output]
          : ["-n", ...cut, "-map", "0", "-c", "copy", "-avoid_negative_ts", "make_zero", output],
        weight: 1,
      }];
    }
    case "target": {
      const b = targetBitrate(op.mb, info?.duration ?? 0, { audio, height: info?.video?.height });
      const scale = b.height ? ["-vf", `scale=-2:${b.height}`] : [];
      const video = ["-c:v", "libx264", "-preset", "medium", "-b:v", `${b.videoKbps}k`, "-pix_fmt", "yuv420p"];
      const log = ["-passlogfile", `${tmp}/pass`];
      return [
        {
          args: [
            "-y",
            ...i,
            "-map",
            "0:v:0",
            ...scale,
            ...video,
            "-pass",
            "1",
            ...log,
            "-an",
            "-f",
            "null",
            "/dev/null",
          ],
          weight: 0.4,
        },
        {
          args: [
            "-n",
            ...i,
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            ...scale,
            ...video,
            "-pass",
            "2",
            ...log,
            ...(audio ? ["-c:a", "aac", "-b:a", `${b.audioKbps}k`] : []),
            ...FASTSTART,
            output,
          ],
          weight: 0.6,
        },
      ];
    }
    case "resize":
      return [{
        args: [
          "-n",
          ...i,
          "-map",
          "0:v:0",
          "-map",
          "0:a:0?",
          "-vf",
          `scale=-2:${op.height}`,
          ...H264,
          ...AAC,
          ...FASTSTART,
          output,
        ],
        weight: 1,
      }];
    case "mute":
      return [{ args: ["-n", ...i, "-map", "0", "-map", "-0:a", "-c", "copy", output], weight: 1 }];
  }
}

/** Why an operation doesn't apply to a file, if it doesn't. */
export function unavailable(op: Operation, info?: MediaInfo): string | undefined {
  const video = !!info?.video;
  const audio = (info?.audioTracks ?? 0) > 0;
  if (!info) return undefined;
  switch (op.kind) {
    case "mp4":
    case "webm":
    case "gif":
    case "mute":
      if (!video) return "There is no video in it";
      if (op.kind === "mute" && !audio) return "There is no audio in it";
      return undefined;
    case "audio":
    case "extract":
      return audio ? undefined : "There is no audio in it";
    case "target":
      if (!video) return "There is no video in it";
      return info.duration ? undefined : "Its length is unknown";
    case "resize":
      if (!video) return "There is no video in it";
      return info.video!.height <= op.height ? `It is already ${info.video!.height}p or smaller` : undefined;
    case "trim":
      return undefined;
  }
}

/** How long the output lasts, to turn ffmpeg's out_time into a fraction. */
export function outputDuration(op: Operation, info?: MediaInfo): number | undefined {
  if (op.kind === "trim") return op.end - op.start;
  return info?.duration;
}

// ---------------------------------------------------------------------------
// Progress

export interface Progress {
  /** Seconds of output written. */
  time: number;
  done: boolean;
  speed?: number;
  size?: number;
}

/** The last block of `ffmpeg -progress file`: key=value lines ending with progress=continue|end. */
export function parseProgress(text: string): Progress | undefined {
  const blocks = text.split(/^progress=(?:continue|end)\s*$/m);
  const ended = /^progress=end\s*$/m.test(text);
  const last = blocks.length > 1 ? blocks[blocks.length - 2] : undefined;
  if (last === undefined) return undefined;
  const kv: Record<string, string> = {};
  for (const line of last.split("\n")) {
    const at = line.indexOf("=");
    if (at > 0) kv[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  // out_time_ms is in microseconds too (an old ffmpeg naming mistake).
  const us = Number(kv.out_time_us ?? kv.out_time_ms);
  const speed = Number(String(kv.speed ?? "").replace(/x$/, ""));
  return {
    time: Number.isFinite(us) && us > 0 ? us / 1e6 : 0,
    done: ended,
    speed: Number.isFinite(speed) && speed > 0 ? speed : undefined,
    size: Number(kv.total_size) || undefined,
  };
}

/** The share of the job done, from each step's progress and weight. */
export function jobFraction(weights: number[], progress: (Progress | undefined)[], duration?: number): number {
  const total = weights.reduce((s, w) => s + w, 0) || 1;
  let done = 0;
  weights.forEach((w, n) => {
    const p = progress[n];
    if (!p) return;
    const f = p.done ? 1 : duration ? Math.min(1, p.time / duration) : 0;
    done += w * f;
  });
  return Math.max(0, Math.min(1, done / total));
}

/** Time left, from the fraction done and the time spent. */
export function eta(fraction: number, elapsedMs: number): string | undefined {
  if (fraction < 0.02 || fraction >= 1) return undefined;
  const left = (elapsedMs / fraction - elapsedMs) / 1000;
  return left < 60
    ? "less than a minute left"
    : `about ${formatDuration(left).replace(/^(\d+):(\d\d)$/, "$1 min")} left`;
}

const quote = (arg: string) => /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** A command line as a shell would read it back. */
export const shellLine = (argv: string[]) => argv.map(quote).join(" ");

/**
 * The script of a background job: each step with its own progress file, the
 * exit code written to `status`, and the unfinished output removed on failure.
 */
export function jobScript(steps: Step[], dir: string, output: string): string {
  const runs = steps.map((s, n) =>
    shellLine([
      "ffmpeg",
      "-hide_banner",
      "-nostdin",
      "-loglevel",
      "error",
      "-progress",
      `${dir}/progress-${n}`,
      "-nostats",
      ...s.args,
    ])
  );
  return [
    // Never overwrite: a file that appeared since the name was picked stops the job (and isn't removed).
    `if [ -e ${quote(output)} ]; then echo 17 > ${quote(`${dir}/status`)}; exit 0; fi`,
    runs.join(" && "),
    "code=$?",
    `[ "$code" -eq 0 ] || rm -f ${quote(output)}`,
    `rm -f ${quote(dir)}/pass*.log* ${quote(dir)}/palette.png`,
    `echo "$code" > ${quote(`${dir}/status`)}`,
  ].join("; ");
}

/** The useful end of ffmpeg's error log. */
export function lastError(log: string): string | undefined {
  const lines = log.split("\n").map((l) => l.trim()).filter((l) => l && !/^\s*(frame|size)=/.test(l));
  return lines.at(-1)?.replace(/^\[[^\]]+\]\s*/, "").slice(0, 300);
}

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const formatBitrate = (bps: number) =>
  bps >= 1_000_000 ? `${(bps / 1_000_000).toFixed(1)} Mb/s` : `${Math.round(bps / 1000)} kb/s`;

export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

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

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S ffmpeg",
  debian: "sudo apt install ffmpeg",
  // Fedora's own ffmpeg-free lacks H.264: RPM Fusion has the full one.
  fedora: "sudo dnf install ffmpeg (from RPM Fusion)",
  suse: "sudo zypper install ffmpeg (from Packman)",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installMarkdown(what: string, family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return `${what}\n\n${families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${MANAGERS[f]}\``).join("\n\n")}`;
}
