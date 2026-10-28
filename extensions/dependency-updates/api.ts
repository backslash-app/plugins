// GitHub GraphQL search for the dependency pull requests, and the REST calls behind the actions.

import { exec } from "@backslash/api";
import { buildQueries, parseAuthors, parsePull, parseScope, type Pull } from "./lib.ts";

const HEADERS = { "User-Agent": "backslash-launcher", "X-GitHub-Api-Version": "2022-11-28" };

export interface Prefs {
  token?: string;
  scope?: string;
  authors?: string;
}

export class AuthError extends Error {}

/** The token of the preferences, else the GitHub CLI's (`gh auth token`). */
export async function token(p: Prefs): Promise<string> {
  const saved = String(p.token ?? "").trim();
  if (saved) return saved;
  try {
    const t = await exec("gh", ["auth", "token"]);
    if (t) return t;
  } catch {
    // gh missing or signed out.
  }
  throw new AuthError("Add a GitHub token in Settings, or sign in with gh auth login");
}

async function check(res: Response): Promise<void> {
  if (res.ok) return;
  let message = "";
  try {
    const body = await res.json();
    message = String(body.message ?? "");
    if (Array.isArray(body.errors) && body.errors[0]?.message) message += ` (${body.errors[0].message})`;
  } catch {
    // Not JSON.
  }
  if (res.status === 401) throw new AuthError("GitHub refused the token: check it in Settings");
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    throw new Error("GitHub rate limit reached: try again in a few minutes");
  }
  if (res.status === 403) {
    throw new Error(`GitHub refused it${message ? `: ${message}` : ""}. The token needs write access to pull requests`);
  }
  throw new Error(`GitHub answered ${res.status}${message ? `: ${message}` : ""}`);
}

export async function rest<T>(
  t: string,
  method: string,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    signal,
    headers: {
      ...HEADERS,
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${t}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  await check(res);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

async function graphql<T>(t: string, query: string, variables: Record<string, unknown>, signal?: AbortSignal) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    signal,
    headers: { ...HEADERS, "Content-Type": "application/json", Authorization: `Bearer ${t}` },
    body: JSON.stringify({ query, variables }),
  });
  await check(res);
  const body = await res.json() as { data?: T; errors?: { message: string; type?: string }[] };
  if (body.errors?.length && !body.data) throw new Error(`GitHub: ${body.errors[0].message}`);
  return body.data as T;
}

const SEARCH = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        id number title url body createdAt updatedAt isDraft mergeable reviewDecision headRefName baseRefName
        author { login }
        repository { nameWithOwner isArchived }
        labels(first: 10) { nodes { name } }
        autoMergeRequest { enabledAt }
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 40) {
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}`;

interface SearchPage {
  search: {
    issueCount: number;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: Record<string, unknown>[];
  };
}

/** Up to 200 results per query. */
const PAGES = 4;

let login: Promise<string> | undefined;

/** The scope qualifiers: the preference, else the signed-in user's own repositories. */
export async function scopeOf(t: string, p: Prefs, signal?: AbortSignal): Promise<string[]> {
  const scope = parseScope(p.scope);
  if (scope.length) return scope;
  const me = await (login ??= rest<{ login: string }>(t, "GET", "/user", undefined, signal).then((u) => u.login));
  return [`user:${me}`];
}

export async function searchPulls(
  t: string,
  p: Prefs,
  signal?: AbortSignal,
): Promise<{ pulls: Pull[]; total: number }> {
  const queries = buildQueries(parseAuthors(p.authors), await scopeOf(t, p, signal));
  const seen = new Map<string, Pull>();
  let total = 0;
  await Promise.all(queries.map(async (q) => {
    let after: string | null = null;
    for (let page = 0; page < PAGES; page++) {
      const data: SearchPage = await graphql<SearchPage>(t, SEARCH, { q, after }, signal);
      if (page === 0) total += data.search.issueCount;
      for (const node of data.search.nodes) {
        const pull = parsePull(node);
        if (pull) seen.set(pull.id, pull);
      }
      if (!data.search.pageInfo.hasNextPage) break;
      after = data.search.pageInfo.endCursor;
    }
  }));
  return { pulls: [...seen.values()], total };
}

const path = (pull: Pull) => `/repos/${pull.repo}`;

export const approve = (t: string, pull: Pull) =>
  rest(t, "POST", `${path(pull)}/pulls/${pull.number}/reviews`, { event: "APPROVE" });

export async function merge(t: string, pull: Pull): Promise<string> {
  try {
    const out = await rest<{ merged: boolean; message: string }>(
      t,
      "PUT",
      `${path(pull)}/pulls/${pull.number}/merge`,
      { merge_method: "squash" },
    );
    return out.message || "Merged";
  } catch (e) {
    const message = (e as Error).message;
    if (/answered 405/.test(message)) {
      throw new Error(`#${pull.number} can't be merged yet: ${message.replace(/^GitHub answered 405: /, "")}`);
    }
    if (/answered 409/.test(message)) throw new Error(`#${pull.number} changed meanwhile: refresh and try again`);
    throw e;
  }
}

/** Dependabot listens to comments; Renovate to the checkbox in its description. */
export async function rebase(t: string, pull: Pull, tickedBody?: string): Promise<void> {
  if (pull.bot === "renovate" && tickedBody) {
    await rest(t, "PATCH", `${path(pull)}/pulls/${pull.number}`, { body: tickedBody });
    return;
  }
  await rest(t, "POST", `${path(pull)}/issues/${pull.number}/comments`, { body: "@dependabot rebase" });
}
