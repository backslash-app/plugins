// CheapShark, Epic Games Store and GamerPower answers, the wishlist check and
// formatting. Pure, tested in lib_test.ts.

import type { Color } from "@backslash/api";

export const CHEAPSHARK = "https://www.cheapshark.com/api/1.0";

// ---------------------------------------------------------------------------
// CheapShark

/** A store of `/stores`. */
export interface Store {
  storeID: string;
  storeName: string;
  isActive: number;
  images?: { banner?: string; logo?: string; icon?: string };
}

/** A deal of `/deals` (CheapShark sends numbers as strings). */
export interface RawDeal {
  internalName?: string;
  title: string;
  metacriticLink?: string | null;
  dealID: string;
  storeID: string;
  gameID: string;
  salePrice: string;
  normalPrice: string;
  isOnSale?: string;
  savings: string;
  metacriticScore?: string;
  steamRatingText?: string | null;
  steamRatingPercent?: string;
  steamRatingCount?: string;
  steamAppID?: string | null;
  releaseDate?: number;
  lastChange?: number;
  dealRating?: string;
  thumb?: string;
}

export interface Deal {
  dealID: string;
  gameID: string;
  title: string;
  storeID: string;
  price: number;
  normal: number;
  /** 0 to 100. */
  savings: number;
  metacritic?: number;
  metacriticUrl?: string;
  steamRating?: { text: string; percent: number; count: number };
  steamAppID?: string;
  /** Milliseconds. */
  released?: number;
  changed?: number;
  /** CheapShark's 0–10 rating of how good the deal is. */
  rating?: number;
  thumb?: string;
}

const num = (s: unknown) => {
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};

export function fromDeal(r: RawDeal): Deal {
  const meta = num(r.metacriticScore);
  const percent = num(r.steamRatingPercent);
  return {
    dealID: r.dealID,
    gameID: r.gameID,
    title: r.title,
    storeID: r.storeID,
    price: num(r.salePrice) ?? 0,
    normal: num(r.normalPrice) ?? 0,
    savings: Math.round(num(r.savings) ?? 0),
    metacritic: meta ? meta : undefined,
    metacriticUrl: r.metacriticLink ? `https://www.metacritic.com${r.metacriticLink}` : undefined,
    steamRating: r.steamRatingText && percent
      ? { text: r.steamRatingText, percent, count: num(r.steamRatingCount) ?? 0 }
      : undefined,
    steamAppID: r.steamAppID || undefined,
    released: r.releaseDate ? r.releaseDate * 1000 : undefined,
    changed: r.lastChange ? r.lastChange * 1000 : undefined,
    rating: num(r.dealRating),
    thumb: r.thumb || undefined,
  };
}

/** The deal lists offered as chips. */
export type DealView = "top" | "recent" | "cheap" | "aaa" | "rated";

export const DEAL_VIEWS: { value: DealView; title: string }[] = [
  { value: "top", title: "Top Deals" },
  { value: "recent", title: "Newest" },
  { value: "cheap", title: "Under $5" },
  { value: "aaa", title: "AAA" },
  { value: "rated", title: "Best Reviewed" },
];

export function dealsUrl(
  view: DealView,
  o: { storeIDs?: string[]; maxPrice?: number; pageSize?: number } = {},
): string {
  const p = new URLSearchParams({ pageSize: String(o.pageSize ?? 60), onSale: "1" });
  if (o.storeIDs?.length) p.set("storeID", o.storeIDs.join(","));
  switch (view) {
    case "top":
      p.set("sortBy", "Deal Rating");
      break;
    case "recent":
      p.set("sortBy", "Recent");
      break;
    case "cheap":
      p.set("sortBy", "Deal Rating");
      p.set("upperPrice", "5");
      break;
    case "aaa":
      p.set("sortBy", "Deal Rating");
      p.set("AAA", "1");
      break;
    case "rated":
      p.set("sortBy", "Metacritic");
      p.set("metacritic", "80");
      break;
  }
  if (o.maxPrice && o.maxPrice > 0 && !(view === "cheap" && o.maxPrice > 5)) p.set("upperPrice", String(o.maxPrice));
  return `${CHEAPSHARK}/deals?${p}`;
}

/** The same game sold by several stores: its best deal only, the others counted. */
export function bestPerGame(deals: Deal[]): { deal: Deal; stores: number }[] {
  const by = new Map<string, { deal: Deal; stores: number }>();
  for (const d of deals) {
    const seen = by.get(d.gameID);
    if (!seen) by.set(d.gameID, { deal: d, stores: 1 });
    else {
      seen.stores++;
      if (d.price < seen.deal.price) seen.deal = d;
    }
  }
  return [...by.values()];
}

/** A game of `/games?title=`. */
export interface GameHit {
  gameID: string;
  steamAppID?: string | null;
  cheapest: string;
  cheapestDealID: string;
  external: string;
  internalName?: string;
  thumb?: string;
}

/** `/games?id=` and each value of `/games?ids=`. */
export interface GameInfo {
  info: { title: string; steamAppID?: string | null; thumb?: string };
  cheapestPriceEver?: { price: string; date: number };
  deals: { storeID: string; dealID: string; price: string; retailPrice: string; savings: string }[];
}

export interface Offer {
  storeID: string;
  dealID: string;
  price: number;
  retail: number;
  savings: number;
}

/** The stores' offers for a game, cheapest first. */
export function offers(g: GameInfo): Offer[] {
  return (g.deals ?? []).map((d) => ({
    storeID: d.storeID,
    dealID: d.dealID,
    price: num(d.price) ?? 0,
    retail: num(d.retailPrice) ?? 0,
    savings: Math.round(num(d.savings) ?? 0),
  })).sort((a, b) => a.price - b.price || b.savings - a.savings);
}

export const searchUrl = (title: string) => `${CHEAPSHARK}/games?${new URLSearchParams({ title, limit: "40" })}`;
export const gameUrl = (id: string) => `${CHEAPSHARK}/games?id=${encodeURIComponent(id)}`;
/** At most 25 ids per request. */
export const gamesUrl = (ids: string[]) => `${CHEAPSHARK}/games?ids=${ids.map(encodeURIComponent).join(",")}`;
/** CheapShark sends the buyer to the store from here (it is how the service is funded). */
export const dealLink = (dealID: string) => `https://www.cheapshark.com/redirect?dealID=${encodeURIComponent(dealID)}`;
export const steamUrl = (appID: string) => `https://store.steampowered.com/app/${appID}`;
export const steamHeader = (appID: string) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${appID}/header.jpg`;
export const storeIcon = (storeID: string) => `https://www.cheapshark.com/img/stores/icons/${Number(storeID) - 1}.png`;

/** The `stores` preference ("Steam, GOG") as CheapShark store ids; unknown names are reported. */
export function storeIDs(input: unknown, stores: Store[]): { ids: string[]; unknown: string[] } {
  const names = String(input ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const store = stores.find((s) => key(s.storeName) === key(n)) ??
      stores.find((s) => key(s.storeName).startsWith(key(n)));
    if (store) ids.push(store.storeID);
    else unknown.push(n);
  }
  return { ids: [...new Set(ids)], unknown };
}

// ---------------------------------------------------------------------------
// Epic Games Store

export interface EpicElement {
  title: string;
  id: string;
  namespace?: string;
  description?: string;
  offerType?: string;
  effectiveDate?: string;
  seller?: { name?: string };
  keyImages?: { type: string; url: string }[];
  productSlug?: string | null;
  urlSlug?: string | null;
  catalogNs?: { mappings?: { pageSlug: string; pageType: string }[] | null };
  offerMappings?: { pageSlug: string; pageType: string }[] | null;
  price?: { totalPrice?: { discountPrice?: number; originalPrice?: number; fmtPrice?: { originalPrice?: string } } };
  promotions?: {
    promotionalOffers?: { promotionalOffers?: EpicOffer[] }[];
    upcomingPromotionalOffers?: { promotionalOffers?: EpicOffer[] }[];
  } | null;
}

interface EpicOffer {
  startDate: string;
  endDate: string;
  discountSetting?: { discountType?: string; discountPercentage?: number };
}

export interface FreeGame {
  id: string;
  title: string;
  description?: string;
  seller?: string;
  image?: string;
  thumb?: string;
  url: string;
  /** "$29.99" when Epic says it. */
  worth?: string;
  start: number;
  end: number;
}

export const EPIC_URL =
  "https://store-site-backend-static.ak.epicgames.com/freeGamesPromotions?locale=en-US&country=US&allowCountries=US";

const isFree = (o: EpicOffer) => o.discountSetting?.discountPercentage === 0;

function epicSlug(e: EpicElement): string | undefined {
  const page =
    [...(e.catalogNs?.mappings ?? []), ...(e.offerMappings ?? [])].find((m) => m.pageType === "productHome") ??
      e.catalogNs?.mappings?.[0] ?? e.offerMappings?.[0];
  const slug = page?.pageSlug || e.productSlug || e.urlSlug;
  return slug && slug !== "[]" ? slug.replace(/\/home$/, "") : undefined;
}

/** The games free now and those announced, from `freeGamesPromotions`. */
export function epicFree(json: any, now = Date.now()): { now: FreeGame[]; upcoming: FreeGame[] } {
  const elements: EpicElement[] = json?.data?.Catalog?.searchStore?.elements ?? [];
  const out = { now: [] as FreeGame[], upcoming: [] as FreeGame[] };
  for (const e of elements) {
    const current = e.promotions?.promotionalOffers?.flatMap((p) => p.promotionalOffers ?? []).find(isFree);
    const next = e.promotions?.upcomingPromotionalOffers?.flatMap((p) => p.promotionalOffers ?? []).find(isFree);
    const offer = current ?? next;
    if (!offer) continue;
    const start = Date.parse(offer.startDate), end = Date.parse(offer.endDate);
    const slug = epicSlug(e);
    const image = (t: string) => e.keyImages?.find((k) => k.type === t)?.url;
    const game: FreeGame = {
      id: `epic:${e.id}`,
      title: e.title,
      description: e.description && e.description !== e.title ? e.description : undefined,
      seller: e.seller?.name && e.seller.name !== "Epic Dev Test Account" ? e.seller.name : undefined,
      image: image("OfferImageWide") ?? image("DieselStoreFrontWide") ?? image("featuredMedia") ?? image("Thumbnail"),
      thumb: image("Thumbnail") ?? image("OfferImageTall") ?? image("DieselStoreFrontTall"),
      url: slug ? `https://store.epicgames.com/en-US/p/${slug}` : "https://store.epicgames.com/en-US/free-games",
      worth: e.price?.totalPrice?.originalPrice ? e.price.totalPrice.fmtPrice?.originalPrice : undefined,
      start,
      end,
    };
    if (current && start <= now && end > now) out.now.push(game);
    else if (start > now) out.upcoming.push(game);
  }
  out.upcoming.sort((a, b) => a.start - b.start);
  return out;
}

// ---------------------------------------------------------------------------
// GamerPower

export interface Giveaway {
  id: number;
  title: string;
  worth?: string;
  thumbnail?: string;
  image?: string;
  description?: string;
  instructions?: string;
  open_giveaway_url?: string;
  gamerpower_url?: string;
  published_date?: string;
  type?: string;
  platforms?: string;
  end_date?: string;
  users?: number;
  status?: string;
}

export const GAMERPOWER = "https://www.gamerpower.com/api/giveaways";

export function giveawaysUrl(platform: string, type: "game" | "loot" | "beta" | "all" = "game"): string {
  const p = new URLSearchParams({ "sort-by": "date" });
  if (platform && platform !== "all") p.set("platform", platform);
  if (type !== "all") p.set("type", type);
  return `${GAMERPOWER}?${p}`;
}

/** GamerPower dates are "2026-10-30 23:59:00" (UTC); "N/A" means no end. */
export function gpDate(s: string | undefined): number | undefined {
  if (!s || s === "N/A") return undefined;
  const t = Date.parse(`${s.replace(" ", "T")}Z`);
  return Number.isFinite(t) ? t : undefined;
}

/** A list answer, or [] when GamerPower says there is none (it answers 201 with an object then). */
export function parseGiveaways(json: unknown, now = Date.now()): Giveaway[] {
  if (!Array.isArray(json)) return [];
  return (json as Giveaway[]).filter((g) => {
    if (g.status && g.status !== "Active") return false;
    const end = gpDate(g.end_date);
    return end === undefined || end > now;
  });
}

const norm = (s: string) =>
  s.toLowerCase().replace(/\((?:epic games|steam|gog|pc)[^)]*\)|giveaway|free|key/g, "").replace(/[^a-z0-9]/g, "");

/** Giveaways that aren't one of Epic's free games already listed. */
export function withoutEpic(giveaways: Giveaway[], epic: FreeGame[]): Giveaway[] {
  const titles = new Set(epic.map((g) => norm(g.title)));
  return giveaways.filter((g) => !titles.has(norm(g.title)));
}

// ---------------------------------------------------------------------------
// Wishlist

export interface WishEntry {
  gameID: string;
  title: string;
  steamAppID?: string;
  thumb?: string;
  /** Dollars; 0 means "tell me about any sale". */
  target: number;
  added: number;
  /** The best price at the last check. */
  last?: { price: number; retail: number; storeID: string; dealID: string; at: number };
  lowest?: { price: number; date: number };
  /** The price already notified, so the same deal isn't announced twice. */
  alerted?: number;
}

export interface WishHit {
  entry: WishEntry;
  offer: Offer;
}

/** Whether an offer is what the user waits for. */
export const meetsTarget = (e: Pick<WishEntry, "target">, o: Pick<Offer, "price" | "savings">) =>
  e.target > 0 ? o.price <= e.target + 1e-9 : o.savings > 0;

/**
 * Applies the prices of a check: updates each entry's last price and lists
 * those newly at or below their target. A deal is announced once; it is
 * announced again only when the price drops further, or after going back up.
 */
export function applyCheck(
  entries: WishEntry[],
  infos: Record<string, GameInfo | undefined>,
  now = Date.now(),
): { entries: WishEntry[]; hits: WishHit[] } {
  const hits: WishHit[] = [];
  const updated = entries.map((e) => {
    const info = infos[e.gameID];
    if (!info) return e;
    const best = offers(info)[0];
    const lowest = info.cheapestPriceEver
      ? { price: num(info.cheapestPriceEver.price) ?? 0, date: info.cheapestPriceEver.date * 1000 }
      : e.lowest;
    if (!best) return { ...e, last: undefined, lowest, alerted: undefined };
    const next: WishEntry = {
      ...e,
      lowest,
      last: { price: best.price, retail: best.retail, storeID: best.storeID, dealID: best.dealID, at: now },
    };
    if (meetsTarget(e, best)) {
      if (e.alerted === undefined || best.price < e.alerted - 1e-9) {
        hits.push({ entry: next, offer: best });
        next.alerted = best.price;
      }
    } else next.alerted = undefined;
    return next;
  });
  return { entries: updated, hits };
}

/** The `target` typed in the form: "9.99", "$10", "10,50"; empty is 0 (any sale). */
export function parsePrice(input: unknown): number | undefined {
  const s = String(input ?? "").trim().replace(/^\$/, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
}

// ---------------------------------------------------------------------------
// Formatting

/** 4.99 → "$4.99"; 0 → "Free". */
export const price = (n: number) => (n <= 0 ? "Free" : `$${n.toFixed(2)}`);

export function savingsColor(savings: number): Color {
  if (savings >= 75) return "green";
  if (savings >= 50) return "teal";
  if (savings >= 25) return "blue";
  return "gray";
}

export function metacriticColor(score: number): Color {
  if (score >= 75) return "green";
  if (score >= 50) return "yellow";
  return "red";
}

export function steamColor(percent: number): Color {
  if (percent >= 80) return "green";
  if (percent >= 60) return "teal";
  if (percent >= 40) return "yellow";
  return "red";
}

/** Time left in an offer: "2 d 4 h", "5 h", "40 min". */
export function timeLeft(end: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((end - now) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h`;
  return `${Math.floor(h / 24)} d${h % 24 ? ` ${h % 24} h` : ""}`;
}

export function shortDate(ms: number, now = Date.now()): string {
  const sameYear = new Date(ms).getFullYear() === new Date(now).getFullYear();
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Markdown for the HTML-free descriptions of GamerPower (line breaks kept). */
export const paragraphs = (s: string | undefined) =>
  (s ?? "").replace(/\r/g, "").split(/\n+/).map((l) => l.trim()).filter(Boolean).join("\n\n");
