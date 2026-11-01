import { type Context, Icons, type Item, list, open } from "@backslash/api";
import { resolvePlace } from "../api.ts";
import { eclipseItem, seenFromPlace, settingsFor, upcomingEclipses } from "../lib.ts";
import { clockOf, localZone, type Place } from "../places.ts";

const FILTERS = ["All", "Solar", "Lunar", "Visible Here"];

async function items(ctx: Context): Promise<Item[]> {
  const now = Date.now();
  const pref = String(ctx.preferences.location ?? "").trim();
  const place: Place | undefined = pref ? await resolvePlace(pref, ctx.signal).catch(() => undefined) : undefined;
  const clock = clockOf(ctx.preferences.hour12);
  const s = place ? settingsFor(place, clock, now) : { zone: localZone(), clock, now };
  const filter = ctx.filter ?? "All";
  const entries = upcomingEclipses(now, place).filter((e) =>
    filter === "Solar"
      ? e.eclipse.body === "solar"
      : filter === "Lunar"
      ? e.eclipse.body === "lunar"
      : filter === "Visible Here"
      ? seenFromPlace(e) !== false
      : true
  );
  const out = entries.map((e) => eclipseItem(e, s, place));
  if (place) return out;
  return [
    {
      id: "no-place",
      title: pref ? `No place named “${pref}”` : "Set your place to see each eclipse from there",
      subtitle: "Settings → Extensions → Night Sky",
      icon: { source: Icons.info, tint: "orange" },
      section: "Your place",
      actions: [open("https://eclipse.gsfc.nasa.gov/eclipse.html", "Open NASA Eclipse Website", { icon: Icons.globe })],
    },
    ...out,
  ];
}

export default list({
  placeholder: "Filter eclipses…",
  empty: { title: "No eclipse left in the table", description: "It covers 2026 to 2030", icon: Icons.sun },
  filter: { options: FILTERS, default: "All" },
  status: "From NASA's eclipse tables, computed for your place",
  items,
});
