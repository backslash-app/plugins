// grep.app's JSON search API and Sourcegraph's streaming search API (no token needed for public code
// where sourcegraph.com allows it; an access token from the preferences otherwise).

import {
  GREP_APP,
  type GrepAppAnswer,
  grepAppParams,
  type Hit,
  parseGrepApp,
  parseSourcegraph,
  parseSse,
  type Query,
  type Results,
  sourcegraphStreamUrl,
} from "./lib.ts";

export class AuthError extends Error {}

const TIMEOUT = 20_000;

const withTimeout = (signal?: AbortSignal) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT)]) : AbortSignal.timeout(TIMEOUT);

async function get(url: string, init: RequestInit, signal: AbortSignal | undefined, engine: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: withTimeout(signal) });
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`${engine} didn't answer within ${TIMEOUT / 1000} s: try a more specific query`);
    }
    throw new Error(`Couldn't reach ${engine}: check your connection`);
  }
}

async function grepAppPage(q: Query, page: number, signal?: AbortSignal): Promise<Results> {
  const res = await get(
    `${GREP_APP}/api/search?${grepAppParams(q, page)}`,
    {
      headers: { Accept: "application/json" },
    },
    signal,
    "grep.app",
  );
  if (res.status === 429) throw new Error("grep.app is rate limiting searches: wait a minute and try again");
  const text = await res.text();
  let body: GrepAppAnswer;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`grep.app answered ${res.status} with something that isn't JSON`);
  }
  if (!res.ok) {
    const why = body.error ?? "";
    if (res.status === 400) throw new Error(`grep.app refused the query${why ? `: ${why}` : ""}`);
    throw new Error(`grep.app answered ${res.status}${why ? `: ${why}` : ""}`);
  }
  return parseGrepApp(body);
}

/** grep.app returns 10 files a page; two pages are fetched at once. */
export async function searchGrepApp(q: Query, signal?: AbortSignal, pages = 2): Promise<Results> {
  const first = await grepAppPage(q, 1, signal);
  if (pages < 2 || (first.total ?? 0) <= first.hits.length) return first;
  const more = await Promise.all(
    Array.from({ length: pages - 1 }, (_, i) => grepAppPage(q, i + 2, signal).catch(() => undefined)),
  );
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const h of [first, ...more].flatMap((r) => r?.hits ?? [])) {
    const key = `${h.repo}/${h.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    hits.push(h);
  }
  return { ...first, hits };
}

/** Sourcegraph's `/.api/search/stream`, read to the end. */
export async function searchSourcegraph(q: Query, token: string, signal?: AbortSignal): Promise<Results> {
  const headers: Record<string, string> = { Accept: "text/event-stream" };
  if (token) headers.Authorization = `token ${token}`;
  const res = await get(sourcegraphStreamUrl(q), { headers }, signal, "Sourcegraph");
  if (res.status === 401 || res.status === 403) {
    await res.body?.cancel();
    throw new AuthError(
      token
        ? "Sourcegraph refused the access token: check it in Settings"
        : "Sourcegraph wants an access token for API searches: add one in Settings",
    );
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).trim();
    throw new Error(`Sourcegraph answered ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`);
  }
  return parseSourcegraph(parseSse(await res.text()));
}
