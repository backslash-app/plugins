import { Icons, type Item, list } from "@backslash/api";
import { search } from "../api.ts";
import { settings } from "../lib.ts";
import { errorItem, mediaItem } from "../views.ts";

export default list({
  placeholder: "Search anime or manga on AniList…",
  filter: { options: [{ value: "ANIME", title: "Anime" }, { value: "MANGA", title: "Manga" }], default: "ANIME" },
  empty: { title: "No match", description: "Try the romaji or English title", icon: Icons.search },
  async search(query, { preferences, filter, signal }): Promise<Item[]> {
    const q = query.trim();
    if (q.length < 2) {
      return [{
        id: "hint",
        title: filter === "MANGA" ? "Type a manga title" : "Type an anime title",
        subtitle: "Tab switches between anime and manga",
        icon: { source: Icons.search, tint: "gray" },
      }];
    }
    try {
      return (await search(q, filter === "MANGA" ? "MANGA" : "ANIME", settings(preferences), signal)).map(mediaItem);
    } catch (e) {
      if (signal.aborted) throw e;
      return [errorItem(e)];
    }
  },
});
