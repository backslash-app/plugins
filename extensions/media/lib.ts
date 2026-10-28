// MPRIS over busctl's JSON output. Pure parsing, tested in lib_test.ts.

/** Removes busctl's `{ type, data }` wrappers, recursively. */
export function unwrap(value: any): any {
  if (Array.isArray(value)) return value.map(unwrap);
  if (value && typeof value === "object") {
    if ("type" in value && "data" in value && Object.keys(value).length === 2) return unwrap(value.data);
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, unwrap(v)]));
  }
  return value;
}

/** The output of `busctl --json=short call … GetAll s <iface>`. */
export function parseGetAll(out: string): Record<string, any> {
  const data = unwrap(JSON.parse(out));
  return Array.isArray(data) ? data[0] ?? {} : data;
}

export interface Player {
  bus: string;
  name: string;
  status: "Playing" | "Paused" | "Stopped";
  title: string;
  artist: string;
  album: string;
  art?: string;
  /** Microseconds. */
  length: number;
  position: number;
  volume?: number;
  /** A web page for the track (Spotify gives one). */
  url?: string;
  shuffle?: boolean;
  loop?: "None" | "Track" | "Playlist";
  canNext: boolean;
  canPrevious: boolean;
  canRaise: boolean;
}

export function player(bus: string, props: Record<string, any>, root: Record<string, any>): Player {
  const meta = props.Metadata ?? {};
  const artist = meta["xesam:artist"];
  return {
    bus,
    name: root.Identity || bus.replace("org.mpris.MediaPlayer2.", "").split(".")[0],
    status: props.PlaybackStatus ?? "Stopped",
    title: meta["xesam:title"] || "Nothing playing",
    artist: Array.isArray(artist) ? artist.join(", ") : artist ?? "",
    album: meta["xesam:album"] ?? "",
    art: meta["mpris:artUrl"] || undefined,
    length: Number(meta["mpris:length"] ?? 0),
    position: Number(props.Position ?? 0),
    volume: typeof props.Volume === "number" ? props.Volume : undefined,
    url: typeof meta["xesam:url"] === "string" && meta["xesam:url"].startsWith("https://")
      ? meta["xesam:url"]
      : undefined,
    shuffle: typeof props.Shuffle === "boolean" ? props.Shuffle : undefined,
    loop: props.LoopStatus,
    canNext: props.CanGoNext !== false,
    canPrevious: props.CanGoPrevious !== false,
    canRaise: root.CanRaise === true,
  };
}

/** Playing first, then paused, then the rest. */
export function rank(players: Player[]): Player[] {
  const order = { Playing: 0, Paused: 1, Stopped: 2 };
  return [...players].sort((a, b) => order[a.status] - order[b.status]);
}

/** 61000000 → "1:01". */
export function clock(us: number): string {
  const s = Math.floor(us / 1_000_000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
