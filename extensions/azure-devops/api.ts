// Azure DevOps REST API (dev.azure.com, api-version 7.1) with a personal access token.

import { Icons, type Item, open, storage } from "@backslash/api";
import { normalizeOrg, parseList, patAuth, type StateCategory, withVersion } from "./lib.ts";

export const TOKEN_DOCS =
  "https://learn.microsoft.com/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate";

export class AuthError extends Error {}

export interface Auth {
  org: string;
  header: string;
  projects: string[];
}

export function auth(preferences: Record<string, unknown>): Auth {
  const org = normalizeOrg(preferences.organization);
  const token = String(preferences.token ?? "").trim();
  if (!org || !token) throw new AuthError("Add your Azure DevOps organization and a personal access token");
  return { org, header: patAuth(token), projects: parseList(preferences.projects) };
}

export const base = (a: Auth) => `https://dev.azure.com/${encodeURIComponent(a.org)}`;

export const tokenPage = (a?: Auth) =>
  a ? `${base(a)}/_usersSettings/tokens` : "https://dev.azure.com/_usersSettings/tokens";

/** A path under `dev.azure.com/<org>`; `api-version` is added. */
export async function ado<T>(
  a: Auth,
  path: string,
  o: { method?: string; body?: unknown; signal?: AbortSignal; version?: string; contentType?: string } = {},
): Promise<T> {
  const res = await fetch(`${base(a)}${withVersion(path, o.version)}`, {
    method: o.method ?? "GET",
    signal: o.signal,
    redirect: "manual",
    headers: {
      Authorization: a.header,
      Accept: "application/json",
      // Without it, a bad token gets a sign-in page instead of a 401.
      "X-TFS-FedAuthRedirect": "Suppress",
      ...(o.body === undefined ? {} : { "Content-Type": o.contentType ?? "application/json" }),
    },
    body: o.body === undefined ? undefined : JSON.stringify(o.body),
  });
  if (res.status === 401 || res.status === 203 || (res.status >= 300 && res.status < 400)) {
    await res.body?.cancel();
    throw new AuthError("Azure DevOps rejected the personal access token (expired, or for another organization?)");
  }
  const text = await res.text();
  let body: { message?: string; value?: unknown } | undefined;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const why = body?.message ?? "";
    if (res.status === 404 && /organization|account/i.test(why)) {
      throw new AuthError(`No Azure DevOps organization “${a.org}”`);
    }
    if (res.status === 403) {
      throw new Error(`Azure DevOps refused it${why ? `: ${why}` : ""}. Check the token's scopes`);
    }
    if (res.status === 429) throw new Error("Azure DevOps is rate limiting: try again in a minute");
    throw new Error(`Azure DevOps answered ${res.status}${why ? `: ${why}` : ""}`);
  }
  if (text && body === undefined) {
    throw new AuthError("Azure DevOps answered with a sign-in page: check the organization and the token");
  }
  return body as T;
}

export interface Me {
  id: string;
  displayName: string;
}

/** The user the token belongs to. */
export async function me(a: Auth, signal?: AbortSignal): Promise<Me> {
  const data = await ado<{ authenticatedUser?: { id?: string; providerDisplayName?: string } }>(
    a,
    "/_apis/connectionData",
    { signal, version: "7.1-preview" },
  );
  const user = data.authenticatedUser;
  if (!user?.id) throw new AuthError("Azure DevOps didn't recognize the token");
  return { id: user.id, displayName: user.providerDisplayName ?? "" };
}

export type Project = { id: string; name: string };

/** The projects of the preference, else the organization's first 30 (cached for 6 hours). */
export async function projects(a: Auth, signal?: AbortSignal): Promise<Project[]> {
  const key = `projects:${a.org}`;
  const cached = await storage.get<{ at: number; list: Project[] }>(key).catch(() => undefined);
  let all: Project[];
  if (cached && Date.now() - cached.at < 6 * 3_600_000 && cached.list.length) {
    all = cached.list;
  } else {
    const res = await ado<{ value: Project[] }>(a, "/_apis/projects?$top=200&stateFilter=wellFormed", { signal });
    all = res.value.map((p) => ({ id: p.id, name: p.name }));
    await storage.set(key, { at: Date.now(), list: all }).catch(() => {});
  }
  if (a.projects.length) {
    const wanted = a.projects.map((p) => p.toLowerCase());
    const found = all.filter((p) => wanted.includes(p.name.toLowerCase()));
    if (!found.length) throw new AuthError(`None of the projects “${a.projects.join(", ")}” exists in ${a.org}`);
    return found;
  }
  return all.slice(0, 30);
}

export const projectPath = (p: { name: string }) => `/${encodeURIComponent(p.name)}`;

/** State categories of each work item type, by `project/type/state`, cached for a day. */
export async function stateCategories(
  a: Auth,
  pairs: { project: string; type: string }[],
  signal?: AbortSignal,
): Promise<Map<string, StateCategory>> {
  const out = new Map<string, StateCategory>();
  const key = `states:${a.org}`;
  const cached = await storage.get<{ at: number; map: Record<string, StateCategory> }>(key).catch(() => undefined);
  const known: Record<string, StateCategory> = cached && Date.now() - cached.at < 86_400_000 ? cached.map : {};
  const missing = pairs.filter((p) => !Object.keys(known).some((k) => k.startsWith(`${p.project}/${p.type}/`)));
  const unique = [...new Map(missing.map((p) => [`${p.project}/${p.type}`, p])).values()];
  await Promise.all(unique.map(async (p) => {
    const states = await typeStates(a, p.project, p.type, signal).catch(() => []);
    for (const s of states) known[`${p.project}/${p.type}/${s.name}`] = s.category;
  }));
  if (unique.length) await storage.set(key, { at: Date.now(), map: known }).catch(() => {});
  for (const [k, v] of Object.entries(known)) out.set(k, v);
  return out;
}

export interface TypeState {
  name: string;
  color?: string;
  category: StateCategory;
}

export async function typeStates(a: Auth, project: string, type: string, signal?: AbortSignal): Promise<TypeState[]> {
  const res = await ado<{ value: TypeState[] }>(
    a,
    `/${encodeURIComponent(project)}/_apis/wit/workitemtypes/${encodeURIComponent(type)}/states`,
    { signal },
  );
  return res.value;
}

/** The row shown instead of results until the credentials work. */
export function setupItems(error: AuthError, a?: Auth): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Azure DevOps: organization and personal access token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Azure DevOps",
        "",
        "1. Open **User settings → Personal access tokens** (Enter opens it) and choose **New Token**.",
        "2. Pick your organization and these scopes:",
        "   - **Code**: Read & write (pull requests and votes)",
        "   - **Work Items**: Read & write (state changes)",
        "   - **Build**: Read & execute (rerun and cancel)",
        "   - **Project and Team**: Read",
        "3. In **Settings → Extensions → Azure DevOps → Configure**, enter the **organization** (`acme` in",
        "   `dev.azure.com/acme`) and paste the token.",
      ].join("\n"),
    },
    actions: [
      open(tokenPage(a), "Create Personal Access Token", { icon: Icons.key }),
      open(TOKEN_DOCS, "About Personal Access Tokens", { icon: Icons.book }),
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

export const countStatus = (items: Item[], one: string, many = `${one}s`) =>
  items[0]?.id === "setup" ? "Not connected" : `${items.length} ${items.length === 1 ? one : many}`;
