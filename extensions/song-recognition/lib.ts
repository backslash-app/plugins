// What SongRec answers (Shazam's JSON, or "Artist - Title"), the recorder
// command lines, links to listen elsewhere and the history. Pure, tested in
// lib_test.ts.

export interface Song {
  /** Shazam's track key: the same song recognized twice has the same one. */
  key: string;
  title: string;
  artist: string;
  album?: string;
  label?: string;
  released?: string;
  genre?: string;
  cover?: string;
  shazam?: string;
  appleMusic?: string;
  spotify?: string;
  preview?: string;
  isrc?: string;
  lyrics?: string[];
  /** When it was recognized (ms). */
  at: number;
  source?: Source;
}

export type Source = "output" | "mic";

// deno-lint-ignore no-explicit-any
type Raw = any;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/** Shazam's answer as SongRec prints it; undefined when nothing matched. */
export function parseShazam(json: Raw, at = Date.now()): Song | undefined {
  const track = json?.track;
  if (!track || !str(track.title)) return undefined;
  const sections: Raw[] = Array.isArray(track.sections) ? track.sections : [];
  const meta: Raw[] = sections.find((s) => s?.type === "SONG")?.metadata ?? [];
  const field = (name: string) => str(meta.find((m: Raw) => String(m?.title).toLowerCase() === name)?.text);
  const lyricsSection = sections.find((s) => s?.type === "LYRICS");
  const lyrics: string[] | undefined = Array.isArray(lyricsSection?.text)
    ? lyricsSection.text.filter((l: unknown) => typeof l === "string")
    : undefined;
  const hubActions: Raw[] = [
    ...(Array.isArray(track.hub?.actions) ? track.hub.actions : []),
    ...((Array.isArray(track.hub?.options) ? track.hub.options : []).flatMap((o: Raw) => o?.actions ?? [])),
  ];
  const providers: Raw[] = Array.isArray(track.hub?.providers) ? track.hub.providers : [];
  const spotify = providers.find((p) => String(p?.type).toUpperCase() === "SPOTIFY")?.actions
    ?.map((a: Raw) => str(a?.uri))
    .find((u: string | undefined) => u?.startsWith("spotify:"));
  const apple = hubActions.map((a) => str(a?.uri)).find((u) =>
    u && /music\.apple\.com|itunes\.apple\.com/.test(u) && !/\.m4a/.test(u)
  );
  const preview = hubActions.map((a) => str(a?.uri)).find((u) => u && /^https:.*\.(m4a|mp3)(\?|$)/.test(u));
  return {
    key: String(track.key ?? `${track.title}|${track.subtitle}`),
    title: str(track.title)!,
    artist: str(track.subtitle) ?? "Unknown artist",
    album: field("album"),
    label: field("label"),
    released: field("released"),
    genre: str(track.genres?.primary),
    cover: str(track.images?.coverarthq) ?? str(track.images?.coverart) ?? str(track.share?.image),
    shazam: str(track.url) ?? str(track.share?.href),
    appleMusic: apple,
    spotify,
    preview,
    isrc: str(track.isrc),
    lyrics: lyrics?.length ? lyrics : undefined,
    at,
  };
}

/** SongRec's output: Shazam's JSON, or a plain "Artist - Title" line. */
export function parseSongrec(output: string, at = Date.now()): Song | undefined {
  const text = output.trim();
  const start = text.indexOf("{");
  if (start >= 0) {
    try {
      return parseShazam(JSON.parse(text.slice(start)), at);
    } catch {
      // Not JSON after all.
    }
  }
  const line = text.split("\n").map((l) => l.trim()).filter(Boolean).at(-1);
  const m = line && /^(.+?)\s+[-–]\s+(.+)$/.exec(line);
  if (!m || /error|panic|warning/i.test(line!)) return undefined;
  return { key: `${m[1]}|${m[2]}`.toLowerCase(), artist: m[1], title: m[2], at };
}

/** A sentence for SongRec's failure. */
export function songrecError(stderr: string): string {
  if (/network|dns|connect|timed out|resolve|tls|reqwest/i.test(stderr)) {
    return "Shazam can't be reached: check your connection";
  }
  if (/No match|not recognized|matches.*\[\]/i.test(stderr)) return "No match";
  if (/decode|unsupported|format/i.test(stderr)) return "SongRec couldn't read the recording";
  const line = stderr.split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  return line.replace(/^(Error|error):\s*/, "").slice(0, 200) || "SongRec failed";
}

// ---------------------------------------------------------------------------
// Recording

export type Recorder = "pw-record" | "parecord";

/** 16 kHz mono WAV, what Shazam's signature needs, from the speakers' monitor or the microphone. */
export function recordArgs(recorder: Recorder, source: Source, file: string): string[] {
  if (recorder === "pw-record") {
    return [
      "--rate",
      "16000",
      "--channels",
      "1",
      ...(source === "output" ? ["-P", "{ stream.capture.sink = true }"] : []),
      file,
    ];
  }
  return [
    "--file-format=wav",
    "--rate=16000",
    "--channels=1",
    ...(source === "output" ? ["--device=@DEFAULT_MONITOR@"] : []),
    file,
  ];
}

/** The listening time preference: 5 to 20 seconds, 10 by default. */
export function parseSeconds(v: unknown): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 5 ? Math.min(20, n) : 10;
}

export function parseSource(v: unknown): Source {
  const t = String(v ?? "").trim().toLowerCase();
  return t === "mic" || t === "microphone" || t === "micro" ? "mic" : "output";
}

// ---------------------------------------------------------------------------
// Links

const enc = encodeURIComponent;
export const query = (s: Pick<Song, "artist" | "title">) => `${s.artist} ${s.title}`;

export function links(s: Song): { title: string; url: string }[] {
  return [
    // The web search opens the Spotify app when it is installed.
    { title: "Open in Spotify", url: `https://open.spotify.com/search/${enc(query(s))}` },
    { title: "Search on YouTube", url: `https://www.youtube.com/results?search_query=${enc(query(s))}` },
    { title: "Open in YouTube Music", url: `https://music.youtube.com/search?q=${enc(query(s))}` },
    ...(s.appleMusic ? [{ title: "Open in Apple Music", url: s.appleMusic }] : []),
    { title: "Search on Deezer", url: `https://www.deezer.com/search/${enc(query(s))}` },
    ...(s.shazam ? [{ title: "Open on Shazam", url: s.shazam }] : []),
  ];
}

// ---------------------------------------------------------------------------
// History

/** Newest first; the same song again within 15 minutes replaces the previous one. */
export function addToHistory(history: Song[], song: Song, max = 200): Song[] {
  const recent = history.filter((h) => !(h.key === song.key && song.at - h.at < 15 * 60_000));
  return [song, ...recent].slice(0, max);
}

export function dayLabel(at: number, now = Date.now()): string {
  const d = new Date(at), n = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(n) - startOf(d)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString("en-US", { weekday: "long" });
  return d.toLocaleDateString("en-US", {
    month: "long",
    year: d.getFullYear() === n.getFullYear() ? undefined : "numeric",
  });
}

export function timeOf(at: number): string {
  return new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

/** The song as markdown for the preview: lyrics when Shazam has them. */
export function songMarkdown(s: Song): string {
  const head = `## ${s.title}\n\n**${s.artist}**${s.album ? ` · ${s.album}` : ""}`;
  if (!s.lyrics?.length) return head;
  return `${head}\n\n${s.lyrics.map((l) => (l.trim() ? l : "")).join("  \n")}`;
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

export function installMarkdown(missing: { songrec: boolean; recorder: boolean }, family?: Family): string {
  const lines: string[] = [];
  if (missing.songrec) {
    const how: Record<Family, string> = {
      arch: "sudo pacman -S songrec",
      debian: "sudo add-apt-repository ppa:marin-m/songrec && sudo apt install songrec",
      fedora: "cargo install songrec",
      suse: "cargo install songrec",
    };
    lines.push(
      "**SongRec** asks Shazam which song it is:",
      "",
      `\`${how[family ?? "debian"]}\``,
      "",
      "or `cargo install songrec`. The Flatpak can't be used from Backslash: its command isn't on the PATH.",
    );
  }
  if (missing.recorder) {
    if (lines.length) lines.push("");
    lines.push(
      "**pw-record** (PipeWire) or **parecord** (PulseAudio) records a few seconds of sound:",
      "",
      `\`${
        {
          arch: "sudo pacman -S pipewire",
          debian: "sudo apt install pipewire-bin",
          fedora: "sudo dnf install pipewire-utils",
          suse: "sudo zypper install pipewire-tools",
        }[family ?? "debian"]
      }\``,
    );
  }
  return lines.join("\n");
}
