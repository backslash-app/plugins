// The Forgejo API of codeberg.org (`/api/v1`) with a personal access token.

import { Icons, type Item, open } from "@backslash/api";

export const HOST = "https://codeberg.org";
export const TOKEN_URL = `${HOST}/user/settings/applications`;

export class AuthError extends Error {}

export function token(preferences: Record<string, unknown>): string {
  const t = String(preferences.token ?? "").trim();
  if (!t) throw new AuthError("Add a Codeberg access token");
  return t;
}

export async function forgejo<T>(
  t: string,
  path: string,
  options: { method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`${HOST}/api/v1${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: { Authorization: `token ${t}`, Accept: "application/json" },
  });
  if (res.status === 401) throw new AuthError("Codeberg rejected the access token");
  if (res.status === 403) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new AuthError(
      /scope/i.test(body.message ?? "")
        ? `The token lacks a permission: ${body.message}`
        : `Codeberg refused the request${body.message ? `: ${body.message}` : ""}`,
    );
  }
  if (res.status === 429) throw new Error("Codeberg is rate limiting: try again in a minute");
  if (!res.ok) throw new Error(`Codeberg answered ${res.status}`);
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The row shown instead of results until a token works. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "Codeberg: personal access token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Codeberg",
        "",
        "1. Open **Settings → Applications** on codeberg.org (Enter opens it).",
        "2. Under **Generate new token**, give it a name and these permissions:",
        "   - **issue**: Read (pull requests and issues)",
        "   - **repository**: Read",
        "   - **user**: Read",
        "   - **notification**: Read and write (to mark notifications as read)",
        "3. Paste the token in **Settings → Extensions → Codeberg → Configure**.",
        "",
        "Only codeberg.org is supported: a self-hosted Forgejo or Gitea would need its own host in the extension's network permission.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Access Token", { icon: Icons.key })],
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

/** The same, for lists that load in two steps. */
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
