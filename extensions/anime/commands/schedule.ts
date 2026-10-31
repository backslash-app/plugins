import { action, Icons, type Item, list, refresh } from "@backslash/api";
import { schedule, watching } from "../api.ts";
import { dayHeader, type Entry, settings, sourceOf } from "../lib.ts";
import { airingItem, errorItem } from "../views.ts";

let status = "";

const reload = action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

export default list({
  placeholder: "Filter airing episodes…",
  status: () => status,
  filter: { options: [{ value: "all", title: "Everything" }, { value: "mine", title: "My List" }], default: "all" },
  empty: {
    title: "Nothing airing",
    description: "Nothing from your list airs this week: try Everything with Tab",
    icon: Icons.calendar,
  },
  async items({ preferences, filter, signal }): Promise<Item[]> {
    const s = settings(preferences);
    const source = sourceOf(s);
    try {
      const [airing, entries] = await Promise.all([
        schedule(s, 7, signal),
        source ? watching(s, source, signal).catch(() => [] as Entry[]) : Promise.resolve([] as Entry[]),
      ]);
      // AniList ids, and MyAnimeList ids as negative keys.
      const onList = new Map<number, Entry>();
      for (const e of entries) onList.set(e.source === "anilist" ? e.media.id : -(e.media.malId ?? 0), e);
      const now = Date.now();
      const shown = airing
        .filter((a) => s.adult || !a.media.adult)
        .filter((a) => filter !== "mine" || onList.has(a.media.id) || (a.media.malId && onList.has(-a.media.malId)));
      const next = shown.find((a) => a.at > now);
      status = `${shown.length} episodes in the next 7 days${next ? ` · next ${next.media.title}` : ""}`;
      return shown.map((a) => airingItem(a, onList, [reload], dayHeader(a.at, now), now));
    } catch (e) {
      if (signal.aborted) throw e;
      status = "";
      return [errorItem(e)];
    }
  },
});
