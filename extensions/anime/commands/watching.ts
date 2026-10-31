import { action, Icons, type Item, list, refresh, updateCommandMetadata } from "@backslash/api";
import { SetupError, watching } from "../api.ts";
import { behind, settings, sourceOf } from "../lib.ts";
import { entryItem, errorItem, setupItem } from "../views.ts";

let status = "";

const reload = action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "List" });

export default list({
  placeholder: "Filter your list…",
  status: () => status,
  empty: {
    title: "Nothing in progress",
    description: "Shows you're watching on AniList or MyAnimeList show here",
    icon: Icons.film,
  },
  async items({ preferences, signal }): Promise<Item[]> {
    const s = settings(preferences);
    const source = sourceOf(s);
    if (!source) {
      status = "";
      return [setupItem()];
    }
    try {
      const entries = await watching(s, source, signal);
      const ready = entries.filter((e) => behind(e) > 0).length;
      const name = source === "anilist" ? "AniList" : "MyAnimeList";
      status = `${name} · ${entries.length} watching · ${ready} with new episodes`;
      updateCommandMetadata({ subtitle: ready ? `${ready} with new episodes` : null }).catch(() => {});
      const now = Date.now();
      return entries.map((e) => entryItem(e, s, [reload], now));
    } catch (e) {
      if (signal.aborted) throw e;
      status = "";
      return [
        e instanceof SetupError ? setupItem(e.message) : errorItem(e, source === "anilist" ? "AniList" : "MyAnimeList"),
      ];
    }
  },
});
