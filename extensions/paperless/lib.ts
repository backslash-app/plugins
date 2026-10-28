// Paperless-ngx documents: names of correspondents, types and tags, dates,
// excerpts, file names, and files picked in the file manager.

/**
 * Where Paperless-ngx usually runs, as declared in `[permissions] net`
 * (kept equal by a test): this computer, local and container names, private
 * networks, Tailscale and DuckDNS. Extensions declare their hosts statically.
 */
export const HOSTS = [
  "localhost",
  "127.0.0.1",
  "paperless",
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

/** `paperless.local:8000/documents?x` → `http://paperless.local:8000`; a sub-path (`/paperless`) is kept. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  try {
    const u = new URL(url);
    const path = u.pathname
      .replace(/\/(dashboard|documents(\/\d+(\/details)?)?|api|view\/\d+|tags|correspondents|accounts\/login)\/?$/i, "")
      .replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Tokens pasted with their prefix ("Token abc…") still work. */
export const cleanToken = (t: unknown) => String(t ?? "").trim().replace(/^Token\s+/i, "");

// ---------------------------------------------------------------------------
// API shapes

export interface Doc {
  id: number;
  title: string;
  correspondent: number | null;
  document_type: number | null;
  storage_path?: number | null;
  tags: number[];
  /** "2024-03-01" since 2.16, a datetime before. */
  created: string;
  created_date?: string;
  modified?: string;
  added?: string;
  content?: string;
  archive_serial_number: number | null;
  original_file_name?: string | null;
  archived_file_name?: string | null;
  page_count?: number | null;
  mime_type?: string;
  notes?: unknown[];
  __search_hit__?: { score?: number; highlights?: string; note_highlights?: string | null; rank?: number };
}

export interface Named {
  id: number;
  name: string;
}

export interface Tag extends Named {
  color?: string;
  text_color?: string;
  is_inbox_tag?: boolean;
  document_count?: number;
}

export interface Page<T> {
  count: number;
  next: string | null;
  results: T[];
}

export interface Names {
  correspondents: Record<string, string>;
  types: Record<string, string>;
  paths: Record<string, string>;
  tags: Record<string, { name: string; color?: string; inbox?: boolean }>;
  /** Unix ms. */
  fetched: number;
}

export function namesFrom(
  correspondents: Named[],
  types: Named[],
  tags: Tag[],
  paths: Named[] = [],
  now = Date.now(),
): Names {
  const map = (list: Named[]) => Object.fromEntries(list.map((x) => [String(x.id), x.name]));
  return {
    correspondents: map(correspondents),
    types: map(types),
    paths: map(paths),
    tags: Object.fromEntries(
      tags.map((t) => [String(t.id), { name: t.name, color: t.color, inbox: t.is_inbox_tag || undefined }]),
    ),
    fetched: now,
  };
}

/** Whether the cached names miss something these documents refer to. */
export function namesMissing(names: Names, docs: Doc[]): boolean {
  return docs.some((d) =>
    (d.correspondent !== null && !(String(d.correspondent) in names.correspondents)) ||
    (d.document_type !== null && !(String(d.document_type) in names.types)) ||
    d.tags.some((t) => !(String(t) in names.tags))
  );
}

export interface DocView {
  id: number;
  title: string;
  correspondent?: string;
  type?: string;
  path?: string;
  tags: { id: number; name: string; color: Color; inbox?: boolean }[];
  /** Unix ms, local midnight of the created day. */
  created?: number;
  added?: number;
  asn?: number;
  pages?: number;
  fileName?: string;
  mime?: string;
  notes: number;
  excerpt: string;
  /** Search hit highlights, as markdown with **matches**. */
  highlights?: string;
  score?: number;
}

export type Color = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "teal" | "pink" | "gray";

/** The launcher's named color closest in hue to a tag's `#rrggbb` (gray for unsaturated ones). */
export function nearestColor(hex: string | undefined): Color {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? "");
  if (!m) return "gray";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  // Paperless's default palette is pastel: low saturation still means a color, near-gray doesn't.
  if (max === 0 || d / max < 0.15 || d < 0.08) return "gray";
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h = (h * 60 + 360) % 360;
  if (h < 15 || h >= 345) return "red";
  if (h < 40) return "orange";
  if (h < 65) return "yellow";
  if (h < 160) return "green";
  if (h < 190) return "teal";
  if (h < 250) return "blue";
  if (h < 290) return "purple";
  return "pink";
}

/** "2024-03-01" or "2024-03-01T00:00:00+01:00" → local midnight of that day (the day is what matters). */
export function createdDay(s: string | undefined): number | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? "");
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime() : undefined;
}

/** Paperless's highlights are HTML (`<span class="match">word</span>`); make them markdown. */
export function highlightsMarkdown(html: string | undefined): string | undefined {
  if (!html) return undefined;
  const text = html
    .replace(/<span class="match">([\s\S]*?)<\/span>/g, "**$1**")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\*\*\s*\*\*/g, " ")
    .trim();
  return text || undefined;
}

/** The first lines of the OCR text, without the blank-line noise OCR leaves. */
export function excerpt(content: string | undefined, max = 600): string {
  const text = (content ?? "").replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join("\n");
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf("\n"));
  return `${cut.slice(0, at > max * 0.6 ? at : max)}…`;
}

export function docView(d: Doc, names: Names): DocView {
  const tag = (id: number) => names.tags[String(id)];
  return {
    id: d.id,
    title: d.title || d.original_file_name || `Document ${d.id}`,
    correspondent: d.correspondent !== null ? names.correspondents[String(d.correspondent)] : undefined,
    type: d.document_type !== null ? names.types[String(d.document_type)] : undefined,
    path: d.storage_path ? names.paths[String(d.storage_path)] : undefined,
    tags: d.tags
      .map((id) => ({
        id,
        name: tag(id)?.name ?? `#${id}`,
        color: nearestColor(tag(id)?.color),
        inbox: tag(id)?.inbox,
      }))
      .sort((a, b) => Number(!!b.inbox) - Number(!!a.inbox) || a.name.localeCompare(b.name)),
    created: createdDay(d.created_date ?? d.created),
    added: d.added ? Date.parse(d.added) : undefined,
    asn: d.archive_serial_number ?? undefined,
    pages: d.page_count ?? undefined,
    fileName: d.original_file_name ?? undefined,
    mime: d.mime_type,
    notes: d.notes?.length ?? 0,
    excerpt: excerpt(d.content),
    highlights: highlightsMarkdown(d.__search_hit__?.highlights),
    score: d.__search_hit__?.score,
  };
}

export const formatDate = (ms: number | undefined) =>
  ms === undefined ? "" : new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export const asnText = (asn: number) => `ASN ${String(asn).padStart(4, "0")}`;

export function webUrl(base: string, id: number) {
  return `${base}/documents/${id}/details`;
}
export const shareUrl = (base: string, slug: string) => `${base}/share/${slug}`;

// ---------------------------------------------------------------------------
// Files

/** `attachment; filename="a b.pdf"; filename*=utf-8''a%20b.pdf` → `a b.pdf`, safe for a file name. */
export function fileNameFrom(disposition: string | null, fallback: string): string {
  let name: string | undefined;
  const star = /filename\*\s*=\s*(?:utf-8|UTF-8)''([^;]+)/.exec(disposition ?? "");
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim().replace(/^"|"$/g, ""));
    } catch {
      name = undefined;
    }
  }
  name ??= /filename\s*=\s*"([^"]+)"/.exec(disposition ?? "")?.[1] ??
    /filename\s*=\s*([^;]+)/.exec(disposition ?? "")?.[1]?.trim();
  const safe = (name ?? fallback).replace(/[/\\\0]/g, "_").replace(/^\.+/, "").trim();
  return safe || fallback;
}

/** `dir/name.pdf`, or `dir/name (2).pdf` when taken. */
export function freePath(dir: string, file: string, exists: (p: string) => boolean): string {
  const dot = file.lastIndexOf(".");
  const stem = dot > 0 ? file.slice(0, dot) : file;
  const ext = dot > 0 ? file.slice(dot) : "";
  for (let i = 1; i < 1000; i++) {
    const p = `${dir}/${i === 1 ? file : `${stem} (${i})${ext}`}`;
    if (!exists(p)) return p;
  }
  return `${dir}/${stem} (${Date.now()})${ext}`;
}

/** Files copied in a file manager: `text/uri-list` or `x-special/gnome-copied-files` text. */
export function parseFileList(text: string, home = ""): string[] {
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line === "copy" || line === "cut") continue;
    let path: string | undefined;
    if (line.startsWith("file://")) {
      try {
        const url = new URL(line);
        if (url.host && url.host !== "localhost") continue;
        path = decodeURIComponent(url.pathname);
      } catch {
        continue;
      }
    } else if (line.startsWith("/")) path = line;
    else if (home && (line === "~" || line.startsWith("~/"))) path = home + line.slice(1);
    if (path && !out.includes(path)) out.push(path);
  }
  return out;
}

/** What Paperless-ngx consumes (with Tika and Gotenberg for office files and mail). */
export const CONSUMABLE =
  /\.(pdf|png|jpe?g|tiff?|gif|webp|bmp|heic|txt|md|csv|eml|docx?|xlsx?|pptx?|odt|ods|odp|rtf)$/i;

export const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  heic: "image/heic",
  txt: "text/plain",
  md: "text/plain",
  csv: "text/csv",
  eml: "message/rfc822",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf",
};
export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";

export const basename = (p: string) => p.replace(/\/+$/, "").split("/").pop() ?? p;
export const stem = (name: string) => name.replace(/\.[^.]+$/, "");

export function bytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1000)));
  const v = n / 1000 ** i;
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function ago(ms: number | undefined, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d < 30 ? `${d} day${d === 1 ? "" : "s"} ago` : formatDate(ms);
}

// ---------------------------------------------------------------------------
// Consumption tasks

export interface Task {
  task_id: string;
  status?: string;
  /** API ≤ 9. */
  result?: string | null;
  related_document?: number | string | null;
  task_file_name?: string | null;
  /** API 10. */
  related_document_ids?: number[];
  result_data?: unknown;
  input_data?: { filename?: string } | null;
}

export interface TaskState {
  state: "pending" | "running" | "done" | "failed";
  documentId?: number;
  message?: string;
  fileName?: string;
}

/** A task in either API generation: Celery states ("SUCCESS") or the new ones ("success"). */
export function taskState(t: Task): TaskState {
  const s = (t.status ?? "").toLowerCase();
  const id = t.related_document_ids?.[0] ??
    (t.related_document !== null && t.related_document !== undefined ? Number(t.related_document) : undefined);
  const resultText = typeof t.result === "string"
    ? t.result
    : t.result_data && typeof t.result_data === "object"
    ? String(
      (t.result_data as { error?: string; message?: string }).error ??
        (t.result_data as { message?: string }).message ?? "",
    )
    : undefined;
  const fileName = t.task_file_name ?? t.input_data?.filename ?? undefined;
  if (s === "success") {
    return {
      state: "done",
      documentId: Number.isFinite(id) ? id : undefined,
      message: resultText || undefined,
      fileName,
    };
  }
  if (s === "failure" || s === "revoked" || s === "failed") {
    return { state: "failed", message: cleanTaskError(resultText), fileName };
  }
  if (s === "started" || s === "running") return { state: "running", fileName };
  return { state: "pending", fileName };
}

/** "x.pdf: Not consuming x.pdf: It is a duplicate of y (#12)." → "It is a duplicate of y (#12)". */
export function cleanTaskError(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return text.replace(/^.*?Not consuming [^:]+:\s*/s, "").replace(/\.$/, "").trim() || text;
}
