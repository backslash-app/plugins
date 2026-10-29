// Serverless Databases: the shapes of the Neon, Turso and PlanetScale APIs,
// and how their projects, branches and databases are shown. Pure, tested in lib_test.ts.

export type Provider = "neon" | "turso" | "planetscale";

export const PROVIDERS: Provider[] = ["neon", "turso", "planetscale"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  neon: "Neon",
  turso: "Turso",
  planetscale: "PlanetScale",
};

export const PROVIDER_COLORS = { neon: "green", turso: "teal", planetscale: "purple" } as const;

export type Tint = "green" | "yellow" | "orange" | "red" | "gray" | "blue" | "purple" | "teal";

export interface Prefs {
  neonApiKey?: string;
  tursoToken?: string;
  planetscaleTokenId?: string;
  planetscaleToken?: string;
  planetscaleOrg?: string;
}

export interface Credentials {
  neon?: string;
  turso?: string;
  planetscale?: { id: string; token: string; org?: string };
}

/** The providers that have a token. */
export function credentials(prefs: Prefs): Credentials {
  const s = (v: unknown) => String(v ?? "").trim();
  const out: Credentials = {};
  if (s(prefs.neonApiKey)) out.neon = s(prefs.neonApiKey);
  if (s(prefs.tursoToken)) out.turso = s(prefs.tursoToken);
  // A token can be pasted as "id:token" in the token field.
  const psToken = s(prefs.planetscaleToken);
  const psId = s(prefs.planetscaleTokenId);
  const pair = !psId && /^[^:\s]+:\S+$/.test(psToken) ? psToken.split(/:(.*)/s) : [psId, psToken];
  if (pair[0] && pair[1]) out.planetscale = { id: pair[0], token: pair[1], org: s(prefs.planetscaleOrg) || undefined };
  return out;
}

export const configured = (c: Credentials) => PROVIDERS.filter((p) => c[p] !== undefined);

/** The message of an API error body, whatever its shape. */
export function errorMessage(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 200);
  const b = body as Record<string, any> | undefined;
  const msg = b?.message ?? b?.error?.message ?? b?.error ?? b?.errors?.[0]?.message ?? b?.code ?? "";
  return typeof msg === "string" ? msg : JSON.stringify(msg);
}

// ---------------------------------------------------------------------------
// Neon (console.neon.tech/api/v2)

export interface NeonProject {
  id: string;
  name: string;
  region_id: string;
  pg_version: number;
  created_at: string;
  updated_at?: string;
  org_id?: string;
  synthetic_storage_size?: number;
  history_retention_seconds?: number;
}

export interface NeonBranch {
  id: string;
  project_id: string;
  parent_id?: string;
  name: string;
  current_state: string;
  logical_size?: number;
  created_at: string;
  updated_at?: string;
  default?: boolean;
  primary?: boolean;
  protected?: boolean;
  expires_at?: string;
}

export interface NeonEndpoint {
  id: string;
  host: string;
  branch_id: string;
  type: "read_write" | "read_only";
  current_state: string;
  autoscaling_limit_min_cu?: number;
  autoscaling_limit_max_cu?: number;
  suspend_timeout_seconds?: number;
  pooler_enabled?: boolean;
  last_active?: string;
  disabled?: boolean;
}

export interface NeonDatabase {
  id: number;
  branch_id: string;
  name: string;
  owner_name: string;
}

const NEON_REGIONS: Record<string, string> = {
  "aws-us-east-1": "US East (N. Virginia)",
  "aws-us-east-2": "US East (Ohio)",
  "aws-us-west-2": "US West (Oregon)",
  "aws-eu-central-1": "Europe (Frankfurt)",
  "aws-eu-west-2": "Europe (London)",
  "aws-ap-southeast-1": "Asia Pacific (Singapore)",
  "aws-ap-southeast-2": "Asia Pacific (Sydney)",
  "aws-sa-east-1": "South America (São Paulo)",
  "azure-eastus2": "Azure East US 2",
  "azure-westus3": "Azure West US 3",
  "azure-gwc": "Azure Germany West Central",
};

export const neonRegion = (id: string) => NEON_REGIONS[id] ?? id.replace(/^(aws|azure)-/, "");

export const neonConsoleUrl = (projectId: string, branchId?: string) =>
  `https://console.neon.tech/app/projects/${projectId}${branchId ? `/branches/${branchId}` : ""}`;

export const isDefaultBranch = (b: NeonBranch) => !!(b.default ?? b.primary);

/** The default branch first, then the newest. */
export function sortBranches(branches: NeonBranch[]): NeonBranch[] {
  return [...branches].sort((a, b) =>
    Number(isDefaultBranch(b)) - Number(isDefaultBranch(a)) || b.created_at.localeCompare(a.created_at)
  );
}

export function endpointState(e: NeonEndpoint | undefined): { label: string; color: Tint } {
  if (!e) return { label: "No compute", color: "gray" };
  if (e.disabled) return { label: "Disabled", color: "red" };
  switch (e.current_state) {
    case "active":
      return { label: "Active", color: "green" };
    case "idle":
      return { label: "Idle", color: "gray" };
    case "init":
      return { label: "Starting", color: "yellow" };
    default:
      return { label: capitalize(e.current_state), color: "gray" };
  }
}

/** "0.25–2 CU". */
export function computeSize(e: NeonEndpoint): string | undefined {
  const min = e.autoscaling_limit_min_cu;
  const max = e.autoscaling_limit_max_cu;
  if (min === undefined) return undefined;
  return min === max || max === undefined ? `${min} CU` : `${min}–${max} CU`;
}

/** A unique name for a new branch: `dev/2026-10-29`, then `dev/2026-10-29-2`. */
export function newBranchName(existing: string[], now = new Date()): string {
  const base = `dev/${now.toISOString().slice(0, 10)}`;
  let name = base;
  for (let n = 2; existing.includes(name); n++) name = `${base}-${n}`;
  return name;
}

/** Neon branch names: up to 256 characters, no leading or trailing spaces. */
export function validateBranchName(name: string): string {
  const n = name.trim();
  if (!n) throw new Error("Give the branch a name");
  if (n.length > 256) throw new Error("Branch names are at most 256 characters");
  return n;
}

// ---------------------------------------------------------------------------
// Turso (api.turso.tech)

export interface TursoOrg {
  name: string;
  slug: string;
  type: "personal" | "team" | string;
  blocked_reads?: boolean;
  blocked_writes?: boolean;
}

export interface TursoDatabase {
  Name: string;
  DbId: string;
  Hostname: string;
  regions?: string[];
  primaryRegion?: string;
  group?: string;
  version?: string;
  type?: string;
  is_schema?: boolean;
  schema?: string;
  sleeping?: boolean;
  block_reads?: boolean;
  block_writes?: boolean;
  archived?: boolean;
}

export interface TursoGroup {
  name: string;
  version?: string;
  uuid?: string;
  locations: string[];
  primary: string;
  archived?: boolean;
  delete_protection?: boolean;
}

export const tursoUrl = (d: TursoDatabase) => `libsql://${d.Hostname}`;

export const tursoDashboardUrl = (org: string, db?: string) =>
  `https://app.turso.tech/${encodeURIComponent(org)}${db ? `/databases/${encodeURIComponent(db)}` : ""}`;

export function tursoState(d: TursoDatabase): { label: string; color: Tint } {
  if (d.archived) return { label: "Archived", color: "gray" };
  if (d.block_reads) return { label: "Reads blocked", color: "red" };
  if (d.block_writes) return { label: "Writes blocked", color: "orange" };
  if (d.sleeping) return { label: "Sleeping", color: "gray" };
  if (d.is_schema) return { label: "Schema", color: "blue" };
  return { label: "Ready", color: "green" };
}

/** `lhr` → `London, UK (lhr)` with the names of /v1/locations, when known. */
export const locationName = (code: string, names: Record<string, string>) =>
  names[code] ? `${names[code]} (${code})` : code;

export const TOKEN_EXPIRATIONS = [
  { value: "1d", title: "1 day" },
  { value: "7d", title: "7 days" },
  { value: "30d", title: "30 days" },
  { value: "never", title: "Never" },
];

/** The path that creates a database token. */
export function tursoTokenPath(org: string, db: string, expiration: string, readOnly: boolean): string {
  const q = new URLSearchParams({ expiration, authorization: readOnly ? "read-only" : "full-access" });
  return `/v1/organizations/${encodeURIComponent(org)}/databases/${encodeURIComponent(db)}/auth/tokens?${q}`;
}

/** What a libSQL client wants: `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` lines. */
export const tursoEnv = (d: TursoDatabase, token: string) =>
  `TURSO_DATABASE_URL=${tursoUrl(d)}\nTURSO_AUTH_TOKEN=${token}\n`;

// ---------------------------------------------------------------------------
// PlanetScale (api.planetscale.com/v1)

export interface PsDatabase {
  id: string;
  name: string;
  html_url?: string;
  state: string;
  region?: { slug: string; display_name: string };
  created_at: string;
  updated_at?: string;
  kind?: string;
  plan?: string;
  branches_count?: number;
  production_branches_count?: number;
  development_branches_count?: number;
  issues_count?: number;
}

export interface PsBranch {
  id: string;
  name: string;
  production: boolean;
  ready: boolean;
  state?: string;
  created_at: string;
  updated_at?: string;
  parent_branch?: string | null;
  html_url?: string;
  region?: { display_name: string };
  safe_migrations?: boolean;
}

export interface PsDeployRequest {
  id: string;
  number: number;
  branch: string;
  into_branch: string;
  state: "open" | "closed" | string;
  deployment_state: string;
  approved?: boolean;
  html_url: string;
  created_at: string;
  updated_at?: string;
  closed_at?: string | null;
  deployed_at?: string | null;
  notes?: string | null;
  actor?: { display_name?: string; avatar_url?: string };
}

export function psState(state: string): { label: string; color: Tint } {
  switch (state) {
    case "ready":
      return { label: "Ready", color: "green" };
    case "sleeping":
      return { label: "Sleeping", color: "gray" };
    case "awakening":
    case "pending":
    case "importing":
      return { label: capitalize(state), color: "yellow" };
    case "sleep_in_progress":
      return { label: "Going to sleep", color: "gray" };
    default:
      return { label: capitalize(state.replace(/_/g, " ")), color: "gray" };
  }
}

/** What a deploy request is waiting for, from its state and deployment state. */
export function deployState(d: PsDeployRequest): { label: string; color: Tint; deployable: boolean } {
  if (d.state === "closed") {
    if (d.deployment_state === "complete" || d.deployed_at) {
      return { label: "Deployed", color: "purple", deployable: false };
    }
    return { label: "Closed", color: "gray", deployable: false };
  }
  switch (d.deployment_state) {
    case "ready":
      return {
        label: d.approved === false ? "Ready (needs approval)" : "Ready to deploy",
        color: "green",
        deployable: true,
      };
    case "no_changes":
      return { label: "No changes", color: "gray", deployable: false };
    case "pending":
    case "submitting":
      return { label: "Checking", color: "yellow", deployable: false };
    case "queued":
      return { label: "Queued", color: "yellow", deployable: false };
    case "in_progress":
    case "in_progress_vschema":
    case "in_progress_cutover":
    case "pending_cutover":
      return { label: "Deploying", color: "blue", deployable: false };
    case "complete":
    case "complete_pending_revert":
      return { label: "Deployed", color: "purple", deployable: false };
    case "error":
    case "complete_error":
    case "cancelled":
    case "in_progress_cancel":
      return { label: capitalize(d.deployment_state.replace(/_/g, " ")), color: "red", deployable: false };
    default:
      return { label: capitalize(d.deployment_state.replace(/_/g, " ")), color: "gray", deployable: false };
  }
}

/** Production branches first, then by name. */
export const sortPsBranches = (branches: PsBranch[]) =>
  [...branches].sort((a, b) => Number(b.production) - Number(a.production) || a.name.localeCompare(b.name));

/** Open deploy requests first, newest first. */
export const sortDeployRequests = (all: PsDeployRequest[]) =>
  [...all].sort((a, b) => Number(b.state === "open") - Number(a.state === "open") || b.number - a.number);

// ---------------------------------------------------------------------------
// Formatting

export function formatBytes(n: number | undefined): string | undefined {
  if (n === undefined || n === null || !Number.isFinite(n)) return undefined;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  for (; v >= 1024 && i < units.length - 1; i++) v /= 1024;
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

/** "5m", "3h", "2d", "4mo", "1y". */
export function age(date: string | undefined, now = Date.now()): string {
  if (!date) return "";
  const s = Math.max(0, (now - Date.parse(date)) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
  return `${Math.floor(s / 86400 / 365)}y`;
}

export const formatDate = (date: string) =>
  new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** A connection URI with its password masked. */
export const maskUri = (uri: string) => uri.replace(/^([a-z+]+:\/\/[^:/@]+:)[^@]*@/i, "$1****@");

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
