// Mastodon's REST API with an access token, and Bluesky's XRPC with an app
// password (a session made at each start, kept in memory only).

import { storage } from "@backslash/api";
import {
  apiError,
  type BskyFeedItem,
  type BskyNotification,
  type BskyPostView,
  type Facet,
  fromBluesky,
  fromBlueskyNotifications,
  fromMastodon,
  fromMastodonNotification,
  type MastodonAccount,
  type MastodonNotification,
  type MastodonStatus,
  type Network,
  normalizeHandle,
  normalizeInstance,
  normalizeService,
  type Notice,
  parseVisibility,
  pdsEndpoint,
  type Post,
  richText,
  rkey,
  type StrongRef,
  subjectUris,
  toFacets,
} from "./lib.ts";

export class SetupError extends Error {}

export interface Accounts {
  mastodon?: { base: string; token: string; visibility: string };
  bluesky?: { service: string; handle: string; password: string };
}

/** What the preferences connect; throws when nothing is set up. */
export function accounts(prefs: Record<string, unknown>): Accounts {
  const out: Accounts = {};
  const base = normalizeInstance(prefs.mastodonInstance);
  const token = String(prefs.mastodonToken ?? "").trim().replace(/^Bearer\s+/i, "");
  if (base && token) out.mastodon = { base, token, visibility: parseVisibility(prefs.mastodonVisibility) };
  const handle = normalizeHandle(prefs.blueskyHandle);
  const password = String(prefs.blueskyPassword ?? "").trim();
  if (handle && password) out.bluesky = { service: normalizeService(prefs.blueskyService), handle, password };
  if (!out.mastodon && !out.bluesky) {
    if (base && !token) throw new SetupError("Add your Mastodon access token");
    if (handle && !password) throw new SetupError("Add a Bluesky app password");
    throw new SetupError("Connect Mastodon or Bluesky");
  }
  return out;
}

export const networksOf = (a: Accounts): Network[] =>
  [a.mastodon ? "mastodon" as const : undefined, a.bluesky ? "bluesky" as const : undefined].filter((n) =>
    n !== undefined
  );

type Options = { method?: string; body?: unknown; signal?: AbortSignal; headers?: Record<string, string> };

async function call<T>(network: Network, url: string, o: Options & { auth?: string } = {}): Promise<T> {
  const timeout = AbortSignal.timeout(20_000);
  let res: Response;
  try {
    res = await fetch(url, {
      method: o.method ?? "GET",
      signal: o.signal ? AbortSignal.any([o.signal, timeout]) : timeout,
      headers: {
        Accept: "application/json",
        ...(o.auth ? { Authorization: `Bearer ${o.auth}` } : {}),
        ...(o.body === undefined ? {} : { "Content-Type": "application/json" }),
        ...o.headers,
      },
      body: o.body === undefined ? undefined : JSON.stringify(o.body),
    });
  } catch (e) {
    if (o.signal?.aborted) throw e;
    throw new Error(`${new URL(url).host} is unreachable: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  if (!res.ok) {
    const message = apiError(network, res.status, json);
    if (res.status === 401) throw new SetupError(message);
    const err = new Error(message) as Error & { code?: string };
    err.code = json?.error;
    throw err;
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// Mastodon

type Mastodon = NonNullable<Accounts["mastodon"]>;

const mastodon = <T>(m: Mastodon, path: string, o: Options = {}) =>
  call<T>("mastodon", `${m.base}/api${path}`, { ...o, auth: m.token });

/** Our account (cached per instance and token digest). */
export async function mastodonMe(m: Mastodon, signal?: AbortSignal): Promise<MastodonAccount> {
  const key = `me:${m.base}:${await digest(m.token)}`;
  const saved = await cached<MastodonAccount>(key);
  if (saved) return saved;
  const me = await mastodon<MastodonAccount>(m, "/v1/accounts/verify_credentials", { signal });
  const value = { id: me.id, acct: me.acct, display_name: me.display_name ?? "", avatar: me.avatar ?? "" };
  await keep(key, value);
  return value;
}

export async function mastodonTimeline(m: Mastodon, signal?: AbortSignal): Promise<Post[]> {
  const list = await mastodon<MastodonStatus[]>(m, "/v1/timelines/home?limit=40", { signal });
  return list.map((s) => fromMastodon(s, m.base));
}

export async function mastodonNotifications(m: Mastodon, signal?: AbortSignal): Promise<Notice[]> {
  const [list, markers] = await Promise.all([
    mastodon<MastodonNotification[]>(m, "/v1/notifications?limit=40", { signal }),
    mastodon<{ notifications?: { last_read_id?: string } }>(m, "/v1/markers?timeline[]=notifications", { signal })
      .catch(() => undefined),
  ]);
  const lastRead = markers?.notifications?.last_read_id;
  return list.map((n) => ({ ...fromMastodonNotification(n, m.base), unread: !!lastRead && newerId(n.id, lastRead) }));
}

/** Mastodon ids are numbers too large for floats: compare as digit strings. */
function newerId(a: string, b: string): boolean {
  return a.length !== b.length ? a.length > b.length : a > b;
}

export async function mastodonMarkRead(m: Mastodon, lastId: string): Promise<void> {
  await mastodon(m, "/v1/markers", { method: "POST", body: { notifications: { last_read_id: lastId } } });
}

export async function mastodonPost(
  m: Mastodon,
  text: string,
  o: { visibility?: string; spoiler?: string; replyTo?: string } = {},
): Promise<string> {
  const status = await mastodon<MastodonStatus>(m, "/v1/statuses", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID() },
    body: {
      status: text,
      visibility: o.visibility ?? m.visibility,
      ...(o.spoiler ? { spoiler_text: o.spoiler, sensitive: true } : {}),
      ...(o.replyTo ? { in_reply_to_id: o.replyTo } : {}),
    },
  });
  return status.url ?? `${m.base}/@${status.account.acct}/${status.id}`;
}

export async function mastodonToggle(m: Mastodon, id: string, what: "reblog" | "favourite", on: boolean) {
  const verb = on ? what : `un${what}`;
  await mastodon(m, `/v1/statuses/${encodeURIComponent(id)}/${verb}`, { method: "POST", body: {} });
}

// ---------------------------------------------------------------------------
// Bluesky

type Bluesky = NonNullable<Accounts["bluesky"]>;

interface BskySession {
  did: string;
  handle: string;
  accessJwt: string;
  pds: string;
}

let session: { key: string; value: BskySession } | undefined;

async function digest(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Signs in with the app password; the session lives as long as this command runs. */
export async function bskySession(b: Bluesky, signal?: AbortSignal, fresh = false): Promise<BskySession> {
  const key = `${b.service} ${b.handle} ${await digest(b.password)}`;
  if (!fresh && session?.key === key) return session.value;
  const r = await call<{ did: string; handle: string; accessJwt: string; didDoc?: unknown }>(
    "bluesky",
    `${b.service}/xrpc/com.atproto.server.createSession`,
    { method: "POST", body: { identifier: b.handle, password: b.password }, signal },
  );
  const value = { did: r.did, handle: r.handle, accessJwt: r.accessJwt, pds: pdsEndpoint(r.didDoc) ?? b.service };
  session = { key, value };
  return value;
}

async function xrpc<T>(b: Bluesky, method: string, o: Options & { query?: Record<string, string | string[]> } = {}) {
  const run = async (s: BskySession) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o.query ?? {})) for (const x of [v].flat()) p.append(k, x);
    const qs = p.size ? `?${p}` : "";
    return await call<T>("bluesky", `${s.pds}/xrpc/${method}${qs}`, { ...o, auth: s.accessJwt });
  };
  try {
    return await run(await bskySession(b, o.signal));
  } catch (e) {
    // Access tokens last a couple of hours: sign in again once.
    if ((e as { code?: string }).code === "ExpiredToken") return await run(await bskySession(b, o.signal, true));
    throw e;
  }
}

export async function bskyTimeline(b: Bluesky, signal?: AbortSignal): Promise<Post[]> {
  const r = await xrpc<{ feed: BskyFeedItem[] }>(b, "app.bsky.feed.getTimeline", { query: { limit: "50" }, signal });
  return r.feed.map(fromBluesky);
}

export async function bskyNotifications(b: Bluesky, signal?: AbortSignal): Promise<Notice[]> {
  const r = await xrpc<{ notifications: BskyNotification[] }>(b, "app.bsky.notification.listNotifications", {
    query: { limit: "50" },
    signal,
  });
  // The posts that were liked or reposted, 25 per request.
  const uris = subjectUris(r.notifications);
  const subjects = new Map<string, BskyPostView>();
  for (let i = 0; i < uris.length; i += 25) {
    const got = await xrpc<{ posts: BskyPostView[] }>(b, "app.bsky.feed.getPosts", {
      query: { uris: uris.slice(i, i + 25) },
      signal,
    }).catch(() => ({ posts: [] }));
    for (const p of got.posts) subjects.set(p.uri, p);
  }
  return fromBlueskyNotifications(r.notifications, subjects);
}

export async function bskyMarkRead(b: Bluesky): Promise<void> {
  await xrpc(b, "app.bsky.notification.updateSeen", { method: "POST", body: { seenAt: new Date().toISOString() } });
}

/** Mentions → DIDs; handles that don't resolve stay plain text. */
async function resolveHandles(b: Bluesky, handles: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all([...new Set(handles)].map(async (handle) => {
    const r = await xrpc<{ did: string }>(b, "com.atproto.identity.resolveHandle", { query: { handle } })
      .catch(() => undefined);
    if (r?.did) out.set(handle, r.did);
  }));
  return out;
}

export async function bskyPost(b: Bluesky, input: string, o: { reply?: { root: StrongRef; parent: StrongRef } } = {}) {
  const s = await bskySession(b);
  const { text, segments } = richText(input);
  const dids = await resolveHandles(b, segments.filter((x) => x.kind === "mention").map((x) => x.value));
  const facets: Facet[] = toFacets(segments, dids);
  const lang = (Intl.DateTimeFormat().resolvedOptions().locale || "en").split("-")[0];
  const r = await xrpc<{ uri: string }>(b, "com.atproto.repo.createRecord", {
    method: "POST",
    body: {
      repo: s.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        createdAt: new Date().toISOString(),
        langs: [lang],
        ...(facets.length ? { facets } : {}),
        ...(o.reply ? { reply: o.reply } : {}),
      },
    },
  });
  return `https://bsky.app/profile/${s.handle}/post/${rkey(r.uri)}`;
}

/** Like or repost (returns the new record's uri), or undo with the record uri. */
export async function bskyToggle(b: Bluesky, post: Post, what: "like" | "repost", on: boolean): Promise<void> {
  const s = await bskySession(b);
  const collection = `app.bsky.feed.${what}`;
  if (on) {
    await xrpc(b, "com.atproto.repo.createRecord", {
      method: "POST",
      body: {
        repo: s.did,
        collection,
        record: { $type: collection, subject: post.ref, createdAt: new Date().toISOString() },
      },
    });
    return;
  }
  const uri = what === "like" ? post.likeUri : post.repostUri;
  if (!uri) return;
  await xrpc(b, "com.atproto.repo.deleteRecord", {
    method: "POST",
    body: { repo: s.did, collection, rkey: rkey(uri) },
  });
}

// ---------------------------------------------------------------------------
// Both

/** Posts to every network asked; reports what worked and what didn't. */
export async function postEverywhere(
  a: Accounts,
  networks: Network[],
  text: string,
  o: { visibility?: string; spoiler?: string } = {},
): Promise<{ posted: { network: Network; url: string }[]; failed: { network: Network; error: string }[] }> {
  const results = await Promise.allSettled(networks.map(async (network) => {
    if (network === "mastodon") {
      if (!a.mastodon) throw new Error("Mastodon is not set up");
      return { network, url: await mastodonPost(a.mastodon, text, o) };
    }
    if (!a.bluesky) throw new Error("Bluesky is not set up");
    // Bluesky has no content warning field: the warning goes first.
    return { network, url: await bskyPost(a.bluesky, o.spoiler ? `CW: ${o.spoiler}\n\n${text}` : text) };
  }));
  const posted: { network: Network; url: string }[] = [];
  const failed: { network: Network; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") posted.push(r.value);
    else failed.push({ network: networks[i], error: (r.reason as Error).message });
  });
  return { posted, failed };
}

// Last results, shown at once next time.

type Json = Parameters<typeof storage.set>[1];

export async function cached<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

export async function keep(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}
