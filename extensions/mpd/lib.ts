// The MPD protocol's text answers, songs, and formatting. Pure, tested in lib_test.ts.

/** "key: value" lines; repeated keys are kept in order. */
export function parsePairs(text: string): [string, string][] {
  return text.split("\n").flatMap((line): [string, string][] => {
    const i = line.indexOf(": ");
    return i > 0 ? [[line.slice(0, i), line.slice(i + 2)]] : [];
  });
}

/** Groups pairs into objects, a new one starting at each `startKey` ("file", "playlist"…). */
export function parseObjects(text: string, startKeys: string[]): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  let cur: Record<string, string> | undefined;
  for (const [k, v] of parsePairs(text)) {
    if (startKeys.includes(k)) {
      cur = { [k]: v };
      out.push(cur);
    } else if (cur && !(k in cur)) cur[k] = v;
  }
  return out;
}

export const parseRecord = (text: string): Record<string, string> => Object.fromEntries(parsePairs(text).reverse());

/** Quotes an argument the way MPD wants: in double quotes, with \ and " escaped. */
export const quote = (arg: string | number) => `"${String(arg).replace(/[\\"]/g, "\\$&")}"`;

// ---------------------------------------------------------------------------
// Songs and status

export interface Song {
  file: string;
  title: string;
  artist?: string;
  album?: string;
  albumArtist?: string;
  date?: string;
  track?: string;
  genre?: string;
  /** Seconds. */
  duration?: number;
  /** In the queue. */
  pos?: number;
  id?: number;
  /** A stream (http://…) rather than a file of the library. */
  stream: boolean;
  /** Radio streams send the current song as Title, their name as Name. */
  name?: string;
}

const basename = (file: string) => decodeURIComponent(file.split("/").pop() ?? file).replace(/\.[a-z0-9]{2,5}$/i, "");

export function toSong(o: Record<string, string>): Song {
  const stream = /^[a-z]+:\/\//i.test(o.file ?? "");
  const duration = Number(o.duration ?? o.Time);
  return {
    file: o.file ?? "",
    title: o.Title || o.Name || basename(o.file ?? "Unknown"),
    artist: o.Artist || o.AlbumArtist || undefined,
    album: o.Album || undefined,
    albumArtist: o.AlbumArtist || undefined,
    date: o.Date?.slice(0, 4) || undefined,
    track: o.Track?.split("/")[0] || undefined,
    genre: o.Genre || undefined,
    duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
    pos: o.Pos !== undefined ? Number(o.Pos) : undefined,
    id: o.Id !== undefined ? Number(o.Id) : undefined,
    stream,
    name: o.Name || undefined,
  };
}

export const parseSongs = (text: string): Song[] => parseObjects(text, ["file"]).map(toSong);

export type State = "play" | "pause" | "stop";

export interface Status {
  state: State;
  /** 0–100, or undefined without a mixer. */
  volume?: number;
  repeat: boolean;
  random: boolean;
  single: "0" | "1" | "oneshot";
  consume: "0" | "1" | "oneshot";
  playlistLength: number;
  /** Changes whenever the queue changes. */
  playlistVersion: number;
  song?: number;
  songId?: number;
  nextSong?: number;
  elapsed?: number;
  duration?: number;
  bitrate?: number;
  audio?: string;
  error?: string;
  updating: boolean;
}

export function parseStatus(text: string): Status {
  const r = parseRecord(text);
  const num = (k: string) => (r[k] !== undefined && r[k] !== "" ? Number(r[k]) : undefined);
  const volume = num("volume");
  return {
    state: (r.state as State) ?? "stop",
    volume: volume === undefined || volume < 0 ? undefined : volume,
    repeat: r.repeat === "1",
    random: r.random === "1",
    single: (r.single as Status["single"]) ?? "0",
    consume: (r.consume as Status["consume"]) ?? "0",
    playlistLength: num("playlistlength") ?? 0,
    playlistVersion: num("playlist") ?? 0,
    song: num("song"),
    songId: num("songid"),
    nextSong: num("nextsong"),
    elapsed: num("elapsed") ?? (r.time ? Number(r.time.split(":")[0]) : undefined),
    duration: num("duration") ?? (r.time ? Number(r.time.split(":")[1]) : undefined),
    bitrate: num("bitrate"),
    audio: r.audio,
    error: r.error,
    updating: r.updating_db !== undefined,
  };
}

export interface Playlist {
  name: string;
  modified?: string;
}

export const parsePlaylists = (text: string): Playlist[] =>
  parseObjects(text, ["playlist"]).map((o) => ({ name: o.playlist, modified: o["Last-Modified"] }))
    .sort((a, b) => a.name.localeCompare(b.name));

export interface Stats {
  artists: number;
  albums: number;
  songs: number;
  /** Seconds of music in the library. */
  dbPlaytime: number;
}

export function parseStats(text: string): Stats {
  const r = parseRecord(text);
  return {
    artists: Number(r.artists ?? 0),
    albums: Number(r.albums ?? 0),
    songs: Number(r.songs ?? 0),
    dbPlaytime: Number(r.db_playtime ?? 0),
  };
}

/** "ACK [50@0] {albumart} No file exists" → its parts. */
export function parseAck(line: string): { code: number; command: string; message: string } | undefined {
  const m = line.match(/^ACK \[(\d+)@\d+\] \{([^}]*)\} ?(.*)$/);
  return m ? { code: Number(m[1]), command: m[2], message: m[3] } : undefined;
}

export const ACK_NO_EXIST = 50;
export const ACK_PASSWORD = 3;
export const ACK_PERMISSION = 4;

// ---------------------------------------------------------------------------
// Formatting

export function clock(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "–:––";
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function totalTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
  return h ? `${h} h ${m} min` : `${m} min`;
}

/** "Daft Punk — Get Lucky" */
export const songLine = (s: Song) => [s.artist, s.title].filter(Boolean).join(" — ");

/** "Random Access Memories (2013)" */
export const albumLine = (s: Song) => (s.album ? `${s.album}${s.date ? ` (${s.date})` : ""}` : undefined);

/** "44100:24:2" → "44.1 kHz · 24 bit · stereo". */
export function audioFormat(audio: string | undefined): string | undefined {
  if (!audio) return undefined;
  const [rate, bits, channels] = audio.split(":");
  const r = Number(rate);
  const ch = channels === "1" ? "mono" : channels === "2" ? "stereo" : `${channels} channels`;
  return [
    r ? `${(r / 1000).toFixed(r % 1000 ? 1 : 0)} kHz` : undefined,
    bits && bits !== "f" ? `${bits} bit` : bits === "f" ? "float" : undefined,
    channels ? ch : undefined,
  ]
    .filter(Boolean).join(" · ");
}

/** The single/consume toggles cycle off → on → once. */
export const nextMode = (
  m: "0" | "1" | "oneshot",
): "0" | "1" | "oneshot" => (m === "0" ? "1" : m === "1" ? "oneshot" : "0");
export const modeName = (m: "0" | "1" | "oneshot") => (m === "0" ? "Off" : m === "1" ? "On" : "Once");

/** A stable file name for a song's cover: FNV-1a of its folder (covers are per album folder). */
export function coverKey(file: string): string {
  const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : file;
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(folder)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h.toString(16).padStart(8, "0");
}

/** The picture type from its first bytes. */
export function imageExtension(bytes: Uint8Array): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpg";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "webp";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
  return "jpg";
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
  arch: "sudo pacman -S mpd",
  debian: "sudo apt install mpd",
  fedora: "sudo dnf install mpd",
  suse: "sudo zypper install mpd",
};

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

export function installMarkdown(family?: Family): string {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return [
    "Backslash talks to the **Music Player Daemon** on `localhost:6600`. Install it, point `music_directory` to your music in `~/.config/mpd/mpd.conf`, then start it:",
    ...families.map((f) => `**${FAMILY_NAMES[f]}**\n\n\`${MANAGERS[f]}\``),
    "`systemctl --user enable --now mpd`",
    'If MPD listens elsewhere (a socket only, another port), add `bind_to_address "localhost"` and `port "6600"` to its configuration.',
  ].join("\n\n");
}
