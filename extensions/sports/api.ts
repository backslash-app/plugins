// football-data.org v4 (token), Jolpica's Ergast-compatible F1 API (no key), balldontlie (optional key),
// short caches in storage, and favourite teams.

import { Icons, type Item, open, storage } from "@backslash/api";
import {
  type ConstructorStanding,
  type DriverStanding,
  type Match,
  type MRData,
  type NbaGame,
  type Race,
  type Standings,
  type Team,
} from "./lib.ts";

export const HOSTS = ["api.football-data.org", "crests.football-data.org", "api.jolpi.ca", "api.balldontlie.io"];

const FOOTBALL = "https://api.football-data.org/v4";
const F1 = "https://api.jolpi.ca/ergast/f1";
const NBA = "https://api.balldontlie.io/v1";

export const FOOTBALL_TOKEN_URL = "https://www.football-data.org/client/register";
export const NBA_KEY_URL = "https://app.balldontlie.io";

export class SetupError extends Error {
  constructor(message: string, readonly service: "football" | "nba") {
    super(message);
  }
}

type Json = Parameters<typeof storage.set>[1];

/** Serves a copy younger than `maxAge`; on failure, an older one rather than an error. */
async function cached<T>(key: string, maxAge: number, load: () => Promise<T>, fresh = false): Promise<T> {
  const hit = await storage.get(key).catch(() => undefined) as { at: number; data: T } | undefined;
  if (hit && !fresh && Date.now() - hit.at < maxAge) return hit.data;
  try {
    const data = await load();
    await storage.set(key, { at: Date.now(), data } as unknown as Json).catch(() => {});
    return data;
  } catch (e) {
    if (hit && !(e instanceof SetupError) && !(e instanceof DOMException)) return hit.data;
    throw e;
  }
}

async function request(service: string, url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    if (e instanceof DOMException) throw e;
    throw new Error(`${service} can't be reached: check your connection`);
  }
}

// ---------------------------------------------------------------------------
// Football

export function footballToken(preferences: Record<string, unknown>): string {
  const t = String(preferences.footballToken ?? "").trim();
  if (!t) throw new SetupError("Add your football-data.org token in Settings", "football");
  return t;
}

async function football<T>(token: string, path: string, signal?: AbortSignal): Promise<T> {
  const res = await request("football-data.org", `${FOOTBALL}${path}`, { signal, headers: { "X-Auth-Token": token } });
  const body = await res.json().catch(() => undefined) as (T & { message?: string; errorCode?: number }) | undefined;
  if (res.status === 400 && /token/i.test(body?.message ?? "")) {
    throw new SetupError("football-data.org refused the token: check it in Settings", "football");
  }
  if (res.status === 403) {
    throw new Error(
      body?.message?.includes("restricted")
        ? "This competition isn't in your football-data.org plan: remove it from Competitions in Settings"
        : "football-data.org refused the token: check it in Settings",
    );
  }
  if (res.status === 429) throw new Error("football-data.org allows 10 requests a minute: try again shortly");
  if (!res.ok || !body) {
    throw new Error(`football-data.org answered ${res.status}${body?.message ? `: ${body.message}` : ""}`);
  }
  return body;
}

/** Matches from yesterday to a week ahead in the given competitions, cached a minute (live scores). */
export function matches(
  token: string,
  codes: string[],
  from: string,
  to: string,
  { signal, fresh }: { signal?: AbortSignal; fresh?: boolean } = {},
): Promise<Match[]> {
  const params = new URLSearchParams({ competitions: codes.join(","), dateFrom: from, dateTo: to });
  return cached(`matches:${params}`, 60_000, async () => {
    const body = await football<{ matches?: Match[] }>(token, `/matches?${params}`, signal);
    return body.matches ?? [];
  }, fresh);
}

export function standings(token: string, code: string, signal?: AbortSignal, fresh = false): Promise<Standings> {
  return cached(
    `standings:${code}`,
    15 * 60_000,
    () => football<Standings>(token, `/competitions/${code}/standings`, signal),
    fresh,
  );
}

/** A favourite team's next and live matches, cached 10 minutes. */
export function teamMatches(token: string, team: Team, signal?: AbortSignal, fresh = false): Promise<Match[]> {
  const params = new URLSearchParams({ status: "SCHEDULED,TIMED,IN_PLAY,PAUSED", limit: "3" });
  return cached(`team:${team.id}`, 10 * 60_000, async () => {
    const body = await football<{ matches?: Match[] }>(token, `/teams/${team.id}/matches?${params}`, signal);
    return body.matches ?? [];
  }, fresh);
}

/** The latest results of a team, cached an hour. */
export function teamResults(token: string, team: Team, signal?: AbortSignal): Promise<Match[]> {
  const params = new URLSearchParams({ status: "FINISHED", limit: "5" });
  return cached(`results:${team.id}`, 60 * 60_000, async () => {
    const body = await football<{ matches?: Match[] }>(token, `/teams/${team.id}/matches?${params}`, signal);
    return (body.matches ?? []).sort((a, b) => Date.parse(b.utcDate) - Date.parse(a.utcDate));
  });
}

export const favouriteTeams = async (): Promise<Team[]> => ((await storage.get("teams")) ?? []) as unknown as Team[];

export async function toggleFavourite(team: Team): Promise<boolean> {
  const all = await favouriteTeams();
  const has = all.some((t) => t.id === team.id);
  const slim = { id: team.id, name: team.name, shortName: team.shortName, tla: team.tla, crest: team.crest };
  await storage.set("teams", (has ? all.filter((t) => t.id !== team.id) : [...all, slim]) as unknown as Json);
  return !has;
}

// ---------------------------------------------------------------------------
// Formula 1

async function jolpica(path: string, signal?: AbortSignal): Promise<MRData["MRData"]> {
  const res = await request("Jolpica (F1 data)", `${F1}${path}`, { signal });
  if (res.status === 429) throw new Error("Jolpica limits requests: try again in a few seconds");
  if (!res.ok) throw new Error(`Jolpica (F1 data) answered ${res.status}`);
  return (await res.json() as MRData).MRData;
}

const races = (d: MRData["MRData"]) => d.RaceTable?.Races ?? [];

export const schedule = (signal?: AbortSignal) =>
  cached("f1:schedule", 6 * 3600_000, async () => races(await jolpica("/current.json?limit=40", signal)));

export const lastResults = (signal?: AbortSignal, fresh = false) =>
  cached(
    "f1:last",
    30 * 60_000,
    async () => races(await jolpica("/current/last/results.json", signal))[0] as Race | undefined,
    fresh,
  );

export const driverStandings = (signal?: AbortSignal, fresh = false) =>
  cached("f1:drivers", 30 * 60_000, async () => {
    const list = (await jolpica("/current/driverStandings.json", signal)).StandingsTable?.StandingsLists[0];
    return {
      round: list?.round ?? "",
      season: list?.season ?? "",
      rows: (list?.DriverStandings ?? []) as DriverStanding[],
    };
  }, fresh);

export const constructorStandings = (signal?: AbortSignal, fresh = false) =>
  cached("f1:constructors", 30 * 60_000, async () => {
    const list = (await jolpica("/current/constructorStandings.json", signal)).StandingsTable?.StandingsLists[0];
    return {
      round: list?.round ?? "",
      season: list?.season ?? "",
      rows: (list?.ConstructorStandings ?? []) as ConstructorStanding[],
    };
  }, fresh);

export const favouriteDrivers = async (): Promise<string[]> => ((await storage.get("drivers")) ?? []) as string[];

export async function toggleDriver(id: string): Promise<boolean> {
  const all = await favouriteDrivers();
  const has = all.includes(id);
  await storage.set("drivers", has ? all.filter((d) => d !== id) : [...all, id]);
  return !has;
}

// ---------------------------------------------------------------------------
// NBA

export function nbaKey(preferences: Record<string, unknown>): string {
  const k = String(preferences.nbaKey ?? "").trim();
  if (!k) throw new SetupError("Add a free balldontlie API key in Settings to see NBA scores", "nba");
  return k;
}

/** Games of the given (US) dates, cached a minute. */
export function nbaGames(key: string, dates: string[], signal?: AbortSignal, fresh = false): Promise<NbaGame[]> {
  const params = new URLSearchParams({ per_page: "100" });
  for (const d of dates) params.append("dates[]", d);
  return cached(`nba:${dates.join(",")}`, 60_000, async () => {
    const res = await request("balldontlie", `${NBA}/games?${params}`, { signal, headers: { Authorization: key } });
    if (res.status === 401) throw new SetupError("balldontlie refused the API key: check it in Settings", "nba");
    if (res.status === 429) throw new Error("balldontlie's free plan allows 5 requests a minute: try again shortly");
    if (!res.ok) throw new Error(`balldontlie answered ${res.status}`);
    return ((await res.json()) as { data?: NbaGame[] }).data ?? [];
  }, fresh);
}

// ---------------------------------------------------------------------------

export function setupItem(e: SetupError): Item {
  const football = e.service === "football";
  return {
    id: "setup",
    title: e.message,
    subtitle: football
      ? "Free plan: Ligue 1, Premier League, Champions League and 9 more"
      : "Free plan: games and scores",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: football
        ? [
          "## Connect football-data.org",
          "",
          "1. Register on **football-data.org** (Enter opens the page); the token arrives by email.",
          "2. Paste it in **Settings → Extensions → Sports Scores → Configure**.",
          "",
          "The free plan covers Ligue 1, Premier League, Champions League, LaLiga, Bundesliga, Serie A,",
          "Eredivisie, Primeira Liga, Championship, Brasileirão, the Euros and the World Cup,",
          "with 10 requests a minute. Formula 1 needs no key.",
        ].join("\n")
        : [
          "## Connect balldontlie",
          "",
          "NBA scores come from **balldontlie**, which now needs a free API key.",
          "Create an account (Enter opens the page), copy the key and paste it in",
          "**Settings → Extensions → Sports Scores → Configure**.",
        ].join("\n"),
    },
    actions: [
      open(football ? FOOTBALL_TOKEN_URL : NBA_KEY_URL, football ? "Get a Token" : "Get an API Key", {
        icon: Icons.key,
      }),
    ],
  };
}

export async function guarded(load: () => Promise<Item[]>): Promise<Item[]> {
  try {
    return await load();
  } catch (e) {
    if (e instanceof SetupError) return [setupItem(e)];
    throw e;
  }
}
