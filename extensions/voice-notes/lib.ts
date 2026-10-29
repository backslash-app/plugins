// Voice Notes logic: the recording and transcription scripts, file names, WAV
// headers, transcripts and notes. Pure, tested in lib_test.ts.

/** Single-quotes a string for sh, when needed. */
export function q(s: string): string {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

// ---------------------------------------------------------------------------
// Recording

export type Recorder = "pw-record" | "ffmpeg" | "arecord";
export const RECORDERS: Recorder[] = ["pw-record", "ffmpeg", "arecord"];

export const RECORDING_UNIT = "backslash-voice-recording";

/** `2026-10-29_14-05-12.wav`: sorts by date, safe in unit names. */
export function recordingName(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${
    p(d.getSeconds())
  }.wav`;
}

/** The date a recording name holds, or undefined for files named otherwise. */
export function dateOfName(name: string): number | undefined {
  const m = name.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s).getTime();
}

/**
 * The script recording 16 kHz mono 16-bit WAV, what Whisper wants. The unit stops it with
 * SIGINT so the recorder finishes the file.
 */
export function recordScript(tool: Recorder, file: string): string {
  const f = q(file);
  const dir = q(file.slice(0, file.lastIndexOf("/")) || "/");
  const cmd = tool === "pw-record"
    ? `exec pw-record --rate 16000 --channels 1 --format s16 ${f}`
    : tool === "ffmpeg"
    ? `exec ffmpeg -hide_banner -loglevel error -nostdin -f pulse -i default -ac 1 -ar 16000 -c:a pcm_s16le -y ${f}`
    : `exec arecord -q -f S16_LE -r 16000 -c 1 -t wav ${f}`;
  return `mkdir -p ${dir}\n${cmd}`;
}

/** `systemd-run` arguments for a background job outside the launcher. */
export function systemdRunArgs(
  unit: string,
  script: string,
  o: { description: string; killSignal?: string; env?: Record<string, string | undefined> },
): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    `--description=${o.description}`,
    "--collect",
    ...(o.killSignal ? [`--property=KillSignal=${o.killSignal}`] : []),
    ...Object.entries(o.env ?? {}).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

// ---------------------------------------------------------------------------
// WAV

/** Seconds of audio in a WAV file, from its header and size (a header left unfinished still works). */
export function wavDuration(head: Uint8Array, fileSize: number): number | undefined {
  if (head.length < 12) return undefined;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const tag = (o: number) => String.fromCharCode(...head.subarray(o, o + 4));
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return undefined;
  let byteRate = 0;
  let o = 12;
  while (o + 8 <= head.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === "fmt " && o + 16 <= head.length) byteRate = v.getUint32(o + 8 + 8, true);
    if (id === "data") {
      if (!byteRate) return undefined;
      const declared = size;
      const real = fileSize - (o + 8);
      // pw-record and arecord write 0 or 0xFFFFFFFF until they finish.
      const bytes = declared > 0 && declared !== 0xffffffff && declared <= real ? declared : real;
      return Math.max(0, bytes / byteRate);
    }
    o += 8 + size + (size % 2);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Transcribing

export type Engine = "whisper.cpp" | "whisper";

export interface Transcriber {
  engine: Engine;
  /** The program: whisper-cli, whisper-cpp or whisper. */
  program: string;
  /** A ggml file for whisper.cpp, a model name for openai-whisper. */
  model: string;
}

export const WHISPER_CPP = ["whisper-cli", "whisper-cpp"];

/** "auto", or a two- or three-letter language code. */
export function languageOf(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s === "auto" || s === "detect") return "auto";
  const names: Record<string, string> = { english: "en", french: "fr", français: "fr", francais: "fr" };
  if (names[s]) return names[s];
  return /^[a-z]{2,3}$/.test(s) ? s : "auto";
}

export const isModelPath = (s: string) => s.includes("/") || /\.bin$/i.test(s);

const RANK = ["large-v3-turbo", "turbo", "small", "base", "medium", "large-v3", "large", "tiny"];

/** The best ggml model among files found: multilingual unless English is asked, mid-size first. */
export function pickModel(paths: string[], language = "auto"): string | undefined {
  const ggml = paths.filter((p) => /(^|\/)ggml-[\w.-]+\.bin$/i.test(p) && !/-encoder|silero|vad/i.test(p));
  const name = (p: string) => p.split("/").pop()!.replace(/^ggml-|\.bin$/gi, "").toLowerCase();
  const english = (p: string) => /\.en(\b|-|$)/.test(name(p));
  const score = (p: string) => {
    const n = name(p).replace(/\.en\b/, "").replace(/-q\d.*$/, "");
    const r = RANK.findIndex((k) => n === k || n.startsWith(`${k}-`) || n === `${k}`);
    const lang = english(p) && language !== "en" ? 100 : 0;
    return (r < 0 ? 50 : r) + lang;
  };
  return [...ggml].sort((a, b) => score(a) - score(b) || a.localeCompare(b))[0];
}

/** What to run: whisper.cpp with a ggml model if there is one, else openai-whisper. */
export function chooseTranscriber(
  o: { installed: Set<string>; modelPref: string; models: string[]; language: string },
): Transcriber | undefined {
  const cpp = WHISPER_CPP.find((p) => o.installed.has(p));
  const pref = o.modelPref.trim();
  if (cpp) {
    const model = pref && isModelPath(pref) ? pref : pickModel(o.models, o.language);
    if (model) return { engine: "whisper.cpp", program: cpp, model };
  }
  if (o.installed.has("whisper")) {
    return { engine: "whisper", program: "whisper", model: pref && !isModelPath(pref) ? pref : "base" };
  }
  return undefined;
}

/** `/x/2026-10-29_14-05-12.wav` → `/x/2026-10-29_14-05-12`. */
export const stemOf = (wav: string) => wav.replace(/\.wav$/i, "");

/** The unit transcribing a recording. */
export const transcribeUnit = (wav: string) =>
  `backslash-voice-transcribe-${(stemOf(wav).split("/").pop() ?? "x").replace(/[^\w.-]+/g, "-").slice(0, 60)}`;

/**
 * The transcription job: the transcript lands in `<stem>.txt`; errors in `<stem>.error`. A
 * notification says when it is done.
 */
export function transcribeScript(t: Transcriber, wav: string, language: string): string {
  const base = stemOf(wav);
  const dir = base.slice(0, base.lastIndexOf("/")) || "/";
  const log = q(`${base}.log`);
  const run = t.engine === "whisper.cpp"
    ? [
      q(t.program),
      "-m",
      q(t.model),
      "-f",
      q(wav),
      "-l",
      q(language),
      "-t",
      `"$(nproc 2>/dev/null || echo 4)"`,
      "-otxt",
      "-of",
      q(base),
      "-np",
      "-nt",
    ]
    : [
      "whisper",
      q(wav),
      "--model",
      q(t.model),
      ...(language === "auto" ? [] : ["--language", q(language)]),
      "--output_format",
      "txt",
      "--output_dir",
      q(dir),
      "--fp16",
      "False",
      "--verbose",
      "False",
    ];
  const title = q("Voice note transcribed");
  return [
    `rm -f ${q(`${base}.error`)}`,
    `if ${run.join(" ")} > /dev/null 2> ${log} && [ -s ${q(`${base}.txt`)} ]; then`,
    `  rm -f ${log}`,
    `  notify-send -a Backslash -i audio-input-microphone-symbolic ${title} "$(head -c 200 ${
      q(`${base}.txt`)
    } | tr '\\n' ' ')" || true`,
    "else",
    `  mv -f ${log} ${q(`${base}.error`)} 2>/dev/null || echo failed > ${q(`${base}.error`)}`,
    `  notify-send -a Backslash -u critical -i dialog-error-symbolic ${q("Transcription failed")} ${
      q("Open Voice Notes to see why")
    } || true`,
    "  exit 1",
    "fi",
  ].join("\n");
}

/** Whisper's text output, tidied: no blank-audio markers, lines joined into paragraphs. */
export function cleanTranscript(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\[(BLANK_AUDIO|MUSIC|Music|SOUND|silence|Silence|inaudible)\]|\((silence|music|inaudible)\)/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The last meaningful line of a failed job's log. */
export function errorLine(log: string): string {
  const lines = log.split("\n").map((l) => l.trim()).filter((l) => l && !/^whisper_|^ggml_|^system_info/.test(l));
  const err = lines.reverse().find((l) => /error|fail|not found|unable|cannot|invalid/i.test(l));
  return (err ?? lines[0] ?? "The transcription failed").slice(0, 200);
}

// ---------------------------------------------------------------------------
// Notes

/** Characters no file name should hold on Linux, Windows or Android sync targets. */
// deno-lint-ignore no-control-regex
const FORBIDDEN = /[\/\\:*?"<>|#^\[\]\u0000-\u001f]/g;

/** A title from a transcript: its first sentence, cut at a word. */
export function titleFrom(transcript: string, max = 60): string {
  const first = transcript.split(/(?<=[.!?])\s/)[0]?.trim() ?? "";
  const t = first.replace(/[.!?]+$/, "");
  if (!t) return "";
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${(cut.lastIndexOf(" ") > 20 ? cut.slice(0, cut.lastIndexOf(" ")) : cut).trim()}…`;
}

/** A file name Quick Notes and Obsidian accept: "Call the bank / card?" → "Call the bank - card.md". */
export function noteFileName(title: string): string {
  const base = title
    .replace(/…$/, "")
    .replace(FORBIDDEN, (c) => (c === "/" || c === "\\" || c === ":" || c === "|" ? "-" : ""))
    .replace(/\s+/g, " ")
    .replace(/^[.\s-]+|[.\s]+$/g, "")
    .slice(0, 120)
    .trim();
  return `${base || "Voice note"}.md`;
}

/** `name.md`, or `name 2.md`… when taken (case-insensitive). */
export function uniqueFileName(wanted: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((t) => t.toLowerCase()));
  if (!lower.has(wanted.toLowerCase())) return wanted;
  const stem = wanted.replace(/\.md$/i, "");
  for (let i = 2;; i++) if (!lower.has(`${stem} ${i}.md`.toLowerCase())) return `${stem} ${i}.md`;
}

/** The markdown note: frontmatter with the date and the recording, then the transcript. */
export function noteText(transcript: string, recorded: Date, audio: string): string {
  const iso = new Date(recorded.getTime() - recorded.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  return [
    "---",
    "tags: [voice-note]",
    `created: ${iso}`,
    `audio: "${audio.replace(/"/g, '\\"')}"`,
    "---",
    transcript.trim(),
    "",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Formatting

/** 83 → "1:23", 3723 → "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** "Today", "Yesterday", "This Week", "Older". */
export function ageSection(ms: number, now = new Date()): string {
  const day = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (ms >= day) return "Today";
  if (ms >= day - 86_400_000) return "Yesterday";
  if (ms >= day - 6 * 86_400_000) return "This Week";
  return "Older";
}

export function when(ms: number, now = new Date()): string {
  const d = new Date(ms);
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  const section = ageSection(ms, now);
  if (section === "Today") return time;
  if (section === "Yesterday") return `Yesterday ${time}`;
  return `${
    d.toLocaleDateString("en", {
      weekday: section === "This Week" ? "short" : undefined,
      day: "numeric",
      month: "short",
    })
  } ${time}`;
}

/** Words to match a recording by what was said. */
export function keywordsOf(transcript: string, max = 80): string[] {
  const words = transcript.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'’-]{2,}/gu) ?? [];
  return [...new Set(words)].slice(0, max);
}

/** Expands a leading `~`. */
export const expandHome = (p: string, home: string) =>
  p === "~" ? home : p.startsWith("~/") ? `${home}${p.slice(1)}` : p;

/** `$HOME/…` → `~/…`. */
export const tildify = (p: string, home: string) => (home && p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p);

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

/** How to get a recorder and whisper.cpp on this distribution. */
export function installHint(family?: Family): { recorder: string; whisper: string } {
  switch (family) {
    case "arch":
      return {
        recorder: "sudo pacman -S pipewire",
        whisper: "yay -S whisper.cpp (AUR), or pipx install openai-whisper",
      };
    case "debian":
      return {
        recorder: "sudo apt install pipewire-bin",
        whisper: "build whisper.cpp, or pipx install openai-whisper",
      };
    case "fedora":
      return { recorder: "sudo dnf install pipewire-utils", whisper: "sudo dnf install whisper-cpp" };
    case "suse":
      return { recorder: "sudo zypper install pipewire-tools", whisper: "pipx install openai-whisper" };
    default:
      return {
        recorder: "install pipewire (pw-record), ffmpeg or alsa-utils (arecord)",
        whisper: "install whisper.cpp or openai-whisper",
      };
  }
}

/** The download link of a ggml model for whisper.cpp. */
export const MODEL_URL = "https://huggingface.co/ggerganov/whisper.cpp/tree/main";
