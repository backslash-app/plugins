// GitLab REST and GraphQL helpers, and what to show when the token is missing or rejected.

import { Icons, type Item, open } from "@backslash/api";

/**
 * gitlab.com only: `[permissions] net` is a static list of hosts, so a
 * self-hosted instance would need its own host in the manifest.
 */
export const HOST = "https://gitlab.com";

/** Prefilled "new token" page: name and the read-only API scope. */
export const TOKEN_URL = `${HOST}/-/user_settings/personal_access_tokens?name=Backslash&scopes=read_api`;

/** The token is missing or GitLab refused it: the list shows how to fix it instead of an error. */
export class AuthError extends Error {}

export function needToken(preferences: Record<string, unknown>): string {
  const token = String(preferences.token ?? "").trim();
  if (!token) throw new AuthError("Add a GitLab personal access token");
  return token;
}

async function check(res: Response): Promise<void> {
  if (res.status === 401) throw new AuthError("GitLab rejected the access token");
  if (res.ok) return;
  const body = await res.json().catch(() => ({})) as { message?: unknown; error?: string };
  const message = typeof body.message === "string" ? body.message : body.error ?? JSON.stringify(body.message ?? "");
  if (res.status === 403) {
    throw new Error(`GitLab refused it (403${message ? `: ${message}` : ""}). Actions need a token with the api scope`);
  }
  throw new Error(`GitLab answered ${res.status}${message ? `: ${message}` : ""}`);
}

export async function rest<T>(
  token: string,
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${HOST}/api/v4${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  await check(res);
  return res.status === 204 ? undefined as T : await res.json() as T;
}

export async function graphql<T>(
  token: string,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${HOST}/api/graphql`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  await check(res);
  const body = await res.json() as { data?: T; errors?: { message: string }[] };
  if (body.errors?.length) throw new Error(`GitLab: ${body.errors[0].message}`);
  if (!body.data) throw new Error("GitLab sent no data");
  return body.data;
}

/** A project path as REST wants it in URLs: `group%2Fproject`. */
export const projectRef = (fullPath: string | number) => encodeURIComponent(String(fullPath));

/** The one row shown instead of the list when signing in is needed. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Create a personal access token on gitlab.com",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect GitLab",
        "",
        "1. Open **GitLab → Preferences → Access tokens** (Enter opens it, prefilled).",
        "2. Keep the **read_api** scope; add **api** to approve merge requests and retry pipelines.",
        "3. Paste the token in **Settings → Extensions → GitLab → Configure**.",
        "",
        "Only **gitlab.com** is supported: extensions declare the hosts they reach, so a self-hosted instance cannot be added from the settings.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Access Token", { icon: Icons.key })],
  }];
}

/** Runs `load`; a token problem becomes the setup row. */
export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof AuthError) return setupItems(e);
    throw e;
  }
}

/** "3 merge requests", or the sign-in hint. */
export function countStatus(items: Item[], one: string, many = `${one}s`): string {
  if (items[0]?.id === "setup") return "Not connected";
  return `${items.length} ${items.length === 1 ? one : many}`;
}
