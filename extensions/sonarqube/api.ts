// The Web API of SonarCloud or a SonarQube server (`/api/...`) with a user token.

import { Icons, type Item, open } from "@backslash/api";
import {
  type ComponentRef,
  type GateCondition,
  type Hotspot,
  isCloud,
  type Issue,
  type Measure,
  METRICS,
  normalizeUrl,
  type Project,
  tokenAuth,
} from "./lib.ts";

export class AuthError extends Error {}

export interface Account {
  base: string;
  header: string;
  organization?: string;
}

export function account(preferences: Record<string, unknown>): Account {
  const token = String(preferences.token ?? "").trim();
  let base: string;
  try {
    base = normalizeUrl(preferences.url);
  } catch {
    throw new AuthError(`“${preferences.url}” is not a web address: fix the server in Settings`);
  }
  if (!token) throw new AuthError("Add a SonarQube or SonarCloud token");
  const organization = String(preferences.organization ?? "").trim() || undefined;
  if (isCloud(base) && !organization) throw new AuthError("Add your SonarCloud organization key");
  return { base, header: tokenAuth(token), organization };
}

export const tokenPage = (a?: Account) => `${a?.base ?? "https://sonarcloud.io"}/account/security`;

export async function sonar<T>(
  a: Account,
  path: string,
  params: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<T> {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") query.set(k, String(v));
  if (a.organization && isCloud(a.base) && !query.has("organization") && !query.has("projectKey")) {
    query.set("organization", a.organization);
  }
  const host = isCloud(a.base) ? "SonarCloud" : "SonarQube";
  let res: Response;
  try {
    res = await fetch(`${a.base}${path}${query.size ? `?${query}` : ""}`, {
      signal,
      headers: { Authorization: a.header, Accept: "application/json" },
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`Can't reach ${a.base}: ${(e as Error).message}`);
  }
  if (res.status === 401) throw new AuthError(`${host} rejected the token`);
  const body = await res.json().catch(() => undefined) as { errors?: { msg: string }[] } | undefined;
  const why = body?.errors?.map((e) => e.msg).join("; ") ?? "";
  if (res.status === 403) throw new Error(`${host} refused it${why ? `: ${why}` : ""}. Check the token's permissions`);
  if (!res.ok) throw new Error(`${host} answered ${res.status}${why ? `: ${why}` : ""}`);
  if (body === undefined) throw new Error(`${a.base} is not a SonarQube server (the answer isn't JSON)`);
  return body as T;
}

/** Every project you can browse (up to 500), with favorites marked. */
export async function projects(a: Account, signal?: AbortSignal): Promise<Project[]> {
  try {
    const r = await sonar<{ components: Project[] }>(a, "/api/components/search_projects", {
      ps: 500,
      f: "analysisDate",
    }, signal);
    return r.components;
  } catch (e) {
    if (e instanceof AuthError || signal?.aborted) throw e;
    const r = await sonar<{ components: Project[] }>(
      a,
      "/api/components/search",
      { qualifiers: "TRK", ps: 500 },
      signal,
    );
    return r.components;
  }
}

/** The measures of many projects, 50 per call, falling back to one call per project. */
export async function measures(a: Account, keys: string[], signal?: AbortSignal): Promise<Measure[]> {
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 50) chunks.push(keys.slice(i, i + 50));
  const lists = await Promise.all(chunks.map(async (chunk) => {
    try {
      const r = await sonar<{ measures: Measure[] }>(a, "/api/measures/search", {
        projectKeys: chunk.join(","),
        metricKeys: METRICS.join(","),
      }, signal);
      return r.measures;
    } catch (e) {
      if (e instanceof AuthError || signal?.aborted) throw e;
      const each = await Promise.all(
        chunk.map((key) =>
          sonar<{ component: { key: string; measures: Measure[] } }>(a, "/api/measures/component", {
            component: key,
            metricKeys: METRICS.join(","),
          }, signal).then((r) => r.component.measures.map((m) => ({ ...m, component: key }))).catch(() =>
            [] as Measure[]
          )
        ),
      );
      return each.flat();
    }
  }));
  return lists.flat();
}

export async function gateConditions(a: Account, key: string, signal?: AbortSignal): Promise<GateCondition[]> {
  const r = await sonar<{ projectStatus: { conditions?: GateCondition[] } }>(a, "/api/qualitygates/project_status", {
    projectKey: key,
  }, signal);
  return r.projectStatus.conditions ?? [];
}

export async function newIssues(
  a: Account,
  key: string,
  signal?: AbortSignal,
): Promise<{ issues: Issue[]; components: ComponentRef[]; total: number }> {
  const r = await sonar<{ issues: Issue[]; components?: ComponentRef[]; total?: number; paging?: { total: number } }>(
    a,
    "/api/issues/search",
    { componentKeys: key, resolved: "false", inNewCodePeriod: "true", ps: 200, s: "SEVERITY", asc: "false" },
    signal,
  );
  return { issues: r.issues, components: r.components ?? [], total: r.paging?.total ?? r.total ?? r.issues.length };
}

export async function hotspots(
  a: Account,
  key: string,
  signal?: AbortSignal,
): Promise<{ hotspots: Hotspot[]; components: ComponentRef[]; total: number }> {
  const r = await sonar<{ hotspots: Hotspot[]; components?: ComponentRef[]; paging?: { total: number } }>(
    a,
    "/api/hotspots/search",
    { projectKey: key, status: "TO_REVIEW", ps: 200 },
    signal,
  );
  return { hotspots: r.hotspots, components: r.components ?? [], total: r.paging?.total ?? r.hotspots.length };
}

/** The row shown instead of results until the server and token work. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "SonarQube: server, token and organization",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect SonarQube or SonarCloud",
        "",
        "1. Open **My Account → Security** on your server (Enter opens SonarCloud's) and generate a **user token**.",
        "2. In **Settings → Extensions → SonarQube → Configure**, set:",
        "   - **Server**: `https://sonarcloud.io`, or your SonarQube address (`https://sonar.example.com`)",
        "   - **Token**: the token you just generated",
        "   - **Organization**: for SonarCloud only, your organization key",
      ].join("\n"),
    },
    actions: [
      open("https://sonarcloud.io/account/security", "Open SonarCloud Tokens", { icon: Icons.key }),
      open("https://docs.sonarsource.com/sonarqube-server/latest/user-guide/managing-tokens/", "About Tokens", {
        icon: Icons.book,
      }),
    ],
  }];
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}

export async function* guardedSteps(load: () => AsyncGenerator<Item[]>): AsyncGenerator<Item[]> {
  try {
    yield* load();
  } catch (e) {
    if (e instanceof AuthError) yield setupItems(e);
    else throw e;
  }
}
