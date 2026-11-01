import { Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { artworkOfTheDay, dailyHistory } from "../api.ts";
import { byline, dayKey } from "../lib.ts";
import { artworkItem } from "../views.ts";

function dayTitle(day: string, today: string): string {
  if (day === today) return "Today";
  const d = new Date(`${day}T12:00:00`);
  const diff = Math.round((Date.parse(`${today}T12:00:00`) - d.getTime()) / 86_400_000);
  if (diff === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default list({
  placeholder: "Filter the artworks of the last days…",
  empty: { title: "No artwork yet", icon: Icons.palette },
  status: "A public-domain highlight each day, from The Met and the Art Institute of Chicago in turn",
  async items(ctx) {
    const today = dayKey();
    const art = await artworkOfTheDay(today, ctx.signal);
    updateCommandMetadata({ subtitle: `${art.title} · ${byline(art)}` }).catch(() => {});
    const items: Item[] = [artworkItem(art, { section: "Today" })];
    for (const d of await dailyHistory()) {
      if (d.day === today) continue;
      items.push(
        artworkItem(d.artwork, { section: "Earlier", subtitle: `${dayTitle(d.day, today)} · ${byline(d.artwork)}` }),
      );
    }
    return items;
  },
});
