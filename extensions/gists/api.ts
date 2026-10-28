// GitHub REST helpers: the token (preferences, else `gh auth token`) and the setup row.
// Same sign-in as the GitHub and GitHub Actions extensions.

import { exec, Icons, type Item, open } from "@backslash/api";

export const API = "https://api.github.com";
export const TOKEN_URL = "https://github.com/settings/tokens/new?scopes=gist&description=Backslash%20Gists";

const HEADERS = { "User-Agent": "backslash-launcher", "X-GitHub-Api-Version": "2022-11-28" };

export class AuthError extends Error {}

/** The token from the preferences, else the GitHub CLI's (`gh auth token`), if any. */
export async function token(preferences: Record<string, unknown>): Promise<string> {
  const saved = String(preferences.token ?? "").trim();
  if (saved) return saved;
  try {
    const t = await exec("gh", ["auth", "token"]);
    if (t) return t;
  } catch { /* gh missing or signed out */ }
  throw new AuthError("Sign in to GitHub");
}

function check(res: Response) {
  if (res.status === 401) throw new AuthError("GitHub rejected the token");
  if (res.status === 403 || res.status === 429) {
    if (res.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit reached: try again in a few minutes");
    }
    throw new AuthError("The token can't manage gists: it needs the gist scope");
  }
  if (res.status === 404) throw new Error("Gist not found: it may have been deleted");
  if (res.status === 422) throw new Error("GitHub refused the gist: check the file name and content");
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
}

export async function github<T>(
  t: string,
  path: string,
  options: { method?: string; signal?: AbortSignal; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      ...HEADERS,
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${t}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  check(res);
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** The row shown instead of results until a token works. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "GitHub CLI or personal access token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect GitHub",
        "",
        "**With the GitHub CLI** (simplest): run `gh auth login` in a terminal. Its sign-in is used automatically.",
        "",
        "**Or with a token:**",
        "",
        "1. Create a classic token with the **gist** scope (Enter opens the page).",
        "2. Paste it in **Settings → Extensions → Gists → Configure**.",
        "",
        "A fine-grained token works too: give it the account permission **Gists: Read and write**.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Token", { icon: Icons.key })],
  }];
}
