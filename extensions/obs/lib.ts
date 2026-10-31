// obs-websocket v5: the address, the Hello/Identify authentication, the
// messages, and what the status requests answer turned into rows. Pure (the
// SHA-256 comes from Web Crypto), tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Address

/** Same list as `[permissions] net`: this computer, the local network, Tailscale. */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home.arpa",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

export const DEFAULT_URL = "ws://localhost:4455";

function ipv4(host: string): number | undefined {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return undefined;
  return parts.reduce((n, p) => n * 256 + Number(p), 0);
}

/** Whether Deno's `--allow-net` with {@link HOSTS} lets us reach `host`. */
export function isAllowedHost(host: string, patterns = HOSTS): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  return patterns.some((p) => {
    if (p.startsWith("*.")) return h.endsWith(p.slice(1)) || h === p.slice(2);
    const cidr = /^([\d.]+)\/(\d+)$/.exec(p);
    if (cidr) {
      const ip = ipv4(h), net = ipv4(cidr[1]);
      if (ip === undefined || net === undefined) return false;
      const bits = Number(cidr[2]);
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return ((ip & mask) >>> 0) === ((net & mask) >>> 0);
    }
    return h === p;
  });
}

/** `localhost`, `192.168.1.5:4455`, `http://studio.lan` → a ws:// URL with OBS's default port. */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return DEFAULT_URL;
  text = text.replace(/^https?:\/\//i, (m) => (m.toLowerCase() === "https://" ? "wss://" : "ws://"));
  if (!/^wss?:\/\//i.test(text)) text = `ws://${text}`;
  try {
    const url = new URL(text);
    if (!url.port) url.port = "4455";
    return `${url.protocol}//${url.host}${url.pathname === "/" ? "" : url.pathname}`;
  } catch {
    throw new Error(`“${input}” is not an address: use something like ws://localhost:4455`);
  }
}

/** The address, refused early when the permissions would block it (with a clearer message than Deno's). */
export function checkedUrl(input: unknown): string {
  const url = normalizeUrl(input);
  const host = new URL(url).hostname;
  if (!isAllowedHost(host)) {
    throw new Error(
      `${host} is not on this computer or your local network: OBS can be reached at localhost, *.lan, *.local, 192.168.x.x…`,
    );
  }
  return url;
}

// ---------------------------------------------------------------------------
// Protocol

export const OP = {
  Hello: 0,
  Identify: 1,
  Identified: 2,
  Reidentify: 3,
  Event: 5,
  Request: 6,
  RequestResponse: 7,
  RequestBatch: 8,
  RequestBatchResponse: 9,
} as const;

/** Close codes obs-websocket uses (WebSocketCloseCode). */
export function closeMessage(code: number, reason = ""): string {
  switch (code) {
    case 4009:
      return "OBS refused the password: check it in Settings (OBS → Tools → WebSocket Server Settings → Show Connect Info)";
    case 4010:
      return "This OBS is too old: obs-websocket 5 (OBS 28 or newer) is needed";
    case 4011:
      return "OBS closed the connection";
    case 4008:
    case 4007:
    case 4006:
    case 4002:
    case 4003:
    case 4004:
    case 4005:
      return `OBS didn't understand a message${reason ? `: ${reason}` : ""}`;
    default:
      return reason ? `OBS closed the connection: ${reason}` : "OBS closed the connection";
  }
}

export const NOT_RUNNING =
  "OBS isn't running, or its WebSocket server is off: OBS → Tools → WebSocket Server Settings → Enable";

async function sha256Base64(text: string): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let binary = "";
  for (const b of hash) binary += String.fromCharCode(b);
  return btoa(binary);
}

/** base64(sha256(base64(sha256(password + salt)) + challenge)), as obs-websocket asks. */
export async function authString(password: string, salt: string, challenge: string): Promise<string> {
  return sha256Base64(await sha256Base64(password + salt) + challenge);
}

export interface Hello {
  obsWebSocketVersion?: string;
  rpcVersion: number;
  authentication?: { challenge: string; salt: string };
}

/** The Identify message answering a Hello; `eventSubscriptions: 0` since the views poll. */
export async function identify(hello: Hello, password: string): Promise<{ op: 1; d: Record<string, unknown> }> {
  const d: Record<string, unknown> = { rpcVersion: 1, eventSubscriptions: 0 };
  if (hello.authentication) {
    if (!password) {
      throw new AuthError(
        "OBS asks for a password: copy it from OBS → Tools → WebSocket Server Settings → Show Connect Info into Settings",
      );
    }
    d.authentication = await authString(password, hello.authentication.salt, hello.authentication.challenge);
  }
  return { op: OP.Identify, d };
}

export class AuthError extends Error {}

/** A request OBS answered with a failure: its status code and comment. */
export class RequestError extends Error {
  constructor(readonly requestType: string, readonly code: number, comment?: string) {
    super(requestMessage(requestType, code, comment));
  }
}

/** What a request's output is called: "ToggleRecord" → "recording". */
export function outputName(type: string): string {
  if (type.includes("ReplayBuffer")) return "the replay buffer";
  if (type.includes("VirtualCam")) return "the virtual camera";
  if (type.includes("Record")) return "recording";
  if (type.includes("Stream")) return "streaming";
  return "that";
}

/** A sentence for a failed request (RequestStatus codes). */
export function requestMessage(type: string, code: number, comment?: string): string {
  const said = comment ? `: ${comment}` : "";
  const output = outputName(type);
  switch (code) {
    case 207:
      return "OBS is still starting: try again in a moment";
    case 204:
      return `This OBS doesn't know ${type}: update OBS`;
    case 500:
      return output.startsWith("the ")
        ? `${output[4].toUpperCase()}${output.slice(5)} is already on`
        : `OBS is already ${output}`;
    case 501:
      return output.startsWith("the ") ? `${output[4].toUpperCase()}${output.slice(5)} is off` : `OBS isn't ${output}`;
    case 502:
      return "The recording is already paused";
    case 503:
      return "The recording isn't paused";
    case 504:
      return `${output === "that" ? "This output" : output.replace(/^the /, "The ")} is turned off in OBS's settings`;
    case 505:
      return "Not possible while Studio Mode is on";
    case 600:
      return `Not found${said}`;
    case 604:
      return `Not available right now${said}`;
    case 702:
      return type.includes("Stream")
        ? "OBS couldn't start streaming: check Settings → Stream in OBS"
        : `OBS couldn't do it${said}`;
    default:
      return `OBS couldn't ${humanType(type)}${said}`;
  }
}

/** "ToggleRecord" → "toggle record". */
export const humanType = (type: string) => type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// ---------------------------------------------------------------------------
// Status

export interface Output {
  active: boolean;
  paused?: boolean;
  reconnecting?: boolean;
  /** Milliseconds. */
  duration: number;
  bytes: number;
  /** 0 to 1, streaming only. */
  congestion?: number;
  skippedFrames?: number;
  totalFrames?: number;
}

export interface Scene {
  name: string;
  uuid?: string;
  index: number;
}

export interface AudioInput {
  name: string;
  kind: string;
  muted: boolean;
  /** Decibels; -Infinity when the fader is all the way down. */
  db?: number;
  /** desktop1, mic1…: one of OBS's global audio devices. */
  special?: string;
}

export interface Stats {
  cpu?: number;
  memory?: number;
  fps?: number;
  renderSkipped?: number;
  renderTotal?: number;
  disk?: number;
}

export interface Status {
  record: Output;
  stream: Output;
  virtualCam?: boolean;
  replayBuffer?: boolean;
  scenes: Scene[];
  current?: string;
  preview?: string;
  inputs: { name: string; kind: string }[];
  stats: Stats;
}

// deno-lint-ignore no-explicit-any
type Raw = any;

const n = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

/** GetRecordStatus or GetStreamStatus. */
export function parseOutput(d: Raw): Output {
  return {
    active: !!d?.outputActive,
    paused: d?.outputPaused === undefined ? undefined : !!d.outputPaused,
    reconnecting: d?.outputReconnecting === undefined ? undefined : !!d.outputReconnecting,
    duration: n(d?.outputDuration),
    bytes: n(d?.outputBytes),
    congestion: typeof d?.outputCongestion === "number" ? d.outputCongestion : undefined,
    skippedFrames: typeof d?.outputSkippedFrames === "number" ? d.outputSkippedFrames : undefined,
    totalFrames: typeof d?.outputTotalFrames === "number" ? d.outputTotalFrames : undefined,
  };
}

/** GetSceneList, top of OBS's scene list first (OBS numbers them from the bottom). */
export function parseScenes(d: Raw): { scenes: Scene[]; current?: string; preview?: string } {
  const raw: Raw[] = Array.isArray(d?.scenes) ? d.scenes : [];
  const scenes = raw
    .filter((s) => typeof s?.sceneName === "string")
    .map((s, i) => ({ name: s.sceneName as string, uuid: s.sceneUuid, index: n(s.sceneIndex, i) }))
    .sort((a, b) => b.index - a.index);
  return {
    scenes,
    current: d?.currentProgramSceneName ?? undefined,
    preview: d?.currentPreviewSceneName ?? undefined,
  };
}

export function parseStats(d: Raw): Stats {
  return {
    cpu: typeof d?.cpuUsage === "number" ? d.cpuUsage : undefined,
    memory: typeof d?.memoryUsage === "number" ? d.memoryUsage : undefined,
    fps: typeof d?.activeFps === "number" ? d.activeFps : undefined,
    renderSkipped: typeof d?.renderSkippedFrames === "number" ? d.renderSkippedFrames : undefined,
    renderTotal: typeof d?.renderTotalFrames === "number" ? d.renderTotalFrames : undefined,
    disk: typeof d?.availableDiskSpace === "number" ? d.availableDiskSpace : undefined,
  };
}

/** GetSpecialInputs: input name → desktop1, mic1… */
export function parseSpecial(d: Raw): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(d ?? {})) {
    if (typeof value === "string" && value) out.set(value, key);
  }
  return out;
}

export const SPECIAL_NAMES: Record<string, string> = {
  desktop1: "Desktop Audio",
  desktop2: "Desktop Audio 2",
  mic1: "Mic/Aux",
  mic2: "Mic/Aux 2",
  mic3: "Mic/Aux 3",
  mic4: "Mic/Aux 4",
};

/** What kind of audio an input carries, for its icon and subtitle. */
export function audioKind(kind: string, special?: string): "mic" | "desktop" | "media" | "other" {
  if (special?.startsWith("mic")) return "mic";
  if (special?.startsWith("desktop")) return "desktop";
  if (/input_capture|wasapi_input|coreaudio_input|jack_input|v4l2/i.test(kind)) return "mic";
  if (/output_capture|wasapi_output|coreaudio_output|wasapi_process|pipewire.*(app|output)/i.test(kind)) {
    return "desktop";
  }
  if (/ffmpeg_source|vlc_source|browser_source|media/i.test(kind)) return "media";
  return "other";
}

/** A readable kind: "pulse_input_capture" → "Audio input". */
export function kindLabel(kind: string): string {
  const k = kind.replace(/_v\d+$/, "");
  const known: Record<string, string> = {
    pulse_input_capture: "Audio input (PulseAudio)",
    pulse_output_capture: "Audio output (PulseAudio)",
    alsa_input_capture: "Audio input (ALSA)",
    jack_output_capture: "JACK",
    wasapi_input_capture: "Audio input",
    wasapi_output_capture: "Audio output",
    wasapi_process_output_capture: "Application audio",
    coreaudio_input_capture: "Audio input",
    coreaudio_output_capture: "Audio output",
    ffmpeg_source: "Media source",
    vlc_source: "VLC video",
    browser_source: "Browser",
    v4l2_input: "Video capture device",
  };
  return known[k] ?? k.replace(/[_-]+/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// Formatting

/** Milliseconds → "4:05" or "1:02:09". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const pad = (x: number) => String(x).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Decibels for a fader: "0 dB", "−6.0 dB", "−∞". */
export function formatDb(db?: number): string {
  if (db === undefined || Number.isNaN(db)) return "";
  if (!Number.isFinite(db) || db <= -100) return "−∞ dB";
  if (Math.abs(db) < 0.05) return "0 dB";
  return `${db < 0 ? "−" : "+"}${Math.abs(db).toFixed(1)} dB`;
}

/** obs-websocket sends -Infinity as null or a very low number. */
export function parseDb(v: unknown): number | undefined {
  if (v === null) return -Infinity;
  return typeof v === "number" ? v : undefined;
}

/** Dropped frames as "0.4 %", or nothing when none. */
export function dropped(skipped?: number, total?: number): string {
  if (!skipped || !total) return "";
  const pct = (skipped / total) * 100;
  return `${pct < 0.1 ? "<0.1" : pct.toFixed(1)} %`;
}

/** The status footer: "OBS 30.2.3 · 60 fps · CPU 3 %". */
export function statusLine(version: string | undefined, stats: Stats): string {
  return [
    version ? `OBS ${version}` : "OBS",
    stats.fps ? `${Math.round(stats.fps)} fps` : "",
    stats.cpu !== undefined ? `CPU ${stats.cpu.toFixed(stats.cpu < 10 ? 1 : 0)} %` : "",
  ].filter(Boolean).join(" · ");
}

/** "~/Videos/2026-10-31 12-00-00.mkv" from a full path. */
export function tilde(path: string, home: string): string {
  return home && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export const basename = (p: string) => p.split(/[\\/]/).pop() ?? p;
export const dirname = (p: string) => p.split(/[\\/]/).slice(0, -1).join("/") || "/";

/** A file name for a scene's screenshot. */
export function screenshotName(scene: string, stamp: number): string {
  let hash = 0;
  for (const ch of scene) hash = (hash * 31 + ch.codePointAt(0)!) >>> 0;
  return `scene-${hash.toString(36)}-${stamp.toString(36)}.jpg`;
}

/** "data:image/jpg;base64,…" → its bytes. */
export function decodeDataUrl(data: string): Uint8Array | undefined {
  const m = /^data:image\/[\w+.-]+;base64,(.+)$/s.exec(data);
  if (!m) return undefined;
  try {
    const binary = atob(m[1]);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return undefined;
  }
}
