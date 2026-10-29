// Flags of LaunchDarkly, Unleash, Flagsmith and GrowthBook in one shape, and how they look in the
// list. Tested in lib_test.ts.

import { type Color, Icons, meta, type Metadata } from "@backslash/api";

export type Provider = "launchdarkly" | "unleash" | "flagsmith" | "growthbook";

export const PROVIDERS: Provider[] = ["launchdarkly", "unleash", "flagsmith", "growthbook"];

export const PROVIDER_NAMES: Record<Provider, string> = {
  launchdarkly: "LaunchDarkly",
  unleash: "Unleash",
  flagsmith: "Flagsmith",
  growthbook: "GrowthBook",
};

export interface EnvState {
  /** What the provider's API calls it (LaunchDarkly key, Unleash name, Flagsmith API key, GrowthBook id). */
  key: string;
  name: string;
  on: boolean;
  production: boolean;
  /** Flagsmith: the feature state id to PATCH. */
  ref?: number;
}

export interface Flag {
  provider: Provider;
  project: string;
  key: string;
  name: string;
  description?: string;
  kind?: string;
  tags: string[];
  archived: boolean;
  stale?: boolean;
  created?: string;
  updated?: string;
  owner?: string;
  url: string;
  environments: EnvState[];
}

// --- Helpers ------------------------------------------------------------------------

/** `ci.example.com/` → `https://ci.example.com`; keeps a path. Throws on what isn't an address. */
export function normalizeUrl(input: unknown): string {
  let text = String(input ?? "").trim();
  if (!text) throw new Error("empty address");
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  const url = new URL(text);
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
}

export const parseList = (text: unknown) => String(text ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);

/** Environments whose name looks like production get a confirmation before a toggle. */
export function looksLikeProduction(name: string, type?: string): boolean {
  if (type && /^prod/i.test(type)) return true;
  return /(^|[^a-z])(prod|production|prd|live)([^a-z]|$)/i.test(name);
}

export function ago(iso: string | number | undefined, now = Date.now()): string {
  if (iso === undefined || iso === "") return "";
  const t = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return "now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86_400) return `${Math.floor(s / 86_400)}d`;
  const d = new Date(t);
  if (s < 365 * 86_400) return d.toLocaleDateString("en", { day: "numeric", month: "short" });
  return d.toLocaleDateString("en", { month: "short", year: "numeric" });
}

const iso = (v: string | number | undefined | null) =>
  v === undefined || v === null || v === "" ? undefined : new Date(v).toISOString();

// --- LaunchDarkly -------------------------------------------------------------------

/** `GET /api/v2/flags/{project}?summary=0`. */
export interface LdFlag {
  key: string;
  name: string;
  description?: string;
  kind?: "boolean" | "multivariate";
  tags?: string[];
  archived?: boolean;
  deprecated?: boolean;
  temporary?: boolean;
  creationDate?: number;
  _maintainer?: { firstName?: string; lastName?: string; email?: string };
  environments?: Record<string, { on: boolean; _environmentName?: string; lastModified?: number }>;
}

/** `GET /api/v2/projects/{project}/environments`. */
export interface LdEnvironment {
  key: string;
  name: string;
  critical?: boolean;
}

export function fromLaunchDarkly(project: string, f: LdFlag, envs: LdEnvironment[]): Flag {
  const order = envs.length ? envs : Object.keys(f.environments ?? {}).map((key) => ({ key, name: key }));
  const maintainer = f._maintainer
    ? [f._maintainer.firstName, f._maintainer.lastName].filter(Boolean).join(" ") || f._maintainer.email
    : undefined;
  const updated = Math.max(0, ...Object.values(f.environments ?? {}).map((e) => e.lastModified ?? 0));
  return {
    provider: "launchdarkly",
    project,
    key: f.key,
    name: f.name || f.key,
    description: f.description || undefined,
    kind: f.kind,
    tags: f.tags ?? [],
    archived: !!f.archived || !!f.deprecated,
    created: iso(f.creationDate),
    updated: updated ? iso(updated) : undefined,
    owner: maintainer,
    url: `https://app.launchdarkly.com/projects/${encodeURIComponent(project)}/flags/${encodeURIComponent(f.key)}`,
    environments: order.filter((e) => f.environments?.[e.key]).map((e) => {
      const name = f.environments![e.key]._environmentName ?? e.name;
      return {
        key: e.key,
        name,
        on: f.environments![e.key].on,
        production: !!(e as LdEnvironment).critical || looksLikeProduction(name) || looksLikeProduction(e.key),
      };
    }),
  };
}

/** The JSON Patch that turns a flag on or off in an environment. */
export const ldTogglePatch = (
  env: string,
  on: boolean,
) => [{ op: "replace", path: `/environments/${env}/on`, value: on }];

// --- Unleash ------------------------------------------------------------------------

/** `GET /api/admin/projects/{project}/features`. */
export interface UnleashFeature {
  name: string;
  description?: string | null;
  type?: string;
  project?: string;
  stale?: boolean;
  archived?: boolean;
  createdAt?: string;
  lastSeenAt?: string | null;
  tags?: { type: string; value: string }[];
  environments?: { name: string; enabled: boolean; type?: string; sortOrder?: number }[];
}

/** `GET /api/admin/environments`. */
export interface UnleashEnvironment {
  name: string;
  type?: string;
  enabled?: boolean;
  sortOrder?: number;
}

export function fromUnleash(base: string, project: string, f: UnleashFeature, envs: UnleashEnvironment[] = []): Flag {
  const types = new Map(envs.map((e) => [e.name, e.type]));
  const order = new Map(envs.map((e, i) => [e.name, e.sortOrder ?? i]));
  return {
    provider: "unleash",
    project: f.project ?? project,
    key: f.name,
    name: f.name,
    description: f.description || undefined,
    kind: f.type,
    tags: (f.tags ?? []).map((t) => t.type === "simple" ? t.value : `${t.type}:${t.value}`),
    archived: !!f.archived,
    stale: f.stale,
    created: f.createdAt,
    updated: f.lastSeenAt ?? undefined,
    url: `${base}/projects/${encodeURIComponent(f.project ?? project)}/features/${encodeURIComponent(f.name)}`,
    environments: [...(f.environments ?? [])]
      .sort((a, b) => (order.get(a.name) ?? a.sortOrder ?? 99) - (order.get(b.name) ?? b.sortOrder ?? 99))
      .map((e) => ({
        key: e.name,
        name: e.name,
        on: e.enabled,
        production: looksLikeProduction(e.name, e.type ?? types.get(e.name)),
      })),
  };
}

// --- Flagsmith ----------------------------------------------------------------------

/** `GET /api/v1/projects/{id}/features/`. */
export interface FsFeature {
  id: number;
  name: string;
  description?: string | null;
  type?: string;
  tags?: number[];
  is_archived?: boolean;
  created_date?: string;
  owners?: { first_name?: string; last_name?: string; email?: string }[];
}

/** `GET /api/v1/environments/?project={id}`. */
export interface FsEnvironment {
  id: number;
  name: string;
  api_key: string;
}

/** `GET /api/v1/environments/{api_key}/featurestates/`. */
export interface FsFeatureState {
  id: number;
  feature: number;
  enabled: boolean;
  identity?: number | null;
  feature_segment?: number | null;
  updated_at?: string;
}

/** Flagsmith's app is next to its API: `api.flagsmith.com/api/v1` → `app.flagsmith.com`. */
export function flagsmithAppUrl(api: string): string {
  const url = new URL(api);
  if (url.hostname === "api.flagsmith.com") return "https://app.flagsmith.com";
  return `${url.protocol}//${url.host}`;
}

/** The environment-wide states (no identity or segment override), by feature id. */
export function environmentStates(states: FsFeatureState[]): Map<number, FsFeatureState> {
  const out = new Map<number, FsFeatureState>();
  for (const s of states) if (!s.identity && !s.feature_segment) out.set(s.feature, s);
  return out;
}

export function fromFlagsmith(
  api: string,
  project: string,
  f: FsFeature,
  envs: { env: FsEnvironment; states: Map<number, FsFeatureState> }[],
  tagNames: Map<number, string> = new Map(),
): Flag {
  const app = flagsmithAppUrl(api);
  const first = envs[0]?.env.api_key;
  const owner = f.owners?.[0];
  return {
    provider: "flagsmith",
    project,
    key: f.name,
    name: f.name,
    description: f.description || undefined,
    kind: f.type === "MULTIVARIATE" ? "multivariate" : f.type ? "standard" : undefined,
    tags: (f.tags ?? []).map((t) => tagNames.get(t)).filter((t): t is string => !!t),
    archived: !!f.is_archived,
    created: f.created_date,
    owner: owner ? [owner.first_name, owner.last_name].filter(Boolean).join(" ") || owner.email : undefined,
    url: first
      ? `${app}/project/${project}/environment/${first}/features?feature=${f.id}`
      : `${app}/project/${project}`,
    environments: envs.flatMap(({ env, states }) => {
      const s = states.get(f.id);
      return s
        ? [{ key: env.api_key, name: env.name, on: s.enabled, production: looksLikeProduction(env.name), ref: s.id }]
        : [];
    }),
  };
}

/** Flagsmith lists are sometimes paginated (`{ results }`), sometimes plain arrays. */
export const results = <T>(body: T[] | { results?: T[] } | undefined): T[] =>
  Array.isArray(body) ? body : body?.results ?? [];

// --- GrowthBook ---------------------------------------------------------------------

/** `GET /api/v1/features`. */
export interface GbFeature {
  id: string;
  description?: string;
  archived?: boolean;
  dateCreated?: string;
  dateUpdated?: string;
  owner?: string;
  project?: string;
  tags?: string[];
  valueType?: string;
  environments?: Record<string, { enabled: boolean; rules?: unknown[] }>;
}

/** `GET /api/v1/environments`. */
export interface GbEnvironment {
  id: string;
  description?: string;
}

export function growthbookAppUrl(api: string): string {
  const url = new URL(api);
  if (url.hostname === "api.growthbook.io") return "https://app.growthbook.io";
  return `${url.protocol}//${url.host}`;
}

export function fromGrowthBook(api: string, f: GbFeature, envs: GbEnvironment[] = []): Flag {
  const order = envs.length ? envs.map((e) => e.id) : Object.keys(f.environments ?? {});
  return {
    provider: "growthbook",
    project: f.project || "All projects",
    key: f.id,
    name: f.id,
    description: f.description || undefined,
    kind: f.valueType,
    tags: f.tags ?? [],
    archived: !!f.archived,
    created: f.dateCreated,
    updated: f.dateUpdated,
    owner: f.owner || undefined,
    url: `${growthbookAppUrl(api)}/features/${encodeURIComponent(f.id)}`,
    environments: order.filter((id) => f.environments?.[id]).map((id) => ({
      key: id,
      name: id,
      on: f.environments![id].enabled,
      production: looksLikeProduction(id),
    })),
  };
}

// --- Presentation -------------------------------------------------------------------

export const PROVIDER_COLORS: Record<Provider, Color> = {
  launchdarkly: "gray",
  unleash: "purple",
  flagsmith: "blue",
  growthbook: "teal",
};

/** "On in 2 of 3", "On everywhere", "Off everywhere". */
export function stateSummary(f: Flag): { text: string; color: Color; icon: string } {
  const n = f.environments.length;
  const on = f.environments.filter((e) => e.on).length;
  if (!n) return { text: "No environment", color: "gray", icon: Icons.flag };
  if (on === n) return { text: n === 1 ? "On" : "On everywhere", color: "green", icon: Icons.flag };
  if (on === 0) return { text: n === 1 ? "Off" : "Off everywhere", color: "gray", icon: Icons.flag };
  return { text: `On in ${on} of ${n}`, color: "yellow", icon: Icons.flag };
}

/** The pills on the right: one per environment, at most `max`. */
export function envAccessories(f: Flag, max = 4) {
  return f.environments.slice(0, max).map((e) => ({
    icon: { source: e.on ? Icons.check : Icons.minus, tint: (e.on ? "green" : "gray") as Color },
    text: e.name,
    tooltip: `${e.on ? "On" : "Off"} in ${e.name}${e.production ? " (production)" : ""}`,
  }));
}

export function flagMetadata(f: Flag): Metadata[] {
  return [
    ...f.environments.map((e) =>
      meta.text(e.name + (e.production ? " (production)" : ""), e.on ? "On" : "Off", {
        icon: e.on ? Icons.check : Icons.minus,
        color: e.on ? "green" : "gray",
      })
    ),
    meta.separator(),
    meta.text("Provider", PROVIDER_NAMES[f.provider], { icon: Icons.flag }),
    meta.text("Project", f.project, { icon: Icons.project }),
    meta.text("Key", f.key, { icon: Icons.key }),
    ...(f.kind ? [meta.text("Type", f.kind)] : []),
    ...(f.tags.length ? [meta.tags("Tags", f.tags)] : []),
    ...(f.stale ? [meta.text("Stale", "Yes", { icon: Icons.alert, color: "orange" })] : []),
    ...(f.archived ? [meta.text("Archived", "Yes", { icon: Icons.archive })] : []),
    ...(f.owner ? [meta.person("Owner", f.owner)] : []),
    ...(f.created ? [meta.text("Created", ago(f.created), { icon: Icons.calendar })] : []),
    ...(f.updated
      ? [meta.text(f.provider === "unleash" ? "Last seen" : "Updated", ago(f.updated), { icon: Icons.clock })]
      : []),
  ];
}

/** Active flags first, by name. */
export function sortFlags(flags: Flag[]): Flag[] {
  return [...flags].sort((a, b) =>
    Number(a.archived) - Number(b.archived) || PROVIDERS.indexOf(a.provider) - PROVIDERS.indexOf(b.provider) ||
    a.project.localeCompare(b.project) || a.name.localeCompare(b.name)
  );
}

/** The confirmation shown before toggling in production. */
export function toggleConfirm(f: Flag, e: EnvState): string | undefined {
  if (!e.production) return undefined;
  return `Turn ${e.on ? "off" : "on"} “${f.name}” in ${e.name}?`;
}

export const toggleTitle = (e: EnvState) => `Turn ${e.on ? "Off" : "On"} in ${e.name}`;
