// football-data.org v4, Jolpica (Ergast) F1 and balldontlie shapes, and how to show them.
// Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

// ---------------------------------------------------------------------------
// Dates

/** The local calendar date: `2026-10-28`. */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const shiftDay = (day: string, n: number) => {
  const [y, m, d] = day.split("-").map(Number);
  return localDay(new Date(y, m - 1, d + n));
};

/** "14:05" in the user's time zone. */
export const localTime = (iso: string) =>
  new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Sat 1 Nov". */
export const localDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }).replace(",", "");

/** "in 2 d 4 h", "in 45 min", "started". */
export function until(iso: string, now = Date.now()): string {
  const m = Math.round((Date.parse(iso) - now) / 60_000);
  if (m <= 0) return "started";
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h} h ${String(m % 60).padStart(2, "0")}`;
  return `in ${Math.floor(h / 24)} d ${h % 24} h`;
}

// ---------------------------------------------------------------------------
// Football (football-data.org v4)

export interface Team {
  id: number;
  name: string;
  shortName?: string | null;
  tla?: string | null;
  crest?: string | null;
}

export type MatchStatus =
  | "SCHEDULED"
  | "TIMED"
  | "IN_PLAY"
  | "PAUSED"
  | "EXTRA_TIME"
  | "PENALTY_SHOOTOUT"
  | "FINISHED"
  | "SUSPENDED"
  | "POSTPONED"
  | "CANCELLED"
  | "AWARDED"
  | "LIVE";

export interface Match {
  id: number;
  utcDate: string;
  status: MatchStatus;
  minute?: number | string | null;
  matchday?: number | null;
  stage?: string;
  group?: string | null;
  venue?: string | null;
  homeTeam: Team;
  awayTeam: Team;
  score: {
    winner?: "HOME_TEAM" | "AWAY_TEAM" | "DRAW" | null;
    duration?: string;
    fullTime: { home: number | null; away: number | null };
    halfTime?: { home: number | null; away: number | null };
    penalties?: { home: number | null; away: number | null };
  };
  competition: { id: number; name: string; code: string; emblem?: string | null };
  area?: { name: string; code: string; flag?: string | null };
  referees?: { name: string; nationality?: string | null }[];
}

export interface StandingRow {
  position: number;
  team: Team;
  playedGames: number;
  form?: string | null;
  won: number;
  draw: number;
  lost: number;
  points: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
}

export interface Standings {
  competition: { name: string; code: string; emblem?: string | null };
  season?: { currentMatchday?: number | null; startDate?: string; endDate?: string };
  standings: { stage: string; type: "TOTAL" | "HOME" | "AWAY"; group?: string | null; table: StandingRow[] }[];
}

export const isLive = (s: MatchStatus) =>
  s === "IN_PLAY" || s === "PAUSED" || s === "LIVE" || s === "EXTRA_TIME" || s === "PENALTY_SHOOTOUT";
export const isOver = (s: MatchStatus) => s === "FINISHED" || s === "AWARDED";

export const teamName = (t: Team) => t.shortName || t.name || t.tla || "?";

/** "2 – 1", "2 – 2 (4–3 pens)", or the kick-off time. */
export function scoreText(m: Match): string {
  const { home, away } = m.score.fullTime;
  if (home === null || away === null || (!isLive(m.status) && !isOver(m.status))) return localTime(m.utcDate);
  const pens = m.score.penalties;
  const shootout = pens && pens.home !== null && pens.away !== null ? ` (${pens.home}–${pens.away} pens)` : "";
  return `${home} – ${away}${shootout}`;
}

export function statusLook(m: Match): { text: string; color: Color } {
  switch (m.status) {
    case "IN_PLAY":
    case "LIVE":
      return { text: m.minute ? `${m.minute}'` : "Live", color: "red" };
    case "PAUSED":
      return { text: "Half-time", color: "orange" };
    case "EXTRA_TIME":
      return { text: "Extra time", color: "red" };
    case "PENALTY_SHOOTOUT":
      return { text: "Penalties", color: "red" };
    case "FINISHED":
    case "AWARDED":
      return {
        text: m.score.duration === "PENALTY_SHOOTOUT" ? "FT (pens)" : m.score.duration === "EXTRA_TIME" ? "AET" : "FT",
        color: "gray",
      };
    case "POSTPONED":
      return { text: "Postponed", color: "yellow" };
    case "SUSPENDED":
      return { text: "Suspended", color: "yellow" };
    case "CANCELLED":
      return { text: "Cancelled", color: "gray" };
    default:
      return { text: localTime(m.utcDate), color: "blue" };
  }
}

/** Live first, then by kick-off; favourites first within the same state. */
export function sortMatches(matches: Match[], favourites: Set<number> = new Set()): Match[] {
  const rank = (m: Match) => (isLive(m.status) ? 0 : isOver(m.status) ? 2 : 1);
  const fav = (m: Match) => (favourites.has(m.homeTeam.id) || favourites.has(m.awayTeam.id) ? 0 : 1);
  return [...matches].sort((a, b) =>
    rank(a) - rank(b) || fav(a) - fav(b) || Date.parse(a.utcDate) - Date.parse(b.utcDate) || a.id - b.id
  );
}

/** "Matchday 11", "Quarter-finals", "League phase · MD 4". */
export function roundName(m: Match): string {
  const stage = (m.stage ?? "").replace(/_/g, " ").toLowerCase();
  const nice = stage ? stage[0].toUpperCase() + stage.slice(1) : "";
  if (!stage || stage === "regular season") return m.matchday ? `Matchday ${m.matchday}` : "";
  return m.matchday ? `${nice} · MD ${m.matchday}` : nice;
}

/** The result for one team: W, D or L, from its point of view. */
export function resultFor(m: Match, teamId: number): "W" | "D" | "L" | undefined {
  if (!isOver(m.status) || !m.score.winner) return undefined;
  if (m.score.winner === "DRAW") return "D";
  const home = m.homeTeam.id === teamId;
  return (m.score.winner === "HOME_TEAM") === home ? "W" : "L";
}

/** `"W,D,L"` or `"WDL"` → `["W", "D", "L"]`. */
export const formOf = (form: string | null | undefined) =>
  (form ?? "").replace(/[^WDL]/g, "").split("").filter(Boolean);

const FORM_COLORS: Record<string, Color> = { W: "green", D: "gray", L: "red" };
export const formColor = (r: string): Color => FORM_COLORS[r] ?? "gray";

/** The main table: TOTAL, all groups of it for group stages. */
export function mainTables(s: Standings): Standings["standings"] {
  const total = s.standings.filter((t) => t.type === "TOTAL");
  return total.length ? total : s.standings.slice(0, 1);
}

/** Competition codes from the preference: "FL1, PL cl" → ["FL1", "PL", "CL"]. */
export function competitionCodes(input: unknown): string[] {
  const codes = String(input ?? "").toUpperCase().split(/[\s,;]+/).filter((c) => /^[A-Z0-9]{2,4}$/.test(c));
  return codes.length ? [...new Set(codes)] : ["FL1", "PL", "CL", "PD", "BL1", "SA"];
}

export const COMPETITIONS: Record<string, string> = {
  FL1: "Ligue 1",
  PL: "Premier League",
  CL: "Champions League",
  PD: "LaLiga",
  BL1: "Bundesliga",
  SA: "Serie A",
  DED: "Eredivisie",
  PPL: "Primeira Liga",
  ELC: "Championship",
  BSA: "Brasileirão",
  EC: "European Championship",
  WC: "World Cup",
};

// ---------------------------------------------------------------------------
// Formula 1 (Jolpica, Ergast-compatible)

export interface Session {
  date: string;
  time?: string;
}

export interface Race {
  season: string;
  round: string;
  url?: string;
  raceName: string;
  Circuit: {
    circuitId: string;
    circuitName: string;
    url?: string;
    Location: { lat: string; long: string; locality: string; country: string };
  };
  date: string;
  time?: string;
  FirstPractice?: Session;
  SecondPractice?: Session;
  ThirdPractice?: Session;
  Qualifying?: Session;
  Sprint?: Session;
  SprintQualifying?: Session;
  SprintShootout?: Session;
  Results?: Result[];
}

export interface Driver {
  driverId: string;
  permanentNumber?: string;
  code?: string;
  givenName: string;
  familyName: string;
  nationality?: string;
  url?: string;
}

export interface Constructor {
  constructorId: string;
  name: string;
  nationality?: string;
  url?: string;
}

export interface Result {
  number: string;
  position: string;
  positionText: string;
  points: string;
  Driver: Driver;
  Constructor: Constructor;
  grid: string;
  laps: string;
  status: string;
  Time?: { millis?: string; time: string };
  FastestLap?: { rank: string; lap: string; Time?: { time: string } };
}

export interface DriverStanding {
  position?: string;
  positionText: string;
  points: string;
  wins: string;
  Driver: Driver;
  Constructors: Constructor[];
}

export interface ConstructorStanding {
  position?: string;
  positionText: string;
  points: string;
  wins: string;
  Constructor: Constructor;
}

/** What every Jolpica answer is wrapped in. */
export interface MRData {
  MRData: {
    total?: string;
    RaceTable?: { season?: string; round?: string; Races: Race[] };
    StandingsTable?: {
      season?: string;
      round?: string;
      StandingsLists: {
        season: string;
        round: string;
        DriverStandings?: DriverStanding[];
        ConstructorStandings?: ConstructorStanding[];
      }[];
    };
  };
}

export interface SessionTime {
  name: string;
  /** ISO 8601 in UTC; date only (midnight UTC) when the time is not known yet. */
  start: string;
  timeKnown: boolean;
}

/** `{ date: "2026-11-01", time: "14:00:00Z" }` → ISO. */
export function sessionStart(s: Session): SessionTime["start"] {
  return s.time ? `${s.date}T${s.time.endsWith("Z") ? s.time : `${s.time}Z`}` : `${s.date}T00:00:00Z`;
}

/** A weekend's sessions in order: practice, sprint qualifying, sprint, qualifying, race. */
export function sessions(r: Race): SessionTime[] {
  const list: [string, Session | undefined][] = [
    ["Practice 1", r.FirstPractice],
    ["Practice 2", r.SecondPractice],
    ["Practice 3", r.ThirdPractice],
    ["Sprint Qualifying", r.SprintQualifying ?? r.SprintShootout],
    ["Sprint", r.Sprint],
    ["Qualifying", r.Qualifying],
    ["Race", { date: r.date, time: r.time }],
  ];
  return list
    .filter((e): e is [string, Session] => !!e[1]?.date)
    .map(([name, s]) => ({ name, start: sessionStart(s), timeKnown: !!s.time }))
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

export const driverName = (d: Driver) => `${d.givenName} ${d.familyName}`;

/** "+5.123s", "1:32:45.123", "+1 Lap", "DNF (Engine)". */
export function resultTime(r: Result): string {
  if (r.Time?.time) return r.Time.time;
  if (/^\+\d+ Laps?$/.test(r.status) || r.status === "Lapped") return r.status;
  if (r.status === "Finished") return "";
  return r.positionText === "R" || /^\d+$/.test(r.positionText) ? `DNF · ${r.status}` : r.status;
}

/** Places gained (positive) or lost from the grid; undefined from the pit lane or when unknown. */
export function placesGained(r: Result): number | undefined {
  const grid = Number(r.grid);
  const pos = Number(r.position);
  if (!grid || !pos || !/^\d+$/.test(r.positionText)) return undefined;
  return grid - pos;
}

const TEAM_COLORS: Record<string, string> = {
  red_bull: "#3671c6",
  ferrari: "#e8002d",
  mercedes: "#27f4d2",
  mclaren: "#ff8000",
  aston_martin: "#229971",
  alpine: "#ff87bc",
  williams: "#64c4ff",
  rb: "#6692ff",
  sauber: "#52e252",
  audi: "#bb0a30",
  haas: "#b6babd",
  cadillac: "#c0c0c0",
};

/** The team's livery color for an icon tint (the launcher takes `#rrggbb`). */
export const teamColor = (constructorId: string): Color => (TEAM_COLORS[constructorId] ?? "gray") as Color;

// ---------------------------------------------------------------------------
// NBA (balldontlie v1)

export interface NbaTeam {
  id: number;
  abbreviation: string;
  city: string;
  name: string;
  full_name: string;
  conference?: string;
  division?: string;
}

export interface NbaGame {
  id: number;
  date: string;
  datetime?: string | null;
  season: number;
  status: string;
  period: number;
  time?: string | null;
  postseason: boolean;
  home_team_score: number;
  visitor_team_score: number;
  home_team: NbaTeam;
  visitor_team: NbaTeam;
}

export type NbaState = "scheduled" | "live" | "final";

export function nbaState(g: NbaGame): NbaState {
  if (/^final/i.test(g.status)) return "final";
  if (g.period > 0 || /qtr|half|ot/i.test(g.status)) return "live";
  return "scheduled";
}

/** "Q3 5:12", "Halftime", "Final/OT", "01:30" (local tip-off). */
export function nbaStatus(g: NbaGame): string {
  const state = nbaState(g);
  if (state === "final") return g.status;
  if (state === "live") {
    if (/half/i.test(g.status)) return "Halftime";
    const q = g.period > 4 ? `OT${g.period - 4 > 1 ? g.period - 4 : ""}` : `Q${g.period}`;
    return g.time && g.time.trim() && !/final/i.test(g.time) ? `${q} ${g.time.trim()}` : q;
  }
  const iso = g.datetime ?? (/^\d{4}-\d{2}-\d{2}T/.test(g.status) ? g.status : undefined);
  return iso ? localTime(iso) : g.status;
}

export function sortNba(games: NbaGame[]): NbaGame[] {
  const rank = (g: NbaGame) => ({ live: 0, scheduled: 1, final: 2 })[nbaState(g)];
  const at = (g: NbaGame) => Date.parse(g.datetime ?? g.date);
  return [...games].sort((a, b) => rank(a) - rank(b) || at(a) - at(b));
}
