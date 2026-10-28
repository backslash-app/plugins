// GitHub REST helpers: the token (preferences, else `gh auth token`) and the setup row.

import { exec, Icons, type Item, open } from "@backslash/api";

export const API = "https://api.github.com";
export const TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo,workflow&description=Backslash%20GitHub%20Actions";

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
    throw new Error(`GitHub refused the request (${res.status}): the token may lack the repo or workflow scope`);
  }
  if (res.status === 409) throw new Error("GitHub: the run is not in a state that allows this");
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
}

export async function github<T>(
  t: string,
  path: string,
  options: { method?: string; signal?: AbortSignal; accept?: string } = {},
): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: { ...HEADERS, Accept: options.accept ?? "application/vnd.github+json", Authorization: `Bearer ${t}` },
  });
  check(res);
  if (res.status === 202 || res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** A job's log as plain text (GitHub redirects to a signed storage URL). */
export async function jobLog(t: string, repo: string, jobId: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API}/repos/${repo}/actions/jobs/${jobId}/logs`, {
    signal,
    headers: { ...HEADERS, Authorization: `Bearer ${t}` },
  });
  if (res.status === 404 || res.status === 410) return "";
  check(res);
  return await res.text();
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
        "1. Create a classic token with the **repo** and **workflow** scopes (Enter opens the page).",
        "2. Paste it in **Settings → Extensions → GitHub Actions → Configure**.",
        "",
        "A fine-grained token works too: give it **Actions: Read and write** and **Contents: Read** on your repositories.",
      ].join("\n"),
    },
    actions: [open(TOKEN_URL, "Create Token", { icon: Icons.key })],
  }];
}
