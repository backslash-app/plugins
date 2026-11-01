import { Icons, type Item, list } from "@backslash/api";
import { type Prefs, search, things, tokenOf } from "../api.ts";
import { gameItem, openSite, tokenRow } from "../items.ts";
import { rankHits, sortGames } from "../lib.ts";

export default list({
  placeholder: "Search board games: Catan, Azul, Gloomhaven…",
  empty: { title: "No board game found", description: "Try another name", icon: Icons.dice },
  status: (items) => {
    const games = items.filter((i) => i.id?.startsWith("game:")).length;
    return games ? `${games} game${games === 1 ? "" : "s"} · ratings and ranks from BoardGameGeek` : "";
  },
  async search(query, { preferences, signal }): Promise<Item[]> {
    try {
      const token = tokenOf(preferences as Prefs);
      if (query.trim().length < 2) {
        return [{
          id: "hint",
          title: "Type a game's name",
          subtitle: "Results show players, playing time, rating, rank and weight",
          icon: { source: Icons.dice, tint: "blue" },
          actions: [openSite()],
        }];
      }
      const hits = rankHits(await search(query, token, signal), query);
      if (!hits.length) return [];
      return sortGames(await things(hits.map((h) => h.id), token, signal), query).map((g) => gameItem(g));
    } catch (e) {
      return tokenRow(e);
    }
  },
  actions: [openSite()],
});
