import { action, Icons, list, refresh, toast } from "@backslash/api";
import { games, saveWishlist, stores as loadStores, wishlist } from "../api.ts";
import { applyCheck } from "../lib.ts";
import { type Stores, wishItem } from "../views.ts";

let footer = "";

export default list({
  placeholder: "Filter your wishlist…",
  empty: {
    title: "Your wishlist is empty",
    description: "Find a game in Game Deals and press Ctrl+W to watch its price",
    icon: Icons.heart,
  },
  status: () => footer,
  actions: [action("Check Prices Now", async () => {
    await toast("Checking prices…");
    return refresh();
  }, { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
  async *items({ signal }) {
    const [entries, storeList] = await Promise.all([wishlist(), loadStores(signal).catch(() => [])]);
    const stores: Stores = new Map(storeList.map((s) => [s.storeID, s]));
    const wished = new Set(entries.map((e) => e.gameID));
    footer = `${entries.length} game${entries.length === 1 ? "" : "s"} watched`;
    // The saved prices at once, then fresh ones.
    yield entries.map((e) => wishItem(e, stores, wished));
    if (!entries.length) return;
    const infos = await games(entries.map((e) => e.gameID), signal);
    // Only prices are refreshed here: alerts stay with the background check.
    const { entries: fresh } = applyCheck(entries, infos);
    const kept = fresh.map((e, i) => ({ ...e, alerted: entries[i].alerted }));
    await saveWishlist(kept);
    const hits = kept.filter((e) => e.last && (e.target > 0 ? e.last.price <= e.target : e.last.price < e.last.retail));
    footer = `${entries.length} game${
      entries.length === 1 ? "" : "s"
    } watched · ${hits.length} at your price · CheapShark`;
    yield kept.map((e) => wishItem(e, stores, wished));
  },
});
