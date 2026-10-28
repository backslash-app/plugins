// Pure helpers for Privacy: who uses the camera, the microphone, the screen and the location.

export type Kind = "camera" | "microphone" | "screen" | "location";

/** One app using a sensitive device. */
export interface Use {
  kind: Kind;
  /** A stable key, for "in use since". */
  key: string;
  app: string;
  pid?: number;
  binary?: string;
  /** Flatpak / portal app id. */
  appId?: string;
  /** The device or source used: "Integrated Camera", "Built-in Audio Analog Stereo"… */
  device?: string;
  /** How it was found. */
  via: "pipewire" | "pulse" | "device" | "geoclue";
  /** PulseAudio source-output index, to mute the stream. */
  streamIndex?: number;
  /** Name of the PulseAudio source (microphone), to mute it. */
  sourceName?: string;
  sourceMuted?: boolean;
  streamMuted?: boolean;
  /** Corked: the stream exists but is paused. */
  paused?: boolean;
}

// ---------------------------------------------------------------------------
// PipeWire (pw-dump)

interface PwObject {
  id: number;
  type: string;
  info?: {
    props?: Record<string, unknown>;
    state?: string;
    "output-node-id"?: number;
    "input-node-id"?: number;
  };
}

const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
const int = (v: unknown) => {
  const n = Number(v);
  return v !== undefined && v !== null && v !== "" && Number.isFinite(n) ? n : undefined;
};

/** Daemons that hold devices on behalf of apps: they aren't "the app using the camera". */
export const PLUMBING = new Set([
  "pipewire",
  "wireplumber",
  "pipewire-media-session",
  "pipewire-pulse",
  "pulseaudio",
  "xdg-desktop-portal",
]);

const SCREEN_HINT =
  /screen|screencast|xdpw|xdg-desktop-portal|gnome-shell|mutter|kwin|hyprland|wlroots|monitor|desktop/i;

/** Camera, microphone and screen-sharing users seen in `pw-dump`. */
export function parsePwDump(json: string): Use[] {
  let objects: PwObject[];
  try {
    objects = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(objects)) return [];
  const nodes = new Map<number, PwObject>();
  const clients = new Map<number, Record<string, unknown>>();
  const links: { from: number; to: number; state?: string }[] = [];
  for (const o of objects) {
    if (o.type === "PipeWire:Interface:Node") nodes.set(o.id, o);
    else if (o.type === "PipeWire:Interface:Client") clients.set(o.id, o.info?.props ?? {});
    else if (o.type === "PipeWire:Interface:Link" && o.info) {
      const from = o.info["output-node-id"];
      const to = o.info["input-node-id"];
      if (from !== undefined && to !== undefined) links.push({ from, to, state: o.info.state });
    }
  }
  const props = (n: PwObject) => n.info?.props ?? {};
  const cls = (n?: PwObject) => str(n && props(n)["media.class"]) ?? "";
  /** The app behind a node: its own props, else its client's. */
  const owner = (n: PwObject) => {
    const p = props(n);
    const c = clients.get(int(p["client.id"]) ?? -1) ?? {};
    const pick = (k: string) => str(p[k]) ?? str(c[k]);
    return {
      app: pick("application.name") ?? pick("application.process.binary") ?? str(p["node.name"]) ?? "Unknown app",
      pid: int(p["application.process.id"]) ?? int(c["application.process.id"]),
      binary: pick("application.process.binary"),
      appId: pick("pipewire.access.portal.app_id") ?? pick("flatpak.app_id"),
    };
  };
  const label = (n: PwObject) =>
    str(props(n)["node.description"]) ?? str(props(n)["node.nick"]) ?? str(props(n)["node.name"]);
  const isCamera = (n: PwObject) => {
    const p = props(n);
    return cls(n) === "Video/Source" &&
      (/^(v4l2|libcamera)$/.test(str(p["device.api"]) ?? "") || /^(v4l2|libcamera)/.test(str(p["node.name"]) ?? "") ||
        /^(v4l2|libcamera):/.test(str(p["object.path"]) ?? ""));
  };
  const isScreen = (n: PwObject) => {
    if (cls(n) !== "Video/Source" || isCamera(n)) return false;
    const o = owner(n);
    const text = [str(props(n)["node.name"]), label(n), o.app, o.binary].join(" ");
    return SCREEN_HINT.test(text);
  };
  const isMic = (n?: PwObject) => !!n && /^Audio\/Source(\/Virtual)?$/.test(cls(n));

  const uses: Use[] = [];
  const consumersOf = (src: PwObject) =>
    links.filter((l) => l.from === src.id && l.state !== "error").map((l) => nodes.get(l.to)).filter((
      n,
    ): n is PwObject => !!n && cls(n).startsWith("Stream/Input"));

  for (const n of nodes.values()) {
    if (isCamera(n) || isScreen(n)) {
      const kind: Kind = isCamera(n) ? "camera" : "screen";
      const consumers = [...new Map(consumersOf(n).map((c) => [c.id, c])).values()];
      for (const c of consumers) {
        const o = owner(c);
        uses.push({ kind, key: `${kind}:pw:${o.pid ?? o.app}`, ...o, device: label(n), via: "pipewire" });
      }
      // A running screencast whose viewer can't be told: the screen is shared all the same.
      if (consumers.length === 0 && n.info?.state === "running" && kind === "screen") {
        const o = owner(n);
        uses.push({ kind, key: `screen:pw:${n.id}`, ...o, device: label(n), via: "pipewire" });
      }
    }
  }
  for (const n of nodes.values()) {
    if (cls(n) !== "Stream/Input/Audio") continue;
    const sources = links.filter((l) => l.to === n.id).map((l) => nodes.get(l.from)).filter(isMic);
    if (sources.length === 0) continue;
    const o = owner(n);
    if (PLUMBING.has(o.binary ?? "")) continue;
    uses.push({
      kind: "microphone",
      key: `microphone:pw:${o.pid ?? o.app}`,
      ...o,
      device: label(sources[0]!),
      via: "pipewire",
      paused: n.info?.state !== undefined && n.info.state !== "running",
    });
  }
  return dedupe(uses);
}

// ---------------------------------------------------------------------------
// PulseAudio / pipewire-pulse (pactl -f json)

interface PaSource {
  index: number;
  name: string;
  description?: string;
  mute?: boolean;
  properties?: Record<string, string>;
}

interface PaSourceOutput {
  index: number;
  source: number;
  client?: string;
  corked?: boolean;
  mute?: boolean;
  properties?: Record<string, string>;
}

/** Recording streams from `pactl -f json list source-outputs`, monitors and level meters left out. */
export function parseSourceOutputs(outputsJson: string, sourcesJson: string): Use[] {
  let outputs: PaSourceOutput[];
  let sources: PaSource[];
  try {
    outputs = JSON.parse(outputsJson);
    sources = JSON.parse(sourcesJson || "[]");
  } catch {
    return [];
  }
  if (!Array.isArray(outputs)) return [];
  const byIndex = new Map((Array.isArray(sources) ? sources : []).map((s) => [s.index, s]));
  const uses: Use[] = [];
  for (const o of outputs) {
    const p = o.properties ?? {};
    const src = byIndex.get(o.source);
    const isMonitor = src ? src.name.endsWith(".monitor") || src.properties?.["device.class"] === "monitor" : false;
    if (isMonitor) continue;
    // pavucontrol's and desktop sound panels' level meters.
    if (p["media.name"] === "Peak detect" || p["stream.monitor"] === "true" || p["media.role"] === "abstract") continue;
    if (PLUMBING.has(p["application.process.binary"] ?? "")) continue;
    const pid = int(p["application.process.id"]);
    const app = p["application.name"] ?? p["application.process.binary"] ?? p["node.name"] ?? "Unknown app";
    uses.push({
      kind: "microphone",
      key: `microphone:pw:${pid ?? app}`,
      app,
      pid,
      binary: p["application.process.binary"],
      appId: p["pipewire.access.portal.app_id"] ?? p["application.id"],
      device: src?.description ?? src?.name,
      via: "pulse",
      streamIndex: o.index,
      sourceName: src?.name,
      sourceMuted: src?.mute,
      streamMuted: o.mute,
      paused: o.corked,
    });
  }
  return dedupe(uses);
}

/** One row per app and kind (an app may open several streams). */
function dedupe(uses: Use[]): Use[] {
  const out = new Map<string, Use>();
  for (const u of uses) {
    const prev = out.get(u.key);
    if (!prev || (prev.paused && !u.paused)) out.set(u.key, u);
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Devices and processes

/** `fuser /dev/video0` stdout: ` 1234 5678m` → pids. */
export function parseFuser(out: string): number[] {
  return [...out.matchAll(/(\d+)[a-zA-Z]*/g)].map((m) => Number(m[1]));
}

export interface Proc {
  pid: number;
  /** Seconds since it started. */
  elapsed: number;
  user: string;
  comm: string;
  args: string;
}

/** `ps -o pid=,etimes=,user=,comm=,args= -p …` */
export function parsePs(out: string): Map<number, Proc> {
  const map = new Map<number, Proc>();
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    if (m) map.set(Number(m[1]), { pid: Number(m[1]), elapsed: Number(m[2]), user: m[3], comm: m[4], args: m[5] });
  }
  return map;
}

/** Camera users found by holding /dev/video*, PipeWire's own processes left out. */
export function deviceUses(holders: { device: string; pids: number[] }[], procs: Map<number, Proc>): Use[] {
  const uses: Use[] = [];
  for (const { device, pids } of holders) {
    for (const pid of pids) {
      const p = procs.get(pid);
      if (p && PLUMBING.has(p.comm)) continue;
      const name = p?.comm ?? `PID ${pid}`;
      uses.push({
        kind: "camera",
        key: `camera:pw:${pid}`,
        app: prettyApp(name),
        pid,
        binary: p?.comm,
        device,
        via: "device",
      });
    }
  }
  return dedupe(uses);
}

/** "firefox" → "Firefox", "google-chrome" → "Google Chrome". */
export function prettyApp(name: string): string {
  if (/[A-Z]/.test(name)) return name;
  return name.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Merges the sources: the first one to report an app (by pid) wins, later ones fill the blanks. */
export function mergeUses(...lists: Use[][]): Use[] {
  const out = new Map<string, Use>();
  for (const list of lists) {
    for (const u of list) {
      const key = u.pid ? `${u.kind}:pid:${u.pid}` : u.key;
      const prev = out.get(key);
      if (!prev) out.set(key, { ...u, key: u.pid ? `${u.kind}:${u.pid}` : u.key });
      else {
        for (const [k, v] of Object.entries(u)) {
          if ((prev as unknown as Record<string, unknown>)[k] === undefined) {
            (prev as unknown as Record<string, unknown>)[k] = v;
          }
        }
      }
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// GeoClue (busctl)

/** Client object paths from `busctl --list tree org.freedesktop.GeoClue2`. */
export function parseGeoclueClients(out: string): string[] {
  return out.split("\n").map((l) => l.trim().replace(/^[└├│─\s]+/, "")).filter((l) =>
    /^\/org\/freedesktop\/GeoClue2\/Client\/\d+$/.test(l)
  );
}

/** `busctl --json=short get-property …` → the value. */
export function busValue(json: string): unknown {
  try {
    return JSON.parse(json)?.data;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Words

export const KIND_TITLE: Record<Kind, string> = {
  camera: "Camera",
  microphone: "Microphone",
  screen: "Screen Sharing",
  location: "Location",
};

/** "Camera and microphone in use", "Screen shared", or null. */
export function subtitle(uses: Use[]): string | null {
  const active = uses.filter((u) => !u.paused);
  const has = (k: Kind) => active.some((u) => u.kind === k);
  const devices = [has("camera") && "camera", has("microphone") && "microphone", has("location") && "location"]
    .filter((x): x is string => !!x);
  const parts: string[] = [];
  if (devices.length) {
    const words = devices.length === 1 ? devices[0] : `${devices.slice(0, -1).join(", ")} and ${devices.at(-1)}`;
    parts.push(`${words[0].toUpperCase()}${words.slice(1)} in use`);
  }
  if (has("screen")) parts.push(parts.length ? "screen shared" : "Screen shared");
  return parts.length ? parts.join(", ") : null;
}

/** "3 min", "1 h 05 min", "12 s". */
export function since(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h ${String(m % 60).padStart(2, "0")} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
