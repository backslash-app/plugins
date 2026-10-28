// Torrents from Transmission, qBittorrent and Deluge in one shape, and how
// to show them: states, speeds, ETAs, sorting, links.

/**
 * Where a torrent client usually runs, as declared in `[permissions] net`
 * (kept equal by a test): this computer, local names, private networks and
 * Tailscale. Extensions declare their hosts statically.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.ts.net",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "100.64.0.0/10",
];

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

export const isLocalHost = (host: string) => ["localhost", "127.0.0.1", "::1", "[::1]"].includes(host.toLowerCase());

// ---------------------------------------------------------------------------
// Clients

export type ClientKind = "transmission" | "qbittorrent" | "deluge";

export const CLIENTS: Record<ClientKind, { title: string; defaultUrl: string; port: number }> = {
  transmission: { title: "Transmission", defaultUrl: "http://localhost:9091", port: 9091 },
  qbittorrent: { title: "qBittorrent", defaultUrl: "http://localhost:8080", port: 8080 },
  deluge: { title: "Deluge", defaultUrl: "http://localhost:8112", port: 8112 },
};

/** The client preference: a name (loosely spelled), or undefined for "detect". */
export function clientKind(input: unknown): ClientKind | undefined {
  const s = String(input ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s || s === "auto") return undefined;
  if (s.startsWith("trans") || s === "tr") return "transmission";
  if (s.startsWith("qb") || s.startsWith("qbit")) return "qbittorrent";
  if (s.startsWith("del")) return "deluge";
  return undefined;
}

/** `localhost:9091/transmission/web/` → `http://localhost:9091`: the address without the web UI's path. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    // Transmission's web UI lives under /transmission/web; a reverse proxy may add its own prefix.
    const path = u.pathname.replace(/\/transmission(\/(web|rpc)?\/?)?$/, "").replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** A guess from the address alone: the default ports and Transmission's path. */
export function guessKind(input: unknown): ClientKind | undefined {
  const raw = String(input ?? "");
  if (/\/transmission\b/.test(raw)) return "transmission";
  try {
    const port = Number(new URL(normalizeUrl(raw)).port);
    return (Object.keys(CLIENTS) as ClientKind[]).find((k) => CLIENTS[k].port === port);
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Torrents

export type State =
  | "error"
  | "downloading"
  | "metadata"
  | "stalled"
  | "queued"
  | "checking"
  | "moving"
  | "seeding"
  | "paused"
  | "completed";

export interface Torrent {
  /** What the client's API takes: Transmission's number, or the info hash. */
  id: string;
  hash: string;
  name: string;
  /** From 0 to 1. */
  progress: number;
  /** Bytes per second. */
  down: number;
  up: number;
  /** Seconds left, when known. */
  eta?: number;
  ratio: number;
  state: State;
  size: number;
  downloaded: number;
  uploaded?: number;
  savePath: string;
  magnet?: string;
  /** Transmission: -1, 0, 1. qBittorrent and Deluge: the position in the queue (0 = none). */
  priority?: number;
  queue?: number;
  error?: string;
  /** Unix ms. */
  added?: number;
  seeds?: number;
  peers?: number;
  tracker?: string;
  category?: string;
  labels?: string[];
}

const num = (v: unknown, fallback = 0) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
const str = (v: unknown) => typeof v === "string" ? v : "";

/** Unknown, infinite and nonsensical ETAs (Transmission -1/-2, qBittorrent 8640000) are undefined. */
export function cleanEta(eta: unknown): number | undefined {
  const n = num(eta, -1);
  return n > 0 && n < 8640000 ? n : undefined;
}

// --- Transmission ----------------------------------------------------------

export const TRANSMISSION_FIELDS = [
  "id",
  "hashString",
  "name",
  "percentDone",
  "rateDownload",
  "rateUpload",
  "eta",
  "uploadRatio",
  "status",
  "error",
  "errorString",
  "sizeWhenDone",
  "totalSize",
  "downloadedEver",
  "uploadedEver",
  "downloadDir",
  "magnetLink",
  "bandwidthPriority",
  "queuePosition",
  "addedDate",
  "peersConnected",
  "peersSendingToUs",
  "metadataPercentComplete",
  "isFinished",
  "labels",
  "trackerStats",
];

export interface TransmissionTorrent {
  id: number;
  hashString?: string;
  name?: string;
  percentDone?: number;
  rateDownload?: number;
  rateUpload?: number;
  eta?: number;
  uploadRatio?: number;
  status?: number;
  error?: number;
  errorString?: string;
  sizeWhenDone?: number;
  totalSize?: number;
  downloadedEver?: number;
  uploadedEver?: number;
  downloadDir?: string;
  magnetLink?: string;
  bandwidthPriority?: number;
  queuePosition?: number;
  addedDate?: number;
  peersConnected?: number;
  peersSendingToUs?: number;
  metadataPercentComplete?: number;
  isFinished?: boolean;
  labels?: string[];
  trackerStats?: { host?: string }[];
}

/** Transmission's `status`: 0 stopped, 1 check queued, 2 checking, 3 download queued, 4 downloading, 5 seed queued, 6 seeding. */
export function transmissionState(t: TransmissionTorrent): State {
  if (t.error) return "error";
  switch (t.status) {
    case 0:
      return num(t.percentDone) >= 1 ? "completed" : "paused";
    case 1:
    case 2:
      return "checking";
    case 3:
    case 5:
      return "queued";
    case 4:
      if (num(t.metadataPercentComplete, 1) < 1) return "metadata";
      return num(t.rateDownload) > 0 || num(t.peersSendingToUs) > 0 ? "downloading" : "stalled";
    case 6:
      return "seeding";
    default:
      return "paused";
  }
}

export function fromTransmission(t: TransmissionTorrent): Torrent {
  const host = t.trackerStats?.find((s) => s.host)?.host;
  return {
    id: String(t.id),
    hash: str(t.hashString),
    name: str(t.name) || str(t.hashString),
    progress: num(t.percentDone),
    down: num(t.rateDownload),
    up: num(t.rateUpload),
    eta: cleanEta(t.eta),
    ratio: Math.max(0, num(t.uploadRatio)),
    state: transmissionState(t),
    size: num(t.sizeWhenDone, num(t.totalSize)),
    downloaded: num(t.downloadedEver),
    uploaded: num(t.uploadedEver),
    savePath: str(t.downloadDir),
    magnet: str(t.magnetLink) || undefined,
    priority: num(t.bandwidthPriority),
    queue: t.queuePosition,
    error: t.error ? str(t.errorString) || "Error" : undefined,
    added: t.addedDate ? t.addedDate * 1000 : undefined,
    peers: t.peersConnected,
    tracker: host ? host.replace(/^\w+:\/\//, "").replace(/[:/].*$/, "") : undefined,
    labels: t.labels?.length ? t.labels : undefined,
  };
}

// --- qBittorrent -----------------------------------------------------------

export interface QbitTorrent {
  hash: string;
  name?: string;
  progress?: number;
  dlspeed?: number;
  upspeed?: number;
  eta?: number;
  ratio?: number;
  state?: string;
  size?: number;
  total_size?: number;
  downloaded?: number;
  uploaded?: number;
  save_path?: string;
  content_path?: string;
  magnet_uri?: string;
  priority?: number;
  added_on?: number;
  num_seeds?: number;
  num_leechs?: number;
  tracker?: string;
  category?: string;
  tags?: string;
}

/** qBittorrent's `state` strings (API v2; v5 says "stopped" where v4 said "paused"). */
export function qbitState(state: string | undefined, progress = 0): State {
  switch (state) {
    case "error":
    case "missingFiles":
      return "error";
    case "downloading":
    case "forcedDL":
      return "downloading";
    case "metaDL":
    case "forcedMetaDL":
      return "metadata";
    case "stalledDL":
      return "stalled";
    case "queuedDL":
    case "queuedUP":
    case "allocating":
      return "queued";
    case "checkingDL":
    case "checkingUP":
    case "checkingResumeData":
      return "checking";
    case "moving":
      return "moving";
    case "uploading":
    case "forcedUP":
    case "stalledUP":
      return "seeding";
    case "pausedUP":
    case "stoppedUP":
      return "completed";
    case "pausedDL":
    case "stoppedDL":
      return "paused";
    default:
      return progress >= 1 ? "completed" : "paused";
  }
}

export function fromQbit(t: QbitTorrent): Torrent {
  const state = qbitState(t.state, num(t.progress));
  return {
    id: t.hash,
    hash: t.hash,
    name: str(t.name) || t.hash,
    progress: num(t.progress),
    down: num(t.dlspeed),
    up: num(t.upspeed),
    eta: cleanEta(t.eta),
    ratio: Math.max(0, num(t.ratio)),
    state,
    size: num(t.size, num(t.total_size)),
    downloaded: num(t.downloaded),
    uploaded: num(t.uploaded),
    savePath: str(t.save_path),
    magnet: str(t.magnet_uri) || undefined,
    // -1 (or 0) when queueing is disabled or the torrent is complete.
    queue: num(t.priority) > 0 ? num(t.priority) : undefined,
    error: state === "error" ? (t.state === "missingFiles" ? "Files are missing" : "Error") : undefined,
    added: t.added_on ? t.added_on * 1000 : undefined,
    seeds: t.num_seeds,
    peers: t.num_leechs,
    tracker: t.tracker ? hostOf(t.tracker) : undefined,
    category: str(t.category) || undefined,
    labels: t.tags ? t.tags.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
  };
}

// --- Deluge ----------------------------------------------------------------

export const DELUGE_FIELDS = [
  "name",
  "progress",
  "download_payload_rate",
  "upload_payload_rate",
  "eta",
  "ratio",
  "state",
  "total_wanted",
  "total_done",
  "total_uploaded",
  "save_path",
  "queue",
  "time_added",
  "num_seeds",
  "num_peers",
  "tracker_host",
  "message",
  "label",
];

export interface DelugeTorrent {
  name?: string;
  /** From 0 to 100. */
  progress?: number;
  download_payload_rate?: number;
  upload_payload_rate?: number;
  eta?: number;
  ratio?: number;
  state?: string;
  total_wanted?: number;
  total_done?: number;
  total_uploaded?: number;
  save_path?: string;
  queue?: number;
  time_added?: number;
  num_seeds?: number;
  num_peers?: number;
  tracker_host?: string;
  message?: string;
  label?: string;
}

export function delugeState(t: DelugeTorrent): State {
  switch (t.state) {
    case "Error":
      return "error";
    case "Downloading":
      return num(t.download_payload_rate) > 0 || num(t.num_seeds) > 0 ? "downloading" : "stalled";
    case "Seeding":
      return "seeding";
    case "Queued":
      return "queued";
    case "Checking":
    case "Allocating":
      return "checking";
    case "Moving":
      return "moving";
    case "Paused":
      return num(t.progress) >= 100 ? "completed" : "paused";
    default:
      return "paused";
  }
}

export function fromDeluge(hash: string, t: DelugeTorrent): Torrent {
  const state = delugeState(t);
  return {
    id: hash,
    hash,
    name: str(t.name) || hash,
    progress: num(t.progress) / 100,
    down: num(t.download_payload_rate),
    up: num(t.upload_payload_rate),
    eta: cleanEta(t.eta),
    ratio: Math.max(0, num(t.ratio)),
    state,
    size: num(t.total_wanted),
    downloaded: num(t.total_done),
    uploaded: num(t.total_uploaded),
    savePath: str(t.save_path),
    // -1 once complete.
    queue: num(t.queue, -1) >= 0 ? num(t.queue) + 1 : undefined,
    error: state === "error" ? str(t.message) || "Error" : undefined,
    added: t.time_added ? Math.round(t.time_added * 1000) : undefined,
    seeds: t.num_seeds,
    peers: t.num_peers,
    tracker: str(t.tracker_host) || undefined,
    labels: t.label ? [t.label] : undefined,
  };
}

// ---------------------------------------------------------------------------
// Presentation

export const STATE_LOOK: Record<State, { label: string; icon: string; tint: Color; order: number }> = {
  error: { label: "Error", icon: "bs-alert", tint: "red", order: 0 },
  downloading: { label: "Downloading", icon: "bs-arrow-down", tint: "blue", order: 1 },
  metadata: { label: "Fetching metadata", icon: "bs-circle-dashed", tint: "blue", order: 2 },
  stalled: { label: "Stalled", icon: "bs-hourglass", tint: "orange", order: 3 },
  queued: { label: "Queued", icon: "bs-clock", tint: "gray", order: 4 },
  checking: { label: "Checking", icon: "bs-refresh", tint: "yellow", order: 5 },
  moving: { label: "Moving", icon: "bs-folder", tint: "yellow", order: 6 },
  seeding: { label: "Seeding", icon: "bs-arrow-up", tint: "green", order: 7 },
  completed: { label: "Completed", icon: "bs-circle-check", tint: "green", order: 8 },
  paused: { label: "Paused", icon: "bs-pause", tint: "gray", order: 9 },
};

type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

export const isActive = (t: Torrent) => !["paused", "completed"].includes(t.state);
export const isIncomplete = (t: Torrent) => t.progress < 1;

/** Errors, then downloads (fastest first), the queue, seeding, and stopped ones; newest first within. */
export function sortTorrents(list: Torrent[]): Torrent[] {
  return [...list].sort((a, b) =>
    STATE_LOOK[a.state].order - STATE_LOOK[b.state].order ||
    (a.state === "downloading" ? b.down - a.down : 0) ||
    (a.queue ?? Infinity) - (b.queue ?? Infinity) ||
    (b.added ?? 0) - (a.added ?? 0) ||
    a.name.localeCompare(b.name)
  );
}

export type View = "all" | "downloading" | "seeding" | "paused";

export function matchesView(t: Torrent, view: string | undefined): boolean {
  switch (view) {
    case "downloading":
      return isIncomplete(t) && t.state !== "paused";
    case "seeding":
      return t.progress >= 1 && t.state !== "paused" && t.state !== "completed";
    case "paused":
      return t.state === "paused" || t.state === "completed";
    default:
      return true;
  }
}

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const speed = (n: number) => `${bytes(n)}/s`;

export function duration(seconds: number | undefined): string {
  if (seconds === undefined || seconds <= 0) return "∞";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return h % 24 ? `${d}d ${h % 24}h` : `${d}d`;
}

export const percent = (ratio: number) =>
  ratio >= 1 ? "100%" : ratio > 0.999 ? "99.9%" : `${(Math.floor(ratio * 1000) / 10).toFixed(ratio < 0.1 ? 1 : 0)}%`;

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
  return new Date(ms).toISOString().slice(0, 10);
}

/** One line for the root search and the footer: "2 downloading · ↓ 4.2 MB/s · ↑ 120 KB/s". */
export function summary(list: Torrent[]): string {
  if (!list.length) return "No torrents";
  const down = list.reduce((n, t) => n + t.down, 0);
  const up = list.reduce((n, t) => n + t.up, 0);
  const dl = list.filter((t) => ["downloading", "stalled", "metadata"].includes(t.state)).length;
  const seeding = list.filter((t) => t.state === "seeding").length;
  const errors = list.filter((t) => t.state === "error").length;
  return [
    errors ? `${errors} with errors` : "",
    dl ? `${dl} downloading` : "",
    !dl && seeding ? `${seeding} seeding` : "",
    !dl && !seeding && !errors ? `${list.length} torrent${list.length === 1 ? "" : "s"}` : "",
    down > 0 ? `↓ ${speed(down)}` : "",
    up > 0 ? `↑ ${speed(up)}` : "",
  ].filter(Boolean).join(" · ");
}

export const PRIORITY_NAMES: Record<number, string> = { [-1]: "Low", 0: "Normal", 1: "High" };

// ---------------------------------------------------------------------------
// Links

export const INFO_HASH = /^(?:[a-f0-9]{40}|[a-z2-7]{32})$/i;

export interface AddInput {
  /** What the client gets: a magnet link or a .torrent URL. */
  link: string;
  kind: "magnet" | "url";
  /** The magnet's display name, or the URL's file name. */
  name?: string;
}

/** A magnet link, a .torrent URL or a bare info hash, from what the user typed or copied. */
export function parseAddInput(text: string): AddInput | undefined {
  const s = text.trim().split(/\s+/)[0] ?? "";
  if (!s) return undefined;
  if (/^magnet:\?/i.test(s)) {
    if (!/[?&]xt=urn:(btih|btmh):/i.test(s)) return undefined;
    const dn = /[?&]dn=([^&]+)/.exec(s)?.[1];
    let name: string | undefined;
    try {
      name = dn ? decodeURIComponent(dn.replace(/\+/g, " ")) : undefined;
    } catch {
      name = dn;
    }
    return { link: s, kind: "magnet", name };
  }
  if (INFO_HASH.test(s)) return { link: `magnet:?xt=urn:btih:${s.toLowerCase()}`, kind: "magnet" };
  if (/^https?:\/\/\S+$/i.test(s)) {
    try {
      const u = new URL(s);
      const file = decodeURIComponent(u.pathname.split("/").pop() ?? "");
      return { link: s, kind: "url", name: file || u.hostname };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A magnet link built from the hash and the name, for clients that don't give one. */
export function magnetOf(t: { hash: string; name: string }): string {
  return `magnet:?xt=urn:btih:${t.hash}&dn=${encodeURIComponent(t.name)}`;
}

export function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/** The `X-Transmission-Session-Id` dance: the id a 409 answer carries. */
export function sessionIdFrom(status: number, headers: Headers): string | undefined {
  return status === 409 ? headers.get("x-transmission-session-id") ?? undefined : undefined;
}

/** The session cookie of qBittorrent or Deluge from `Set-Cookie`. */
export function cookieFrom(setCookie: string | null): string | undefined {
  if (!setCookie) return undefined;
  for (const part of setCookie.split(/,(?=\s*[A-Za-z0-9_-]+=)/)) {
    const m = /^\s*([^=;\s]+)=([^;]*)/.exec(part);
    // "SID", "QBT_SID_8080" (qBittorrent 5) or Deluge's "_session_id".
    if (m && m[2] && (/(^|_)SID(_|$)/.test(m[1]) || m[1] === "_session_id")) return `${m[1]}=${m[2]}`;
  }
  return undefined;
}
