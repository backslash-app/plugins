import { type Context, Icons, type Item, list, open } from "@backslash/api";
import { resolvePlace } from "../api.ts";
import { settingsFor, showerItem, upcomingShowers } from "../lib.ts";
import { clockOf, localZone, type Place } from "../places.ts";

async function items(ctx: Context): Promise<Item[]> {
  const now = Date.now();
  const pref = String(ctx.preferences.location ?? "").trim();
  const place: Place | undefined = pref ? await resolvePlace(pref, ctx.signal).catch(() => undefined) : undefined;
  const clock = clockOf(ctx.preferences.hour12);
  const s = place ? settingsFor(place, clock, now) : { zone: localZone(), clock, now };
  const entries = upcomingShowers(now, place).map((e) => showerItem(e, s, place));
  if (place) return entries;
  return [
    {
      id: "no-place",
      title: pref ? `No place named “${pref}”` : "Set your place to see what to expect",
      subtitle: "Settings → Extensions → Night Sky",
      icon: { source: Icons.info, tint: "orange" },
      section: "Your place",
      detail: {
        markdown:
          "With your place set, each shower shows how high its radiant gets during the dark hours, how much the Moon gets in the way, and about how many meteors to expect.",
      },
      actions: [open("https://www.imo.net/resources/calendar/", "Open the IMO Calendar", { icon: Icons.globe })],
    },
    ...entries,
  ];
}

export default list({
  placeholder: "Filter meteor showers…",
  empty: { title: "No meteor shower", icon: Icons.sparkle },
  status: (items) => {
    const active = items.filter((i) => i.section === "Active now").length;
    return active ? `${active} active now` : "Rates for a dark sky, away from city lights";
  },
  items,
});
