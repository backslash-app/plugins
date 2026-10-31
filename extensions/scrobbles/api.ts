// Network and cache: recent tracks are always fetched, top charts kept for an hour.

import { storage } from "@backslash/api";
import {
  type Kind,
  lastfmError,
  lastfmUrl,
  lbListensUrl,
  lbPlayingNowUrl,
  lbStatsUrl,
  parseLastfmRecent,
  parseLastfmTop,
  parseLbListens,
  parseLbPlayingNow,
  parseLbStats,
  type Service,
  SERVICES,
  type Settings,
  type Top,
  type Track,
} from "./lib.ts";

type Json = Parameters<typeof storage.set>[1];
const HOUR = 3_600_000;
const HEADERS = { "User-Agent": "Backslash-Scrobbles/1.0 (+https://github.com/backslash-app/plugins)" };

async function getJson(url: string, service: Service, signal?: AbortSignal): Promise<unknown> {
  const name = SERVICES[service].title;
  const timeout = AbortSignal.timeout(15_000);
  let res: Response;
  try {
    res = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, headers: HEADERS });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new Error(`${name} is unreachable: ${(e as Error).message}`);
  }
  // ListenBrainz: statistics not computed yet.
  if (res.status === 204) return undefined;
  const body = await res.json().catch(() => undefined);
  const lastfm = service === "lastfm" ? lastfmError(body) : undefined;
  if (lastfm) throw new Error(lastfm);
  if (res.status === 404) throw new Error(`${name}: no such user, check the user name in Settings`);
  if (res.status === 429) throw new Error(`${name} asks to slow down: try again in a minute`);
  if (!res.ok) {
    const msg = (body as { error?: string })?.error;
    throw new Error(`${name} answered ${res.status}${msg ? `: ${msg}` : ""}`);
  }
  return body;
}

export async function recent(
  service: Service,
  s: Settings,
  signal?: AbortSignal,
): Promise<{ tracks: Track[]; total?: number }> {
  if (service === "lastfm") {
    return parseLastfmRecent(
      await getJson(lastfmUrl("user.getrecenttracks", s, { limit: 50, extended: 1 }), service, signal),
    );
  }
  const user = s.listenbrainzUser!;
  const [now, listens] = await Promise.all([
    getJson(lbPlayingNowUrl(user), service, signal).catch(() => undefined),
    getJson(lbListensUrl(user), service, signal),
  ]);
  const playing = parseLbPlayingNow(now);
  return { tracks: [...(playing ? [playing] : []), ...parseLbListens(listens)] };
}

export async function top(
  service: Service,
  kind: Kind,
  s: Settings,
  o: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<Top[] | undefined> {
  const user = service === "lastfm" ? s.lastfmUser : s.listenbrainzUser;
  const key = `top:${service}:${user}:${kind}:${s.period}`;
  const hit = o.fresh ? undefined : await storage.get(key).catch(() => undefined) as
    | { at: number; value: Top[] | null }
    | undefined;
  if (hit && Date.now() - hit.at < HOUR) return hit.value ?? undefined;
  let value: Top[] | undefined;
  if (service === "lastfm") {
    const method = { artists: "user.gettopartists", tracks: "user.gettoptracks", albums: "user.gettopalbums" }[kind];
    const period = { week: "7day", month: "1month", year: "12month", all: "overall" }[s.period];
    value = parseLastfmTop(await getJson(lastfmUrl(method, s, { period, limit: 50 }), service, o.signal), kind);
  } else {
    const body = await getJson(lbStatsUrl(user!, kind, s.period, 50), service, o.signal);
    value = body === undefined ? undefined : parseLbStats(body, kind);
  }
  await storage.set(key, { at: Date.now(), value: value ?? null } as unknown as Json).catch(() => {});
  return value;
}
