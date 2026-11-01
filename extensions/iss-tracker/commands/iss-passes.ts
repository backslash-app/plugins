import { type Context, Icons, type Item, list, open } from "@backslash/api";
import { findPlaces, issElements, resolvePlace } from "../api.ts";
import { passes } from "../geo.ts";
import { passItems, settingsFor } from "../lib.ts";
import { clockOf, coordinatesPlace, parseCoordinates, type Place, placeLabel, zoneOf } from "../places.ts";
import { satrec } from "../sgp4.ts";

const DAYS = 10;

function message(id: string, title: string, subtitle: string): Item {
  return {
    id,
    title,
    subtitle,
    icon: { source: Icons.info, tint: "orange" },
    actions: [open("https://spotthestation.nasa.gov", "Open Spot the Station", { icon: Icons.globe })],
  };
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const text = query.trim();
  let place: Place | undefined;
  if (text) {
    const coords = parseCoordinates(text);
    place = coords ? coordinatesPlace(coords.latitude, coords.longitude) : (await findPlaces(text, ctx.signal))[0];
    if (!place) return [message("not-found", `No place named “${text}”`, "Check the spelling, or type coordinates")];
  } else {
    const pref = String(ctx.preferences.location ?? "").trim();
    if (!pref) return [message("no-place", "Type a city, or set your place", "Settings → Extensions → ISS Tracker")];
    place = await resolvePlace(pref, ctx.signal);
    if (!place) {
      return [
        message("no-place", `No place named “${pref}”`, "Check your place in Settings → Extensions → ISS Tracker"),
      ];
    }
  }
  const elements = await issElements(ctx.signal);
  const sat = satrec(elements.tle);
  const now = Date.now();
  const s = settingsFor(zoneOf(place), clockOf(ctx.preferences.hour12), now);
  const all = passes(sat, place.latitude, place.longitude, now, now + DAYS * 86_400_000);
  const onlyVisible = (ctx.filter ?? "Visible") === "Visible";
  const items = passItems(all, s, place, onlyVisible);
  if (items.length) return items;
  return [
    message(
      "none",
      onlyVisible ? `No visible pass over ${place.name} in the next ${DAYS} days` : "No pass found",
      onlyVisible
        ? "It passes over at night in the Earth's shadow, or in daylight: try again in a few days"
        : placeLabel(place),
    ),
  ];
}

export default list({
  placeholder: "Your place, or type a city: Tokyo, 48.85, 2.35…",
  empty: {
    title: "Type a city",
    description: "Or set your place in Settings → Extensions → ISS Tracker",
    icon: Icons.star,
  },
  filter: { options: ["Visible", "All"], default: "Visible" },
  status: (items) => {
    const passesShown = items.filter((i) => i.id?.startsWith("pass:")).length;
    return passesShown ? `${passesShown} pass${passesShown === 1 ? "" : "es"} in the next ${DAYS} days` : "";
  },
  search,
});
