// Speech engines, their voices and the background script. Pure, tested in lib_test.ts.

export type Engine = "piper" | "espeak-ng" | "spd-say" | "festival";

export const ENGINES: Engine[] = ["piper", "espeak-ng", "spd-say", "festival"];

export const ENGINE_NAMES: Record<Engine, string> = {
  piper: "Piper",
  "espeak-ng": "eSpeak NG",
  "spd-say": "Speech Dispatcher",
  festival: "Festival",
};

/** The engine preference: "auto" or one of the engines. */
export function parseEngine(pref: string | undefined): Engine | "auto" {
  const p = (pref ?? "").trim().toLowerCase().replace(/^espeak$/, "espeak-ng").replace(
    /^speech-dispatcher$/,
    "spd-say",
  );
  return (ENGINES as string[]).includes(p) ? p as Engine : "auto";
}

/** The first engine that is installed (and, for Piper, has a voice model). */
export function pickEngine(pref: Engine | "auto", available: Set<Engine>): Engine | undefined {
  if (pref !== "auto") return available.has(pref) ? pref : undefined;
  return ENGINES.find((e) => available.has(e));
}

// ---------------------------------------------------------------------------
// Voices

export interface Voice {
  engine: Engine;
  /** What the engine takes: an espeak voice name, a model path, a dispatcher voice. */
  id: string;
  name: string;
  /** "fr", "en-us"… */
  language: string;
  gender?: string;
  quality?: string;
  /** Piper: the sample rate of the model. */
  sampleRate?: number;
}

/**
 * `espeak-ng --voices`:
 * ```
 * Pty Language       Age/Gender VoiceName          File                 Other Languages
 *  5  af              --/M      Afrikaans          gmw/af
 *  2  en-gb           --/M      English_(Great_Britain) gmw/en          (en 2)
 * ```
 */
export function parseEspeakVoices(out: string): Voice[] {
  return out.split("\n").slice(1).flatMap((line): Voice[] => {
    const m = line.trim().match(/^\d+\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
    if (!m) return [];
    const gender = m[2].split("/")[1];
    return [{
      engine: "espeak-ng",
      id: m[1],
      name: m[3].replace(/_/g, " "),
      language: m[1].toLowerCase(),
      gender: gender === "M" ? "Male" : gender === "F" ? "Female" : undefined,
    }];
  });
}

/** `spd-say -L`: "NAME  LANGUAGE  VARIANT" after a header. */
export function parseSpdVoices(out: string): Voice[] {
  return out.split("\n").flatMap((line): Voice[] => {
    const m = line.trim().match(/^(\S+)\s+([a-z]{2,3}(?:[-_][A-Za-z0-9]+)*)\s+(\S+)$/);
    if (!m || m[1] === "NAME") return [];
    return [{
      engine: "spd-say",
      id: m[1],
      name: m[1].replace(/[_+]/g, " "),
      language: m[2].toLowerCase().replace("_", "-"),
    }];
  });
}

/** A Piper model from its `.onnx.json` config, next to `<name>.onnx`. */
export function piperVoice(modelPath: string, configJson: string | undefined): Voice {
  const file = modelPath.split("/").pop()!.replace(/\.onnx$/, "");
  // fr_FR-siwis-medium
  const m = file.match(/^([a-z]{2,3})_([A-Z]{2})-(.+?)-(x_low|low|medium|high)$/);
  let cfg: { audio?: { sample_rate?: number; quality?: string }; language?: { code?: string; name_english?: string } } =
    {};
  try {
    cfg = configJson ? JSON.parse(configJson) : {};
  } catch {
    // Defaults below.
  }
  const lang = (cfg.language?.code ?? (m ? `${m[1]}_${m[2]}` : "en")).toLowerCase().replace("_", "-");
  const speaker = m?.[3] ?? file;
  return {
    engine: "piper",
    id: modelPath,
    name: `${speaker.replace(/[_-]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}${
      cfg.language?.name_english ? ` · ${cfg.language.name_english}` : ""
    }`,
    language: lang,
    quality: cfg.audio?.quality ?? m?.[4]?.replace("_", " "),
    sampleRate: cfg.audio?.sample_rate ?? 22050,
  };
}

// ---------------------------------------------------------------------------
// Language guess

const STOPWORDS: Record<string, string[]> = {
  en: ["the", "and", "is", "are", "you", "that", "with", "for", "this", "have", "not", "was", "of", "to"],
  fr: ["le", "la", "les", "et", "est", "une", "des", "pour", "que", "qui", "dans", "pas", "vous", "sur", "avec", "du"],
  de: ["der", "die", "das", "und", "ist", "nicht", "ein", "eine", "mit", "sie", "ich", "auf", "für", "den"],
  es: ["el", "los", "las", "y", "es", "una", "por", "que", "con", "para", "del", "como", "pero", "muy"],
  it: ["il", "gli", "e", "è", "una", "per", "che", "con", "non", "della", "sono", "come", "anche"],
  pt: ["o", "os", "as", "e", "é", "uma", "para", "que", "com", "não", "do", "da", "em", "você"],
  nl: ["de", "het", "en", "is", "een", "van", "niet", "met", "voor", "dat", "zijn", "ook"],
};

/** The likely language of a text ("fr", "en"…), or undefined when it's too short to tell. */
export function guessLanguage(text: string): string | undefined {
  const words = text.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  if (words.length < 3) return undefined;
  let best: string | undefined;
  let bestScore = 0;
  for (const [lang, list] of Object.entries(STOPWORDS)) {
    const set = new Set(list);
    let score = words.filter((w) => set.has(w.replace(/^[ldjmnst]'/, ""))).length;
    if (lang === "fr") {
      score += (text.match(/[àâçéèêëîïôûùœ]/gi) ?? []).length * 0.3 + (text.match(/\b[ldjmnst]'/gi) ?? []).length;
    }
    if (lang === "de") score += (text.match(/[äöüß]/gi) ?? []).length * 0.5;
    if (lang === "es") score += (text.match(/[ñ¿¡]/gi) ?? []).length;
    if (score > bestScore) [best, bestScore] = [lang, score];
  }
  return bestScore >= 1 ? best : undefined;
}

/** The chosen voice, else one for the text's language, else the first one. */
export function voiceFor(voices: Voice[], chosen: string | undefined, language: string | undefined): Voice | undefined {
  if (chosen) {
    const v = voices.find((x) => x.id === chosen) ?? voices.find((x) => x.name.toLowerCase() === chosen.toLowerCase());
    if (v) return v;
  }
  if (language) {
    const base = (l: string) => l.split(/[-_]/)[0];
    const exact = voices.filter((v) => base(v.language) === language);
    if (exact.length) {
      // espeak: "fr" before "fr-be"; piper: the best quality first.
      const rank = (v: Voice) =>
        (v.language === language ? 0 : 1) + ({ high: 0, medium: 0.1, low: 0.2, "x low": 0.3 }[v.quality ?? ""] ?? 0.15);
      return [...exact].sort((a, b) => rank(a) - rank(b))[0];
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Text

/** Readable text: no URLs spelled letter by letter, no markdown marks, collapsed spaces. */
export function cleanText(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)[^)]+\)/g, "$1")
    .replace(/https?:\/\/(?:www\.)?([^/\s]+)\S*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** About 160 words a minute at normal speed. */
export function duration(text: string, speed = 1): number {
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length;
  return Math.max(1, Math.round((words / 160) * 60 / Math.max(0.25, speed)));
}

export function clock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  return `${m}:${String(seconds % 60).padStart(2, "0")}`;
}

export const preview = (text: string, max = 60) => {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
};

/** The speed preference in percent (100 = normal), kept within what engines handle. */
export const speedOf = (pref: unknown) => Math.max(0.3, Math.min(3, (Number(pref) || 100) / 100));

// ---------------------------------------------------------------------------
// Commands

/** Single-quotes for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface SpeakOptions {
  engine: Engine;
  /** The file holding the text. */
  file: string;
  voice?: Voice;
  language?: string;
  /** 1 = normal. */
  speed: number;
  /** For Piper's WAV fallback. */
  cache: string;
}

/** The shell script that reads `file` aloud and exits when done. */
export function speakScript(o: SpeakOptions): string {
  const f = q(o.file);
  switch (o.engine) {
    case "espeak-ng": {
      const voice = o.voice?.id ?? o.language;
      const wpm = Math.round(175 * o.speed);
      return `exec espeak-ng ${voice ? `-v ${q(voice)} ` : ""}-s ${wpm} -f ${f}`;
    }
    case "spd-say": {
      const rate = Math.round(Math.max(-100, Math.min(100, (o.speed - 1) * 100)));
      const voice = o.voice ? `-y ${q(o.voice.id)} ` : "";
      const lang = o.voice?.language ?? o.language;
      return `exec spd-say -w -e -r ${rate} ${voice}${lang ? `-l ${q(lang.split("-")[0])} ` : ""}< ${f}`;
    }
    case "festival":
      return `exec festival --tts ${f}`;
    case "piper": {
      const model = q(o.voice!.id);
      const rate = o.voice?.sampleRate ?? 22050;
      const scale = (1 / o.speed).toFixed(2);
      const wav = q(`${o.cache}/speech.wav`);
      return [
        `if command -v aplay >/dev/null 2>&1; then`,
        `  piper --model ${model} --length_scale ${scale} --output-raw < ${f} | aplay -q -r ${rate} -f S16_LE -t raw -c 1 -`,
        `elif command -v paplay >/dev/null 2>&1; then`,
        `  piper --model ${model} --length_scale ${scale} --output-raw < ${f} | paplay --raw --rate=${rate} --format=s16le --channels=1`,
        `else`,
        `  piper --model ${model} --length_scale ${scale} --output_file ${wav} < ${f} && pw-play ${wav}`,
        `fi`,
      ].join("\n");
    }
  }
}

export const UNIT = "backslash-text-to-speech";

export function systemdRunArgs(script: string, env: Record<string, string | undefined> = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${UNIT}`,
    "--description=Backslash: text to speech",
    "--collect",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
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

const INSTALL: Record<Family, string> = {
  arch: "sudo pacman -S espeak-ng",
  debian: "sudo apt install espeak-ng",
  fedora: "sudo dnf install espeak-ng",
  suse: "sudo zypper install espeak-ng",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installMarkdown(family?: Family): string {
  const families = family ? [family] : (Object.keys(INSTALL) as Family[]);
  return [
    "Backslash reads text aloud with **eSpeak NG** (small, every language), **Piper** (natural neural voices), **Speech Dispatcher** or **Festival**. The quickest start:",
    ...families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${INSTALL[f]}\``),
    "For natural voices, install Piper (`pipx install piper-tts`, or `piper-tts-bin` from the AUR) and put a voice (`.onnx` and its `.onnx.json`) from huggingface.co/rhasspy/piper-voices in `~/.local/share/piper`.",
  ].join("\n\n");
}
