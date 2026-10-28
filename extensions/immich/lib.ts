// Immich assets, albums and memories: dates, places, cameras, exposure,
// and the links to them.

/**
 * Where Immich usually runs, as declared in `[permissions] net` (kept equal
 * by a test): this computer, local and container names, private networks,
 * Tailscale and DuckDNS. Extensions declare their hosts statically.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "immich",
  "immich-server",
  "*.local",
  "*.lan",
  "*.home",
  "*.home.arpa",
  "*.internal",
  "*.duckdns.org",
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

/** `immich.local:2283/photos` or `…/api` → `http://immich.local:2283`; a sub-path is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    if (!u.port && u.protocol === "http:" && !/^http:\/\/[^/]+:80\b/.test(url)) u.port = "2283";
    const path = u.pathname
      .replace(/\/(api|photos(\/[\w-]+)?|albums(\/[\w-]+)?|explore|search|auth\/login|memory)\/?$/i, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

// ---------------------------------------------------------------------------
// API shapes

export interface Exif {
  make?: string | null;
  model?: string | null;
  lensModel?: string | null;
  fNumber?: number | null;
  exposureTime?: string | null;
  iso?: number | null;
  focalLength?: number | null;
  exifImageWidth?: number | null;
  exifImageHeight?: number | null;
  fileSizeInByte?: number | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  description?: string | null;
  dateTimeOriginal?: string | null;
  orientation?: string | null;
  rating?: number | null;
}

export interface Asset {
  id: string;
  type: "IMAGE" | "VIDEO" | "AUDIO" | "OTHER";
  originalFileName: string;
  originalMimeType?: string;
  fileCreatedAt?: string;
  /** The wall-clock time where it was taken, written as if UTC. */
  localDateTime?: string;
  isFavorite?: boolean;
  isArchived?: boolean;
  /** "0:00:12.345678" for videos. */
  duration?: string;
  exifInfo?: Exif;
  people?: { id: string; name: string }[];
  width?: number | null;
  height?: number | null;
  livePhotoVideoId?: string | null;
}

export interface Album {
  id: string;
  albumName: string;
  description?: string;
  assetCount: number;
  albumThumbnailAssetId?: string | null;
  startDate?: string;
  endDate?: string;
  shared?: boolean;
  hasSharedLink?: boolean;
  updatedAt?: string;
  owner?: { name?: string; email?: string };
  albumUsers?: { user?: { name?: string } }[];
}

export interface Memory {
  id: string;
  type: string;
  data?: { year?: number; personName?: string };
  memoryAt?: string;
  showAt?: string;
  hideAt?: string;
  assets: Asset[];
}

/** Before Immich 1.119: `GET /api/assets/memory-lane`. */
export interface MemoryLane {
  yearsAgo?: number;
  title?: string;
  assets: Asset[];
}

// ---------------------------------------------------------------------------
// Presentation

export interface AssetView {
  id: string;
  name: string;
  video: boolean;
  /** Unix ms of the wall-clock time, to format with UTC getters. */
  taken?: number;
  place?: string;
  camera?: string;
  lens?: string;
  exposure?: string;
  dimensions?: string;
  size?: number;
  favorite: boolean;
  people: string[];
  duration?: string;
  description?: string;
  coords?: { lat: number; lon: number };
}

export function place(e: Exif | undefined): string | undefined {
  const parts = [e?.city, e?.state, e?.country].filter((x): x is string => !!x && x.trim() !== "");
  return [...new Set(parts)].join(", ") || undefined;
}

/** "Apple iPhone 15 Pro"; the make is left out when the model starts with it ("Canon EOS R6"). */
export function camera(e: Exif | undefined): string | undefined {
  const make = (e?.make ?? "").trim();
  const model = (e?.model ?? "").trim();
  if (!make && !model) return undefined;
  if (!make) return model;
  if (!model) return make;
  const first = make.split(/\s+/)[0].toLowerCase();
  return model.toLowerCase().startsWith(first)
    ? model
    : `${make.replace(/\s+(corporation|corp\.?|company)$/i, "")} ${model}`;
}

/** "ƒ/1.8 · 1/120 s · ISO 100 · 26 mm". */
export function exposure(e: Exif | undefined): string | undefined {
  if (!e) return undefined;
  const parts: string[] = [];
  if (e.fNumber) parts.push(`ƒ/${Number(e.fNumber.toFixed(1))}`);
  if (e.exposureTime) parts.push(`${e.exposureTime} s`);
  if (e.iso) parts.push(`ISO ${e.iso}`);
  if (e.focalLength) parts.push(`${Number(e.focalLength.toFixed(1))} mm`);
  return parts.length ? parts.join(" · ") : undefined;
}

/** "0:01:05.123" → "1:05". */
export function videoDuration(d: string | undefined): string | undefined {
  const m = /^(\d+):(\d{2}):(\d{2})/.exec(d ?? "");
  if (!m) return undefined;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (!h && !min && !s) return undefined;
  return h
    ? `${h}:${String(min).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${min}:${String(s).padStart(2, "0")}`;
}

export function assetView(a: Asset): AssetView {
  const e = a.exifInfo;
  const w = e?.exifImageWidth ?? a.width, h = e?.exifImageHeight ?? a.height;
  const rotated = e?.orientation === "6" || e?.orientation === "8";
  const taken = Date.parse(a.localDateTime ?? a.fileCreatedAt ?? "");
  return {
    id: a.id,
    name: a.originalFileName,
    video: a.type === "VIDEO",
    taken: Number.isFinite(taken) ? taken : undefined,
    place: place(e),
    camera: camera(e),
    lens: e?.lensModel?.trim() || undefined,
    exposure: exposure(e),
    dimensions: w && h ? (rotated ? `${h} × ${w}` : `${w} × ${h}`) : undefined,
    size: e?.fileSizeInByte ?? undefined,
    favorite: !!a.isFavorite,
    people: (a.people ?? []).map((p) => p.name).filter(Boolean),
    duration: a.type === "VIDEO" ? videoDuration(a.duration) : undefined,
    description: e?.description?.trim() || undefined,
    coords: typeof e?.latitude === "number" && typeof e?.longitude === "number"
      ? { lat: e.latitude, lon: e.longitude }
      : undefined,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "14 Jul 2024, 18:32" from the wall-clock time (no time zone shift). */
export function takenText(ms: number | undefined, withTime = true): string {
  if (ms === undefined) return "";
  const d = new Date(ms);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (!withTime) return day;
  return `${day}, ${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function dateRange(start?: string, end?: string): string | undefined {
  const a = Date.parse(start ?? ""), b = Date.parse(end ?? "");
  if (!Number.isFinite(a)) return undefined;
  const da = new Date(a), db = new Date(Number.isFinite(b) ? b : a);
  const month = (d: Date) => `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  if (month(da) === month(db)) return month(da);
  if (da.getUTCFullYear() === db.getUTCFullYear()) {
    return `${MONTHS[da.getUTCMonth()]} – ${MONTHS[db.getUTCMonth()]} ${db.getUTCFullYear()}`;
  }
  return `${month(da)} – ${month(db)}`;
}

export function bytes(n: number | undefined): string {
  if (!n || !Number.isFinite(n) || n <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export interface MemoryGroup {
  title: string;
  year?: number;
  assets: Asset[];
}

/** Memories of today, newest year first; birthdays named after the person. */
export function memoryGroups(memories: Memory[], now = new Date()): MemoryGroup[] {
  const t = now.getTime();
  const current = memories.filter((m) => {
    const show = Date.parse(m.showAt ?? ""), hide = Date.parse(m.hideAt ?? "");
    return (!Number.isFinite(show) || show <= t) && (!Number.isFinite(hide) || t < hide);
  });
  return current
    .filter((m) => m.assets?.length)
    .map((m) => {
      const year = m.data?.year;
      const ago = year ? now.getFullYear() - year : undefined;
      const title = m.type === "birthday" && m.data?.personName
        ? `${m.data.personName}'s birthday${year ? ` · ${year}` : ""}`
        : ago !== undefined
        ? `${ago <= 0 ? "This year" : ago === 1 ? "1 year ago" : `${ago} years ago`}${year ? ` · ${year}` : ""}`
        : "Memories";
      return { title, year, assets: m.assets };
    })
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export function laneGroups(lanes: MemoryLane[], now = new Date()): MemoryGroup[] {
  return lanes.filter((l) => l.assets?.length).map((l) => {
    const year = l.yearsAgo !== undefined ? now.getFullYear() - l.yearsAgo : undefined;
    return {
      title: l.yearsAgo !== undefined
        ? `${l.yearsAgo === 1 ? "1 year ago" : `${l.yearsAgo} years ago`} · ${year}`
        : l.title ?? "Memories",
      year,
      assets: l.assets,
    };
  }).sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
}

export const assetUrl = (base: string, id: string) => `${base}/photos/${id}`;
export const albumUrl = (base: string, id: string) => `${base}/albums/${id}`;

/** A shared link on the server's public address when it has one (Administration → Server Settings → External domain). */
export function shareUrl(
  base: string,
  externalDomain: string | undefined,
  link: { key: string; slug?: string | null },
) {
  const root = (externalDomain?.trim() || base).replace(/\/+$/, "");
  return link.slug ? `${root}/s/${link.slug}` : `${root}/share/${link.key}`;
}

export const mapUrl = (lat: number, lon: number) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=15/${lat.toFixed(5)}/${
    lon.toFixed(5)
  }`;

/** `name.jpg` in `dir`, or `name (2).jpg` when taken; never a path outside `dir`. */
export function freePath(dir: string, file: string, exists: (p: string) => boolean): string {
  const safe = file.replace(/[/\\\0]/g, "_").replace(/^\.+/, "") || "photo";
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const p = `${dir}/${i === 1 ? safe : `${stem} (${i})${ext}`}`;
    if (!exists(p)) return p;
  }
  return `${dir}/${stem} (${Date.now()})${ext}`;
}
