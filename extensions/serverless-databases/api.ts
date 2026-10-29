// The three providers' APIs: authentication, errors, pagination and the calls the views need.

import { storage } from "@backslash/api";
import {
  type Credentials,
  errorMessage,
  type NeonBranch,
  type NeonDatabase,
  type NeonEndpoint,
  type NeonProject,
  type Provider,
  PROVIDER_NAMES,
  type PsBranch,
  type PsDatabase,
  type PsDeployRequest,
  type TursoDatabase,
  type TursoGroup,
  type TursoOrg,
  tursoTokenPath,
} from "./lib.ts";

/** The hosts of `[permissions] net` (kept equal by a test). */
export const HOSTS = ["console.neon.tech", "api.turso.tech", "api.planetscale.com"];

const BASES: Record<Provider, string> = {
  neon: "https://console.neon.tech/api/v2",
  turso: "https://api.turso.tech",
  planetscale: "https://api.planetscale.com/v1",
};

export const TOKEN_PAGES: Record<Provider, string> = {
  neon: "https://console.neon.tech/app/settings/api-keys",
  turso: "https://app.turso.tech/account/api-tokens",
  planetscale: "https://app.planetscale.com/~/settings/service-tokens",
};

export class TokenError extends Error {
  constructor(readonly provider: Provider) {
    super(`${PROVIDER_NAMES[provider]} refused the token: check it in Settings`);
  }
}

function authHeader(provider: Provider, c: Credentials): string {
  if (provider === "planetscale") return `${c.planetscale!.id}:${c.planetscale!.token}`;
  return `Bearer ${c[provider]}`;
}

export async function call<T>(
  provider: Provider,
  c: Credentials,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASES[provider]}${path}`, {
      method: o.method ?? "GET",
      signal: o.signal,
      headers: {
        Authorization: authHeader(provider, c),
        Accept: "application/json",
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`Cannot reach ${PROVIDER_NAMES[provider]}: check your connection`);
  }
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = text;
  }
  if (res.status === 401) throw new TokenError(provider);
  if (!res.ok) {
    const msg = errorMessage(data);
    if (res.status === 403) {
      throw new Error(`${PROVIDER_NAMES[provider]} denied it${msg ? `: ${msg}` : ""}. Check the token's permissions`);
    }
    if (res.status === 404) throw new Error(`${PROVIDER_NAMES[provider]}: not found${msg ? ` (${msg})` : ""}`);
    if (res.status === 429) throw new Error(`${PROVIDER_NAMES[provider]} rate limit reached: try again in a minute`);
    throw new Error(`${PROVIDER_NAMES[provider]} answered ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return data as T;
}

const enc = encodeURIComponent;

// ---------------------------------------------------------------------------
// Neon

export interface NeonProjectEntry {
  project: NeonProject;
  org?: string;
}

/** Personal projects and those of every organization the key can see. */
export async function neonProjects(c: Credentials, signal: AbortSignal): Promise<NeonProjectEntry[]> {
  const orgs = await call<{ organizations: { id: string; name: string }[] }>("neon", c, "/users/me/organizations", {
    signal,
  }).then((r) => r.organizations ?? [], (e) => {
    // Organization API keys can't list organizations: their projects come without org_id.
    if (signal.aborted || e instanceof TokenError) throw e;
    return [];
  });
  const lists = await Promise.all([
    call<{ projects: NeonProject[] }>("neon", c, "/projects?limit=400", { signal }).then(
      (r) => r.projects.map((project): NeonProjectEntry => ({ project })),
      (e) => {
        // A personal key in an organization-only account may be refused here.
        if (signal.aborted || e instanceof TokenError || !orgs.length) throw e;
        return [] as NeonProjectEntry[];
      },
    ),
    ...orgs.map((o) =>
      call<{ projects: NeonProject[] }>("neon", c, `/projects?limit=400&org_id=${enc(o.id)}`, { signal }).then(
        (r) => r.projects.map((project) => ({ project, org: o.name })),
        () => [] as NeonProjectEntry[],
      )
    ),
  ]);
  const seen = new Map<string, NeonProjectEntry>();
  for (const e of lists.flat()) if (!seen.has(e.project.id) || e.org) seen.set(e.project.id, e);
  return [...seen.values()].sort((a, b) => (b.project.updated_at ?? "").localeCompare(a.project.updated_at ?? ""));
}

export async function neonBranches(
  c: Credentials,
  projectId: string,
  signal?: AbortSignal,
): Promise<{ branches: NeonBranch[]; endpoints: NeonEndpoint[] }> {
  const [b, e] = await Promise.all([
    call<{ branches: NeonBranch[] }>("neon", c, `/projects/${enc(projectId)}/branches`, { signal }),
    call<{ endpoints: NeonEndpoint[] }>("neon", c, `/projects/${enc(projectId)}/endpoints`, { signal }),
  ]);
  return { branches: b.branches ?? [], endpoints: e.endpoints ?? [] };
}

export async function neonDatabases(c: Credentials, projectId: string, branchId: string): Promise<NeonDatabase[]> {
  const r = await call<{ databases: NeonDatabase[] }>(
    "neon",
    c,
    `/projects/${enc(projectId)}/branches/${enc(branchId)}/databases`,
  );
  return r.databases ?? [];
}

/** The connection string of a database of the branch, with its owner's password. */
export async function neonConnectionUri(
  c: Credentials,
  projectId: string,
  branchId: string,
  db: NeonDatabase,
  pooled: boolean,
): Promise<string> {
  const q = new URLSearchParams({
    branch_id: branchId,
    database_name: db.name,
    role_name: db.owner_name,
    pooled: String(pooled),
  });
  const r = await call<{ uri: string }>("neon", c, `/projects/${enc(projectId)}/connection_uri?${q}`);
  return r.uri;
}

export async function neonCreateBranch(
  c: Credentials,
  projectId: string,
  name: string,
  parentId: string,
  withCompute: boolean,
): Promise<NeonBranch> {
  const r = await call<{ branch: NeonBranch }>("neon", c, `/projects/${enc(projectId)}/branches`, {
    method: "POST",
    body: { branch: { name, parent_id: parentId }, ...(withCompute ? { endpoints: [{ type: "read_write" }] } : {}) },
  });
  return r.branch;
}

export async function neonDeleteBranch(c: Credentials, projectId: string, branchId: string): Promise<void> {
  await call("neon", c, `/projects/${enc(projectId)}/branches/${enc(branchId)}`, { method: "DELETE" });
}

export async function neonEndpoint(c: Credentials, projectId: string, endpointId: string, op: "start" | "suspend") {
  await call("neon", c, `/projects/${enc(projectId)}/endpoints/${enc(endpointId)}/${op}`, { method: "POST" });
}

// ---------------------------------------------------------------------------
// Turso

export async function tursoOrgs(c: Credentials, signal: AbortSignal): Promise<TursoOrg[]> {
  return await call<TursoOrg[]>("turso", c, "/v1/organizations", { signal }) ?? [];
}

export async function tursoDatabases(c: Credentials, org: string, signal: AbortSignal): Promise<TursoDatabase[]> {
  const r = await call<{ databases: TursoDatabase[] }>("turso", c, `/v1/organizations/${enc(org)}/databases`, {
    signal,
  });
  return r.databases ?? [];
}

export async function tursoGroups(c: Credentials, org: string, signal: AbortSignal): Promise<TursoGroup[]> {
  const r = await call<{ groups: TursoGroup[] }>("turso", c, `/v1/organizations/${enc(org)}/groups`, { signal });
  return r.groups ?? [];
}

/** Location codes and names (`lhr` → `London, UK`): they barely change, cached for a week. */
export async function tursoLocations(c: Credentials, signal: AbortSignal): Promise<Record<string, string>> {
  const cached = await storage.get("turso-locations").catch(() => undefined) as
    | { at: number; locations: Record<string, string> }
    | undefined;
  if (cached && Date.now() - cached.at < 7 * 86_400_000) return cached.locations;
  try {
    const r = await call<{ locations: Record<string, string> }>("turso", c, "/v1/locations", { signal });
    await storage.set("turso-locations", { at: Date.now(), locations: r.locations }).catch(() => {});
    return r.locations ?? {};
  } catch (e) {
    if (signal.aborted) throw e;
    return cached?.locations ?? {};
  }
}

export async function tursoCreateToken(
  c: Credentials,
  org: string,
  db: string,
  expiration: string,
  readOnly: boolean,
): Promise<string> {
  const r = await call<{ jwt: string }>("turso", c, tursoTokenPath(org, db, expiration, readOnly), { method: "POST" });
  return r.jwt;
}

// ---------------------------------------------------------------------------
// PlanetScale

const MAX_PAGES = 10;

async function psPages<T>(c: Credentials, path: string, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= MAX_PAGES;) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await call<{ data: T[]; next_page?: number | null }>(
      "planetscale",
      c,
      `${path}${sep}page=${page}&per_page=100`,
      { signal },
    );
    out.push(...(r.data ?? []));
    if (!r.next_page || r.next_page <= page) break;
    page = r.next_page;
  }
  return out;
}

/** The organization in Settings, else every one the service token can see. */
export async function psOrgs(c: Credentials, signal: AbortSignal): Promise<string[]> {
  if (c.planetscale?.org) return [c.planetscale.org];
  const orgs = await psPages<{ name: string }>(c, "/organizations", signal);
  if (!orgs.length) {
    throw new Error("PlanetScale lists no organization for this token: set the organization in Settings");
  }
  return orgs.map((o) => o.name);
}

export const psDatabases = (c: Credentials, org: string, signal: AbortSignal) =>
  psPages<PsDatabase>(c, `/organizations/${enc(org)}/databases`, signal);

export const psBranches = (c: Credentials, org: string, db: string, signal?: AbortSignal) =>
  psPages<PsBranch>(c, `/organizations/${enc(org)}/databases/${enc(db)}/branches`, signal);

export const psDeployRequests = (c: Credentials, org: string, db: string, signal?: AbortSignal) =>
  psPages<PsDeployRequest>(c, `/organizations/${enc(org)}/databases/${enc(db)}/deploy-requests`, signal);

export async function psDeploy(c: Credentials, org: string, db: string, n: number): Promise<void> {
  await call("planetscale", c, `/organizations/${enc(org)}/databases/${enc(db)}/deploy-requests/${n}/deploy`, {
    method: "POST",
  });
}
