// Bitbucket Cloud REST API 2.0 with an Atlassian API token (or a legacy app password).

import { Icons, type Item, open, storage } from "@backslash/api";
import { basicAuth, type Repo } from "./lib.ts";

export const API = "https://api.bitbucket.org/2.0";
export const TOKEN_URL = "https://id.atlassian.com/manage-profile/security/api-tokens";
export const DOCS_URL = "https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/";

export class AuthError extends Error {}

export interface Auth {
  header: string;
}

export function auth(preferences: Record<string, unknown>): Auth {
  const user = String(preferences.email ?? "").trim();
  const secret = String(preferences.token ?? "").trim();
  if (!user || !secret) throw new AuthError("Add your Atlassian email and an API token");
  return { header: basicAuth(user, secret) };
}

/** A path under /2.0, or a full `next` URL from a paginated answer. */
export async function bitbucket<T>(a: Auth, path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(path.startsWith("https://") ? path : `${API}${path}`, {
    signal,
    headers: { Authorization: a.header, Accept: "application/json" },
  });
  if (res.status === 401) throw new AuthError("Bitbucket rejected the email or API token");
  if (res.status === 403) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string; detail?: string } };
    const why = body.error?.detail || body.error?.message || "";
    if (/scope|privilege|permission/i.test(why)) throw new AuthError(`The API token lacks a scope: ${why}`);
    throw new Error(`Bitbucket refused the request${why ? `: ${why}` : ""}`);
  }
  if (res.status === 429) throw new Error("Bitbucket is rate limiting: try again in a minute");
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(`Bitbucket answered ${res.status}${body.error?.message ? `: ${body.error.message}` : ""}`);
  }
  return await res.json() as T;
}

export interface Page<T> {
  values: T[];
  next?: string;
  size?: number;
}

/** Up to `max` values, following `next`. */
export async function all<T>(a: Auth, path: string, max: number, signal?: AbortSignal): Promise<T[]> {
  const out: T[] = [];
  let next: string | undefined = path;
  while (next && out.length < max) {
    const page: Page<T> = await bitbucket<Page<T>>(a, next, signal);
    out.push(...page.values);
    next = page.next;
  }
  return out.slice(0, max);
}

export interface Me {
  uuid: string;
  account_id?: string;
  display_name: string;
  nickname?: string;
  links?: { avatar?: { href: string } };
}

export async function me(a: Auth, signal?: AbortSignal): Promise<Me> {
  return await bitbucket<Me>(a, "/user", signal);
}

/** Workspace slugs: from the preference, else every workspace you're a member of. */
export async function workspaces(a: Auth, preference: unknown, signal?: AbortSignal): Promise<string[]> {
  const chosen = String(preference ?? "").split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (chosen.length) return chosen;
  const cached = await storage.get<{ at: number; slugs: string[] }>("workspaces").catch(() => undefined);
  if (cached && Date.now() - cached.at < 6 * 3_600_000 && cached.slugs.length) return cached.slugs;
  let slugs: string[];
  try {
    const access = await all<{ workspace: { slug: string } }>(a, "/user/workspaces?pagelen=100", 100, signal);
    slugs = access.map((w) => w.workspace.slug);
  } catch (e) {
    if (e instanceof AuthError) throw e;
    // Older endpoint, being retired by Atlassian.
    const list = await all<{ slug: string }>(a, "/workspaces?role=member&pagelen=100", 100, signal);
    slugs = list.map((w) => w.slug);
  }
  await storage.set("workspaces", { at: Date.now(), slugs }).catch(() => {});
  return slugs;
}

/** The most recently updated repositories of the workspaces, `max` each. */
export async function recentRepos(a: Auth, slugs: string[], max: number, signal?: AbortSignal): Promise<Repo[]> {
  const lists = await Promise.all(
    slugs.map((ws) =>
      all<Repo>(
        a,
        `/repositories/${encodeURIComponent(ws)}?sort=-updated_on&pagelen=${Math.min(max, 100)}`,
        max,
        signal,
      )
        .catch((e) => {
          if (e instanceof AuthError) throw e;
          return [] as Repo[];
        })
    ),
  );
  return lists.flat();
}

/** The row shown instead of results until the credentials work. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Bitbucket: Atlassian API token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Bitbucket",
        "",
        "1. Open **Atlassian account → Security → API tokens** (Enter opens it).",
        "2. Choose **Create API token with scopes**, pick **Bitbucket**, and these scopes:",
        "   - `read:user:bitbucket`, `read:workspace:bitbucket`",
        "   - `read:repository:bitbucket`, `read:pullrequest:bitbucket`",
        "   - `read:issue:bitbucket` (for issues)",
        "3. In **Settings → Extensions → Bitbucket → Configure**, enter your **Atlassian account email** and paste the token.",
        "",
        "An older **app password** still works while Atlassian accepts it: enter your Bitbucket **username** instead of the email.",
      ].join("\n"),
    },
    actions: [
      open(TOKEN_URL, "Create API Token", { icon: Icons.key }),
      open(DOCS_URL, "About API Tokens", { icon: Icons.book }),
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
