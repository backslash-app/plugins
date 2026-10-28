// radio-browser.info answers, player command lines and formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

/** A station of `/json/stations/…`. */
export interface Station {
  stationuuid: string;
  name: string;
  url: string;
  url_resolved?: string;
  homepage?: string;
  favicon?: string;
  tags?: string;
  country?: string;
  countrycode?: string;
  state?: string;
  language?: string;
  votes?: number;
  codec?: string;
  bitrate?: number;
  hls?: number;
  lastcheckok?: number;
  clickcount?: number;
  clicktrend?: number;
}

export type Player = "mpv" | "ffplay" | "vlc";
export const PLAYERS: Player[] = ["mpv", "ffplay", "vlc"];

/** The `player` preference: one player, or all in order for auto. */
export function playerChoice(input: unknown): Player[] {
  const p = String(input ?? "").trim().toLowerCase().replace(/^cvlc$/, "vlc");
  return (PLAYERS as string[]).includes(p) ? [p as Player] : PLAYERS;
}

/** The program run for a player. */
export const program = (p: Player) => (p === "vlc" ? "cvlc" : p);

/** The command line that plays `url` without a window. */
export function playerArgs(p: Player, url: string, o: { script?: string; title?: string } = {}): string[] {
  switch (p) {
    case "mpv":
      return [
        "mpv",
        "--no-video",
        "--no-terminal",
        "--idle=no",
        "--cache=yes",
        "--demuxer-max-bytes=4MiB",
        ...(o.script ? [`--script=${o.script}`] : []),
        ...(o.title ? [`--title=${o.title}`] : []),
        url,
      ];
    case "ffplay":
      return [
        "ffplay",
        "-nodisp",
        "-autoexit",
        "-loglevel",
        "error",
        ...(o.title ? ["-window_title", o.title] : []),
        url,
      ];
    case "vlc":
      return [
        "cvlc",
        "--intf",
        "dummy",
        "--no-video",
        "--play-and-exit",
        ...(o.title ? ["--meta-title", o.title] : []),
        url,
      ];
  }
}

/** `systemd-run` arguments for a background unit running `argv`. */
export function unitArgs(unit: string, description: string, argv: string[]): string[] {
  return ["--user", "--quiet", "--collect", `--unit=${unit}`, `--description=${description}`, ...argv];
}

/** Station tags: `"jazz,france, public radio"` → `["jazz", "france", "public radio"]`. */
export function tags(s: Pick<Station, "tags">, limit = 8): string[] {
  const seen = new Set<string>();
  return (s.tags ?? "").split(",").map((t) => t.trim().toLowerCase()).filter((t) => {
    if (!t || t.length > 24 || seen.has(t)) return false;
    seen.add(t);
    return true;
  }).slice(0, limit);
}

/** "AAC+ · 128 kbps", "MP3", "HLS". */
export function quality(s: Pick<Station, "codec" | "bitrate" | "hls">): string {
  const codec = s.codec && s.codec !== "UNKNOWN" ? s.codec : s.hls ? "HLS" : "";
  return [codec, s.bitrate ? `${s.bitrate} kbps` : ""].filter(Boolean).join(" · ");
}

const GENRES: [RegExp, Color][] = [
  [/jazz|blues|soul|funk/, "purple"],
  [/classical|classique|opera|baroque/, "teal"],
  [/news|talk|info|actualit|sport|public radio/, "blue"],
  [/rock|metal|punk|grunge|indie/, "red"],
  [/electro|dance|house|techno|trance|edm|ambient|chill|lounge|lofi|lo-fi/, "pink"],
  [/pop|hits|top 40|charts|80s|90s|oldies/, "orange"],
  [/country|folk|world|latin|reggae/, "green"],
  [/hip.?hop|rap|r&b|urban/, "yellow"],
];

/** A color for the station's icon, from its genres. */
export function genreColor(s: Pick<Station, "tags">): Color {
  const t = tags(s, 20).join(" ");
  return GENRES.find(([re]) => re.test(t))?.[1] ?? "gray";
}

/** What the user typed for the Country view → radio-browser parameters. */
export function countryParams(query: string): Record<string, string> {
  const q = query.trim();
  if (/^[a-z]{2}$/i.test(q)) return { countrycode: q.toUpperCase() };
  return { country: q };
}

/** Merges name and tag results: exact and name matches first, then by votes, without duplicates. */
export function mergeResults(byName: Station[], byTag: Station[], query: string, limit = 60): Station[] {
  const q = query.trim().toLowerCase();
  const seen = new Set<string>();
  const all = [...byName, ...byTag].filter((s) => {
    if (!s.stationuuid || seen.has(s.stationuuid)) return false;
    seen.add(s.stationuuid);
    return true;
  });
  const score = (s: Station) => {
    const n = s.name.trim().toLowerCase();
    return n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3;
  };
  return all.map((s, i) => ({ s, i })).sort((a, b) =>
    score(a.s) - score(b.s) || (b.s.votes ?? 0) - (a.s.votes ?? 0) || a.i - b.i
  ).slice(0, limit).map((x) => x.s);
}

/**
 * An mpv script writing the song of the stream's ICY metadata to `out` each
 * time it changes (the key's case varies by server), and removing it on exit.
 */
export function songScript(out: string): string {
  return [
    `local out = ${JSON.stringify(out)}`,
    "local function save(_, m)",
    '  local title = ""',
    '  if m then for k, v in pairs(m) do if string.lower(k) == "icy-title" then title = v end end end',
    '  local f = io.open(out, "w")',
    "  if f then f:write(title) f:close() end",
    "end",
    'mp.observe_property("metadata", "native", save)',
    'mp.register_event("shutdown", function() os.remove(out) end)',
    "",
  ].join("\n");
}

/** The song file's text → the song, ignoring placeholders like " - ". */
export function songTitle(text: string | undefined): string | undefined {
  const value = (text ?? "").trim();
  return value && !/^[\s\-–]*$/.test(value) ? value : undefined;
}

/** "3 min", "1 h 05": how long it has been playing. */
export function elapsed(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just started";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")}`;
}

export const compact = (n: number) =>
  new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(n);

/** Distro family from /etc/os-release, for install hints. */
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
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

/** `sudo apt install mpv`, or a generic hint. */
export function installCommand(family: Family | undefined, pkg = "mpv"): string {
  return family ? `${MANAGERS[family]} ${pkg}` : `Install ${pkg} with your package manager`;
}
