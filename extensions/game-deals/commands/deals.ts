import { type Context, Icons, type Item, list } from "@backslash/api";
import { deals, searchGames, stores as loadStores, wishlist } from "../api.ts";
import { bestPerGame, DEAL_VIEWS, type DealView, storeIDs } from "../lib.ts";
import { dealItem, hitItem, type Stores } from "../views.ts";

let footer = "";

export default (ctx: Context) => {
  const maxPrice = Number(ctx.preferences.maxPrice) || 0;
  return list({
    placeholder: "Type a game to compare prices, or browse today's deals…",
    filter: { options: DEAL_VIEWS },
    empty: { title: "No deal found", description: "Try another title or another view", icon: Icons.gamepad },
    status: () => footer,
    async search(query, { signal, filter }) {
      const [storeList, wished] = await Promise.all([loadStores(signal), wishlist()]);
      const stores: Stores = new Map(storeList.map((s) => [s.storeID, s]));
      const wishedIds = new Set(wished.map((w) => w.gameID));
      const q = query.trim();
      if (q) {
        const hits = await searchGames(q, signal);
        footer = `${hits.length} game${hits.length === 1 ? "" : "s"} · CheapShark`;
        return hits.map((h) => hitItem(h, stores, wishedIds));
      }
      const head: Item[] = [];
      const picked = storeIDs(ctx.preferences.stores, storeList.filter((s) => s.isActive));
      if (picked.unknown.length) {
        head.push({
          id: "unknown-stores",
          title: `Unknown store${picked.unknown.length > 1 ? "s" : ""}: ${picked.unknown.join(", ")}`,
          subtitle: "Check the Stores preference: " + storeList.filter((s) =>
            s.isActive
          ).slice(0, 8).map((s) => s.storeName).join(", ") + "…",
          icon: { source: Icons.alert, tint: "orange" },
        });
      }
      const view = (DEAL_VIEWS.some((v) => v.value === filter) ? filter : "top") as DealView;
      const found = await deals(view, { storeIDs: picked.ids, maxPrice, signal });
      const best = bestPerGame(found);
      footer = `${best.length} deal${best.length === 1 ? "" : "s"}${
        picked.ids.length ? ` in ${picked.ids.length} stores` : ""
      } · prices in USD · CheapShark`;
      return [...head, ...best.map((b) => dealItem(b.deal, stores, { wished: wishedIds, otherStores: b.stores }))];
    },
  });
};
