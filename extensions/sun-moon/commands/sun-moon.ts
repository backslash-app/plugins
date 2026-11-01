import {
  type Action,
  action,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  replace,
  updateCommandMetadata,
} from "@backslash/api";
import { findPlaces, resolvePlace } from "../api.ts";
import {
  addDays,
  clockOf,
  computeView,
  coordinatesPlace,
  type Day,
  dayOf,
  formatDay,
  parseQuery,
  type Place,
  placeLabel,
  resolveDate,
  subtitle,
  suncalcUrl,
  type View,
  viewItems,
  zoneOf,
} from "../lib.ts";

const HELP = [
  "## What you can type",
  "",
  "- A city: `Tokyo`, `Lyon, France`",
  "- Coordinates: `48.85, 2.35`",
  "- A date: `tomorrow`, `friday`, `+3`, `2026-12-21`, `21 dec`, `demain`",
  "- Both: `Reykjavik 21 jun`",
  "",
  "Your place is set in **Settings → Extensions → Sun & Moon**.",
].join("\n");

function dayActions(place: Place, day: Day, nested: boolean): Action[] {
  const go = (d: Day) => nested ? replace(dayView(place, d)) : dayView(place, d);
  return [
    action("Next Day", () => go(addDays(day, 1)), {
      icon: Icons.arrowRight,
      shortcut: "<Ctrl>n",
      section: "Day",
    }),
    action("Previous Day", () => go(addDays(day, -1)), {
      icon: Icons.history,
      shortcut: "<Ctrl>p",
      section: "Day",
    }),
    open(suncalcUrl(place, day), "Open in SunCalc", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Place" }),
    copy(`${place.latitude}, ${place.longitude}`, "Copy Coordinates", { icon: Icons.pin, section: "Place" }),
  ];
}

function compute(place: Place, day: Day | undefined, ctx: Context): View {
  const now = Date.now();
  return computeView(place, day ?? dayOf(now, zoneOf(place)), now, clockOf(ctx.preferences.hour12));
}

/** One place on one day, opened from another place or with Next / Previous Day. */
function dayView(place: Place, day: Day): ListSpec {
  return list({
    title: `${place.name} · ${formatDay(day)}`,
    placeholder: `Filter ${place.name}, ${formatDay(day)}…`,
    status: () => placeLabel(place),
    items: (ctx: Context) => viewItems(compute(place, day, ctx), dayActions(place, day, true)),
  });
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
    detail: {
      metadata: [
        meta.text("Place", placeLabel(p), { icon: Icons.globe }),
        meta.text("Time zone", zoneOf(p), { icon: Icons.clock }),
        meta.text("Coordinates", `${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)}`, { icon: Icons.pin }),
      ],
    },
    actions: [action("Show Sun & Moon", () => dayView(p, d), { icon: Icons.sun })],
  };
}

function message(id: string, title: string, sub: string): Item {
  return {
    id,
    title,
    subtitle: sub,
    icon: { source: Icons.info, tint: "orange" },
    detail: { markdown: HELP },
    actions: [open("https://www.suncalc.org", "Open SunCalc", { icon: Icons.globe })],
  };
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const q = parseQuery(query);
  if (q.error) return [message("error", q.error, "Try tomorrow, friday, +3, 2026-12-21 or 21 dec")];

  let place: Place | undefined;
  let others: Place[] = [];
  if (q.coordinates) place = coordinatesPlace(q.coordinates.latitude, q.coordinates.longitude);
  else if (q.place) {
    [place, ...others] = await findPlaces(q.place, ctx.signal);
    if (!place) return [message("not-found", `No place named “${q.place}”`, "Check the spelling, or type coordinates")];
  } else {
    const pref = String(ctx.preferences.location ?? "").trim();
    if (!pref) {
      return [message("no-place", "Type a city, or set your place", "Settings → Extensions → Sun & Moon")];
    }
    place = await resolvePlace(pref, ctx.signal);
    if (!place) {
      return [
        message("no-place", `No place named “${pref}”`, "Check your place in Settings → Extensions → Sun & Moon"),
      ];
    }
  }

  const day = q.date ? resolveDate(q.date, dayOf(Date.now(), zoneOf(place))) : undefined;
  const v = compute(place, day, ctx);
  if (!query.trim()) updateCommandMetadata({ subtitle: subtitle(v) }).catch(() => {});
  return [...viewItems(v, dayActions(place, v.day, false)), ...others.map((p) => placeItem(p, day))];
}

export default list({
  placeholder: "A city, a date or both: Tokyo tomorrow, 21 dec, 48.85, 2.35…",
  empty: {
    title: "Type a city",
    description: "Or set your place in Settings → Extensions → Sun & Moon",
    icon: Icons.sun,
  },
  status: (items) => {
    const first = items.find((i) => i.section?.startsWith("Sun · "));
    return first?.section?.replace(/^Sun · /, "") ?? "Computed on your computer";
  },
  search,
});
