// BoardGameGeek's XML API 2: request URLs, reading the answers, and wording.
// Pure: no network, no launcher.

import { all, child, decodeEntities, find, type Node, num, parseXml, value } from "./xml.ts";

export const SITE = "https://boardgamegeek.com";
export const API = `${SITE}/xmlapi2`;
/** Where an application is registered to get a token for the XML API. */
export const TOKEN_URL = `${SITE}/applications`;
export const TOKEN_HELP_URL = `${SITE}/using_the_xml_api`;
/** BGG's thing endpoint takes at most 20 ids. */
export const THING_BATCH = 20;

// ---------------------------------------------------------------------------
// Types

export interface Rank {
  name: string;
  title: string;
  rank?: number;
}

export interface Game {
  id: number;
  type: string;
  name: string;
  alternateNames: string[];
  year?: number;
  thumbnail?: string;
  image?: string;
  description: string;
  minPlayers?: number;
  maxPlayers?: number;
  bestWith?: string;
  recommendedWith?: string;
  minTime?: number;
  maxTime?: number;
  minAge?: number;
  designers: string[];
  artists: string[];
  publishers: string[];
  categories: string[];
  mechanics: string[];
  families: string[];
  rating?: number;
  bayesRating?: number;
  ratings?: number;
  weight?: number;
  weightVotes?: number;
  owned?: number;
  wishing?: number;
  ranks: Rank[];
}

export interface SearchHit {
  id: number;
  type: string;
  name: string;
  year?: number;
}

export type CollectionFilter = "owned" | "wishlist" | "wanttoplay" | "rated";

export interface CollectionItem {
  id: number;
  collectionId?: number;
  subtype: string;
  name: string;
  year?: number;
  thumbnail?: string;
  image?: string;
  minPlayers?: number;
  maxPlayers?: number;
  minTime?: number;
  maxTime?: number;
  myRating?: number;
  average?: number;
  rank?: number;
  plays: number;
  status: Record<string, boolean>;
  wishlistPriority?: number;
  comment?: string;
  modified?: string;
}

export interface Player {
  name: string;
  username?: string;
  score?: string;
  win: boolean;
  isNew: boolean;
  color?: string;
}

export interface Play {
  id: number;
  date: string;
  quantity: number;
  length?: number;
  location?: string;
  incomplete: boolean;
  gameId: number;
  game: string;
  comments?: string;
  players: Player[];
}

export interface Plays {
  total: number;
  page: number;
  plays: Play[];
}

// ---------------------------------------------------------------------------
// URLs

export const searchUrl = (query: string) =>
  `${API}/search?${new URLSearchParams({ query: query.trim(), type: "boardgame,boardgameexpansion" })}`;

export const thingUrl = (ids: number[]) => `${API}/thing?${new URLSearchParams({ id: ids.join(","), stats: "1" })}`;

const FILTER_PARAM: Record<CollectionFilter, string> = {
  owned: "own",
  wishlist: "wishlist",
  wanttoplay: "wanttoplay",
  rated: "rated",
};

export function collectionUrl(username: string, filter: CollectionFilter): string {
  return `${API}/collection?${new URLSearchParams({ username, [FILTER_PARAM[filter]]: "1", stats: "1" })}`;
}

export const playsUrl = (username: string, page = 1) =>
  `${API}/plays?${new URLSearchParams({ username, page: String(page) })}`;

export const gameUrl = (id: number, type = "boardgame") => `${SITE}/${type}/${id}`;
export const collectionPage = (username: string) => `${SITE}/collection/user/${encodeURIComponent(username)}`;
export const playsPage = (username: string) =>
  `${SITE}/plays/bydate/user/${encodeURIComponent(username)}/subtype/boardgame`;
export const profilePage = (username: string) => `${SITE}/user/${encodeURIComponent(username)}`;

// ---------------------------------------------------------------------------
// Answers

/** BGG's `<errors><error><message>…` or `<error><message>…`, if the answer is one. */
export function errorMessage(root: Node): string | undefined {
  if (root.name === "errors" || root.name === "error") {
    return find(root, "message")[0]?.text.trim() || root.text.trim() || "BoardGameGeek reported an error";
  }
  if (root.name === "message") return root.text.trim();
  return undefined;
}

function checkError(root: Node): void {
  const message = errorMessage(root);
  if (message) throw new Error(`BoardGameGeek: ${message}`);
}

/** Descriptions are escaped twice (`&amp;#10;`): one more pass, then tidy paragraphs. */
export function cleanDescription(text: string): string {
  return decodeEntities(text)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function primaryName(item: Node): string {
  const names = all(item, "name");
  const primary = names.find((n) => n.attrs.type === "primary") ?? names[0];
  return primary?.attrs.value ?? primary?.text.trim() ?? "";
}

function links(item: Node, type: string): string[] {
  return all(item, "link").filter((l) => l.attrs.type === type).map((l) => l.attrs.value ?? "").filter(Boolean);
}

/** "Best with 4 players" from the poll summary, or computed from the votes. */
function playerPoll(item: Node): { best?: string; recommended?: string } {
  const summary = all(item, "poll-summary").find((p) => p.attrs.name === "suggested_numplayers");
  if (summary) {
    const results = all(summary, "result");
    const pick = (name: string) => results.find((r) => r.attrs.name === name)?.attrs.value?.trim() || undefined;
    return { best: pick("bestwith"), recommended: pick("recommmendedwith") ?? pick("recommendedwith") };
  }
  const poll = all(item, "poll").find((p) => p.attrs.name === "suggested_numplayers");
  if (!poll || !Number(poll.attrs.totalvotes)) return {};
  const best: string[] = [], recommended: string[] = [];
  for (const r of all(poll, "results")) {
    const votes = Object.fromEntries(all(r, "result").map((x) => [x.attrs.value, Number(x.attrs.numvotes ?? 0)]));
    const yes = (votes["Best"] ?? 0) + (votes["Recommended"] ?? 0);
    if (yes <= (votes["Not Recommended"] ?? 0)) continue;
    recommended.push(r.attrs.numplayers);
    if ((votes["Best"] ?? 0) >= (votes["Recommended"] ?? 0) && (votes["Best"] ?? 0) > (votes["Not Recommended"] ?? 0)) {
      best.push(r.attrs.numplayers);
    }
  }
  return {
    best: best.length ? `Best with ${best.join(", ")} players` : undefined,
    recommended: recommended.length ? `Recommended with ${recommended.join(", ")} players` : undefined,
  };
}

function ranks(node: Node | undefined): Rank[] {
  return find(node, "rank").map((r) => ({
    name: r.attrs.name ?? "",
    title: (r.attrs.friendlyname ?? r.attrs.name ?? "").replace(/ Rank$/, ""),
    rank: Number(r.attrs.value) || undefined,
  }));
}

/** The items of a `thing` answer. */
export function parseThings(xml: string): Game[] {
  const root = parseXml(xml);
  checkError(root);
  return all(root, "item").map((item): Game => {
    const ratings = child(child(item, "statistics"), "ratings");
    const poll = playerPoll(item);
    return {
      id: Number(item.attrs.id),
      type: item.attrs.type ?? "boardgame",
      name: primaryName(item),
      alternateNames: all(item, "name").filter((n) => n.attrs.type === "alternate").map((n) => n.attrs.value ?? ""),
      year: num(item, "yearpublished"),
      thumbnail: value(item, "thumbnail"),
      image: value(item, "image"),
      description: cleanDescription(child(item, "description")?.text ?? ""),
      minPlayers: num(item, "minplayers"),
      maxPlayers: num(item, "maxplayers"),
      bestWith: poll.best,
      recommendedWith: poll.recommended,
      minTime: num(item, "minplaytime") ?? num(item, "playingtime"),
      maxTime: num(item, "maxplaytime") ?? num(item, "playingtime"),
      minAge: num(item, "minage"),
      designers: links(item, "boardgamedesigner").filter((d) => d !== "(Uncredited)"),
      artists: links(item, "boardgameartist").filter((d) => d !== "(Uncredited)"),
      publishers: links(item, "boardgamepublisher"),
      categories: links(item, "boardgamecategory"),
      mechanics: links(item, "boardgamemechanic"),
      families: links(item, "boardgamefamily"),
      rating: num(ratings, "average"),
      bayesRating: num(ratings, "bayesaverage"),
      ratings: num(ratings, "usersrated"),
      weight: num(ratings, "averageweight"),
      weightVotes: num(ratings, "numweights"),
      owned: num(ratings, "owned"),
      wishing: num(ratings, "wishing"),
      ranks: ranks(child(ratings, "ranks")),
    };
  });
}

/** The hits of a `search` answer, without duplicates (a game and its expansion entry). */
export function parseSearch(xml: string): SearchHit[] {
  const root = parseXml(xml);
  checkError(root);
  const seen = new Set<number>();
  const hits: SearchHit[] = [];
  for (const item of all(root, "item")) {
    const id = Number(item.attrs.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    hits.push({ id, type: item.attrs.type ?? "boardgame", name: primaryName(item), year: num(item, "yearpublished") });
  }
  return hits;
}

/**
 * The hits worth fetching details for: exact names first, then names starting
 * with the query, then the rest in BGG's order.
 */
export function rankHits(hits: SearchHit[], query: string, limit = THING_BATCH): SearchHit[] {
  const q = normalize(query);
  const score = (h: SearchHit) => {
    const n = normalize(h.name);
    return (n === q ? 0 : n.startsWith(q) ? 1 : n.includes(q) ? 2 : 3) + (h.type === "boardgame" ? 0 : 0.5);
  };
  return hits.map((h, i) => ({ h, i, s: score(h) })).sort((a, b) => a.s - b.s || a.i - b.i).slice(0, limit).map((
    x,
  ) => x.h);
}

export function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/** Games in the order to show: exact name, then the most rated. */
export function sortGames(games: Game[], query: string): Game[] {
  const q = normalize(query);
  const exact = (g: Game) => normalize(g.name) === q || g.alternateNames.some((n) => normalize(n) === q) ? 0 : 1;
  return [...games].sort((a, b) => exact(a) - exact(b) || (b.ratings ?? 0) - (a.ratings ?? 0));
}

/** A `collection` answer. The 202 "please wait" answer is handled by the caller. */
export function parseCollection(xml: string): CollectionItem[] {
  const root = parseXml(xml);
  checkError(root);
  return all(root, "item").map((item): CollectionItem => {
    const stats = child(item, "stats");
    const rating = child(stats, "rating");
    const status = child(item, "status");
    const flags: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(status?.attrs ?? {})) if (v === "0" || v === "1") flags[k] = v === "1";
    const boardgameRank = ranks(child(rating, "ranks")).find((r) => r.name === "boardgame")?.rank;
    return {
      id: Number(item.attrs.objectid),
      collectionId: Number(item.attrs.collid) || undefined,
      subtype: item.attrs.subtype ?? "boardgame",
      name: child(item, "name")?.text.trim() ?? "",
      year: num(item, "yearpublished"),
      thumbnail: value(item, "thumbnail"),
      image: value(item, "image"),
      minPlayers: Number(stats?.attrs.minplayers) || undefined,
      maxPlayers: Number(stats?.attrs.maxplayers) || undefined,
      minTime: Number(stats?.attrs.minplaytime) || undefined,
      maxTime: Number(stats?.attrs.maxplaytime) || undefined,
      myRating: Number(rating?.attrs.value) || undefined,
      average: num(rating, "average"),
      rank: boardgameRank,
      plays: Number(value(item, "numplays") ?? 0) || 0,
      status: flags,
      wishlistPriority: Number(status?.attrs.wishlistpriority) || undefined,
      comment: child(item, "comment")?.text.trim() || undefined,
      modified: status?.attrs.lastmodified,
    };
  });
}

/** A `plays` answer. */
export function parsePlays(xml: string): Plays {
  const root = parseXml(xml);
  checkError(root);
  return {
    total: Number(root.attrs.total ?? 0) || 0,
    page: Number(root.attrs.page ?? 1) || 1,
    plays: all(root, "play").map((p): Play => {
      const item = child(p, "item");
      return {
        id: Number(p.attrs.id),
        date: p.attrs.date ?? "",
        quantity: Number(p.attrs.quantity ?? 1) || 1,
        length: Number(p.attrs.length) || undefined,
        location: p.attrs.location?.trim() || undefined,
        incomplete: p.attrs.incomplete === "1",
        gameId: Number(item?.attrs.objectid),
        game: item?.attrs.name ?? "",
        comments: cleanDescription(child(p, "comments")?.text ?? "") || undefined,
        players: find(child(p, "players"), "player").map((pl) => ({
          name: pl.attrs.name?.trim() || pl.attrs.username?.trim() || "Anonymous",
          username: pl.attrs.username?.trim() || undefined,
          score: pl.attrs.score?.trim() || undefined,
          win: pl.attrs.win === "1",
          isNew: pl.attrs.new === "1",
          color: pl.attrs.color?.trim() || undefined,
        })),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Wording

export function playersText(min?: number, max?: number): string | undefined {
  if (!min && !max) return undefined;
  if (!max || min === max) return `${min ?? max} player${(min ?? max) === 1 ? "" : "s"}`;
  if (!min) return `Up to ${max} players`;
  return `${min}–${max} players`;
}

export function timeText(min?: number, max?: number): string | undefined {
  if (!min && !max) return undefined;
  if (!max || !min || min === max) return `${min || max} min`;
  return `${min}–${max} min`;
}

/** BGG's weight scale, 1 to 5. */
export function weightText(weight?: number): string | undefined {
  if (!weight) return undefined;
  const word = weight < 1.5
    ? "Light"
    : weight < 2.5
    ? "Medium light"
    : weight < 3.5
    ? "Medium"
    : weight < 4.5
    ? "Medium heavy"
    : "Heavy";
  return `${weight.toFixed(2)} / 5 · ${word}`;
}

export type Tint = "green" | "teal" | "blue" | "purple" | "orange" | "red" | "gray";

/** BGG's colors for ratings: 8+ dark green, 7+ green, 5+ blue, below purple/red. */
export function ratingColor(rating?: number): Tint {
  if (!rating) return "gray";
  if (rating >= 8) return "green";
  if (rating >= 7) return "teal";
  if (rating >= 5) return "blue";
  if (rating >= 3) return "purple";
  return "red";
}

export const ratingText = (r?: number) => r ? r.toFixed(1) : undefined;

/** The overall board game rank, if ranked. */
export function overallRank(g: Pick<Game, "ranks">): number | undefined {
  return g.ranks.find((r) => r.name === "boardgame")?.rank;
}

export function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** The first paragraph(s) of a description, up to about `max` characters. */
export function excerpt(text: string, max = 400): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("\n"));
  return `${(end > max / 2 ? cut.slice(0, end + 1) : cut).trim()}…`;
}

/** "Alice 42 (won), Bob 38". */
export function playersLine(p: Play): string {
  return p.players.map((pl) => `${pl.name}${pl.score ? ` ${pl.score}` : ""}${pl.win ? " (won)" : ""}`).join(", ");
}

export function winners(p: Play): Player[] {
  return p.players.filter((pl) => pl.win);
}

/** Whether `username` won the play. */
export function iWon(p: Play, username: string): boolean | undefined {
  const me = p.players.find((pl) => pl.username?.toLowerCase() === username.toLowerCase());
  return me ? me.win : undefined;
}

export interface PlayStats {
  plays: number;
  games: number;
  wins: number;
  withMe: number;
  minutes: number;
  mostPlayed?: { game: string; plays: number };
}

export function playStats(plays: Play[], username: string): PlayStats {
  const counts = new Map<string, number>();
  let wins = 0, withMe = 0, minutes = 0, total = 0;
  for (const p of plays) {
    total += p.quantity;
    counts.set(p.game, (counts.get(p.game) ?? 0) + p.quantity);
    minutes += p.length ?? 0;
    const won = iWon(p, username);
    if (won !== undefined) {
      withMe++;
      if (won) wins++;
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return {
    plays: total,
    games: counts.size,
    wins,
    withMe,
    minutes,
    mostPlayed: top ? { game: top[0], plays: top[1] } : undefined,
  };
}

/** "Sun, Nov 1, 2026" from "2026-11-01". */
export function dateText(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return date;
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function cleanUsername(text: string): string {
  return text.trim().replace(/^@/, "");
}

/** The answer says the token is missing or refused. */
export function tokenRefused(status: number): boolean {
  return status === 401 || status === 403;
}
