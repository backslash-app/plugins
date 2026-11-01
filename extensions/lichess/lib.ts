// Lichess data turned into what the commands show. No network here.

import { boardText, numbered, parseFen, play, type Position, sanTokens, toFen, uciToSan } from "./chess.ts";

export const SITE = "https://lichess.org";

// ---------------------------------------------------------------------------
// API shapes (only the fields used)

export interface Perf {
  games: number;
  rating: number;
  rd?: number;
  /** Rating change over the last 12 games. */
  prog?: number;
  /** Provisional: too few games for a stable rating. */
  prov?: boolean;
}

export interface User {
  id: string;
  username: string;
  title?: string;
  patron?: boolean;
  disabled?: boolean;
  tosViolation?: boolean;
  createdAt?: number;
  seenAt?: number;
  url?: string;
  playing?: string;
  perfs?: Record<string, Perf & { runs?: number; score?: number }>;
  profile?: {
    flag?: string;
    country?: string;
    location?: string;
    bio?: string;
    realName?: string;
    fideRating?: number;
    firstName?: string;
    lastName?: string;
  };
  count?: { all: number; rated: number; win: number; loss: number; draw: number; playing?: number };
  playTime?: { total: number; tv?: number };
}

export interface GamePlayer {
  user?: { name: string; id: string; title?: string };
  rating?: number;
  ratingDiff?: number;
  provisional?: boolean;
  aiLevel?: number;
  analysis?: { inaccuracy: number; mistake: number; blunder: number; acpl: number; accuracy?: number };
}

export interface Game {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  perf: string;
  createdAt: number;
  lastMoveAt: number;
  status: string;
  source?: string;
  players: { white: GamePlayer; black: GamePlayer };
  winner?: "white" | "black";
  opening?: { eco: string; name: string; ply: number };
  moves?: string;
  pgn?: string;
  clock?: { initial: number; increment: number; totalTime?: number };
  daysPerTurn?: number;
  tournament?: string;
  swiss?: string;
}

export interface Playing {
  gameId: string;
  fullId: string;
  color: "white" | "black";
  fen: string;
  hasMoved: boolean;
  isMyTurn: boolean;
  lastMove?: string;
  opponent: { id?: string; username: string; rating?: number; ai?: number };
  perf: string;
  rated: boolean;
  secondsLeft?: number;
  speed: string;
  variant: { key: string; name: string };
}

export interface DailyPuzzle {
  game: {
    id: string;
    perf: { key: string; name: string };
    rated: boolean;
    players: { name: string; id?: string; color: "white" | "black"; rating?: number; title?: string }[];
    pgn: string;
    clock?: string;
  };
  puzzle: {
    id: string;
    rating: number;
    plays: number;
    solution: string[];
    themes: string[];
    initialPly: number;
  };
}

export interface Suggestion {
  id: string;
  name: string;
  title?: string;
  patron?: boolean;
  online?: boolean;
}

// ---------------------------------------------------------------------------
// Usernames

/** A Lichess username from what the user typed: a name, "@name" or a profile URL. */
export function cleanUsername(text: string): string {
  const t = text.trim();
  const fromUrl = /lichess\.org\/@\/([A-Za-z0-9_-]+)/.exec(t);
  const name = (fromUrl ? fromUrl[1] : t.replace(/^@/, "")).trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,29}$/.test(name) ? name : "";
}

/** Where to create a personal API token; no scope is needed to export games. */
export const TOKEN_URL = `${SITE}/account/oauth/token/create?description=Backslash`;

/**
 * Whether a failed request means "sign in first": an explicit "Login
 * required", or a 401 sent without a token.
 */
export function loginRequired(status: number, body: string, withToken: boolean): boolean {
  if (/login required/i.test(body)) return true;
  return status === 401 && !withToken;
}

export const profileUrl = (name: string) => `${SITE}/@/${encodeURIComponent(name)}`;
export const gameUrl = (id: string, color?: "white" | "black") => `${SITE}/${id}${color ? `/${color}` : ""}`;
export const puzzleUrl = (id: string) => `${SITE}/training/${id}`;
export const analysisUrl = (fen: string) => `${SITE}/analysis/standard/${fen.replace(/ /g, "_")}`;

// ---------------------------------------------------------------------------
// Ratings

/** The rated time controls and variants, in Lichess's order, with their names. */
export const PERFS: { key: string; title: string; icon: string }[] = [
  { key: "ultraBullet", title: "UltraBullet", icon: "bs-bolt" },
  { key: "bullet", title: "Bullet", icon: "bs-bolt" },
  { key: "blitz", title: "Blitz", icon: "bs-timer" },
  { key: "rapid", title: "Rapid", icon: "bs-clock" },
  { key: "classical", title: "Classical", icon: "bs-hourglass" },
  { key: "correspondence", title: "Correspondence", icon: "bs-mail" },
  { key: "chess960", title: "Chess960", icon: "bs-shuffle" },
  { key: "kingOfTheHill", title: "King of the Hill", icon: "bs-flag" },
  { key: "threeCheck", title: "Three-check", icon: "bs-check" },
  { key: "antichess", title: "Antichess", icon: "bs-repeat" },
  { key: "atomic", title: "Atomic", icon: "bs-sparkle" },
  { key: "horde", title: "Horde", icon: "bs-layers" },
  { key: "racingKings", title: "Racing Kings", icon: "bs-rocket" },
  { key: "crazyhouse", title: "Crazyhouse", icon: "bs-dice" },
  { key: "puzzle", title: "Puzzles", icon: "bs-lightbulb" },
];

export interface Rating {
  key: string;
  title: string;
  icon: string;
  rating: number;
  games: number;
  progress: number;
  provisional: boolean;
  deviation?: number;
}

/** The ratings the player has games in, the most played first; Storm and Racer scores aside. */
export function ratings(user: User): Rating[] {
  const perfs = user.perfs ?? {};
  return PERFS.flatMap((p, order) => {
    const perf = perfs[p.key];
    if (!perf || !perf.games || typeof perf.rating !== "number") return [];
    return [{
      key: p.key,
      title: p.title,
      icon: p.icon,
      rating: perf.rating,
      games: perf.games,
      progress: perf.prog ?? 0,
      provisional: !!perf.prov,
      deviation: perf.rd,
      order,
    }];
  }).sort((a, b) => b.games - a.games || a.order - b.order).map(({ order: _, ...r }) => r);
}

/** Puzzle Storm, Racer and Streak best scores. */
export function scores(user: User): { title: string; score: number; runs?: number }[] {
  const perfs = user.perfs ?? {};
  return [["storm", "Puzzle Storm"], ["racer", "Puzzle Racer"], ["streak", "Puzzle Streak"]].flatMap(([key, title]) => {
    const p = perfs[key];
    return p && p.score ? [{ title, score: p.score, runs: p.runs }] : [];
  });
}

/** "+23", "−8", "±0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "±0";
}

export function ratingText(r: { rating: number; provisional?: boolean }): string {
  return `${r.rating}${r.provisional ? "?" : ""}`;
}

/** "GM DrNykterstein". */
export function displayName(name: string, title?: string): string {
  return title ? `${title} ${name}` : name;
}

/** "1d 4h", "35h 12m" style play time. */
export function duration(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor(seconds % 86400 / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

/** "3 minutes ago", "yesterday", "5 days ago", from a timestamp in milliseconds. */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [86400, "day"], [3600, "hour"], [
    60,
    "minute",
  ]];
  for (const [size, unit] of units) {
    const n = Math.floor(s / size);
    if (n >= 1) {
      if (unit === "day" && n === 1) return "yesterday";
      return `${n} ${unit}${n === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

/** A flag emoji from a country code ("FR" → 🇫🇷); "" for Lichess's special flags. */
export function flag(code?: string): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "";
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

// ---------------------------------------------------------------------------
// Games

/** "3+2", "15+10", "1 day", "∞". */
export function timeControl(game: Pick<Game, "clock" | "daysPerTurn">): string {
  if (game.clock) {
    const base = game.clock.initial / 60;
    const minutes = base === 0.25 ? "¼" : base === 0.5 ? "½" : base === 0.75 ? "¾" : String(base);
    return `${minutes}+${game.clock.increment}`;
  }
  if (game.daysPerTurn) return `${game.daysPerTurn} day${game.daysPerTurn === 1 ? "" : "s"}`;
  return "∞";
}

export type Result = "win" | "loss" | "draw" | "ongoing";

/** What the game's `status` means, in words. */
export const STATUS: Record<string, string> = {
  created: "Not started",
  started: "Playing",
  aborted: "Aborted",
  mate: "Checkmate",
  resign: "Resignation",
  stalemate: "Stalemate",
  timeout: "Left the game",
  draw: "Draw",
  outoftime: "Time out",
  cheat: "Cheat detected",
  noStart: "Not started in time",
  unknownFinish: "Finished",
  variantEnd: "Variant ending",
};

export interface GameSummary {
  id: string;
  url: string;
  color: "white" | "black";
  result: Result;
  /** "1-0", "0-1", "½-½", "*". */
  score: string;
  /** How it ended: "Checkmate", "Time out"… */
  ending: string;
  opponent: string;
  opponentRating?: number;
  rating?: number;
  ratingDiff?: number;
  accuracy?: number;
  opponentAccuracy?: number;
  opening?: string;
  eco?: string;
  speed: string;
  perf: string;
  timeControl: string;
  rated: boolean;
  variant: string;
  moves: number;
  playedAt: number;
  pgn?: string;
}

function playerName(p: GamePlayer): string {
  if (p.aiLevel) return `Stockfish level ${p.aiLevel}`;
  return p.user ? displayName(p.user.name, p.user.title) : "Anonymous";
}

/** The game from `username`'s side (case does not matter); from white's side if they didn't play it. */
export function summarize(game: Game, username: string): GameSummary {
  const id = username.toLowerCase();
  const color: "white" | "black" = game.players.black.user?.id === id ? "black" : "white";
  const me = game.players[color];
  const them = game.players[color === "white" ? "black" : "white"];
  const over = !["created", "started"].includes(game.status);
  const result: Result = !over ? "ongoing" : game.winner ? (game.winner === color ? "win" : "loss") : "draw";
  const ending = STATUS[game.status] ?? game.status;
  const score = !over ? "*" : game.winner === "white" ? "1-0" : game.winner === "black" ? "0-1" : "½-½";
  const plies = game.moves ? game.moves.trim().split(/\s+/).filter(Boolean).length : 0;
  return {
    id: game.id,
    url: gameUrl(game.id, color),
    color,
    result,
    score,
    ending,
    opponent: playerName(them),
    opponentRating: them.rating,
    rating: me.rating,
    ratingDiff: me.ratingDiff,
    accuracy: me.analysis?.accuracy,
    opponentAccuracy: them.analysis?.accuracy,
    opening: game.opening?.name,
    eco: game.opening?.eco,
    speed: game.speed,
    perf: game.perf,
    timeControl: timeControl(game),
    rated: game.rated,
    variant: game.variant,
    moves: Math.ceil(plies / 2),
    playedAt: game.lastMoveAt ?? game.createdAt,
    pgn: game.pgn,
  };
}

/** Games from an NDJSON body, skipping blank or broken lines. */
export function parseNdjson<T>(body: string): T[] {
  return body.split("\n").flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

export const capitalize = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s;

/** "Won by checkmate", "Lost on time", "Draw by stalemate", "In progress". */
export function resultSentence(g: Pick<GameSummary, "result" | "ending">): string {
  if (g.result === "ongoing") return "In progress";
  const how: Record<string, string> = {
    Checkmate: "by checkmate",
    Resignation: "by resignation",
    "Time out": "on time",
    "Left the game": "by abandonment",
    Stalemate: "by stalemate",
    Draw: "by agreement",
    "Variant ending": "by variant rules",
    "Cheat detected": "by cheat detection",
  };
  const word = g.result === "win" ? "Won" : g.result === "loss" ? "Lost" : "Draw";
  if (g.result === "draw" && g.ending === "Draw") return "Draw";
  return `${word} ${how[g.ending] ?? `(${g.ending.toLowerCase()})`}`;
}

export interface Record3 {
  win: number;
  loss: number;
  draw: number;
}

/** Wins, losses and draws of finished games. */
export function record(games: GameSummary[]): Record3 {
  const r = { win: 0, loss: 0, draw: 0 };
  for (const g of games) if (g.result !== "ongoing") r[g.result]++;
  return r;
}

/** "Last 20: 12 won, 6 lost, 2 drawn"; "" without finished games. */
export function recordText(games: GameSummary[]): string {
  const finished = games.filter((g) => g.result !== "ongoing");
  if (!finished.length) return "";
  const r = record(finished);
  return `Last ${finished.length}: ${r.win} won, ${r.loss} lost, ${r.draw} drawn`;
}

/** Seconds as "2:05", "1:03:20", or "3 days" for correspondence. */
export function clockText(seconds: number): string {
  if (seconds >= 86400) {
    const d = Math.floor(seconds / 86400);
    return `${d} day${d === 1 ? "" : "s"}`;
  }
  const h = Math.floor(seconds / 3600);
  const m = Math.floor(seconds % 3600 / 60);
  const s = Math.floor(seconds % 60);
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Boards and puzzles

/** A board as a fenced code block, for a detail panel. */
export function boardMarkdown(pos: Position, orientation: "white" | "black"): string {
  return ["```", boardText(pos, orientation === "white" ? "w" : "b"), "```"].join("\n");
}

export interface PuzzleView {
  id: string;
  url: string;
  rating: number;
  plays: number;
  themes: string[];
  /** The side to find the moves for. */
  color: "white" | "black";
  position: Position;
  fen: string;
  /** The opponent's move that sets up the puzzle, in SAN. */
  lastMove?: string;
  /** The solution in SAN, numbered: "24. Qxh7+ Kxh7 25. Rh3#". */
  solution: string;
  solutionMoves: string[];
  /** The game up to the puzzle, as SAN tokens. */
  gameMoves: string[];
  gameId: string;
  gameUrl: string;
  perf: string;
  players: string;
}

export function themeTitle(theme: string): string {
  const special: Record<string, string> = {
    mateIn1: "Mate in 1",
    mateIn2: "Mate in 2",
    mateIn3: "Mate in 3",
    mateIn4: "Mate in 4",
    mateIn5: "Mate in 5+",
    oneMove: "One move",
    veryLong: "Very long",
    crushing: "Crushing",
    advantage: "Advantage",
    equality: "Equality",
    middlegame: "Middlegame",
    endgame: "Endgame",
    opening: "Opening",
  };
  return special[theme] ?? capitalize(theme.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase());
}

/** The daily puzzle's position, replayed from the game's moves, and its solution in SAN. */
export function puzzleView(daily: DailyPuzzle): PuzzleView {
  const gameMoves = sanTokens(daily.game.pgn);
  const position = play(gameMoves);
  const color = position.turn === "w" ? "white" : "black";
  const solutionMoves = uciToSan(daily.puzzle.solution, position);
  const players = daily.game.players
    .map((p) => `${displayName(p.name, p.title)}${p.rating ? ` (${p.rating})` : ""}`)
    .join(" vs ");
  return {
    id: daily.puzzle.id,
    url: puzzleUrl(daily.puzzle.id),
    rating: daily.puzzle.rating,
    plays: daily.puzzle.plays,
    themes: daily.puzzle.themes,
    color,
    position,
    fen: toFen(position),
    lastMove: gameMoves.at(-1),
    solution: numbered(solutionMoves, position),
    solutionMoves,
    gameMoves,
    gameId: daily.game.id,
    gameUrl: gameUrl(daily.game.id),
    perf: daily.game.perf.name,
    players,
  };
}

/** A position from a FEN, for games in progress. */
export function positionOf(fen: string): Position {
  return parseFen(fen.split(" ").length < 2 ? `${fen} w - - 0 1` : fen);
}
