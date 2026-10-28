// Choosing the selection tool, building the background script, and reading
// tesseract's output. Pure, tested in lib_test.ts.

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";
export interface Session {
  wayland: boolean;
  desktop: Desktop;
}
export type Env = Partial<Record<string, string>>;

export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const current = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || current.includes("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || current.includes("sway")
    ? "sway"
    : current.some((d) => ["gnome", "ubuntu", "unity", "pop"].includes(d))
    ? "gnome"
    : current.includes("kde")
    ? "kde"
    : "other";
  return { wayland, desktop };
}

export type Grabber = "grim" | "gnome-screenshot" | "spectacle" | "maim" | "scrot" | "import";

/** Tools that can grab a selected area in this session, best first. */
export function grabberCandidates(s: Session): Grabber[] {
  if (s.wayland) return s.desktop === "gnome" ? ["gnome-screenshot"] : s.desktop === "kde" ? ["spectacle"] : ["grim"];
  const x11: Grabber[] = ["maim", "scrot", "import"];
  return s.desktop === "gnome" ? ["gnome-screenshot", ...x11] : s.desktop === "kde" ? ["spectacle", ...x11] : x11;
}

/** Single-quotes a string for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Grabs a selected area into `$img`. */
export function grabArea(tool: Grabber): string {
  switch (tool) {
    case "grim":
      return `geometry=$(slurp) || exit 0; grim -g "$geometry" "$img"`;
    case "gnome-screenshot":
      return `gnome-screenshot -a -f "$img"`;
    case "spectacle":
      return `spectacle -b -n -r -o "$img"`;
    case "maim":
      return `maim -s "$img"`;
    case "scrot":
      return `scrot -s "$img"`;
    case "import":
      return `import "$img"`;
  }
}

/** "eng, fra" / "eng+fra" / "English" → "eng+fra"; undefined when nothing usable. */
export function normalizeLanguages(text: string | undefined): string | undefined {
  const codes = (text ?? "").toLowerCase().split(/[\s,;+]+/).map((c) => NAME_TO_CODE[c] ?? c).filter((c) =>
    /^[a-z][a-z0-9_]*$/.test(c)
  );
  return codes.length ? [...new Set(codes)].join("+") : undefined;
}

export interface OcrOptions {
  tool: Grabber;
  languages: string;
  /** Where recognized texts are kept, one file each. */
  historyDir: string;
  wayland: boolean;
  keep?: number;
  /** Seconds before selecting: the launcher must be gone. */
  wait?: number;
}

/** The background script: select, recognize, copy, remember, notify. */
export function ocrScript(o: OcrOptions): string {
  const h = q(o.historyDir);
  const copy = o.wayland
    ? `printf '%s' "$text" | wl-copy 2>/dev/null || printf '%s' "$text" | xclip -selection clipboard 2>/dev/null`
    : `printf '%s' "$text" | xclip -selection clipboard 2>/dev/null || printf '%s' "$text" | wl-copy 2>/dev/null`;
  return [
    `sleep ${o.wait ?? 0.4}`,
    `img="\${XDG_RUNTIME_DIR:-/tmp}/backslash-ocr-$$.png"`,
    `trap 'rm -f "$img"' EXIT`,
    `${grabArea(o.tool)} || exit 0`,
    `[ -s "$img" ] || exit 0`,
    `text=$(tesseract "$img" - -l ${q(o.languages)} 2>/dev/null | tr -d '\\f')`,
    `if [ -z "$(printf '%s' "$text" | tr -d '[:space:]')" ]; then`,
    `  notify-send -a Backslash 'Text from Screen' 'No text found in the selection' 2>/dev/null; exit 0`,
    "fi",
    `mkdir -p ${h} && printf '%s\\n' "$text" > ${h}/"$(date +%s)".txt`,
    `ls -1t ${h}/*.txt 2>/dev/null | tail -n +${(o.keep ?? 30) + 1} | xargs -r rm -f`,
    `if ${copy}; then title='Text copied'; else title='Text recognized'; fi`,
    `notify-send -a Backslash "$title" "$(printf '%s' "$text" | head -c 240)" 2>/dev/null`,
    "true",
  ].join("\n");
}

/** `systemd-run` arguments to run the script outside the launcher. */
export function systemdRunArgs(unit: string, script: string, env: Env = {}): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    "--description=Backslash: text from screen",
    "--collect",
    // wl-copy and xclip stay in the background to serve the clipboard.
    "--property=KillMode=process",
    ...Object.entries(env).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

/** `tesseract --list-langs` → codes, without the `osd` helper model. */
export function parseLanguages(out: string): string[] {
  return out.split("\n").map((l) => l.trim()).filter((l) =>
    l && !/^list of/i.test(l) && l !== "osd" && !l.includes(" ")
  )
    .sort((a, b) => languageName(a).localeCompare(languageName(b)));
}

/** `tesseract --version` → "5.3.4". */
export const parseVersion = (out: string) => out.match(/tesseract\s+v?(\d+(?:\.\d+)*)/i)?.[1];

const NAMES: Record<string, string> = {
  afr: "Afrikaans",
  ara: "Arabic",
  bel: "Belarusian",
  ben: "Bengali",
  bul: "Bulgarian",
  cat: "Catalan",
  ces: "Czech",
  chi_sim: "Chinese (Simplified)",
  chi_tra: "Chinese (Traditional)",
  dan: "Danish",
  deu: "German",
  ell: "Greek",
  eng: "English",
  epo: "Esperanto",
  est: "Estonian",
  eus: "Basque",
  fas: "Persian",
  fin: "Finnish",
  fra: "French",
  gle: "Irish",
  glg: "Galician",
  heb: "Hebrew",
  hin: "Hindi",
  hrv: "Croatian",
  hun: "Hungarian",
  ind: "Indonesian",
  isl: "Icelandic",
  ita: "Italian",
  jpn: "Japanese",
  kor: "Korean",
  lat: "Latin",
  lav: "Latvian",
  lit: "Lithuanian",
  nld: "Dutch",
  nor: "Norwegian",
  pol: "Polish",
  por: "Portuguese",
  ron: "Romanian",
  rus: "Russian",
  slk: "Slovak",
  slv: "Slovenian",
  spa: "Spanish",
  srp: "Serbian",
  swe: "Swedish",
  tha: "Thai",
  tur: "Turkish",
  ukr: "Ukrainian",
  vie: "Vietnamese",
  equ: "Math / equations",
};

const NAME_TO_CODE: Record<string, string> = Object.fromEntries([
  ...Object.entries(NAMES).map(([code, name]) => [name.toLowerCase(), code]),
  ["french", "fra"],
  ["français", "fra"],
  ["anglais", "eng"],
  ["german", "deu"],
  ["allemand", "deu"],
  ["espagnol", "spa"],
]);

export const languageName = (code: string) =>
  NAMES[code] ?? (code.startsWith("script/") ? `${code.slice(7).replace(/_/g, " ")} (script)` : code);

export const describeLanguages = (codes: string) => codes.split("+").map(languageName).join(" + ");

/** First line of a recognized text, for a title. */
export function firstLine(text: string, max = 70): string {
  const line = text.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

export const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Text shown verbatim in a detail panel (the markdown subset has no escapes). */
export const verbatim = (text: string) => "```\n" + text.replace(/```/g, "ˋˋˋ").trimEnd() + "\n```";

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

export const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

/** The package with tesseract's model for a language, per distribution. */
export function languagePackage(code: string, family: Family): string {
  switch (family) {
    case "debian":
      return `tesseract-ocr-${code.replace(/_/g, "-")}`;
    case "arch":
      return `tesseract-data-${code}`;
    case "fedora":
      return `tesseract-langpack-${code}`;
    case "suse":
      return `tesseract-ocr-traineddata-${(NAMES[code] ?? code).toLowerCase().replace(/\W.*$/, "")}`;
  }
}

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

/** The command installing tesseract (with English) or more languages. */
export function installTesseract(family: Family, languages: string[] = ["eng"]): string {
  const base = family === "debian" || family === "suse" ? "tesseract-ocr" : "tesseract";
  return `${MANAGERS[family]} ${[base, ...languages.map((l) => languagePackage(l, family))].join(" ")}`;
}

export function installLanguage(family: Family, code: string): string {
  return `${MANAGERS[family]} ${languagePackage(code, family)}`;
}

export function grabberInstall(s: Session, family: Family): string {
  const debianSpectacle = family === "debian" ? "kde-spectacle" : "spectacle";
  const clip = s.wayland ? "wl-clipboard" : "xclip";
  const tools = s.wayland
    ? s.desktop === "gnome" ? "gnome-screenshot" : s.desktop === "kde" ? debianSpectacle : "grim slurp"
    : "maim";
  return `${MANAGERS[family]} ${tools} ${clip}`;
}
