// The Gitea / Forgejo API (`/api/v1`) of the user's server, with a personal access token.

import { Icons, type Item, open } from "@backslash/api";

export const DOCS_URL = "https://docs.gitea.com/development/api-usage#generating-and-listing-api-tokens";

export class AuthError extends Error {
  constructor(message: string, readonly base?: string, readonly kind: "url" | "token" = "token") {
    super(message);
  }
}

/** `codeberg.org/`, `https://git.example.com/explore/repos` → `https://…` without path or slash. */
export function normalizeUrl(input: unknown): string {
  let url = String(input ?? "").trim();
  if (!url) return "";
  if (!/^https?:\/\//i.test(url)) {
    // Local servers rarely have a certificate.
    const local = /^(localhost|\d{1,3}(\.\d{1,3}){3}|[^/:]+\.(local|lan|home\.arpa))(:|\/|$)/i.test(url);
    url = `${local ? "http" : "https"}://${url}`;
  }
  url = url.replace(/\/+$/, "")
    .replace(/\/api(\/v1)?(\/.*)?$/, "")
    .replace(/\/(explore|user|issues|pulls|notifications|-)(\/.*)?$/, "");
  return url;
}

export interface Server {
  base: string;
  token: string;
  /** `git.example.com`, for titles. */
  host: string;
}

export function server(preferences: Record<string, unknown>): Server {
  const base = normalizeUrl(preferences.url);
  if (!base) throw new AuthError("Add the address of your Gitea or Forgejo server", undefined, "url");
  let host: string;
  try {
    host = new URL(base).host;
  } catch {
    throw new AuthError(`“${preferences.url}” is not an address`, undefined, "url");
  }
  const token = String(preferences.token ?? "").trim();
  if (!token) throw new AuthError(`Add an access token for ${host}`, base);
  return { base, token, host };
}

export async function api<T>(
  s: Server,
  path: string,
  options: { method?: string; signal?: AbortSignal } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${s.base}/api/v1${path}`, {
      method: options.method ?? "GET",
      signal: options.signal,
      headers: { Authorization: `token ${s.token}`, Accept: "application/json" },
    });
  } catch (e) {
    if (options.signal?.aborted) throw e;
    throw new AuthError(`Can't reach ${s.host}: check the address`, s.base, "url");
  }
  if (res.status === 401) throw new AuthError(`${s.host} rejected the access token`, s.base);
  if (res.status === 403) {
    const body = await res.json().catch(() => ({})) as { message?: string };
    throw new AuthError(
      /scope/i.test(body.message ?? "")
        ? `The token lacks a permission: ${body.message}`
        : `${s.host} refused the request${body.message ? `: ${body.message}` : ""}`,
      s.base,
    );
  }
  if (res.status === 429) throw new Error(`${s.host} is rate limiting: try again in a minute`);
  if (!res.ok) throw new Error(`${s.host} answered ${res.status}`);
  if (res.status === 204 || res.status === 205) return undefined as T;
  const text = await res.text();
  if (/^\s*</.test(text)) {
    throw new AuthError(`${s.host} doesn't look like Gitea or Forgejo: check the address`, s.base, "url");
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The row shown instead of results until the server and token work. */
export function setupItems(error: AuthError): Item[] {
  const tokens = error.base ? `${error.base}/user/settings/applications` : undefined;
  return [{
    id: "setup",
    title: error.message,
    subtitle: error.kind === "url" ? "Settings → Extensions → Gitea & Forgejo" : "Personal access token",
    icon: { source: error.kind === "url" ? Icons.globe : Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect your Gitea or Forgejo server",
        "",
        "In **Settings → Extensions → Gitea & Forgejo → Configure**:",
        "",
        "1. **Server address**: as you open it in the browser, e.g. `https://codeberg.org`, `https://gitea.com` or `https://git.example.com`.",
        "2. **Access token**: create one in **Settings → Applications → Generate new token**" +
        (tokens ? " (Enter opens the page)" : "") + ", with these permissions:",
        "   - **issue**: Read (pull requests and issues)",
        "   - **repository**: Read",
        "   - **user**: Read",
        "   - **notification**: Read and write (to mark notifications as read)",
      ].join("\n"),
    },
    actions: [
      ...(tokens ? [open(tokens, "Create Access Token", { icon: Icons.key })] : []),
      open(DOCS_URL, "How to Create a Token", { icon: Icons.book }),
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

/** The same, for lists that load in two steps. */
export async function* guardedSteps(load: () => AsyncGenerator<Item[]>): AsyncGenerator<Item[]> {
  try {
    yield* load();
  } catch (e) {
    if (e instanceof AuthError) yield setupItems(e);
    else throw e;
  }
}

export const countStatus = (items: Item[], one: string, host?: string, many = `${one}s`) =>
  items[0]?.id === "setup"
    ? "Not connected"
    : `${items.length} ${items.length === 1 ? one : many}${host ? ` · ${host}` : ""}`;
