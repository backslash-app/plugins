// List items shared by the commands.

import { type Action, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import { TokenMissing, TokenRefused } from "./api.ts";
import {
  type CollectionItem,
  dateText,
  excerpt,
  type Game,
  gameUrl,
  iWon,
  overallRank,
  type Play,
  playersLine,
  playersText,
  ratingColor,
  ratingText,
  SITE,
  thousands,
  timeText,
  TOKEN_HELP_URL,
  TOKEN_URL,
  weightText,
} from "./lib.ts";

const TOKEN_STEPS = [
  "## BoardGameGeek needs an application token",
  "",
  "Since 2025, BoardGameGeek only answers apps that send the token of an application registered on the site.",
  "",
  "1. Sign in on boardgamegeek.com and open **Applications** (Ctrl+Enter opens it).",
  "2. Register an application, e.g. *Backslash (personal use)*, non-commercial. BGG may take a few days to approve it.",
  "3. Create a token for it and copy it.",
  "4. Paste it in **Settings → Extensions → BoardGameGeek → Application token**.",
  "",
  `More in BGG's [XML API terms](${TOKEN_HELP_URL}).`,
].join("\n");

/** The row shown instead of results when the token is missing or refused. */
export function tokenItem(e: TokenMissing | TokenRefused): Item {
  const refused = e instanceof TokenRefused;
  return {
    id: "token",
    title: refused ? "BoardGameGeek refused the application token" : "BoardGameGeek needs an application token",
    subtitle: refused
      ? "Check it in Settings → Extensions → BoardGameGeek, or create a new one"
      : "Register an application on boardgamegeek.com, then paste its token in Settings",
    icon: { source: Icons.key, tint: refused ? "red" : "orange" },
    detail: { markdown: TOKEN_STEPS },
    actions: [
      open(TOKEN_URL, "Open BGG Applications", { icon: Icons.key }),
      open(TOKEN_HELP_URL, "Read the XML API Terms", { icon: Icons.book }),
    ],
  };
}

/** Turns token errors into the explanation row; other errors are thrown on. */
export function tokenRow(e: unknown): Item[] {
  if (e instanceof TokenMissing || e instanceof TokenRefused) return [tokenItem(e)];
  throw e;
}

function gameMarkdown(g: Game): string {
  const lines = [`## ${g.name}${g.year ? ` (${g.year})` : ""}`, ""];
  if (g.description) lines.push(excerpt(g.description, 1200).replace(/\n/g, "\n\n"), "");
  if (g.mechanics.length) lines.push(`**Mechanics:** ${g.mechanics.join(", ")}`, "");
  if (g.categories.length) lines.push(`**Categories:** ${g.categories.join(", ")}`, "");
  return lines.join("\n");
}

export function gameItem(g: Game, o: { section?: string; actions?: Action[] } = {}): Item {
  const rank = overallRank(g);
  const players = playersText(g.minPlayers, g.maxPlayers);
  const time = timeText(g.minTime, g.maxTime);
  const url = gameUrl(g.id, g.type);
  const metadata: Metadata[] = [
    ...(players ? [meta.text("Players", players, { icon: Icons.person })] : []),
    ...(g.bestWith ? [meta.text("", g.bestWith)] : []),
    ...(g.recommendedWith ? [meta.text("", g.recommendedWith)] : []),
    ...(time ? [meta.text("Playing time", time, { icon: Icons.clock })] : []),
    ...(g.minAge ? [meta.text("Age", `${g.minAge}+`)] : []),
    ...(g.weight ? [meta.progress("Weight", (g.weight - 1) / 4, weightText(g.weight))] : []),
    meta.separator(),
    ...(g.rating
      ? [meta.tags("Rating", [{
        text: `${ratingText(g.rating)} / 10 · ${thousands(g.ratings ?? 0)} ratings`,
        color: ratingColor(g.rating),
      }])]
      : []),
    ...(g.bayesRating ? [meta.text("Geek rating", g.bayesRating.toFixed(2))] : []),
    ...g.ranks.filter((r) => r.rank).map((r) => meta.text(`${r.title} rank`, `#${thousands(r.rank!)}`)),
    ...(g.owned ? [meta.text("Owned by", `${thousands(g.owned)} users`)] : []),
    meta.separator(),
    ...(g.designers.length ? [meta.text("Designers", g.designers.slice(0, 4).join(", "))] : []),
    ...(g.artists.length ? [meta.text("Artists", g.artists.slice(0, 4).join(", "))] : []),
    ...(g.publishers.length ? [meta.text("Publisher", g.publishers[0])] : []),
    meta.link("BoardGameGeek", `boardgamegeek.com/${g.type}/${g.id}`, url),
  ];
  return {
    id: `game:${g.id}`,
    title: g.name,
    subtitle: [g.year, players, time].filter(Boolean).join(" · "),
    icon: g.thumbnail ?? { source: Icons.dice, tint: ratingColor(g.rating) },
    section: o.section ?? (g.type === "boardgameexpansion" ? "Expansions" : "Board games"),
    keywords: [...g.alternateNames, ...g.designers],
    accessories: [
      ...(rank ? [{ text: `#${thousands(rank)}`, tooltip: "Board game rank" }] : []),
      ...(g.rating ? [{ tag: ratingText(g.rating)!, color: ratingColor(g.rating), tooltip: "Average rating" }] : []),
    ],
    detail: {
      image: g.image,
      stats: [
        ...(g.rating ? [{ label: "Rating", value: ratingText(g.rating)!, color: ratingColor(g.rating) }] : []),
        ...(rank ? [{ label: "Rank", value: `#${thousands(rank)}` }] : []),
        ...(g.weight ? [{ label: "Weight", value: g.weight.toFixed(1) }] : []),
      ],
      markdown: gameMarkdown(g),
      metadata,
    },
    actions: [
      open(url, "Open on BoardGameGeek", { icon: Icons.globe }),
      ...(o.actions ?? []),
      copy(url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl><Shift>c" }),
      copy(g.name, "Copy Name", { icon: Icons.text }),
    ],
  };
}

const STATUS: [string, string][] = [
  ["own", "Owned"],
  ["prevowned", "Previously owned"],
  ["fortrade", "For trade"],
  ["want", "Want in trade"],
  ["wanttoplay", "Want to play"],
  ["wanttobuy", "Want to buy"],
  ["wishlist", "Wishlist"],
  ["preordered", "Preordered"],
];

const WISHLIST = ["", "Must have", "Love to have", "Like to have", "Thinking about it", "Don't buy this"];

export function collectionItem(c: CollectionItem, o: { actions?: Action[] } = {}): Item {
  const players = playersText(c.minPlayers, c.maxPlayers);
  const time = timeText(c.minTime, c.maxTime);
  const url = gameUrl(c.id, c.subtype);
  const statuses = STATUS.filter(([k]) => c.status[k]).map(([, t]) => t);
  return {
    id: `collection:${c.collectionId ?? c.id}`,
    title: c.name,
    subtitle: [c.year, players, time].filter(Boolean).join(" · "),
    icon: c.thumbnail ?? { source: Icons.dice, tint: ratingColor(c.average) },
    section: c.subtype === "boardgameexpansion" ? "Expansions" : undefined,
    keywords: [...statuses, c.comment ?? ""],
    accessories: [
      ...(c.plays ? [{ text: `${c.plays} play${c.plays === 1 ? "" : "s"}`, icon: Icons.play }] : []),
      ...(c.wishlistPriority && c.status.wishlist
        ? [{ tag: WISHLIST[c.wishlistPriority] ?? `Priority ${c.wishlistPriority}`, color: "purple" as const }]
        : []),
      ...(c.myRating
        ? [{ tag: `★ ${c.myRating}`, color: ratingColor(c.myRating), tooltip: "Your rating" }]
        : c.average
        ? [{ text: ratingText(c.average), tooltip: "Average rating" }]
        : []),
    ],
    detail: {
      image: c.image,
      stats: [
        ...(c.myRating ? [{ label: "Your rating", value: String(c.myRating), color: ratingColor(c.myRating) }] : []),
        ...(c.average ? [{ label: "Average", value: ratingText(c.average)! }] : []),
        { label: "Plays", value: c.plays },
      ],
      markdown: [`## ${c.name}${c.year ? ` (${c.year})` : ""}`, "", c.comment ? `> ${c.comment}` : ""].join("\n"),
      metadata: [
        ...(statuses.length ? [meta.tags("Status", statuses.map((s) => ({ text: s })))] : []),
        ...(players ? [meta.text("Players", players, { icon: Icons.person })] : []),
        ...(time ? [meta.text("Playing time", time, { icon: Icons.clock })] : []),
        ...(c.rank ? [meta.text("Board game rank", `#${thousands(c.rank)}`)] : []),
        ...(c.modified ? [meta.text("Last changed", c.modified.slice(0, 10))] : []),
        meta.link("BoardGameGeek", `boardgamegeek.com/${c.subtype}/${c.id}`, url),
      ],
    },
    actions: [
      open(url, "Open on BoardGameGeek", { icon: Icons.globe }),
      ...(o.actions ?? []),
      copy(url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl><Shift>c" }),
      copy(c.name, "Copy Name", { icon: Icons.text }),
    ],
  };
}

export function playItem(p: Play, username: string, o: { actions?: Action[] } = {}): Item {
  const won = iWon(p, username);
  const url = gameUrl(p.gameId);
  const scoreRows = p.players.map((pl) =>
    `| ${pl.win ? "🏆 " : ""}${pl.name}${pl.isNew ? " *(new)*" : ""} | ${pl.score ?? ""} | ${pl.color ?? ""} |`
  );
  return {
    id: `play:${p.id}`,
    title: p.game,
    subtitle: [dateText(p.date), playersLine(p)].filter(Boolean).join(" · "),
    icon: { source: Icons.dice, tint: won === true ? "green" : won === false ? "gray" : "blue" },
    section: p.date.slice(0, 7),
    keywords: [p.location ?? "", ...p.players.map((pl) => pl.name)],
    accessories: [
      ...(p.quantity > 1 ? [{ text: `×${p.quantity}` }] : []),
      ...(p.length ? [{ text: `${p.length} min`, icon: Icons.clock }] : []),
      ...(p.incomplete ? [{ tag: "Incomplete", color: "orange" as const }] : []),
      ...(won === true ? [{ tag: "Won", color: "green" as const }] : won === false ? [{ tag: "Lost" }] : []),
    ],
    detail: {
      markdown: [
        `## ${p.game}`,
        "",
        ...(p.players.length ? ["| Player | Score | Color |", "|---|---|---|", ...scoreRows, ""] : []),
        p.comments ? `> ${p.comments.replace(/\n/g, "\n> ")}` : "",
      ].join("\n"),
      metadata: [
        meta.text("Date", dateText(p.date), { icon: Icons.calendar }),
        ...(p.quantity > 1 ? [meta.text("Times played", String(p.quantity))] : []),
        ...(p.length ? [meta.text("Length", `${p.length} min`, { icon: Icons.clock })] : []),
        ...(p.location ? [meta.text("Location", p.location, { icon: Icons.home })] : []),
        meta.link("BoardGameGeek", `boardgamegeek.com/boardgame/${p.gameId}`, url),
      ],
    },
    actions: [
      open(url, "Open Game on BoardGameGeek", { icon: Icons.globe }),
      ...(o.actions ?? []),
      copy(`${p.game}, ${dateText(p.date)}: ${playersLine(p)}`, "Copy Result", { icon: Icons.text }),
    ],
  };
}

export const openSite = () => open(SITE, "Open BoardGameGeek", { icon: Icons.globe });
