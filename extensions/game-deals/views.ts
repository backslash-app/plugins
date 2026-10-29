// Deals, games, free games and the wishlist as launcher items and views.

import {
  type Accessory,
  type Action,
  action,
  copy,
  field,
  form,
  type FormSpec,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { addWish, game, removeWish, toggleClaimed } from "./api.ts";
import {
  type Deal,
  dealLink,
  type FreeGame,
  type GameHit,
  type Giveaway,
  gpDate,
  metacriticColor,
  offers,
  paragraphs,
  parsePrice,
  price,
  savingsColor,
  shortDate,
  steamColor,
  steamHeader,
  steamUrl,
  type Store,
  timeLeft,
  type WishEntry,
} from "./lib.ts";

export type Stores = Map<string, Store>;

const storeName = (stores: Stores, id: string) => stores.get(id)?.storeName ?? `Store ${id}`;
const storeIconUrl = (stores: Stores, id: string) => {
  const icon = stores.get(id)?.images?.icon;
  return icon ? `https://www.cheapshark.com${icon}` : undefined;
};

/** The game's own picture: Steam's header when it is on Steam, else the store's thumbnail. */
const picture = (o: { steamAppID?: string | null; thumb?: string }) =>
  o.steamAppID ? steamHeader(o.steamAppID) : o.thumb;

// ---------------------------------------------------------------------------
// Wishlist form

export function wishForm(
  g: { gameID: string; title: string; steamAppID?: string; thumb?: string; price?: number },
  done: () => unknown = () => pop(),
): FormSpec {
  const suggestion = g.price && g.price > 1 ? (Math.floor(g.price * 0.75 * 100) / 100).toFixed(2) : "";
  return form({
    title: `Watch ${g.title}`,
    submitTitle: "Add to Wishlist",
    fields: [
      field.text("target", "Target price (USD)", {
        placeholder: "Notify me at or below this price; empty: any sale",
        value: suggestion,
      }),
    ],
    async submit(values) {
      const target = parsePrice(values.target);
      if (target === undefined) {
        await toast("Type a price such as 9.99, or leave it empty", { style: "failure" });
        return;
      }
      await addWish({
        gameID: g.gameID,
        title: g.title,
        steamAppID: g.steamAppID,
        thumb: g.thumb,
        target,
        added: Date.now(),
      });
      await toast(target ? `Watching ${g.title} below ${price(target)}` : `Watching ${g.title} for any sale`, {
        style: "success",
      });
      return done() as never;
    },
  });
}

// ---------------------------------------------------------------------------
// One game's offers in every store

export function offersView(
  g: { gameID: string; title: string; steamAppID?: string | null; thumb?: string },
  stores: Stores,
  wished: Set<string>,
): ListSpec {
  return list({
    title: g.title,
    placeholder: `Stores selling ${g.title}…`,
    empty: { title: "No store sells it right now", icon: Icons.coin },
    async items({ signal }) {
      const info = await game(g.gameID, signal);
      const all = offers(info);
      const lowest = info.cheapestPriceEver;
      const steamAppID = info.info.steamAppID ?? g.steamAppID ?? undefined;
      return all.map((o, i): Item => ({
        id: o.dealID,
        title: storeName(stores, o.storeID),
        icon: storeIconUrl(stores, o.storeID) ?? { source: Icons.coin, tint: "green" },
        section: i === 0 ? "Cheapest" : "Other Stores",
        accessories: [
          ...(o.savings > 0 ? [{ tag: `-${o.savings}%`, color: savingsColor(o.savings) }] : []),
          ...(o.savings > 0 ? [{ text: price(o.retail), tooltip: "Normal price" }] : []),
          { text: price(o.price), color: o.savings > 0 ? "green" as const : undefined },
        ],
        detail: {
          image: picture({ steamAppID, thumb: info.info.thumb }),
          stats: [
            { label: "Price", value: price(o.price), color: o.savings > 0 ? "green" : undefined },
            { label: "Saving", value: `${o.savings}%` },
            ...(lowest ? [{ label: "Lowest Ever", value: price(Number(lowest.price)) }] : []),
          ],
          metadata: [
            meta.text("Store", storeName(stores, o.storeID), { icon: Icons.coin }),
            meta.text("Normal price", price(o.retail)),
            ...(lowest
              ? [meta.text("Lowest ever", `${price(Number(lowest.price))} on ${shortDate(lowest.date * 1000)}`)]
              : []),
          ],
        },
        actions: [
          open(dealLink(o.dealID), `Buy on ${storeName(stores, o.storeID)}`, { icon: Icons.external }),
          ...(wished.has(g.gameID) ? [] : [
            action("Add to Wishlist…", () =>
              wishForm({
                gameID: g.gameID,
                title: info.info.title,
                steamAppID: steamAppID ?? undefined,
                thumb: info.info.thumb,
                price: all[0]?.price,
              }), { icon: Icons.heart, shortcut: "<Ctrl>w" }),
          ]),
          ...(steamAppID ? [open(steamUrl(steamAppID), "Open on Steam", { shortcut: "<Ctrl>o" })] : []),
          copy(dealLink(o.dealID), "Copy Deal Link", { icon: Icons.link }),
        ],
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Deals

function dealMetadata(d: Deal, stores: Stores): Metadata[] {
  const lines: Metadata[] = [
    meta.text("Store", storeName(stores, d.storeID), { icon: Icons.coin }),
    meta.text("Normal price", price(d.normal)),
  ];
  if (d.metacritic) {
    lines.push(
      d.metacriticUrl
        ? { ...meta.link("Metacritic", `${d.metacritic} / 100`, d.metacriticUrl), color: metacriticColor(d.metacritic) }
        : meta.text("Metacritic", `${d.metacritic} / 100`, { color: metacriticColor(d.metacritic) }),
    );
  }
  if (d.steamRating) {
    lines.push(meta.text("Steam reviews", `${d.steamRating.text} · ${d.steamRating.percent}%`, {
      icon: Icons.person,
      color: steamColor(d.steamRating.percent),
    }));
    lines.push(meta.text("Reviews", d.steamRating.count.toLocaleString("en")));
  }
  if (d.rating !== undefined) lines.push(meta.progress("Deal rating", d.rating / 10, `${d.rating.toFixed(1)} / 10`));
  if (d.released) lines.push(meta.text("Released", shortDate(d.released), { icon: Icons.calendar }));
  if (d.changed) lines.push(meta.text("Price since", shortDate(d.changed), { icon: Icons.clock }));
  return lines;
}

export function dealItem(d: Deal, stores: Stores, o: { wished: Set<string>; otherStores?: number }): Item {
  const store = storeName(stores, d.storeID);
  const accessories: Accessory[] = [
    ...(d.metacritic
      ? [{ text: String(d.metacritic), color: metacriticColor(d.metacritic), tooltip: "Metacritic" }]
      : []),
    { tag: `-${d.savings}%`, color: savingsColor(d.savings) },
    { text: price(d.price), color: "green" },
  ];
  return {
    id: d.dealID,
    title: d.title,
    subtitle: `${store}${o.otherStores && o.otherStores > 1 ? ` · ${o.otherStores} stores` : ""} · was ${
      price(d.normal)
    }`,
    icon: storeIconUrl(stores, d.storeID) ?? { source: Icons.gamepad, tint: "purple" },
    keywords: [store, ...(d.steamRating ? [d.steamRating.text] : [])],
    accessories,
    detail: {
      image: picture(d),
      stats: [
        { label: "Price", value: price(d.price), color: "green" },
        { label: "Saving", value: `${d.savings}%`, color: savingsColor(d.savings) },
        ...(d.metacritic ? [{ label: "Metacritic", value: d.metacritic, color: metacriticColor(d.metacritic) }] : []),
      ],
      metadata: dealMetadata(d, stores),
    },
    actions: [
      open(dealLink(d.dealID), `Buy on ${store}`, { icon: Icons.external }),
      action("Compare Stores", () => offersView(d, stores, o.wished), { icon: Icons.coin }),
      ...(o.wished.has(d.gameID) ? [] : [
        action("Add to Wishlist…", () =>
          wishForm({
            gameID: d.gameID,
            title: d.title,
            steamAppID: d.steamAppID,
            thumb: d.thumb,
            price: d.price,
          }), { icon: Icons.heart, shortcut: "<Ctrl>w" }),
      ]),
      ...(d.steamAppID ? [open(steamUrl(d.steamAppID), "Open on Steam", { shortcut: "<Ctrl>o" })] : []),
      ...(d.metacriticUrl ? [open(d.metacriticUrl, "Open on Metacritic", { icon: Icons.star })] : []),
      copy(dealLink(d.dealID), "Copy Deal Link", { icon: Icons.link, shortcut: "<Ctrl>l" }),
    ],
  };
}

/** A game found by title: its cheapest price, Enter compares stores. */
export function hitItem(h: GameHit, stores: Stores, wished: Set<string>): Item {
  const g = { gameID: h.gameID, title: h.external, steamAppID: h.steamAppID, thumb: h.thumb };
  return {
    id: `game-${h.gameID}`,
    title: h.external,
    icon: h.thumb && /steamstatic|akamaihd/.test(h.thumb) ? h.thumb : { source: Icons.gamepad, tint: "purple" },
    accessories: [
      ...(wished.has(h.gameID)
        ? [{ icon: { source: Icons.heartFilled, tint: "pink" as const }, tooltip: "In your wishlist" }]
        : []),
      { text: `from ${price(Number(h.cheapest))}`, color: "green" },
    ],
    detail: {
      image: picture(g),
      metadata: [meta.text("Cheapest now", price(Number(h.cheapest)), { icon: Icons.coin })],
    },
    actions: [
      action("Compare Stores", () => offersView(g, stores, wished), { icon: Icons.coin }),
      open(dealLink(h.cheapestDealID), "Buy at the Cheapest Store", { icon: Icons.external }),
      ...(wished.has(h.gameID) ? [] : [
        action("Add to Wishlist…", () =>
          wishForm({
            gameID: h.gameID,
            title: h.external,
            steamAppID: h.steamAppID ?? undefined,
            thumb: h.thumb,
            price: Number(h.cheapest),
          }), { icon: Icons.heart, shortcut: "<Ctrl>w" }),
      ]),
      ...(h.steamAppID ? [open(steamUrl(h.steamAppID), "Open on Steam", { shortcut: "<Ctrl>o" })] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Wishlist

export function wishItem(e: WishEntry, stores: Stores, wished: Set<string>): Item {
  const last = e.last;
  const hit = last && (e.target > 0 ? last.price <= e.target : last.price < last.retail);
  const saving = last && last.retail > 0 ? Math.round((1 - last.price / last.retail) * 100) : 0;
  const goal = e.target > 0 ? `below ${price(e.target)}` : "any sale";
  return {
    id: e.gameID,
    title: e.title,
    subtitle: last ? `${price(last.price)} at ${storeName(stores, last.storeID)} · target ${goal}` : `Target ${goal}`,
    icon: hit ? { source: Icons.bell, tint: "green" } : { source: Icons.heart, tint: "pink" },
    section: hit ? "At Your Price" : "Waiting",
    accessories: [
      ...(saving > 0 ? [{ tag: `-${saving}%`, color: savingsColor(saving) }] : []),
      ...(last ? [{ text: price(last.price), color: hit ? "green" as const : undefined }] : [{ text: "not checked" }]),
    ],
    detail: {
      image: picture(e),
      stats: [
        ...(last ? [{ label: "Now", value: price(last.price), color: hit ? "green" as const : undefined }] : []),
        { label: "Target", value: e.target > 0 ? price(e.target) : "Any sale" },
        ...(e.lowest ? [{ label: "Lowest Ever", value: price(e.lowest.price) }] : []),
      ],
      metadata: [
        ...(last ? [meta.text("Store", storeName(stores, last.storeID), { icon: Icons.coin })] : []),
        ...(last ? [meta.text("Normal price", price(last.retail))] : []),
        ...(e.lowest ? [meta.text("Lowest ever", `${price(e.lowest.price)} on ${shortDate(e.lowest.date)}`)] : []),
        ...(last ? [meta.text("Checked", new Date(last.at).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        meta.text("Added", shortDate(e.added), { icon: Icons.calendar }),
      ],
    },
    actions: [
      ...(last
        ? [open(dealLink(last.dealID), `Buy on ${storeName(stores, last.storeID)}`, { icon: Icons.external })]
        : []),
      action("Compare Stores", () => offersView(e, stores, wished), { icon: Icons.coin }),
      action("Change Target Price…", () => wishForm({ ...e, price: last?.price }), {
        icon: Icons.tag,
        shortcut: "<Ctrl>e",
      }),
      ...(e.steamAppID ? [open(steamUrl(e.steamAppID), "Open on Steam", { shortcut: "<Ctrl>o" })] : []),
      action("Remove from Wishlist", async () => {
        await removeWish(e.gameID);
        await toast(`${e.title} removed`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Stop watching ${e.title}?`,
        shortcut: "<Ctrl>BackSpace",
      }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Free games

function claimAction(id: string, isClaimed: boolean): Action {
  return action(isClaimed ? "Mark as Not Claimed" : "Mark as Claimed", async () => {
    await toggleClaimed(id);
    return refresh();
  }, { icon: isClaimed ? Icons.dottedCircle : Icons.done, shortcut: "<Ctrl>d" });
}

export function epicItem(g: FreeGame, o: { upcoming?: boolean; claimed: boolean }, now = Date.now()): Item {
  const when = o.upcoming ? `from ${shortDate(g.start, now)}` : `${timeLeft(g.end, now)} left`;
  return {
    id: g.id,
    title: g.title,
    subtitle: [g.seller, o.upcoming ? "Coming soon" : "Free to keep"].filter(Boolean).join(" · "),
    icon: o.claimed
      ? { source: Icons.done, tint: "gray" }
      : g.thumb ?? { source: Icons.gamepad, tint: o.upcoming ? "gray" : "green" },
    section: o.claimed ? "Claimed" : o.upcoming ? "Coming Soon on Epic" : "Free Now on Epic",
    keywords: ["epic", ...(g.seller ? [g.seller] : [])],
    accessories: [
      ...(g.worth ? [{ text: g.worth, tooltip: "Normal price" }] : []),
      { tag: when, color: o.upcoming ? "gray" as const : "green" as const },
    ],
    detail: {
      image: g.image,
      markdown: g.description ? `## ${g.title}\n\n${g.description}` : `## ${g.title}`,
      metadata: [
        meta.text("Store", "Epic Games Store", { icon: Icons.gamepad }),
        ...(g.seller ? [meta.text("Publisher", g.seller)] : []),
        ...(g.worth ? [meta.text("Worth", g.worth, { icon: Icons.coin })] : []),
        meta.text(o.upcoming ? "Free from" : "Free since", new Date(g.start).toLocaleString("en-GB"), {
          icon: Icons.calendar,
        }),
        meta.text("Until", new Date(g.end).toLocaleString("en-GB"), { icon: Icons.clock }),
      ],
    },
    actions: [
      open(g.url, o.upcoming ? "Open in the Epic Store" : "Claim in the Epic Store", { icon: Icons.external }),
      ...(o.upcoming ? [] : [claimAction(g.id, o.claimed)]),
      copy(g.url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl>l" }),
    ],
  };
}

export function giveawayItem(g: Giveaway, o: { claimed: boolean }, now = Date.now()): Item {
  const id = `gp:${g.id}`;
  const end = gpDate(g.end_date);
  const url = g.open_giveaway_url || g.gamerpower_url || "https://www.gamerpower.com/";
  const worth = g.worth && g.worth !== "N/A" ? g.worth : undefined;
  return {
    id,
    title: g.title.replace(/\s+Giveaway$/i, ""),
    subtitle: [g.platforms, g.type].filter(Boolean).join(" · "),
    icon: o.claimed ? { source: Icons.done, tint: "gray" } : g.thumbnail ?? { source: Icons.gamepad, tint: "teal" },
    section: o.claimed ? "Claimed" : "Giveaways",
    keywords: (g.platforms ?? "").split(/,\s*/),
    accessories: [
      ...(worth ? [{ text: worth, tooltip: "Worth" }] : []),
      ...(end ? [{ tag: `${timeLeft(end, now)} left`, color: "teal" as const }] : [{ tag: "No end date" }]),
    ],
    detail: {
      image: g.image ?? g.thumbnail,
      markdown: [
        paragraphs(g.description),
        g.instructions ? `### How to get it\n\n${paragraphs(g.instructions)}` : "",
      ].filter(Boolean).join("\n\n"),
      metadata: [
        ...(g.platforms ? [meta.tags("Platforms", g.platforms.split(/,\s*/))] : []),
        ...(g.type ? [meta.text("Type", g.type, { icon: Icons.tag })] : []),
        ...(worth ? [meta.text("Worth", worth, { icon: Icons.coin })] : []),
        ...(end ? [meta.text("Ends", new Date(end).toLocaleString("en-GB"), { icon: Icons.clock })] : []),
        ...(g.users ? [meta.text("Claimed by", `${g.users.toLocaleString("en")} people`, { icon: Icons.person })] : []),
        meta.link("Source", "GamerPower", g.gamerpower_url ?? "https://www.gamerpower.com/"),
      ],
    },
    actions: [
      open(url, "Get It", { icon: Icons.external }),
      claimAction(id, o.claimed),
      ...(g.gamerpower_url ? [open(g.gamerpower_url, "Open on GamerPower", { shortcut: "<Ctrl>o" })] : []),
      copy(url, "Copy Link", { icon: Icons.link, shortcut: "<Ctrl>l" }),
    ],
  };
}
