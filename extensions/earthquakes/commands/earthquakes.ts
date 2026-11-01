import { action, type Context, Icons, list, refresh, updateCommandMetadata } from "@backslash/api";
import { feed, resolveLocation } from "../api.ts";
import { feedOf, FEEDS, feedTitle, parseQuakes, quakeItem, status, summary, unitsOf } from "../lib.ts";

// Set by "Refresh": the next load skips the 5 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

const localTime = (t: number) =>
  new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "medium", timeZoneName: "short" });

let shown = "";

export default list({
  placeholder: "Filter by place, country or magnitude class…",
  filter: { options: FEEDS.map((f) => ({ value: f.value, title: f.title })), default: FEEDS[0].value },
  empty: { title: "No earthquakes in this feed", description: "Try a longer period or a lower magnitude" },
  actions: [refreshAction],
  status: (items) => items.length ? shown : "USGS",
  async items(ctx: Context) {
    const name = feedOf(ctx.filter);
    const units = unitsOf(ctx.preferences.units);
    // A wrong location should not hide the feed: distances are then left out.
    const [data, home] = await Promise.all([
      feed(name, ctx.signal, fresh),
      resolveLocation(String(ctx.preferences.location ?? ""), ctx.signal).catch(() => undefined),
    ]);
    fresh = false;
    const quakes = parseQuakes(data, home);
    shown = `${status(quakes)} · ${feedTitle(name)} · USGS`;
    if (quakes[0] && name === FEEDS[0].value) updateCommandMetadata({ subtitle: summary(quakes[0]) }).catch(() => {});
    const now = Date.now();
    return quakes.map((q) =>
      quakeItem(q, { units, now, localTime, section: feedTitle(name), extraActions: [refreshAction] })
    );
  },
});
