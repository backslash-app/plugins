import {
  type Action,
  action,
  type Context,
  Icons,
  type Item,
  list,
  type ListSpec,
  open,
  replace,
} from "@backslash/api";
import { findPlaces, resolvePlace } from "../api.ts";
import { nightItems, settingsFor, tonight } from "../lib.ts";
import {
  addDays,
  clockOf,
  coordinatesPlace,
  type Day,
  dayOf,
  formatDay,
  parseQuery,
  type Place,
  placeLabel,
  resolveDay,
  zoneOf,
} from "../places.ts";

const HELP = [
  "## What you can type",
  "",
  "- A city: `Tokyo`, `Lyon, France`",
  "- Coordinates: `48.85, 2.35`",
  "- A night: `tomorrow`, `+3`, `2026-12-21`, `demain`",
  "- Both: `Reykjavik +2`",
  "",
  "Your place is set in **Settings → Extensions → Night Sky**.",
].join("\n");

function nightActions(place: Place, day: Day, nested: boolean): Action[] {
  const go = (d: Day) => nested ? replace(nightView(place, d)) : nightView(place, d);
  return [
    action("Next Night", () => go(addDays(day, 1)), { icon: Icons.arrowRight, shortcut: "<Ctrl>n", section: "Night" }),
    action("Previous Night", () => go(addDays(day, -1)), {
      icon: Icons.history,
      shortcut: "<Ctrl>p",
      section: "Night",
    }),
  ];
}

function items(place: Place, day: Day, ctx: Context, nested: boolean): Item[] {
  const s = settingsFor(place, clockOf(ctx.preferences.hour12), Date.now());
  return nightItems(tonight(place, day), s, nightActions(place, day, nested));
}

/** One place on one night, opened from another place or with Next / Previous Night. */
function nightView(place: Place, day: Day): ListSpec {
  return list({
    title: `${place.name} · ${formatDay(day)}`,
    placeholder: `Filter the night of ${formatDay(day)}…`,
    status: () => placeLabel(place),
    items: (ctx: Context) => items(place, day, ctx, true),
  });
}

function message(id: string, title: string, subtitle: string): Item {
  return {
    id,
    title,
    subtitle,
    icon: { source: Icons.info, tint: "orange" },
    detail: { markdown: HELP },
    actions: [open("https://stellarium-web.org", "Open Stellarium Web", { icon: Icons.globe })],
  };
}

function placeItem(p: Place, day: Day | undefined): Item {
  const d = day ?? dayOf(Date.now(), zoneOf(p));
  return {
    id: `place:${p.id ?? p.name}`,
    title: p.name,
    subtitle: [p.admin1, p.country].filter(Boolean).join(", "),
    icon: { source: Icons.pin, tint: "blue" },
    section: "Other Places",
    accessories: p.country_code ? [{ tag: p.country_code }] : [],
    actions: [action("Show the Night Sky", () => nightView(p, d), { icon: Icons.star })],
  };
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const q = parseQuery(query);
  let place: Place | undefined;
  let others: Place[] = [];
  if (q.coordinates) place = coordinatesPlace(q.coordinates.latitude, q.coordinates.longitude);
  else if (q.place) {
    [place, ...others] = await findPlaces(q.place, ctx.signal);
    if (!place) return [message("not-found", `No place named “${q.place}”`, "Check the spelling, or type coordinates")];
  } else {
    const pref = String(ctx.preferences.location ?? "").trim();
    if (!pref) return [message("no-place", "Type a city, or set your place", "Settings → Extensions → Night Sky")];
    place = await resolvePlace(pref, ctx.signal);
    if (!place) {
      return [message("no-place", `No place named “${pref}”`, "Check your place in Settings → Extensions → Night Sky")];
    }
  }
  const day = resolveDay(q, dayOf(Date.now(), zoneOf(place)));
  const nightAt = items(place, day, ctx, false);
  const explicitDay = q.date !== undefined || q.offset !== undefined;
  return [...nightAt, ...others.map((p) => placeItem(p, explicitDay ? day : undefined))];
}

export default list({
  placeholder: "A city, a night or both: Tokyo, tomorrow, 2026-12-21…",
  empty: {
    title: "Type a city",
    description: "Or set your place in Settings → Extensions → Night Sky",
    icon: Icons.star,
  },
  status: (items) => {
    const n = items.find((i) => i.id === "night");
    return n?.section ?? "Computed on your computer";
  },
  search,
});
