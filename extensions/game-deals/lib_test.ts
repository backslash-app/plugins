import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  applyCheck,
  bestPerGame,
  dealsUrl,
  epicFree,
  fromDeal,
  type GameInfo,
  gamesUrl,
  type Giveaway,
  giveawaysUrl,
  gpDate,
  meetsTarget,
  metacriticColor,
  offers,
  parseGiveaways,
  parsePrice,
  price,
  type RawDeal,
  savingsColor,
  type Store,
  storeIDs,
  timeLeft,
  type WishEntry,
  withoutEpic,
} from "./lib.ts";
import { dealItem, epicItem, giveawayItem, wishItem } from "./views.ts";

// Shaped like CheapShark's /deals.
const RAW: RawDeal = {
  internalName: "HOLLOWKNIGHT",
  title: "Hollow Knight",
  metacriticLink: "/game/hollow-knight/",
  dealID: "abc%3D",
  storeID: "1",
  gameID: "146966",
  salePrice: "7.49",
  normalPrice: "14.99",
  isOnSale: "1",
  savings: "50.033356",
  metacriticScore: "87",
  steamRatingText: "Overwhelmingly Positive",
  steamRatingPercent: "97",
  steamRatingCount: "312345",
  steamAppID: "367520",
  releaseDate: 1487894400,
  lastChange: 1761700000,
  dealRating: "9.6",
  thumb: "https://cdn.cloudflare.steamstatic.com/steam/apps/367520/capsule_sm_120.jpg",
};

const STORES: Store[] = [
  { storeID: "1", storeName: "Steam", isActive: 1, images: { icon: "/img/stores/icons/0.png" } },
  { storeID: "7", storeName: "GOG", isActive: 1, images: { icon: "/img/stores/icons/6.png" } },
  { storeID: "11", storeName: "Humble Store", isActive: 1 },
  { storeID: "15", storeName: "Fanatical", isActive: 1 },
];

Deno.test("deals: numbers, links and ratings", () => {
  const d = fromDeal(RAW);
  assertEquals(d.price, 7.49);
  assertEquals(d.normal, 14.99);
  assertEquals(d.savings, 50);
  assertEquals(d.metacritic, 87);
  assertEquals(d.metacriticUrl, "https://www.metacritic.com/game/hollow-knight/");
  assertEquals(d.steamRating, { text: "Overwhelmingly Positive", percent: 97, count: 312345 });
  assertEquals(d.released, 1487894400000);
  assertEquals(d.rating, 9.6);
  const none = fromDeal({
    ...RAW,
    metacriticScore: "0",
    steamRatingText: null,
    steamRatingPercent: "0",
    steamAppID: null,
  });
  assertEquals(none.metacritic, undefined);
  assertEquals(none.steamRating, undefined);
  assertEquals(none.steamAppID, undefined);
});

Deno.test("deal list addresses", () => {
  const top = new URL(dealsUrl("top", { storeIDs: ["1", "7"] }));
  assertEquals(top.searchParams.get("sortBy"), "Deal Rating");
  assertEquals(top.searchParams.get("storeID"), "1,7");
  assertEquals(top.searchParams.get("onSale"), "1");
  assertEquals(new URL(dealsUrl("cheap")).searchParams.get("upperPrice"), "5");
  assertEquals(new URL(dealsUrl("cheap", { maxPrice: 20 })).searchParams.get("upperPrice"), "5");
  assertEquals(new URL(dealsUrl("aaa", { maxPrice: 20 })).searchParams.get("upperPrice"), "20");
  assertEquals(new URL(dealsUrl("aaa")).searchParams.get("AAA"), "1");
  assertEquals(new URL(dealsUrl("rated")).searchParams.get("metacritic"), "80");
  assertEquals(new URL(dealsUrl("recent")).searchParams.get("sortBy"), "Recent");
  assertEquals(gamesUrl(["1", "2"]), "https://www.cheapshark.com/api/1.0/games?ids=1,2");
});

Deno.test("one row per game, its cheapest store", () => {
  const a = fromDeal(RAW);
  const b = fromDeal({ ...RAW, dealID: "b", storeID: "7", salePrice: "6.99" });
  const c = fromDeal({ ...RAW, dealID: "c", gameID: "2", title: "Celeste" });
  const out = bestPerGame([a, b, c]);
  assertEquals(out.map((o) => [o.deal.dealID, o.stores]), [["b", 2], ["c", 1]]);
});

Deno.test("store preference", () => {
  assertEquals(storeIDs("steam, gog, Humble", STORES), { ids: ["1", "7", "11"], unknown: [] });
  assertEquals(storeIDs("Steam, Nope", STORES), { ids: ["1"], unknown: ["Nope"] });
  assertEquals(storeIDs("", STORES), { ids: [], unknown: [] });
});

const INFO: GameInfo = {
  info: { title: "Hollow Knight", steamAppID: "367520", thumb: "" },
  cheapestPriceEver: { price: "4.94", date: 1700000000 },
  deals: [
    { storeID: "1", dealID: "s", price: "7.49", retailPrice: "14.99", savings: "50.03" },
    { storeID: "7", dealID: "g", price: "6.99", retailPrice: "14.99", savings: "53.37" },
    { storeID: "11", dealID: "h", price: "14.99", retailPrice: "14.99", savings: "0" },
  ],
};

Deno.test("offers of a game, cheapest first", () => {
  assertEquals(offers(INFO).map((o) => [o.dealID, o.price, o.savings]), [["g", 6.99, 53], ["s", 7.49, 50], [
    "h",
    14.99,
    0,
  ]]);
});

const entry = (o: Partial<WishEntry> = {}): WishEntry => ({
  gameID: "146966",
  title: "Hollow Knight",
  target: 8,
  added: 0,
  ...o,
});

Deno.test("wishlist check: announced once, again when cheaper, re-armed when the price goes up", () => {
  const first = applyCheck([entry()], { "146966": INFO }, 1000);
  assertEquals(first.hits.length, 1);
  assertEquals(first.hits[0].offer.dealID, "g");
  assertEquals(first.entries[0].alerted, 6.99);
  assertEquals(first.entries[0].last, { price: 6.99, retail: 14.99, storeID: "7", dealID: "g", at: 1000 });
  assertEquals(first.entries[0].lowest, { price: 4.94, date: 1700000000000 });

  const again = applyCheck(first.entries, { "146966": INFO });
  assertEquals(again.hits.length, 0);

  const cheaper = { ...INFO, deals: [{ ...INFO.deals[1], price: "4.99", savings: "66.7" }] };
  assertEquals(applyCheck(again.entries, { "146966": cheaper }).hits.length, 1);

  const up = { ...INFO, deals: [{ ...INFO.deals[2] }] };
  const rearmed = applyCheck(again.entries, { "146966": up });
  assertEquals(rearmed.hits.length, 0);
  assertEquals(rearmed.entries[0].alerted, undefined);
  assertEquals(applyCheck(rearmed.entries, { "146966": INFO }).hits.length, 1);

  // A game CheapShark didn't answer for is left as it was.
  assertEquals(applyCheck([entry()], {}).entries[0], entry());
});

Deno.test("target 0 means any sale", () => {
  assertEquals(meetsTarget({ target: 0 }, { price: 14.99, savings: 0 }), false);
  assertEquals(meetsTarget({ target: 0 }, { price: 9.99, savings: 33 }), true);
  assertEquals(meetsTarget({ target: 10 }, { price: 10, savings: 0 }), true);
  assertEquals(meetsTarget({ target: 10 }, { price: 10.01, savings: 50 }), false);
});

Deno.test("prices typed in the form", () => {
  assertEquals(parsePrice("9.99"), 9.99);
  assertEquals(parsePrice("$10"), 10);
  assertEquals(parsePrice("10,5"), 10.5);
  assertEquals(parsePrice(""), 0);
  assertEquals(parsePrice("cheap"), undefined);
  assertEquals(parsePrice("-3"), undefined);
});

// Shaped like freeGamesPromotions.
const EPIC = {
  data: {
    Catalog: {
      searchStore: {
        elements: [
          {
            title: "Mystery Game",
            id: "m1",
            description: "Mystery Game",
            keyImages: [{ type: "VaultClosed", url: "https://cdn1.epicgames.com/vault.png" }],
            promotions: null,
          },
          {
            title: "Free Now Game",
            id: "f1",
            description: "A great game.",
            seller: { name: "Studio" },
            keyImages: [
              { type: "OfferImageWide", url: "https://cdn1.epicgames.com/wide.jpg" },
              { type: "Thumbnail", url: "https://cdn1.epicgames.com/thumb.jpg" },
            ],
            productSlug: null,
            catalogNs: { mappings: [{ pageSlug: "free-now-game-0a1b2c", pageType: "productHome" }] },
            price: { totalPrice: { discountPrice: 0, originalPrice: 2499, fmtPrice: { originalPrice: "$24.99" } } },
            promotions: {
              promotionalOffers: [{
                promotionalOffers: [{
                  startDate: "2026-10-23T15:00:00.000Z",
                  endDate: "2026-10-30T15:00:00.000Z",
                  discountSetting: { discountType: "PERCENTAGE", discountPercentage: 0 },
                }],
              }],
              upcomingPromotionalOffers: [],
            },
          },
          {
            title: "Half Price Game",
            id: "h1",
            promotions: {
              promotionalOffers: [{
                promotionalOffers: [{
                  startDate: "2026-10-23T15:00:00.000Z",
                  endDate: "2026-10-30T15:00:00.000Z",
                  discountSetting: { discountType: "PERCENTAGE", discountPercentage: 50 },
                }],
              }],
            },
          },
          {
            title: "Next Week Game",
            id: "n1",
            productSlug: "next-week-game/home",
            promotions: {
              promotionalOffers: [],
              upcomingPromotionalOffers: [{
                promotionalOffers: [{
                  startDate: "2026-10-30T15:00:00.000Z",
                  endDate: "2026-11-06T15:00:00.000Z",
                  discountSetting: { discountType: "PERCENTAGE", discountPercentage: 0 },
                }],
              }],
            },
          },
        ],
      },
    },
  },
};

const NOW = Date.parse("2026-10-29T12:00:00Z");

Deno.test("Epic: free now and coming soon; discounts and mystery games skipped", () => {
  const free = epicFree(EPIC, NOW);
  assertEquals(free.now.map((g) => g.title), ["Free Now Game"]);
  assertEquals(free.upcoming.map((g) => g.title), ["Next Week Game"]);
  const g = free.now[0];
  assertEquals(g.url, "https://store.epicgames.com/en-US/p/free-now-game-0a1b2c");
  assertEquals(g.image, "https://cdn1.epicgames.com/wide.jpg");
  assertEquals(g.thumb, "https://cdn1.epicgames.com/thumb.jpg");
  assertEquals(g.worth, "$24.99");
  assertEquals(g.seller, "Studio");
  assertEquals(free.upcoming[0].url, "https://store.epicgames.com/en-US/p/next-week-game");
  assertEquals(epicFree({}, NOW), { now: [], upcoming: [] });
});

const GIVEAWAYS: Giveaway[] = [
  {
    id: 1,
    title: "Free Now Game (Epic Games) Giveaway",
    worth: "$24.99",
    end_date: "2026-10-30 15:00:00",
    status: "Active",
    platforms: "PC, Epic Games Store",
    type: "Game",
  },
  {
    id: 2,
    title: "Indie Gem (Steam) Giveaway",
    worth: "N/A",
    end_date: "N/A",
    status: "Active",
    platforms: "PC, Steam",
    type: "Game",
    open_giveaway_url: "https://www.gamerpower.com/open/indie-gem",
    users: 1234,
  },
  { id: 3, title: "Ended", end_date: "2026-10-01 00:00:00", status: "Active" },
  { id: 4, title: "Expired", status: "Expired" },
];

Deno.test("GamerPower: active giveaways, minus Epic's own", () => {
  assertEquals(gpDate("2026-10-30 15:00:00"), Date.parse("2026-10-30T15:00:00Z"));
  assertEquals(gpDate("N/A"), undefined);
  const active = parseGiveaways(GIVEAWAYS, NOW);
  assertEquals(active.map((g) => g.id), [1, 2]);
  assertEquals(parseGiveaways({ status: 0, status_message: "No active giveaways available at the moment." }), []);
  const epic = epicFree(EPIC, NOW);
  assertEquals(withoutEpic(active, epic.now).map((g) => g.id), [2]);
  const url = new URL(giveawaysUrl("steam"));
  assertEquals(url.searchParams.get("platform"), "steam");
  assertEquals(url.searchParams.get("type"), "game");
  assertEquals(new URL(giveawaysUrl("all")).searchParams.has("platform"), false);
});

Deno.test("formatting", () => {
  assertEquals(price(4.5), "$4.50");
  assertEquals(price(0), "Free");
  assertEquals(savingsColor(80), "green");
  assertEquals(savingsColor(10), "gray");
  assertEquals(metacriticColor(87), "green");
  assertEquals(metacriticColor(40), "red");
  assertEquals(timeLeft(NOW + 40 * 60_000, NOW), "40 min");
  assertEquals(timeLeft(NOW + 5 * 3_600_000, NOW), "5 h");
  assertEquals(timeLeft(NOW + 52 * 3_600_000, NOW), "2 d 4 h");
  assertEquals(timeLeft(NOW + 48 * 3_600_000, NOW), "2 d");
});

Deno.test("items", () => {
  const stores = new Map(STORES.map((s) => [s.storeID, s]));
  const deal = dealItem(fromDeal(RAW), stores, { wished: new Set(), otherStores: 3 });
  assertEquals(deal.title, "Hollow Knight");
  assertEquals(deal.subtitle, "Steam · 3 stores · was $14.99");
  assertEquals(deal.icon, "https://www.cheapshark.com/img/stores/icons/0.png");
  assertEquals(deal.detail?.image, "https://cdn.cloudflare.steamstatic.com/steam/apps/367520/header.jpg");
  assertEquals(deal.actions?.map((a) => a.title).slice(0, 3), ["Buy on Steam", "Compare Stores", "Add to Wishlist…"]);
  const wished = dealItem(fromDeal(RAW), stores, { wished: new Set(["146966"]) });
  assertEquals(wished.actions?.some((a) => a.title === "Add to Wishlist…"), false);

  const checked = applyCheck([entry()], { "146966": INFO }).entries[0];
  const w = wishItem(checked, stores, new Set());
  assertEquals(w.section, "At Your Price");
  assertEquals(w.subtitle, "$6.99 at GOG · target below $8.00");
  const remove = w.actions?.find((a) => a.title === "Remove from Wishlist");
  assertEquals(remove?.destructive, true);
  assertStringIncludes(remove?.confirm ?? "", "Hollow Knight");
  assertEquals(wishItem(entry(), stores, new Set()).section, "Waiting");

  const free = epicFree(EPIC, NOW);
  const e = epicItem(free.now[0], { claimed: false }, NOW);
  assertEquals(e.section, "Free Now on Epic");
  assertEquals(e.accessories?.[1].tag, "1 d 3 h left");
  assertEquals(epicItem(free.now[0], { claimed: true }, NOW).section, "Claimed");
  assertEquals(epicItem(free.upcoming[0], { upcoming: true, claimed: false }, NOW).section, "Coming Soon on Epic");

  const g = giveawayItem(GIVEAWAYS[1], { claimed: false }, NOW);
  assertEquals(g.title, "Indie Gem (Steam)");
  assertEquals(g.actions?.[0].title, "Get It");
});
