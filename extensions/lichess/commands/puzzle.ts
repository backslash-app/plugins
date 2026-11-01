import { action, copy, detail, type DetailSpec, Icons, meta, open, replace } from "@backslash/api";
import { dailyPuzzle } from "../api.ts";
import { analysisAction } from "../items.ts";
import { boardMarkdown, type PuzzleView, puzzleView, themeTitle } from "../lib.ts";

function view(p: PuzzleView, solved: boolean): DetailSpec {
  const side = p.color === "white" ? "White" : "Black";
  return detail({
    title: "Daily Puzzle",
    markdown: [
      `## ${side} to play`,
      "",
      p.lastMove ? `After **${p.lastMove}**, find the best move for ${side.toLowerCase()}.` : "",
      "",
      boardMarkdown(p.position, p.color),
      "",
      solved ? `**Solution:** ${p.solution}` : "_Ctrl+K → Show Solution when you are done._",
    ].join("\n"),
    stats: [
      { label: "Puzzle rating", value: p.rating, color: "blue" },
      { label: "Played", value: p.plays.toLocaleString("en") },
      { label: "Moves to find", value: Math.ceil(p.solutionMoves.length / 2) },
    ],
    metadata: [
      meta.tags("Themes", p.themes.map((t) => ({ text: themeTitle(t), color: "purple" as const }))),
      meta.text("From", `${p.perf} game`, { icon: Icons.gamepad }),
      meta.text("Players", p.players, { icon: Icons.person }),
      meta.link("Game", `lichess.org/${p.gameId}`, p.gameUrl),
      meta.text("FEN", p.fen),
    ],
    status: `Puzzle #${p.id} · ${p.rating}`,
    actions: [
      open(p.url, "Solve on Lichess"),
      solved
        ? action("Hide Solution", () => replace(view(p, false)), { icon: Icons.eyeOff })
        : action("Show Solution", () => replace(view(p, true)), { icon: Icons.eye, shortcut: "<Ctrl>s" }),
      analysisAction(p.fen),
      copy(p.fen, "Copy FEN", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(p.url, "Copy Puzzle Link", { section: "Copy" }),
    ],
  });
}

export default async ({ signal }: { signal: AbortSignal }) => view(puzzleView(await dailyPuzzle(signal)), false);
