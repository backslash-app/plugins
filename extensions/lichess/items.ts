// List items shared by the commands.

import { action, type Color, copy, Icons, type Item, list, meta, type Metadata, open } from "@backslash/api";
import { games, LoginRequired, user } from "./api.ts";
import {
  ago,
  analysisUrl,
  boardMarkdown,
  capitalize,
  clockText,
  displayName,
  duration,
  flag,
  type GameSummary,
  gameUrl,
  type Playing,
  positionOf,
  profileUrl,
  type Rating,
  ratings,
  ratingText,
  recordText,
  resultSentence,
  scores,
  signed,
  SITE,
  summarize,
  TOKEN_URL,
  type User,
} from "./lib.ts";

const RESULT: Record<GameSummary["result"], { icon: string; tint: Color; tag: string }> = {
  win: { icon: Icons.check, tint: "green", tag: "Won" },
  loss: { icon: Icons.cross, tint: "red", tag: "Lost" },
  draw: { icon: Icons.minus, tint: "gray", tag: "Draw" },
  ongoing: { icon: Icons.play, tint: "blue", tag: "Playing" },
};

export function gameItem(g: GameSummary, section: string): Item {
  const r = RESULT[g.result];
  const opponent = `${g.opponent}${g.opponentRating ? ` (${g.opponentRating})` : ""}`;
  const kind = `${capitalize(g.perf)} ${g.timeControl}${g.rated ? "" : " · casual"}`;
  const metadata: Metadata[] = [
    meta.tags("Result", [{ text: `${resultSentence(g)} · ${g.score}`, color: r.tint }]),
    meta.text("Color", g.color === "white" ? "White" : "Black", { icon: g.color === "white" ? Icons.square : "⬛" }),
    meta.text("Opponent", opponent, { icon: Icons.person }),
    ...(g.rating
      ? [meta.text("Rating", `${g.rating}${g.ratingDiff !== undefined ? ` (${signed(g.ratingDiff)})` : ""}`)]
      : []),
    ...(g.accuracy !== undefined ? [meta.progress("Accuracy", g.accuracy / 100, `${g.accuracy} %`)] : []),
    ...(g.opponentAccuracy !== undefined
      ? [meta.progress("Opponent accuracy", g.opponentAccuracy / 100, `${g.opponentAccuracy} %`)]
      : []),
    meta.separator(),
    ...(g.opening ? [meta.text("Opening", `${g.eco ? `${g.eco} · ` : ""}${g.opening}`, { icon: Icons.book })] : []),
    meta.text("Time control", kind, { icon: Icons.clock }),
    ...(g.variant !== "standard" ? [meta.text("Variant", capitalize(g.variant))] : []),
    meta.text("Moves", g.moves),
    meta.text("Played", ago(g.playedAt)),
    meta.link("Game", `lichess.org/${g.id}`, g.url),
  ];
  return {
    id: `game:${g.id}`,
    title: opponent,
    subtitle: g.opening ?? kind,
    icon: { source: r.icon, tint: r.tint },
    section,
    keywords: [r.tag, g.perf, g.speed, g.eco ?? "", g.ending, g.color],
    accessories: [
      ...(g.ratingDiff !== undefined && g.rated
        ? [{
          text: signed(g.ratingDiff),
          color: (g.ratingDiff > 0 ? "green" : g.ratingDiff < 0 ? "red" : "gray") as Color,
        }]
        : []),
      { tag: g.timeControl, tooltip: kind },
      { tag: r.tag, color: r.tint },
      { text: ago(g.playedAt) },
    ],
    detail: { metadata },
    actions: [
      open(g.url, "Open on Lichess"),
      open(`${SITE}/${g.id}/${g.color}#analysis`, "Open Analysis", { icon: Icons.search }),
      ...(g.pgn ? [copy(g.pgn, "Copy PGN", { shortcut: "<Ctrl><Shift>c", section: "Copy" })] : []),
      copy(g.url, "Copy Link", { section: "Copy" }),
    ],
  };
}

/** A game in progress, from /api/account/playing. */
export function playingItem(p: Playing): Item {
  const opponent = p.opponent.ai ? `Stockfish level ${p.opponent.ai}` : p.opponent.username;
  const title = `${opponent}${p.opponent.rating ? ` (${p.opponent.rating})` : ""}`;
  const url = `${SITE}/${p.fullId}`;
  const left = p.secondsLeft !== undefined ? clockText(p.secondsLeft) : undefined;
  return {
    id: `playing:${p.gameId}`,
    title,
    subtitle: `${capitalize(p.perf)}${p.variant.key !== "standard" ? ` · ${p.variant.name}` : ""}`,
    icon: { source: p.isMyTurn ? Icons.bell : Icons.hourglass, tint: p.isMyTurn ? "orange" : "gray" },
    section: p.isMyTurn ? "Your turn" : "Waiting for your opponent",
    keywords: ["playing", p.speed],
    accessories: [
      ...(left ? [{ text: left, icon: Icons.timer }] : []),
      { tag: p.color === "white" ? "White" : "Black" },
    ],
    detail: {
      markdown: p.variant.key === "standard" || p.variant.key === "fromPosition"
        ? boardMarkdown(positionOf(p.fen), p.color)
        : undefined,
      metadata: [
        meta.text("Opponent", title, { icon: Icons.person }),
        meta.text("You play", p.color === "white" ? "White" : "Black"),
        ...(p.lastMove ? [meta.text("Last move", p.lastMove)] : []),
        ...(left ? [meta.text("Time left", left, { icon: Icons.timer })] : []),
        meta.text("Rated", p.rated ? "Yes" : "No"),
      ],
    },
    actions: [open(url, p.isMyTurn ? "Play on Lichess" : "Open on Lichess"), copy(gameUrl(p.gameId), "Copy Link")],
  };
}

export interface GamesOptions {
  count: number;
  token?: string;
}

/** The row shown instead of games when Lichess wants a token. */
export function tokenItem(): Item {
  return {
    id: "token-needed",
    title: "Lichess needs a personal API token for recent games",
    subtitle: "Create one (no scope needed), then paste it in Settings → Extensions → Lichess",
    icon: { source: Icons.key, tint: "orange" },
    section: "Recent games",
    detail: {
      markdown: [
        "## A token is needed for recent games",
        "",
        "Lichess only exports games to signed-in requests. Create a personal API token: it needs **no scope**, so it",
        "can only read public data.",
        "",
        "1. Open the token page and click **Create**.",
        "2. Paste the token in **Settings → Extensions → Lichess → API token**.",
        "",
        "Ratings, profiles and the daily puzzle work without it.",
      ].join("\n"),
    },
    actions: [
      open(TOKEN_URL, "Create a Token on Lichess", { icon: Icons.key }),
      copy(TOKEN_URL, "Copy Token Page Link"),
    ],
  };
}

/**
 * A player's last games as items. Without a token Lichess refuses: a row
 * explains how to get one, unless the player doesn't exist at all.
 */
export async function recentGames(
  name: string,
  o: GamesOptions,
  signal?: AbortSignal,
): Promise<{ games: GameSummary[]; items: Item[]; unknown?: boolean }> {
  try {
    const found = (await games(name, o.count, o.token, signal)).map((g) => summarize(g, name));
    return { games: found, items: found.map((g) => gameItem(g, "Recent games")) };
  } catch (e) {
    if (!(e instanceof LoginRequired)) throw e;
    if (!await user(name, signal)) return { games: [], items: [], unknown: true };
    return { games: [], items: [tokenItem()] };
  }
}

/** A player's last games, as a view to open from a profile. */
export function gamesView(name: string, o: GamesOptions) {
  let shown: GameSummary[] = [];
  return list({
    title: `${name}'s games`,
    placeholder: "Filter by opponent, opening, result…",
    empty: { title: "No games yet", icon: Icons.gamepad },
    status: () => recordText(shown),
    async items({ signal }) {
      const recent = await recentGames(name, o, signal);
      shown = recent.games;
      return recent.items;
    },
  });
}

function ratingItem(user: User, r: Rating, o: GamesOptions): Item {
  const url = `${profileUrl(user.username)}/perf/${r.key}`;
  return {
    id: `rating:${user.id}:${r.key}`,
    title: r.title,
    subtitle: `${r.games.toLocaleString("en")} games${r.provisional ? " · provisional" : ""}`,
    icon: { source: r.icon, tint: "blue" },
    section: `${user.username}'s ratings`,
    accessories: [
      ...(r.progress
        ? [{ text: signed(r.progress), color: (r.progress > 0 ? "green" : "red") as Color, tooltip: "Last 12 games" }]
        : []),
      { tag: ratingText(r), color: "blue" },
    ],
    detail: {
      stats: [
        { label: "Rating", value: ratingText(r), color: "blue" },
        {
          label: "Last 12 games",
          value: signed(r.progress),
          color: r.progress > 0 ? "green" : r.progress < 0 ? "red" : "gray",
        },
        { label: "Games", value: r.games.toLocaleString("en") },
      ],
      metadata: [
        ...(r.deviation ? [meta.text("Rating deviation", `±${r.deviation}`)] : []),
        ...(r.provisional ? [meta.text("Provisional", "Not enough rated games yet", { icon: Icons.info })] : []),
        meta.link("Statistics", `lichess.org/@/${user.username}/perf/${r.key}`, url),
      ],
    },
    actions: [
      open(url, "Open Rating Statistics"),
      action("Show Recent Games", () => gamesView(user.username, o), { icon: Icons.gamepad }),
      open(profileUrl(user.username), "Open Profile", { icon: Icons.person }),
    ],
  };
}

/** A profile: the player, then each rating, then puzzle scores. */
export function profileItems(user: User, o: GamesOptions, section?: string): Item[] {
  const name = displayName(user.username, user.title);
  const country = flag(user.profile?.flag ?? user.profile?.country);
  const real = user.profile?.realName ??
    ([user.profile?.firstName, user.profile?.lastName].filter(Boolean).join(" ") || undefined);
  const rs = ratings(user);
  const best = rs.filter((r) => r.key !== "puzzle")[0];
  const c = user.count;
  const metadata: Metadata[] = [
    ...(real ? [meta.text("Name", real)] : []),
    ...(user.profile?.location || country
      ? [meta.text("From", [country, user.profile?.location].filter(Boolean).join(" "))]
      : []),
    ...(user.profile?.fideRating ? [meta.text("FIDE rating", user.profile.fideRating)] : []),
    ...(c ? [meta.text("Record", `${c.win} won · ${c.loss} lost · ${c.draw} drawn`)] : []),
    ...(user.playTime?.total ? [meta.text("Time played", duration(user.playTime.total), { icon: Icons.clock })] : []),
    ...(user.createdAt ? [meta.text("Joined", ago(user.createdAt))] : []),
    ...(user.seenAt ? [meta.text("Last seen", ago(user.seenAt))] : []),
    ...(user.patron ? [meta.tags("Patron", [{ text: "Lichess Patron", color: "yellow" }])] : []),
    ...(user.disabled ? [meta.tags("Account", [{ text: "Closed", color: "red" }])] : []),
    ...(user.tosViolation ? [meta.tags("Account", [{ text: "Marked for violating the terms", color: "red" }])] : []),
  ];
  const bio = user.profile?.bio?.trim();
  const header: Item = {
    id: `user:${user.id}`,
    title: name,
    subtitle: [country, real].filter(Boolean).join(" ") || (best ? `${best.title} ${ratingText(best)}` : undefined),
    icon: { source: Icons.person, tint: user.patron ? "yellow" : "gray" },
    section: section ?? "Player",
    keywords: [user.id],
    accessories: [
      ...(user.playing ? [{ tag: "Playing now", color: "green" as Color }] : []),
      ...(c ? [{ text: `${c.all.toLocaleString("en")} games` }] : []),
    ],
    detail: {
      stats: rs.slice(0, 3).map((r) => ({ label: r.title, value: ratingText(r), color: "blue" as Color })),
      markdown: bio ? (bio.length > 300 ? `${bio.slice(0, 300)}…` : bio) : undefined,
      metadata,
    },
    actions: [
      open(profileUrl(user.username), "Open Profile"),
      action("Show Recent Games", () => gamesView(user.username, o), { icon: Icons.gamepad }),
      ...(user.playing ? [open(user.playing, "Watch Current Game", { icon: Icons.eye })] : []),
      copy(profileUrl(user.username), "Copy Profile Link", { section: "Copy" }),
    ],
  };
  if (section) return [header];
  return [
    header,
    ...rs.map((r) => ratingItem(user, r, o)),
    ...scores(user).map((s): Item => ({
      id: `score:${user.id}:${s.title}`,
      title: s.title,
      subtitle: s.runs ? `${s.runs} runs` : undefined,
      icon: { source: Icons.lightbulb, tint: "yellow" },
      section: "Puzzle scores",
      accessories: [{ tag: `Best ${s.score}`, color: "yellow" }],
      actions: [open(`${profileUrl(user.username)}`, "Open Profile")],
    })),
  ];
}

/** Opens a position in the Lichess analysis board. */
export function analysisAction(fen: string) {
  return open(analysisUrl(fen), "Open in Analysis Board", { icon: Icons.search });
}
