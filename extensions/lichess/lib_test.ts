import { assert, assertEquals, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import {
  applyMove,
  boardText,
  inCheck,
  legalMoves,
  numbered,
  parseFen,
  parseMove,
  play,
  type Position,
  sanTokens,
  START_FEN,
  toFen,
  toSan,
  uciToSan,
} from "./chess.ts";
import {
  ago,
  analysisUrl,
  cleanUsername,
  clockText,
  type DailyPuzzle,
  displayName,
  duration,
  flag,
  type Game,
  parseNdjson,
  puzzleView,
  ratings,
  recordText,
  resultSentence,
  scores,
  signed,
  summarize,
  themeTitle,
  timeControl,
  type User,
} from "./lib.ts";

const dir = new URL(".", import.meta.url).pathname;
const fixture = (name: string) => Deno.readTextFileSync(`${dir}fixtures/${name}`);

function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(pos);
  if (depth === 1) return moves.length;
  return moves.reduce((n, m) => n + perft(applyMove(pos, m), depth - 1), 0);
}

Deno.test("chess: FEN round trip", () => {
  assertEquals(toFen(parseFen(START_FEN)), START_FEN);
  const kiwipete = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
  assertEquals(toFen(parseFen(kiwipete)), kiwipete);
  assertThrows(() => parseFen("8/8/8 w - - 0 1"), Error, "not a FEN");
  assertThrows(() => parseFen("9/8/8/8/8/8/8/8 w - - 0 1"), Error, "not a FEN");
});

Deno.test("chess: move generation matches known perft counts", () => {
  assertEquals(perft(parseFen(START_FEN), 1), 20);
  assertEquals(perft(parseFen(START_FEN), 2), 400);
  assertEquals(perft(parseFen(START_FEN), 3), 8902);
  // Castling, en passant, promotions and pins.
  const kiwipete = parseFen("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  assertEquals(perft(kiwipete, 1), 48);
  assertEquals(perft(kiwipete, 2), 2039);
  const endgame = parseFen("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1");
  assertEquals(perft(endgame, 1), 14);
  assertEquals(perft(endgame, 2), 191);
  assertEquals(perft(endgame, 3), 2812);
  const promotions = parseFen("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1");
  assertEquals(perft(promotions, 1), 6);
  assertEquals(perft(promotions, 2), 264);
});

Deno.test("chess: the Opera Game replays to its final position, SAN for SAN", () => {
  const pgn = `[Event "Paris"]
[White "Paul Morphy"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 {A comment} 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 (9... Qb4+ 10. Qxb4) 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8
13. Rxd7 Rxd7 14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;
  const tokens = sanTokens(pgn);
  assertEquals(tokens.length, 33);
  assertEquals(tokens[0], "e4");
  assertEquals(tokens.at(-1), "Rd8#");
  let pos = parseFen(START_FEN);
  for (const san of tokens) {
    const move = parseMove(pos, san);
    assertEquals(toSan(pos, move), san);
    pos = applyMove(pos, move);
  }
  assertEquals(toFen(pos), "1n1Rkb1r/p4ppp/4q3/4p1B1/4P3/8/PPP2PPP/2K5 b k - 1 17");
  assert(inCheck(pos));
  assertEquals(legalMoves(pos).length, 0);
});

Deno.test("chess: SAN details", () => {
  // En passant.
  const ep = play(["e4", "a6", "e5", "d5"]);
  assertEquals(toSan(ep, parseMove(ep, "e5d6")), "exd6");
  assertEquals(applyMove(ep, parseMove(ep, "exd6")).board[35], "");
  // Promotion with check, and moves written in UCI.
  const promo = parseFen("8/P6k/8/8/8/8/8/K7 w - - 0 1");
  assertEquals(uciToSan(["a7a8q"], promo), ["a8=Q"]);
  assertEquals(uciToSan(["a7a8r"], parseFen("7k/P7/6K1/8/8/8/8/8 w - - 0 1")), ["a8=R#"]);
  // Rank disambiguation, and castling written with zeros.
  const rooks = parseFen("R7/8/8/8/8/8/8/R3K2k w Q - 0 1");
  assertEquals(toSan(rooks, parseMove(rooks, "a8a4")), "R8a4");
  assertEquals(toSan(rooks, parseMove(rooks, "0-0-0")), "O-O-O+");
  assertThrows(() => parseMove(parseFen(START_FEN), "e5"), Error, "illegal move");
  // Castling rights are lost when the king moves.
  assertEquals(applyMove(rooks, parseMove(rooks, "Kd2")).castling, "");
});

Deno.test("chess: numbering and drawing", () => {
  const start = parseFen(START_FEN);
  assertEquals(numbered(["e4", "e5", "Nf3"], start), "1. e4 e5 2. Nf3");
  const black = parseFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1");
  assertEquals(numbered(["e5", "Nf3"], black), "1… e5 2. Nf3");
  const lines = boardText(start).split("\n");
  assertEquals(lines.length, 9);
  assertEquals(lines[0], "8 ♜ ♞ ♝ ♛ ♚ ♝ ♞ ♜");
  assertEquals(lines[7], "1 ♖ ♘ ♗ ♕ ♔ ♗ ♘ ♖");
  assertEquals(lines[8], "  a b c d e f g h");
  assertEquals(boardText(start, "b").split("\n")[0], "1 ♖ ♘ ♗ ♔ ♕ ♗ ♘ ♖");
  assertEquals(boardText(start, "b").split("\n")[8], "  h g f e d c b a");
});

Deno.test("usernames", () => {
  assertEquals(cleanUsername(" DrNykterstein "), "DrNykterstein");
  assertEquals(cleanUsername("@thibault"), "thibault");
  assertEquals(cleanUsername("https://lichess.org/@/Some-One_2/perf/blitz"), "Some-One_2");
  assertEquals(cleanUsername("not a name"), "");
  assertEquals(cleanUsername(""), "");
  assertEquals(displayName("Magnus", "GM"), "GM Magnus");
  assertEquals(displayName("Magnus"), "Magnus");
});

Deno.test("ratings: most played first, without unplayed ones", () => {
  const user = JSON.parse(fixture("user.json")) as User;
  const rs = ratings(user);
  assertEquals(rs.map((r) => r.key), ["puzzle", "blitz", "bullet", "correspondence", "rapid"]);
  assertEquals(rs[1], {
    key: "blitz",
    title: "Blitz",
    icon: "bs-timer",
    rating: 1800,
    games: 3400,
    progress: 23,
    provisional: false,
    deviation: 45,
  });
  assert(rs.find((r) => r.key === "rapid")!.provisional);
  assertEquals(scores(user), [
    { title: "Puzzle Storm", score: 34, runs: 12 },
    { title: "Puzzle Streak", score: 17, runs: 3 },
  ]);
  assertEquals(ratings({ id: "x", username: "x" }), []);
});

Deno.test("games: from the player's side", () => {
  const games = parseNdjson<Game>(fixture("games.ndjson"));
  assertEquals(games.length, 4);
  const [won, lost, drawn, ongoing] = games.map((g) => summarize(g, "Thibault"));
  assertEquals(won.color, "white");
  assertEquals(won.result, "win");
  assertEquals(won.score, "1-0");
  assertEquals(won.opponent, "Rival");
  assertEquals(won.opponentRating, 1790);
  assertEquals(won.ratingDiff, 6);
  assertEquals(won.accuracy, 91);
  assertEquals(won.opponentAccuracy, 78);
  assertEquals(won.opening, "Italian Game");
  assertEquals(won.eco, "C50");
  assertEquals(won.timeControl, "3+2");
  assertEquals(won.moves, 5);
  assertEquals(won.url, "https://lichess.org/g1/white");
  assert(won.pgn?.includes("1. e4 e5"));
  assertEquals(resultSentence(won), "Won by checkmate");

  assertEquals(lost.color, "black");
  assertEquals(lost.result, "loss");
  assertEquals(lost.opponent, "GM GM_X");
  assertEquals(lost.timeControl, "½+0");
  assertEquals(resultSentence(lost), "Lost on time");

  assertEquals(drawn.result, "draw");
  assertEquals(drawn.score, "½-½");
  assertEquals(drawn.opponent, "Stockfish level 4");
  assertEquals(drawn.timeControl, "3 days");
  assertEquals(drawn.rated, false);
  assertEquals(resultSentence(drawn), "Draw by stalemate");

  assertEquals(ongoing.result, "ongoing");
  assertEquals(ongoing.score, "*");
  assertEquals(ongoing.moves, 0);
  assertEquals(resultSentence(ongoing), "In progress");

  assertEquals(recordText([won, lost, drawn, ongoing]), "Last 3: 1 won, 1 lost, 1 drawn");
  assertEquals(recordText([ongoing]), "");
});

Deno.test("time controls and durations", () => {
  assertEquals(timeControl({ clock: { initial: 15, increment: 0 } }), "¼+0");
  assertEquals(timeControl({ clock: { initial: 900, increment: 10 } }), "15+10");
  assertEquals(timeControl({ daysPerTurn: 1 }), "1 day");
  assertEquals(timeControl({}), "∞");
  assertEquals(clockText(125), "2:05");
  assertEquals(clockText(3800), "1:03:20");
  assertEquals(clockText(2 * 86400 + 5), "2 days");
  assertEquals(duration(1036800), "12d 0h");
  assertEquals(duration(3 * 3600 + 120), "3h 2m");
  assertEquals(duration(59), "0m");
  const now = Date.UTC(2026, 0, 10);
  assertEquals(ago(now - 30_000, now), "just now");
  assertEquals(ago(now - 5 * 60_000, now), "5 minutes ago");
  assertEquals(ago(now - 86400_000, now), "yesterday");
  assertEquals(ago(now - 3 * 86400_000, now), "3 days ago");
  assertEquals(ago(now - 400 * 86400_000, now), "1 year ago");
  assertEquals(signed(5), "+5");
  assertEquals(signed(-5), "−5");
  assertEquals(signed(0), "±0");
  assertEquals(flag("fr"), "🇫🇷");
  assertEquals(flag("_lichess"), "");
  assertEquals(flag(undefined), "");
});

Deno.test("daily puzzle: position, side and solution", () => {
  const daily = JSON.parse(fixture("daily.json")) as DailyPuzzle;
  const p = puzzleView(daily);
  assertEquals(p.color, "white");
  assertEquals(p.lastMove, "Nf6");
  assertEquals(p.fen, "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
  assertEquals(p.solutionMoves, ["Qxf7#"]);
  assertEquals(p.solution, "4. Qxf7#");
  assertEquals(p.url, "https://lichess.org/training/K69di");
  assertEquals(p.players, "Alice (1712) vs FM Bob (1690)");
  assertEquals(p.gameMoves.length, daily.puzzle.initialPly + 1);
  assertEquals(
    analysisUrl(p.fen),
    "https://lichess.org/analysis/standard/r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR_w_KQkq_-_4_4",
  );
  assertEquals(themeTitle("mateIn1"), "Mate in 1");
  assertEquals(themeTitle("kingsideAttack"), "Kingside attack");
  assertEquals(themeTitle("short"), "Short");
});

Deno.test("manifest: commands, preferences and permissions", () => {
  const m = parse(Deno.readTextFileSync(`${dir}backslash.toml`)) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
    preferences: { name: string; type?: string }[];
  };
  assertEquals(m.extension.id, "lichess");
  assertEquals(m.permissions.net, ["lichess.org"]);
  for (const c of m.commands) Deno.statSync(`${dir}commands/${c.name}.ts`);
  assertEquals(m.preferences.find((p) => p.name === "token")?.type, "secret");
});
