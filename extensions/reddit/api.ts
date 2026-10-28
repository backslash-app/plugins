// Reddit's public JSON endpoints (no account). Reddit refuses unauthenticated
// requests from some networks (403) and rate limits them (429): the last
// listing is kept to be shown when that happens.

import { storage } from "@backslash/api";
import {
  type Comment,
  commentsOf,
  type Listing,
  listingPath,
  parseSubreddits,
  type Post,
  postsOf,
  type RedditComment,
  type RedditPost,
  refusal,
  type Sort,
} from "./lib.ts";

const BASE = "https://www.reddit.com";
// Reddit asks for a descriptive User-Agent: <platform>:<app id>:<version> (by /u/<user>).
const HEADERS = { "User-Agent": "linux:app.backslash.reddit:1.0.0 (by /u/backslash-app)", Accept: "application/json" };

type Json = Parameters<typeof storage.set>[1];

/** Reddit refused: `blocked` when it's about this network or the rate, not the subreddit. */
export class Refused extends Error {
  constructor(message: string, readonly blocked: boolean) {
    super(message);
  }
}

export async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function get<T>(path: string, signal?: AbortSignal): Promise<T> {
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      headers: HEADERS,
      redirect: "manual",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Refused(
      timeout.aborted ? "Reddit is taking too long to answer" : `Reddit is unreachable: ${(e as Error).message}`,
      true,
    );
  }
  // A subreddit that doesn't exist redirects to the search page.
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new Refused("This subreddit doesn't exist", false);
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const r = refusal(res.status, body, res.headers.get("retry-after"));
    throw new Refused(r.message, r.blocked);
  }
  if (body === undefined) throw new Refused("Reddit answered with a web page instead of data (blocked?)", true);
  return body as T;
}

export interface Loaded {
  posts: Post[];
  /** When the posts are a saved copy because Reddit refused. */
  savedAt?: number;
  refused?: Refused;
}

/** A listing; when Reddit blocks or rate limits, the last copy if there is one. */
export async function listing(subs: string[], sort: Sort, nsfw: boolean, signal?: AbortSignal): Promise<Loaded> {
  const path = listingPath(subs, sort);
  const key = `listing:${path}`;
  try {
    const l = await get<Listing<RedditPost>>(path, signal);
    const posts = postsOf(l, nsfw);
    await save(key, { at: Date.now(), posts });
    return { posts };
  } catch (e) {
    if (!(e instanceof Refused) || !e.blocked) throw e;
    const saved = await load<{ at: number; posts: Post[] }>(key);
    if (!saved) throw e;
    return { posts: saved.posts.filter((p) => nsfw || !p.nsfw), savedAt: saved.at, refused: e };
  }
}

export async function comments(id: string, signal?: AbortSignal): Promise<Comment[]> {
  const answer = await get<[unknown, Listing<RedditComment>]>(
    `/comments/${encodeURIComponent(id)}.json?limit=12&depth=1&sort=top&raw_json=1`,
    signal,
  );
  return commentsOf(answer);
}

// ---------------------------------------------------------------------------
// Subreddits: the preference's, then those added from the launcher.

export async function added(): Promise<string[]> {
  return await load<string[]>("subreddits") ?? [];
}

export async function subreddits(
  preferences: Record<string, unknown>,
): Promise<{ name: string; fromPrefs: boolean }[]> {
  const prefs = parseSubreddits(preferences.subreddits);
  const mine = parseSubreddits((await added()).join(" "));
  const seen = new Set(prefs.map((s) => s.toLowerCase()));
  return [
    ...prefs.map((name) => ({ name, fromPrefs: true })),
    ...mine.filter((s) => !seen.has(s.toLowerCase())).map((name) => ({ name, fromPrefs: false })),
  ];
}

export async function addSubreddit(name: string): Promise<void> {
  const list = await added();
  if (!list.some((s) => s.toLowerCase() === name.toLowerCase())) await save("subreddits", [...list, name]);
}

export async function removeSubreddit(name: string): Promise<void> {
  await save("subreddits", (await added()).filter((s) => s.toLowerCase() !== name.toLowerCase()));
}
