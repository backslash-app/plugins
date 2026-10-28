// Reading the vault / bao CLI's JSON output and building Vault UI links. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export type Program = "vault" | "bao";

export const PRODUCT: Record<Program, string> = { vault: "Vault", bao: "OpenBao" };

/** Where the CLIs connect when VAULT_ADDR is not set. */
export const DEFAULT_ADDRESS = "https://127.0.0.1:8200";

// ---------------------------------------------------------------------------
// Address and paths

/** `vault.lan:8200/ui/` → `https://vault.lan:8200`; empty stays empty. */
export function normalizeAddress(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) return "";
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  try {
    const url = new URL(text);
    return `${url.protocol}//${url.host}`;
  } catch {
    return "";
  }
}

/** `secret/` + `app/` + `db` → `secret/app/db`. */
export function joinPath(...parts: string[]): string {
  return parts.filter(Boolean).map((p, i) => (i ? p.replace(/^\/+/, "") : p)).join("").replace(/\/{2,}/g, "/");
}

/** The last segment of a path: `secret/app/db` → `db`, `secret/app/` → `app/`. */
export function baseName(path: string): string {
  const m = /([^/]+\/?)$/.exec(path);
  return m ? m[1] : path;
}

// ---------------------------------------------------------------------------
// Mounts: `vault secrets list -format=json`

export interface Mount {
  /** With its trailing slash, as Vault prints it: `secret/`. */
  path: string;
  type: string;
  /** KV engine version. */
  version: 1 | 2;
  description: string;
  accessor: string;
  local: boolean;
  sealWrap: boolean;
}

interface RawMount {
  type?: string;
  description?: string;
  accessor?: string;
  local?: boolean;
  seal_wrap?: boolean;
  options?: Record<string, string> | null;
}

/** The KV mounts (and the legacy `generic` type), sorted by path; the others are only counted. */
export function parseMounts(json: string): { kv: Mount[]; other: number } {
  const raw = JSON.parse(json || "{}") as Record<string, RawMount>;
  const kv: Mount[] = [];
  let other = 0;
  for (const [path, m] of Object.entries(raw)) {
    if (m?.type !== "kv" && m?.type !== "generic") {
      other++;
      continue;
    }
    kv.push({
      path: path.endsWith("/") ? path : `${path}/`,
      type: m.type,
      version: m.options?.version === "2" ? 2 : 1,
      description: m.description ?? "",
      accessor: m.accessor ?? "",
      local: m.local ?? false,
      sealWrap: m.seal_wrap ?? false,
    });
  }
  return { kv: kv.sort((a, b) => a.path.localeCompare(b.path)), other };
}

// ---------------------------------------------------------------------------
// Listing: `vault kv list -format=json <path>`

export interface Entry {
  name: string;
  folder: boolean;
}

/** `["db", "app/"]` → folders first, then secrets, each sorted. */
export function parseList(json: string): Entry[] {
  const raw = JSON.parse(json || "[]");
  const keys: unknown[] = Array.isArray(raw) ? raw : Array.isArray(raw?.data?.keys) ? raw.data.keys : [];
  return keys
    .filter((k): k is string => typeof k === "string" && k.length > 0)
    .map((name) => ({ name, folder: name.endsWith("/") }))
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// One secret: `vault kv get -format=json <path>`

export interface VersionInfo {
  version: number;
  created: string;
  deleted: string;
  destroyed: boolean;
}

export interface Secret {
  /** Keys and their values as text (non-string values as JSON). */
  data: Record<string, string>;
  /** KV v2 only. */
  version?: VersionInfo;
  customMetadata: Record<string, string>;
  /** The version exists but its data was deleted or destroyed. */
  gone: boolean;
}

/** A secret value as text: strings as they are, the rest as JSON. */
export function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function parseSecret(json: string, kvVersion: 1 | 2): Secret {
  const raw = JSON.parse(json || "{}");
  const outer = raw?.data ?? null;
  const inner = kvVersion === 2 ? outer?.data ?? null : outer;
  const md = kvVersion === 2 ? outer?.metadata ?? null : null;
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries((inner ?? {}) as Record<string, unknown>)) data[k] = valueText(v);
  return {
    data,
    version: md
      ? {
        version: Number(md.version) || 0,
        created: md.created_time ?? "",
        deleted: md.deletion_time ?? "",
        destroyed: md.destroyed === true,
      }
      : undefined,
    customMetadata: (md?.custom_metadata ?? {}) as Record<string, string>,
    gone: kvVersion === 2 && inner === null,
  };
}

// ---------------------------------------------------------------------------
// KV v2 metadata: `vault kv metadata get -format=json <path>`

export interface Metadata {
  currentVersion: number;
  oldestVersion: number;
  maxVersions: number;
  created: string;
  updated: string;
  casRequired: boolean;
  deleteVersionAfter: string;
  customMetadata: Record<string, string>;
  /** Newest first. */
  versions: VersionInfo[];
}

export function parseMetadata(json: string): Metadata {
  const d = JSON.parse(json || "{}")?.data ?? {};
  const versions = Object.entries((d.versions ?? {}) as Record<string, Record<string, unknown>>)
    .map(([n, v]) => ({
      version: Number(n),
      created: String(v.created_time ?? ""),
      deleted: String(v.deletion_time ?? ""),
      destroyed: v.destroyed === true,
    }))
    .filter((v) => Number.isFinite(v.version))
    .sort((a, b) => b.version - a.version);
  return {
    currentVersion: Number(d.current_version) || 0,
    oldestVersion: Number(d.oldest_version) || 0,
    maxVersions: Number(d.max_versions) || 0,
    created: d.created_time ?? "",
    updated: d.updated_time ?? "",
    casRequired: d.cas_required === true,
    deleteVersionAfter: d.delete_version_after ?? "0s",
    customMetadata: (d.custom_metadata ?? {}) as Record<string, string>,
    versions,
  };
}

export type VersionState = "current" | "live" | "deleted" | "destroyed";

export function versionState(v: VersionInfo, current: number): VersionState {
  if (v.destroyed) return "destroyed";
  if (v.deleted) return "deleted";
  return v.version === current ? "current" : "live";
}

export const VERSION_LOOK: Record<VersionState, { label: string; color: Color }> = {
  current: { label: "Current", color: "green" },
  live: { label: "Available", color: "blue" },
  deleted: { label: "Deleted", color: "orange" },
  destroyed: { label: "Destroyed", color: "red" },
};

// ---------------------------------------------------------------------------
// Token: `vault token lookup -format=json`

export interface Token {
  displayName: string;
  policies: string[];
  /** Seconds left; 0 for a token that never expires. */
  ttl: number;
  creationTtl: number;
  expireTime: string;
  issueTime: string;
  renewable: boolean;
  type: string;
  orphan: boolean;
  path: string;
  accessor: string;
  entityId: string;
  numUses: number;
  meta: Record<string, string>;
}

export function parseToken(json: string): Token {
  const d = JSON.parse(json || "{}")?.data ?? {};
  const policies = [...new Set([...(d.policies ?? []), ...(d.identity_policies ?? [])].map(String))];
  return {
    displayName: d.display_name ?? "",
    policies,
    ttl: Number(d.ttl) || 0,
    creationTtl: Number(d.creation_ttl) || 0,
    expireTime: d.expire_time ?? "",
    issueTime: d.issue_time ?? "",
    renewable: d.renewable === true,
    type: d.type ?? "service",
    orphan: d.orphan === true,
    path: d.path ?? "",
    accessor: d.accessor ?? "",
    entityId: d.entity_id ?? "",
    numUses: Number(d.num_uses) || 0,
    meta: (d.meta ?? {}) as Record<string, string>,
  };
}

/** 90061 → "1d 1h", 3599 → "59m", 42 → "42s"; 0 → "never expires". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s === 0) return "never expires";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return `${s}s`;
}

/** Red under an hour, orange under a day, green otherwise (and for tokens that never expire). */
export function ttlColor(ttl: number): Color {
  if (ttl === 0) return "green";
  if (ttl < 3600) return "red";
  if (ttl < 86400) return "orange";
  return "green";
}

// ---------------------------------------------------------------------------
// Server: `vault status -format=json`

export interface Status {
  version: string;
  sealed: boolean;
  initialized: boolean;
  sealType: string;
  threshold: number;
  shares: number;
  progress: number;
  storage: string;
  clusterName: string;
  haEnabled: boolean;
  /** "active", "standby" or "" when HA is off. */
  haMode: string;
  leader: string;
}

export function parseStatus(json: string): Status {
  const d = JSON.parse(json || "{}");
  return {
    version: d.version ?? "",
    sealed: d.sealed === true,
    initialized: d.initialized !== false,
    sealType: d.type ?? "",
    threshold: Number(d.t) || 0,
    shares: Number(d.n) || 0,
    progress: Number(d.progress) || 0,
    storage: d.storage_type ?? "",
    clusterName: d.cluster_name ?? "",
    haEnabled: d.ha_enabled === true,
    haMode: d.ha_enabled ? (d.is_self === false ? "standby" : "active") : "",
    leader: d.leader_address ?? "",
  };
}

// ---------------------------------------------------------------------------
// Errors

export type ErrorKind = "address" | "token" | "denied" | "sealed" | "tls" | "empty" | "other";

/** Sorts the CLI's stderr into what the user can do about it. */
export function classifyError(stderr: string): ErrorKind {
  const t = stderr.toLowerCase();
  if (/no value found at|no entries found/.test(t)) return "empty";
  if (/vault is sealed|code: 503.*sealed|\bsealed\b/.test(t)) return "sealed";
  if (/missing client token|invalid token|bad token|token is expired|code: 401/.test(t)) return "token";
  if (/permission denied|code: 403/.test(t)) return "denied";
  if (/x509|certificate|tls: |http response to https client/.test(t)) return "tls";
  if (/connection refused|no such host|dial tcp|i\/o timeout|network is unreachable|connect: /.test(t)) {
    return "address";
  }
  return "other";
}

/** The CLI's message without its boilerplate: the line that says what went wrong. */
export function cleanError(stderr: string): string {
  const lines = stderr.split("\n").map((l) => l.trim()).filter(Boolean);
  const errorLine = lines.find((l) => /^\*\s/.test(l))?.replace(/^\*\s*/, "");
  const first = (lines[0] ?? "").replace(/^Error\s+[a-z ]+:\s*/i, "").replace(/^Error:\s*/i, "");
  return (errorLine || first || "The command failed").slice(0, 300);
}

// ---------------------------------------------------------------------------
// Vault UI

/** The web UI page of a mount, folder or secret. OpenBao keeps the pre-1.15 routes. */
export function uiUrl(
  address: string,
  program: Program,
  mount: Mount,
  path = "",
  folder = path === "" || path.endsWith("/"),
): string {
  const m = encodeURIComponent(mount.path.replace(/\/$/, ""));
  const base = `${address}/ui/vault/secrets/${m}`;
  const segments = path.replace(/\/$/, "").split("/").filter(Boolean).map(encodeURIComponent).join("/");
  if (mount.version === 2 && program === "vault") {
    if (folder) return segments ? `${base}/kv/list/${segments}/` : `${base}/kv/list`;
    return `${base}/kv/${encodeURIComponent(path)}/details`;
  }
  if (folder) return segments ? `${base}/list/${segments}/` : `${base}/list`;
  return `${base}/show/${segments}`;
}

/** Concealed text, the same length whatever the value. */
export const MASK = "••••••••";

/** Values stay concealed until revealed; long ones are shortened for the list. */
export function shownValue(value: string, reveal: boolean): string {
  if (!reveal) return MASK;
  return value.length > 120 ? `${value.slice(0, 117)}…` : value;
}

/** Shell-safe single-quoted text. */
export const shellQuote = (s: string) => /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;

/** "2026-10-27T09:15:03.123456Z" → "27 Oct 2026, 09:15"; empty stays empty. */
export function formatDate(iso: string): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t) || t <= 0) return "";
  return new Date(t).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  }) + " UTC";
}

/** "3 days ago", "in 2 hours". */
export function relative(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (!iso || Number.isNaN(t) || t <= 0) return "";
  const diff = Math.round((t - now) / 1000);
  const abs = Math.abs(diff);
  const [n, unit] = abs < 60
    ? [abs, "second"]
    : abs < 3600
    ? [Math.floor(abs / 60), "minute"]
    : abs < 86400
    ? [Math.floor(abs / 3600), "hour"]
    : abs < 86400 * 60
    ? [Math.floor(abs / 86400), "day"]
    : abs < 86400 * 730
    ? [Math.floor(abs / (86400 * 30)), "month"]
    : [Math.floor(abs / (86400 * 365)), "year"];
  if (unit === "second") return diff >= 0 ? "in a moment" : "just now";
  const text = `${n} ${unit}${n === 1 ? "" : "s"}`;
  return diff >= 0 ? `in ${text}` : `${text} ago`;
}
