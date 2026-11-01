// The Lichess API (lichess.org/api). Profiles and the daily puzzle need no
// token; exporting games and the games waiting for your move need a personal
// token. Profiles are cached for a few
// minutes, the daily puzzle until it changes.

import { storage } from "@backslash/api";
import {
  cleanUsername,
  type DailyPuzzle,
  type Game,
  loginRequired,
  parseNdjson,
  type Playing,
  type Suggestion,
  type User,
} from "./lib.ts";

const API = "https://lichess.org/api";
const PROFILE_TTL = 5 * 60_000;
const PUZZLE_TTL = 60 * 60_000;

export interface Prefs {
  username?: string;
  token?: string;
  count?: string | number;
}

type Json = Parameters<typeof storage.set>[1];

async function load<T>(key: string): Promise<T | undefined> {
  return await storage.get(key).catch(() => undefined) as T | undefined;
}

async function save(key: string, value: unknown): Promise<void> {
  await storage.set(key, value as Json).catch(() => {});
}

async function request(path: string, o: { signal?: AbortSignal; token?: string; accept?: string } = {}) {
  const headers: Record<string, string> = { Accept: o.accept ?? "application/json" };
  if (o.token) headers.Authorization = `Bearer ${o.token}`;
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { headers, signal: o.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new Error(`Lichess is unreachable: ${(e as Error).message}`);
  }
  if (res.ok) return res;
  const body = await res.text().catch(() => "");
  if (loginRequired(res.status, body, !!o.token)) throw new LoginRequired();
  if (res.status === 401) throw new Error("Lichess refused the API token: create a new one in Settings → Extensions");
  if (res.status === 429) throw new Error("Lichess asks to slow down: try again in a minute");
  if (res.status === 404) throw new NotFound();
  throw new Error(`Lichess answered ${res.status}`);
}

export class NotFound extends Error {
  constructor() {
    super("Not found on Lichess");
  }
}

/** Lichess wants a signed-in request (a personal API token). */
export class LoginRequired extends Error {
  constructor() {
    super("Lichess needs a personal API token for this");
  }
}

/** The username set in the preferences, or an error saying where to set it. */
export function myUsername(prefs: Prefs): string {
  const name = cleanUsername(String(prefs.username ?? ""));
  if (!name) throw new Error("Set your Lichess username in Settings → Extensions → Lichess");
  return name;
}

export function tokenOf(prefs: Prefs): string | undefined {
  return String(prefs.token ?? "").trim() || undefined;
}

export function gameCount(prefs: Prefs): number {
  const n = Number(prefs.count);
  return Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 100) : 20;
}

/** A player's profile, or undefined if there is no such account. */
export async function user(name: string, signal?: AbortSignal, fresh = false): Promise<User | undefined> {
  const key = `user:${name.toLowerCase()}`;
  const cached = fresh ? undefined : await load<{ at: number; data: User }>(key);
  if (cached && Date.now() - cached.at < PROFILE_TTL) return cached.data;
  try {
    const data = await (await request(`/user/${encodeURIComponent(name)}`, { signal })).json() as User;
    await save(key, { at: Date.now(), data });
    return data;
  } catch (e) {
    if (e instanceof NotFound) return undefined;
    throw e;
  }
}

/**
 * A player's last games, newest first, with openings, accuracy and PGN.
 * Lichess only exports games to signed-in requests: without a token it
 * answers 404 for everyone, which throws {@link LoginRequired}.
 */
export async function games(name: string, max: number, token?: string, signal?: AbortSignal): Promise<Game[]> {
  const params = new URLSearchParams({
    max: String(max),
    opening: "true",
    accuracy: "true",
    pgnInJson: "true",
    clocks: "false",
    evals: "false",
  });
  try {
    const res = await request(`/games/user/${encodeURIComponent(name)}?${params}`, {
      signal,
      token: token || undefined,
      accept: "application/x-ndjson",
    });
    return parseNdjson<Game>(await res.text());
  } catch (e) {
    if (e instanceof NotFound) {
      if (!token) throw new LoginRequired();
      return [];
    }
    throw e;
  }
}

/** The games in progress of the token's owner. */
export async function playing(token: string, signal?: AbortSignal): Promise<Playing[]> {
  const res = await request("/account/playing?nb=50", { signal, token });
  return ((await res.json()) as { nowPlaying?: Playing[] }).nowPlaying ?? [];
}

export async function dailyPuzzle(signal?: AbortSignal, fresh = false): Promise<DailyPuzzle> {
  const cached = fresh ? undefined : await load<{ at: number; data: DailyPuzzle }>("daily");
  if (cached && Date.now() - cached.at < PUZZLE_TTL) return cached.data;
  const data = await (await request("/puzzle/daily", { signal })).json() as DailyPuzzle;
  await save("daily", { at: Date.now(), data });
  return data;
}

/** Players whose name starts with `term`. */
export async function autocomplete(term: string, signal?: AbortSignal): Promise<Suggestion[]> {
  if (term.length < 3) return [];
  const params = new URLSearchParams({ term, object: "true", nb: "8" });
  const res = await request(`/player/autocomplete?${params}`, { signal });
  return ((await res.json()) as { result?: Suggestion[] }).result ?? [];
}
