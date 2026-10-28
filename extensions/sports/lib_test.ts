import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS } from "./api.ts";
import {
  competitionCodes,
  formOf,
  isLive,
  mainTables,
  type Match,
  type NbaGame,
  nbaState,
  nbaStatus,
  placesGained,
  type Race,
  type Result,
  resultFor,
  resultTime,
  roundName,
  scoreText,
  sessions,
  sessionStart,
  shiftDay,
  sortMatches,
  sortNba,
  type Standings,
  statusLook,
  teamColor,
  until,
} from "./lib.ts";

const team = (id: number, name: string, shortName: string, tla: string) => ({
  id,
  name,
  shortName,
  tla,
  crest: `https://crests.football-data.org/${id}.png`,
});
const PSG = team(524, "Paris Saint-Germain FC", "PSG", "PSG");
const OM = team(516, "Olympique de Marseille", "Marseille", "MAR");
const OL = team(523, "Olympique Lyonnais", "Lyon", "LYO");
const LOSC = team(521, "Lille OSC", "Lille", "LIL");

// Shaped like `matches[]` of `GET https://api.football-data.org/v4/matches`.
const match = (
  id: number,
  status: Match["status"],
  utcDate: string,
  home = PSG,
  away = OM,
  score: (number | null)[] = [null, null],
): Match => ({
  id,
  utcDate,
  status,
  matchday: 10,
  stage: "REGULAR_SEASON",
  group: null,
  homeTeam: home,
  awayTeam: away,
  score: {
    winner: status === "FINISHED"
      ? (score[0]! > score[1]! ? "HOME_TEAM" : score[0] === score[1] ? "DRAW" : "AWAY_TEAM")
      : null,
    duration: "REGULAR",
    fullTime: { home: score[0], away: score[1] },
    halfTime: { home: null, away: null },
  },
  competition: { id: 2015, name: "Ligue 1", code: "FL1", emblem: "https://crests.football-data.org/FL1.png" },
});

Deno.test("football matches", () => {
  const live = match(1, "IN_PLAY", "2026-10-28T19:00:00Z", OL, LOSC, [1, 0]);
  const later = match(2, "TIMED", "2026-10-28T20:45:00Z");
  const done = match(3, "FINISHED", "2026-10-28T17:00:00Z", OM, OL, [2, 2]);
  const fav = match(4, "TIMED", "2026-10-28T21:00:00Z", LOSC, OM);
  assert(isLive(live.status));
  assertEquals(scoreText(live), "1 – 0");
  assertEquals(scoreText(done), "2 – 2");
  assertEquals(statusLook(live), { text: "Live", color: "red" });
  assertEquals(statusLook({ ...live, status: "PAUSED" }).text, "Half-time");
  assertEquals(statusLook(done).text, "FT");
  assertEquals(statusLook({ ...done, score: { ...done.score, duration: "PENALTY_SHOOTOUT" } }).text, "FT (pens)");
  assertEquals(
    scoreText({ ...done, score: { ...done.score, penalties: { home: 4, away: 3 } } }),
    "2 – 2 (4–3 pens)",
  );
  assertEquals(sortMatches([done, fav, later, live], new Set([LOSC.id])).map((m) => m.id), [1, 4, 2, 3]);
  assertEquals(roundName(live), "Matchday 10");
  assertEquals(roundName({ ...live, stage: "LEAGUE_STAGE", matchday: 4 }), "League stage · MD 4");
  assertEquals(roundName({ ...live, stage: "QUARTER_FINALS", matchday: null }), "Quarter finals");
  assertEquals(resultFor(done, OM.id), "D");
  const win = match(5, "FINISHED", "2026-10-20T19:00:00Z", PSG, OM, [3, 1]);
  assertEquals(resultFor(win, PSG.id), "W");
  assertEquals(resultFor(win, OM.id), "L");
  assertEquals(resultFor(later, PSG.id), undefined);
});

Deno.test("standings and preferences", () => {
  // Shaped like `GET /v4/competitions/CL/standings` in the league phase.
  const table: Standings = {
    competition: { name: "UEFA Champions League", code: "CL" },
    standings: [
      { stage: "LEAGUE_STAGE", type: "TOTAL", group: null, table: [] },
      { stage: "LEAGUE_STAGE", type: "HOME", group: null, table: [] },
      { stage: "LEAGUE_STAGE", type: "AWAY", group: null, table: [] },
    ],
  };
  assertEquals(mainTables(table).length, 1);
  assertEquals(formOf("W,D,L,W,W"), ["W", "D", "L", "W", "W"]);
  assertEquals(formOf(null), []);
  assertEquals(competitionCodes("fl1, PL;cl  pl"), ["FL1", "PL", "CL"]);
  assertEquals(competitionCodes(""), ["FL1", "PL", "CL", "PD", "BL1", "SA"]);
  assertEquals(shiftDay("2026-10-31", 1), "2026-11-01");
  assertEquals(shiftDay("2026-01-01", -1), "2025-12-31");
});

// Shaped like `MRData.RaceTable.Races[0]` of `GET https://api.jolpi.ca/ergast/f1/current/next.json`.
const SPRINT_WEEKEND: Race = {
  season: "2026",
  round: "21",
  url: "https://en.wikipedia.org/wiki/2026_S%C3%A3o_Paulo_Grand_Prix",
  raceName: "São Paulo Grand Prix",
  Circuit: {
    circuitId: "interlagos",
    circuitName: "Autódromo José Carlos Pace",
    Location: { lat: "-23.7036", long: "-46.6997", locality: "São Paulo", country: "Brazil" },
  },
  date: "2026-11-08",
  time: "17:00:00Z",
  FirstPractice: { date: "2026-11-06", time: "14:30:00Z" },
  SprintQualifying: { date: "2026-11-06", time: "18:30:00Z" },
  Sprint: { date: "2026-11-07", time: "14:00:00Z" },
  Qualifying: { date: "2026-11-07", time: "18:00:00Z" },
};

Deno.test("F1 weekend sessions", () => {
  assertEquals(sessions(SPRINT_WEEKEND).map((s) => s.name), [
    "Practice 1",
    "Sprint Qualifying",
    "Sprint",
    "Qualifying",
    "Race",
  ]);
  assertEquals(sessions(SPRINT_WEEKEND).at(-1)!.start, "2026-11-08T17:00:00Z");
  assertEquals(sessionStart({ date: "2026-11-08" }), "2026-11-08T00:00:00Z");
  assertEquals(sessionStart({ date: "2026-11-08", time: "17:00:00" }), "2026-11-08T17:00:00Z");
  const classic: Race = {
    ...SPRINT_WEEKEND,
    SprintQualifying: undefined,
    Sprint: undefined,
    SecondPractice: { date: "2026-11-06", time: "18:00:00Z" },
    ThirdPractice: { date: "2026-11-07", time: "14:30:00Z" },
  };
  assertEquals(sessions(classic).map((s) => s.name), ["Practice 1", "Practice 2", "Practice 3", "Qualifying", "Race"]);
  const now = Date.parse("2026-11-06T12:00:00Z");
  assertEquals(until("2026-11-06T14:30:00Z", now), "in 2 h 30");
  assertEquals(until("2026-11-06T12:40:00Z", now), "in 40 min");
  assertEquals(until("2026-11-08T17:00:00Z", now), "in 2 d 5 h");
  assertEquals(until("2026-11-06T11:00:00Z", now), "started");
});

const result = (over: Partial<Result>): Result => ({
  number: "1",
  position: "1",
  positionText: "1",
  points: "25",
  Driver: { driverId: "max_verstappen", code: "VER", givenName: "Max", familyName: "Verstappen" },
  Constructor: { constructorId: "red_bull", name: "Red Bull" },
  grid: "3",
  laps: "71",
  status: "Finished",
  Time: { millis: "5523123", time: "1:32:03.123" },
  ...over,
});

Deno.test("F1 results", () => {
  assertEquals(resultTime(result({})), "1:32:03.123");
  assertEquals(resultTime(result({ position: "12", positionText: "12", status: "+1 Lap", Time: undefined })), "+1 Lap");
  assertEquals(
    resultTime(result({ position: "18", positionText: "R", status: "Engine", Time: undefined })),
    "DNF · Engine",
  );
  assertEquals(
    resultTime(result({ position: "20", positionText: "D", status: "Disqualified", Time: undefined })),
    "Disqualified",
  );
  assertEquals(placesGained(result({})), 2);
  assertEquals(placesGained(result({ grid: "0" })), undefined);
  assertEquals(placesGained(result({ positionText: "R", position: "18" })), undefined);
  assertEquals(teamColor("ferrari"), "#e8002d");
  assertEquals(teamColor("unknown"), "gray");
});

// Shaped like `data[]` of `GET https://api.balldontlie.io/v1/games?dates[]=…`.
const nbaTeam = (id: number, abbreviation: string, city: string, name: string) => ({
  id,
  abbreviation,
  city,
  name,
  full_name: `${city} ${name}`,
});
const game = (id: number, status: string, period: number, time: string | null, scores = [0, 0]): NbaGame => ({
  id,
  date: "2026-10-28",
  datetime: "2026-10-28T23:30:00Z",
  season: 2026,
  status,
  period,
  time,
  postseason: false,
  home_team_score: scores[0],
  visitor_team_score: scores[1],
  home_team: nbaTeam(14, "LAL", "Los Angeles", "Lakers"),
  visitor_team: nbaTeam(2, "BOS", "Boston", "Celtics"),
});

Deno.test("NBA games", () => {
  const scheduled = game(1, "2026-10-28T23:30:00Z", 0, null);
  const live = game(2, "3rd Qtr", 3, "5:12", [78, 81]);
  const half = game(3, "Halftime", 2, "", [55, 50]);
  const final = game(4, "Final", 4, "Final", [102, 99]);
  const ot = game(5, "2nd OT", 6, "1:02", [120, 120]);
  assertEquals(nbaState(scheduled), "scheduled");
  assertEquals(nbaState(live), "live");
  assertEquals(nbaState(final), "final");
  assertEquals(nbaStatus(live), "Q3 5:12");
  assertEquals(nbaStatus(half), "Halftime");
  assertEquals(nbaStatus(final), "Final");
  assertEquals(nbaStatus(ot), "OT2 1:02");
  assertEquals(sortNba([final, scheduled, live]).map((g) => g.id), [2, 1, 4]);
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
