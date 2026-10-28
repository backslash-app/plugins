// Parsing pactl (JSON and text), wpctl and EasyEffects, and formatting volumes.

export interface Port {
  name: string;
  description: string;
  available: boolean;
}

/** A sink (output) or source (input). */
export interface Device {
  /** pactl's index, or wpctl's node id. */
  index: number;
  /** pactl's name (alsa_input.…); wpctl has none, its id is used. */
  name: string;
  description: string;
  muted: boolean;
  /** Percent, averaged over channels. */
  volume: number;
  isDefault: boolean;
  /** RUNNING, IDLE, SUSPENDED. */
  state?: string;
  /** usb, pci, bluetooth. */
  bus?: string;
  /** webcam, headset, microphone, internal. */
  formFactor?: string;
  activePort?: string;
  ports: Port[];
  /** The sink a monitor source listens to. */
  monitorOf?: string;
  channels?: number;
  sampleSpec?: string;
}

/** An application playing (sink input) or recording (source output). */
export interface Stream {
  index: number;
  kind: "playback" | "recording";
  app: string;
  /** What it plays: a tab title, a song; generic names left out. */
  media?: string;
  binary?: string;
  iconName?: string;
  pid?: string;
  /** Index (pactl) or name of the device it plays on or records from. */
  device?: number;
  deviceName?: string;
  volume: number;
  muted: boolean;
  corked: boolean;
}

// ---------------------------------------------------------------------------
// pactl

/** `pactl --version` → 16.1. JSON output (`-f json`) came with PulseAudio 16. */
export function pactlVersion(text: string): number | undefined {
  const m = /pactl\s+(\d+(?:\.\d+)?)/.exec(text);
  return m ? Number(m[1]) : undefined;
}

export const supportsJson = (version: number | undefined) => version !== undefined && version >= 16;

/** A device or stream as pactl describes it, whichever the format. */
interface Raw {
  index: number;
  fields: Record<string, string>;
  properties: Record<string, string>;
  volumePercent: number;
  ports: Port[];
}

const average = (values: number[]) => values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : 0;

/** `front-left: 32768 /  50% / -18.06 dB,   front-right: 32768 /  50% / -18.06 dB` → 50. */
export function volumeFromText(text: string): number {
  return average([...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1])));
}

interface JsonVolume {
  [channel: string]: { value?: number; value_percent?: string; db?: string };
}

interface JsonEntry {
  index: number;
  name?: string;
  description?: string;
  state?: string;
  mute?: boolean;
  corked?: boolean;
  volume?: JsonVolume;
  sink?: number | string;
  source?: number | string;
  monitor_of_sink?: string | null;
  active_port?: string | null;
  sample_specification?: string;
  channel_map?: string;
  properties?: Record<string, string | number>;
  ports?: { name: string; description?: string; availability?: string }[];
}

function fromJson(e: JsonEntry): Raw {
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(e)) {
    if (v === null || typeof v === "object") continue;
    fields[k] = String(v);
  }
  return {
    index: e.index,
    fields,
    properties: Object.fromEntries(Object.entries(e.properties ?? {}).map(([k, v]) => [k, String(v)])),
    volumePercent: average(Object.values(e.volume ?? {}).map((c) => parseInt(c.value_percent ?? "0", 10))),
    ports: (e.ports ?? []).map((p) => ({
      name: p.name,
      description: p.description ?? p.name,
      available: p.availability !== "not available",
    })),
  };
}

/** Keys of `pactl list` text output, as the JSON output names them. */
const TEXT_KEYS: Record<string, string> = {
  "State": "state",
  "Name": "name",
  "Description": "description",
  "Mute": "mute",
  "Corked": "corked",
  "Sink": "sink",
  "Source": "source",
  "Monitor of Sink": "monitor_of_sink",
  "Active Port": "active_port",
  "Sample Specification": "sample_specification",
  "Channel Map": "channel_map",
};

/** `pactl list sources` (and sinks, sink-inputs, source-outputs) in English (LC_ALL=C). */
function fromText(text: string): Raw[] {
  const out: Raw[] = [];
  let cur: Raw | undefined;
  let block: "properties" | "ports" | "formats" | undefined;
  for (const line of text.split("\n")) {
    const head = /^(?:Sink|Source|Sink Input|Source Output) #(\d+)\s*$/.exec(line);
    if (head) {
      cur = { index: Number(head[1]), fields: {}, properties: {}, volumePercent: 0, ports: [] };
      out.push(cur);
      block = undefined;
      continue;
    }
    if (!cur || !line.trim()) continue;
    const depth = /^\t*/.exec(line)![0].length;
    const body = line.trim();
    if (depth >= 2 && block === "properties") {
      const m = /^([\w.-]+) = "(.*)"$/.exec(body);
      if (m) cur.properties[m[1]] = m[2].replace(/\\"/g, '"');
      continue;
    }
    if (depth >= 2 && block === "ports") {
      const m = /^([^:]+): (.+?) \((.*)\)$/.exec(body);
      if (m) cur.ports.push({ name: m[1], description: m[2], available: !/not available/.test(m[3]) });
      continue;
    }
    if (depth >= 2) continue;
    block = undefined;
    const m = /^([^:]+):\s?(.*)$/.exec(body);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "Properties") block = "properties";
    else if (key === "Ports") block = "ports";
    else if (key === "Formats") block = "formats";
    else if (key === "Volume") cur.volumePercent = volumeFromText(value);
    else if (TEXT_KEYS[key]) cur.fields[TEXT_KEYS[key]] = value.trim();
  }
  return out;
}

const yes = (v: string | undefined) => v === "true" || v === "yes";

/** Names pactl gives streams that say nothing. */
const GENERIC_MEDIA = /^(audio ?stream|playback|output|record|recstream|capture|audio|stream|default|.*\.wav)$/i;

function toDevice(r: Raw, defaultName: string): Device {
  const p = r.properties;
  const monitor = r.fields.monitor_of_sink && r.fields.monitor_of_sink !== "n/a" ? r.fields.monitor_of_sink : undefined;
  const channels = /(\d+)ch/.exec(r.fields.sample_specification ?? "")?.[1];
  return {
    index: r.index,
    name: r.fields.name ?? String(r.index),
    description: r.fields.description || p["device.description"] || p["node.nick"] || r.fields.name || "Unknown",
    muted: yes(r.fields.mute),
    volume: r.volumePercent,
    isDefault: r.fields.name === defaultName,
    state: r.fields.state || undefined,
    bus: p["device.bus"] || undefined,
    formFactor: p["device.form_factor"] || undefined,
    activePort: r.fields.active_port && r.fields.active_port !== "n/a" ? r.fields.active_port : undefined,
    ports: r.ports,
    monitorOf: monitor ?? (p["device.class"] === "monitor" || /\.monitor$/.test(r.fields.name ?? "") ? "?" : undefined),
    channels: channels ? Number(channels) : undefined,
    sampleSpec: r.fields.sample_specification || undefined,
  };
}

function toStream(r: Raw, kind: Stream["kind"]): Stream {
  const p = r.properties;
  const media = p["media.name"];
  const target = kind === "playback" ? r.fields.sink : r.fields.source;
  return {
    index: r.index,
    kind,
    app: p["application.name"] || p["node.name"] || p["application.process.binary"] || media || `Stream ${r.index}`,
    media: media && !GENERIC_MEDIA.test(media) && media !== p["application.name"] ? media : undefined,
    binary: p["application.process.binary"] || undefined,
    iconName: p["application.icon_name"] || undefined,
    pid: p["application.process.id"] || undefined,
    device: target !== undefined && /^\d+$/.test(target) ? Number(target) : undefined,
    volume: r.volumePercent,
    muted: yes(r.fields.mute),
    corked: yes(r.fields.corked),
  };
}

const parse = (text: string, json: boolean): Raw[] =>
  json ? (JSON.parse(text || "[]") as JsonEntry[]).map(fromJson) : fromText(text);

/** `pactl [-f json] list sources|sinks`. */
export function parseDevices(text: string, json: boolean, defaultName: string): Device[] {
  return parse(text, json).map((r) => toDevice(r, defaultName));
}

/** `pactl [-f json] list sink-inputs|source-outputs`, without pavucontrol's level meters. */
export function parseStreams(text: string, json: boolean, kind: Stream["kind"]): Stream[] {
  return parse(text, json)
    .filter((r) =>
      r.properties["application.id"] !== "org.PulseAudio.pavucontrol" &&
      r.properties["media.name"] !== "Peak detect" &&
      !/^(pavucontrol|pwvucontrol)$/.test(r.properties["application.process.binary"] ?? "")
    )
    .map((r) => toStream(r, kind));
}

/** `pactl info`: `Default Source: alsa_input.…`. */
export function parseInfoDefault(text: string, which: "Sink" | "Source"): string {
  return new RegExp(`^Default ${which}: (.+)$`, "m").exec(text)?.[1].trim() ?? "";
}

/** `pactl get-source-mute @DEFAULT_SOURCE@` → `Mute: yes`. */
export const parseMute = (text: string) => /Mute:\s*yes/i.test(text);

// ---------------------------------------------------------------------------
// wpctl (WirePlumber), when pactl isn't installed

export interface WpNode {
  id: number;
  name: string;
  isDefault: boolean;
  volume?: number;
  muted: boolean;
}

export interface WpStatus {
  sinks: WpNode[];
  sources: WpNode[];
  streams: { id: number; app: string; kind: Stream["kind"]; target?: string }[];
}

/** `wpctl status`: the Audio section's sinks, sources and streams. */
export function parseWpctlStatus(text: string): WpStatus {
  const out: WpStatus = { sinks: [], sources: [], streams: [] };
  let section = "";
  let list: string | undefined;
  let stream: WpStatus["streams"][number] | undefined;
  for (const raw of text.split("\n")) {
    if (/^\S/.test(raw)) {
      section = raw.trim();
      list = undefined;
      continue;
    }
    if (section !== "Audio") continue;
    const line = raw.replace(/[│├└─]/g, " ");
    const header = /^\s*([A-Z][\w ]+):\s*$/.exec(line);
    if (header) {
      list = header[1].trim();
      stream = undefined;
      continue;
    }
    if (list === "Sinks" || list === "Sources") {
      const m = /^\s*(\*)?\s*(\d+)\.\s+(.+?)\s*(?:\[vol:\s*([\d.]+)(\s+MUTED)?\])?\s*$/.exec(line);
      if (!m) continue;
      const node: WpNode = {
        id: Number(m[2]),
        name: m[3].trim(),
        isDefault: !!m[1],
        volume: m[4] ? Math.round(Number(m[4]) * 100) : undefined,
        muted: !!m[5],
      };
      (list === "Sinks" ? out.sinks : out.sources).push(node);
    } else if (list === "Streams") {
      // Streams at the first level, their ports below: "65. output_FL > Built-in Audio:playback_FL [active]".
      const m = /^(\s*)(\d+)\.\s+(.+?)\s*$/.exec(line);
      if (!m) continue;
      const port = /^(input|output|monitor|capture|playback)_\w+\s*(<|>)\s*(.+?)(?::[\w-]+)?\s*(\[.*\])?\s*$/.exec(
        m[3],
      );
      if (port && stream) {
        stream.kind = port[2] === ">" ? "playback" : "recording";
        stream.target ??= port[3].trim();
      } else if (!port) {
        stream = { id: Number(m[2]), app: m[3].trim(), kind: "playback" };
        out.streams.push(stream);
      }
    }
  }
  return out;
}

/** `wpctl get-volume 64` → `Volume: 0.60 [MUTED]`. */
export function parseWpctlVolume(text: string): { volume: number; muted: boolean } {
  const m = /Volume:\s*([\d.]+)/.exec(text);
  return { volume: m ? Math.round(Number(m[1]) * 100) : 0, muted: /MUTED/.test(text) };
}

export function wpDevice(n: WpNode): Device {
  return {
    index: n.id,
    name: String(n.id),
    description: n.name,
    muted: n.muted,
    volume: n.volume ?? 0,
    isDefault: n.isDefault,
    ports: [],
  };
}

// ---------------------------------------------------------------------------
// Volumes

export const MAX_VOLUME = 150;

export const clampVolume = (v: number) => Math.max(0, Math.min(MAX_VOLUME, Math.round(v)));

/** The next step up or down, on a multiple of the step: 47 + 5 → 50. */
export function stepVolume(current: number, delta: number): number {
  const step = Math.abs(delta);
  const next = delta > 0 ? Math.floor(current / step) * step + step : Math.ceil(current / step) * step - step;
  return clampVolume(next);
}

export function volumeColor(volume: number, muted: boolean): "gray" | "red" | "orange" | "green" {
  if (muted || volume === 0) return "gray";
  if (volume > 100) return "red";
  if (volume < 20) return "orange";
  return "green";
}

/** A little bar for the row: `▮▮▮▮▯▯▯▯▯▯`. */
export function volumeBar(volume: number, width = 10): string {
  const filled = Math.round(Math.min(100, volume) / 100 * width);
  return "▮".repeat(filled) + "▯".repeat(width - filled);
}

/** How a device is connected, for humans. */
export function deviceKind(d: Pick<Device, "bus" | "formFactor" | "description" | "name">): string {
  const text = `${d.description} ${d.name}`.toLowerCase();
  if (d.bus === "bluetooth" || /bluez|bluetooth/.test(text)) return "Bluetooth";
  if (d.formFactor === "webcam" || /webcam|camera|c9\d\d/.test(text)) return "Webcam";
  if (d.formFactor === "headset" || /headset|casque/.test(text)) return "Headset";
  if (d.bus === "usb" || /usb/.test(text)) return "USB";
  if (/easyeffects/.test(text)) return "EasyEffects";
  if (/virtual|null|loopback|rnnoise|noise/.test(text)) return "Virtual";
  return "Built-in";
}

// ---------------------------------------------------------------------------
// EasyEffects

export type PresetKind = "output" | "input";

/** Where EasyEffects keeps its presets: 7.x in ~/.config, 8.x in ~/.local/share, and the Flatpak's. */
export function presetDirs(home: string): { dir: string; kind: PresetKind; flatpak: boolean }[] {
  const flat = `${home}/.var/app/com.github.wwmm.easyeffects`;
  const bases: [string, boolean][] = [
    [`${home}/.local/share/easyeffects`, false],
    [`${home}/.config/easyeffects`, false],
    [`${flat}/data/easyeffects`, true],
    [`${flat}/config/easyeffects`, true],
  ];
  return bases.flatMap(([base, flatpak]) =>
    (["output", "input"] as const).map((kind) => ({ dir: `${base}/${kind}`, kind, flatpak }))
  );
}

/** `easyeffects -p`: `Output Presets: Bass Boost,Loudness,` and `Input Presets: …`. */
export function parsePresetList(text: string): { output: string[]; input: string[] } {
  const list = (label: string) =>
    (new RegExp(`^${label} Presets:\\s*(.*)$`, "mi").exec(text)?.[1] ?? "")
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
  return { output: list("Output"), input: list("Input") };
}

const PLUGIN_NAMES: Record<string, string> = {
  autogain: "Autogain",
  bass_enhancer: "Bass Enhancer",
  bass_loudness: "Bass Loudness",
  compressor: "Compressor",
  convolver: "Convolver",
  crossfeed: "Crossfeed",
  crystalizer: "Crystalizer",
  deepfilternet: "DeepFilterNet",
  deesser: "Deesser",
  delay: "Delay",
  echo_canceller: "Echo Canceller",
  equalizer: "Equalizer",
  exciter: "Exciter",
  expander: "Expander",
  filter: "Filter",
  gate: "Gate",
  level_meter: "Level Meter",
  limiter: "Limiter",
  loudness: "Loudness",
  maximizer: "Maximizer",
  multiband_compressor: "Multiband Compressor",
  multiband_gate: "Multiband Gate",
  pitch: "Pitch",
  reverb: "Reverb",
  rnnoise: "Noise Reduction",
  speex: "Speex",
  stereo_tools: "Stereo Tools",
};

/** The effects of a preset file, in order: `["Equalizer", "Compressor"]`. */
export function presetEffects(json: string): string[] {
  try {
    const o = JSON.parse(json) as Record<string, { plugins_order?: string[] }>;
    const section = o.output ?? o.input ?? Object.values(o)[0];
    return (section?.plugins_order ?? []).map((p) => {
      const base = p.replace(/#\d+$/, "");
      return PLUGIN_NAMES[base] ?? base.replace(/_/g, " ");
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------

/** A name safe to show in a toast: `alsa_input.usb-Blue_Yeti` stays, long descriptions are cut. */
export const short = (s: string, max = 40) => s.length > max ? `${s.slice(0, max - 1)}…` : s;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
