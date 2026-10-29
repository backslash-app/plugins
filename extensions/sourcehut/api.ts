// The GraphQL APIs of sr.ht (`https://<service>.sr.ht/query`) with a personal access token.

import { Icons, type Item, open } from "@backslash/api";
import { graphqlError, type Page, type Service, serviceUrl } from "./lib.ts";

export const TOKEN_URL = "https://meta.sr.ht/oauth2/personal-token";
export const DOCS_URL = "https://man.sr.ht/graphql.md";

export class AuthError extends Error {}

export function token(preferences: Record<string, unknown>): string {
  const t = String(preferences.token ?? "").trim();
  if (!t) throw new AuthError("Add a SourceHut personal access token");
  return t;
}

const NAMES: Record<Service, string> = {
  git: "git.sr.ht",
  builds: "builds.sr.ht",
  todo: "todo.sr.ht",
  lists: "lists.sr.ht",
};

export async function gql<T>(
  t: string,
  service: Service,
  query: string,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T> {
  const name = NAMES[service];
  const res = await fetch(`${serviceUrl(service)}/query`, {
    method: "POST",
    signal,
    headers: { Authorization: `Bearer ${t}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401) throw new AuthError(`${name} rejected the token (expired or revoked?)`);
  if (res.status === 429) throw new Error(`${name} is rate limiting: try again in a minute`);
  const body = await res.json().catch(() => undefined) as
    | { data?: T; errors?: { message: string }[] }
    | undefined;
  const why = graphqlError(body?.errors);
  if (why && /access|grant|scope|authoriz|token/i.test(why) && !body?.data) {
    throw new AuthError(`${name}: ${why}. Generate a token for all services`);
  }
  if (!res.ok) throw new Error(`${name} answered ${res.status}${why ? `: ${why}` : ""}`);
  if (!body?.data || (why && Object.values(body.data).every((v) => v === null))) {
    throw new Error(`${name}: ${why ?? "empty answer"}`);
  }
  return body.data;
}

/** Follows `cursor` for up to `pages` pages; `pick` finds the page in each answer. */
export async function paged<T, D>(
  t: string,
  service: Service,
  query: string,
  pick: (data: D) => Page<T> | undefined | null,
  pages: number,
  variables: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | null | undefined = null;
  for (let i = 0; i < pages; i++) {
    const data: D = await gql<D>(t, service, query, { ...variables, cursor }, signal);
    const page = pick(data);
    if (!page) break;
    out.push(...page.results);
    cursor = page.cursor;
    if (!cursor) break;
  }
  return out;
}

/** The row shown instead of results until a token works. */
export function setupItems(error: AuthError): Item[] {
  return [{
    id: "setup",
    title: error.message,
    subtitle: "SourceHut: personal access token",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect SourceHut",
        "",
        "1. Open **meta.sr.ht → OAuth 2.0 → Generate new token** (Enter opens it).",
        "2. Leave **all services** selected (or limit it to git, builds, todo and lists, read and write).",
        "3. Paste the token in **Settings → Extensions → SourceHut → Configure**.",
        "",
        "Tokens last a year: generate a new one when it expires.",
      ].join("\n"),
    },
    actions: [
      open(TOKEN_URL, "Generate Token", { icon: Icons.key }),
      open(DOCS_URL, "About the GraphQL API", { icon: Icons.book }),
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
