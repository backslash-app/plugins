// A small chess move applier: enough to replay a game's moves (SAN or UCI),
// write moves back in SAN and draw the position. Standard chess only.

/** "P", "N", "B", "R", "Q", "K" for white, lowercase for black, "" for an empty square. */
export type Piece = string;
export type Side = "w" | "b";

export interface Position {
  /** Index `rank * 8 + file`: a1 is 0, h1 is 7, a8 is 56. */
  board: Piece[];
  turn: Side;
  /** "KQkq", or a subset, or "". */
  castling: string;
  /** The square a pawn can capture en passant, or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
}

export interface Move {
  from: number;
  to: number;
  /** Lowercase piece letter: "q", "r", "b", "n". */
  promotion?: string;
}

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const FILES = "abcdefgh";

export const squareName = (sq: number): string => FILES[sq % 8] + String(Math.floor(sq / 8) + 1);

export function squareIndex(name: string): number {
  const m = /^([a-h])([1-8])$/.exec(name);
  if (!m) throw new Error(`not a square: ${name}`);
  return (Number(m[2]) - 1) * 8 + FILES.indexOf(m[1]);
}

const sideOf = (p: Piece): Side | undefined => p ? (p === p.toUpperCase() ? "w" : "b") : undefined;
const other = (s: Side): Side => s === "w" ? "b" : "w";

export function parseFen(fen: string): Position {
  const [placement, turn = "w", castling = "-", ep = "-", half = "0", full = "1"] = fen.trim().split(/\s+/);
  const rows = placement?.split("/") ?? [];
  if (rows.length !== 8) throw new Error(`not a FEN position: ${fen}`);
  const board: Piece[] = new Array(64).fill("");
  rows.forEach((row, i) => {
    const rank = 7 - i;
    let file = 0;
    for (const c of row) {
      if (/\d/.test(c)) file += Number(c);
      else if (/[pnbrqkPNBRQK]/.test(c) && file < 8) board[rank * 8 + file++] = c;
      else throw new Error(`not a FEN position: ${fen}`);
    }
    if (file !== 8) throw new Error(`not a FEN position: ${fen}`);
  });
  if (turn !== "w" && turn !== "b") throw new Error(`not a FEN position: ${fen}`);
  return {
    board,
    turn,
    castling: castling === "-" ? "" : castling,
    ep: ep === "-" ? -1 : squareIndex(ep),
    halfmove: Number(half) || 0,
    fullmove: Number(full) || 1,
  };
}

export function toFen(pos: Position): string {
  const rows: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const p = pos.board[rank * 8 + file];
      if (!p) empty++;
      else {
        if (empty) row += empty;
        empty = 0;
        row += p;
      }
    }
    rows.push(row + (empty || ""));
  }
  return [
    rows.join("/"),
    pos.turn,
    pos.castling || "-",
    pos.ep >= 0 ? squareName(pos.ep) : "-",
    pos.halfmove,
    pos.fullmove,
  ].join(" ");
}

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

function step(sq: number, df: number, dr: number): number {
  const f = sq % 8 + df;
  const r = Math.floor(sq / 8) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

/** Whether `by` attacks `sq`. */
export function attacked(board: Piece[], sq: number, by: Side): boolean {
  const own = (p: Piece, kind: string) => p === (by === "w" ? kind.toUpperCase() : kind);
  const pawnRank = by === "w" ? -1 : 1;
  for (const df of [-1, 1]) {
    const s = step(sq, df, pawnRank);
    if (s >= 0 && own(board[s], "p")) return true;
  }
  for (const [df, dr] of KNIGHT) {
    const s = step(sq, df, dr);
    if (s >= 0 && own(board[s], "n")) return true;
  }
  for (const [df, dr] of KING) {
    const s = step(sq, df, dr);
    if (s >= 0 && own(board[s], "k")) return true;
  }
  for (const [dirs, kinds] of [[ROOK, ["r", "q"]], [BISHOP, ["b", "q"]]] as const) {
    for (const [df, dr] of dirs) {
      let s = step(sq, df, dr);
      while (s >= 0) {
        const p = board[s];
        if (p) {
          if (kinds.some((k) => own(p, k))) return true;
          break;
        }
        s = step(s, df, dr);
      }
    }
  }
  return false;
}

export function inCheck(pos: Position, side: Side = pos.turn): boolean {
  const king = pos.board.indexOf(side === "w" ? "K" : "k");
  return king >= 0 && attacked(pos.board, king, other(side));
}

function pseudoMoves(pos: Position): Move[] {
  const moves: Move[] = [];
  const { board, turn } = pos;
  const enemy = other(turn);
  for (let from = 0; from < 64; from++) {
    const p = board[from];
    if (sideOf(p) !== turn) continue;
    const kind = p.toLowerCase();
    const add = (to: number) => {
      if (to >= 0 && sideOf(board[to]) !== turn) moves.push({ from, to });
    };
    if (kind === "p") {
      const dir = turn === "w" ? 1 : -1;
      const startRank = turn === "w" ? 1 : 6;
      const lastRank = turn === "w" ? 7 : 0;
      const push = (to: number) => {
        if (Math.floor(to / 8) === lastRank) { for (const promotion of "qrbn") moves.push({ from, to, promotion }); }
        else moves.push({ from, to });
      };
      const one = step(from, 0, dir);
      if (one >= 0 && !board[one]) {
        push(one);
        const two = step(from, 0, 2 * dir);
        if (Math.floor(from / 8) === startRank && !board[two]) moves.push({ from, to: two });
      }
      for (const df of [-1, 1]) {
        const to = step(from, df, dir);
        if (to < 0) continue;
        if (sideOf(board[to]) === enemy) push(to);
        else if (to === pos.ep) moves.push({ from, to });
      }
    } else if (kind === "n" || kind === "k") {
      for (const [df, dr] of kind === "n" ? KNIGHT : KING) add(step(from, df, dr));
      if (kind === "k") {
        const home = turn === "w" ? 4 : 60;
        const rights = turn === "w" ? ["K", "Q"] : ["k", "q"];
        if (from === home && !attacked(board, home, enemy)) {
          if (
            pos.castling.includes(rights[0]) && !board[home + 1] && !board[home + 2] &&
            board[home + 3] === (turn === "w" ? "R" : "r") &&
            !attacked(board, home + 1, enemy) && !attacked(board, home + 2, enemy)
          ) moves.push({ from, to: home + 2 });
          if (
            pos.castling.includes(rights[1]) && !board[home - 1] && !board[home - 2] && !board[home - 3] &&
            board[home - 4] === (turn === "w" ? "R" : "r") &&
            !attacked(board, home - 1, enemy) && !attacked(board, home - 2, enemy)
          ) moves.push({ from, to: home - 2 });
        }
      }
    } else {
      const dirs = kind === "r" ? ROOK : kind === "b" ? BISHOP : [...ROOK, ...BISHOP];
      for (const [df, dr] of dirs) {
        let to = step(from, df, dr);
        while (to >= 0) {
          if (board[to]) {
            if (sideOf(board[to]) === enemy) moves.push({ from, to });
            break;
          }
          moves.push({ from, to });
          to = step(to, df, dr);
        }
      }
    }
  }
  return moves;
}

/** The position after `move`, which is assumed to be pseudo-legal. */
export function applyMove(pos: Position, move: Move): Position {
  const board = [...pos.board];
  const p = board[move.from];
  const kind = p.toLowerCase();
  const captured = board[move.to];
  board[move.to] = move.promotion ? (pos.turn === "w" ? move.promotion.toUpperCase() : move.promotion) : p;
  board[move.from] = "";
  let ep = -1;
  if (kind === "p") {
    if (move.to === pos.ep) board[move.to + (pos.turn === "w" ? -8 : 8)] = "";
    if (Math.abs(move.to - move.from) === 16) ep = (move.from + move.to) / 2;
  }
  if (kind === "k" && Math.abs(move.to - move.from) === 2) {
    const kingside = move.to > move.from;
    const rookFrom = kingside ? move.from + 3 : move.from - 4;
    const rookTo = kingside ? move.from + 1 : move.from - 1;
    board[rookTo] = board[rookFrom];
    board[rookFrom] = "";
  }
  let castling = pos.castling;
  const lose = (sq: number) => {
    if (sq === 4) castling = castling.replace(/[KQ]/g, "");
    if (sq === 60) castling = castling.replace(/[kq]/g, "");
    if (sq === 7) castling = castling.replace("K", "");
    if (sq === 0) castling = castling.replace("Q", "");
    if (sq === 63) castling = castling.replace("k", "");
    if (sq === 56) castling = castling.replace("q", "");
  };
  lose(move.from);
  lose(move.to);
  return {
    board,
    turn: other(pos.turn),
    castling,
    ep,
    halfmove: kind === "p" || captured ? 0 : pos.halfmove + 1,
    fullmove: pos.turn === "b" ? pos.fullmove + 1 : pos.fullmove,
  };
}

export function legalMoves(pos: Position): Move[] {
  return pseudoMoves(pos).filter((m) => !inCheck(applyMove(pos, m), pos.turn));
}

/** The move in Standard Algebraic Notation, with + or #. */
export function toSan(pos: Position, move: Move, legal = legalMoves(pos)): string {
  const p = pos.board[move.from];
  const kind = p.toLowerCase();
  let san: string;
  if (kind === "k" && Math.abs(move.to - move.from) === 2) {
    san = move.to > move.from ? "O-O" : "O-O-O";
  } else {
    const capture = !!pos.board[move.to] || (kind === "p" && move.to === pos.ep);
    if (kind === "p") {
      san = (capture ? FILES[move.from % 8] + "x" : "") + squareName(move.to) +
        (move.promotion ? "=" + move.promotion.toUpperCase() : "");
    } else {
      const rivals = legal.filter((m) => m.to === move.to && m.from !== move.from && pos.board[m.from] === p);
      let which = "";
      if (rivals.length) {
        const sameFile = rivals.some((m) => m.from % 8 === move.from % 8);
        const sameRank = rivals.some((m) => Math.floor(m.from / 8) === Math.floor(move.from / 8));
        if (!sameFile) which = FILES[move.from % 8];
        else if (!sameRank) which = String(Math.floor(move.from / 8) + 1);
        else which = squareName(move.from);
      }
      san = kind.toUpperCase() + which + (capture ? "x" : "") + squareName(move.to);
    }
  }
  const next = applyMove(pos, move);
  if (inCheck(next)) san += legalMoves(next).length ? "+" : "#";
  return san;
}

const sameMove = (a: Move, b: Move) =>
  a.from === b.from && a.to === b.to && (a.promotion ?? "") === (b.promotion ?? "");

/** Reads a move in SAN ("Nf3", "exd5", "O-O", "e8=Q+") or UCI ("g1f3", "e7e8q"). */
export function parseMove(pos: Position, text: string): Move {
  const legal = legalMoves(pos);
  const uci = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(text);
  if (uci) {
    const wanted = { from: squareIndex(uci[1]), to: squareIndex(uci[2]), promotion: uci[3] };
    const found = legal.find((m) => sameMove(m, wanted));
    if (found) return found;
  }
  const clean = (s: string) => s.replace(/[+#!?]+$/, "").replace(/0/g, "O").replace(/=/, "");
  const wanted = clean(text);
  const found = legal.find((m) => clean(toSan(pos, m, legal)) === wanted);
  if (!found) throw new Error(`illegal move ${text} in ${toFen(pos)}`);
  return found;
}

/** The SAN moves of a PGN or of a plain move list, without headers, comments, numbers or results. */
export function sanTokens(pgn: string): string[] {
  const body = pgn
    .replace(/^\s*\[[^\]]*\]\s*$/gm, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/;[^\n]*/g, " ");
  // Variations, innermost first.
  let text = body;
  for (let prev = ""; prev !== text;) {
    prev = text;
    text = text.replace(/\([^()]*\)/g, " ");
  }
  return text.split(/\s+/)
    .map((t) => t.replace(/^\d+\.(\.\.)?/, ""))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*|\$\d+)$/.test(t));
}

/** Plays `moves` (SAN or UCI) from a position; throws on the first illegal one. */
export function play(moves: string[], from: Position = parseFen(START_FEN)): Position {
  return moves.reduce((pos, text) => applyMove(pos, parseMove(pos, text)), from);
}

/** The UCI moves as SAN, played from `from`. */
export function uciToSan(moves: string[], from: Position): string[] {
  const out: string[] = [];
  let pos = from;
  for (const text of moves) {
    const move = parseMove(pos, text);
    out.push(toSan(pos, move));
    pos = applyMove(pos, move);
  }
  return out;
}

/** "1. e4 e5 2. Nf3", numbered from the position's move number. */
export function numbered(sans: string[], from: Position): string {
  let n = from.fullmove;
  let white = from.turn === "w";
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (white) parts.push(`${n}. ${san}`);
    else parts.push(i === 0 ? `${n}… ${san}` : san);
    if (!white) n++;
    white = !white;
  });
  return parts.join(" ");
}

const FIGURES: Record<string, string> = {
  K: "♔",
  Q: "♕",
  R: "♖",
  B: "♗",
  N: "♘",
  P: "♙",
  k: "♚",
  q: "♛",
  r: "♜",
  b: "♝",
  n: "♞",
  p: "♟",
};

/** The board as text lines, from `orientation`'s side, with coordinates. */
export function boardText(pos: Position, orientation: Side = "w"): string {
  const ranks = orientation === "w" ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];
  const files = orientation === "w" ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const lines = ranks.map((r) =>
    `${r + 1} ` + files.map((f) => {
      const p = pos.board[r * 8 + f];
      return p ? FIGURES[p] : (r + f) % 2 === 0 ? "·" : " ";
    }).join(" ")
  );
  lines.push("  " + files.map((f) => FILES[f]).join(" "));
  return lines.join("\n");
}
