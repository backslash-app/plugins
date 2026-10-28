// Storage of the user's clocks and their rendering as launcher items.

import { type Action, action, copy, Icons, type Item, meta, refresh, storage, toast } from "@backslash/api";
import {
  CITIES,
  type City,
  cityId,
  dayDiff,
  dayLabel,
  DEFAULT_PLACES,
  formatDate,
  formatDiff,
  formatTime,
  formatUtcOffset,
  isDaytime,
  isWorkingHours,
  LOCAL_ID,
  localZone,
  move,
  nextTransition,
  type Place,
  placesFromIds,
  shortDate,
  wallClock,
  zoneAbbreviation,
  zoneOffset,
} from "./lib.ts";

const KEY = "places";

export async function savedIds(): Promise<string[]> {
  const ids = await storage.get<string[]>(KEY).catch(() => undefined);
  return Array.isArray(ids) ? ids : [...DEFAULT_PLACES];
}

export async function saveIds(ids: string[]): Promise<void> {
  await storage.set(KEY, ids);
}

export async function savedPlaces(): Promise<Place[]> {
  return placesFromIds(await savedIds());
}

export async function addCity(city: City): Promise<boolean> {
  const ids = await savedIds();
  const id = cityId(city);
  if (ids.includes(id)) return false;
  await saveIds([...ids, id]);
  return true;
}

/** The name of the local clock: the city of its zone ("Paris"), else the zone. */
export function localName(zone = localZone()): string {
  const city = CITIES.find((c) => c.zone === zone);
  return city?.name ?? (zone.split("/").pop() ?? zone).replace(/_/g, " ");
}

export const displayName = (p: Place) => (p.local ? localName(p.zone) : p.name);

/** Region of a zone, for sections: "Europe", "Americas"… */
export function region(zone: string): string {
  const head = zone.split("/")[0];
  switch (head) {
    case "America":
      return "Americas";
    case "Europe":
      return "Europe";
    case "Asia":
      return "Asia";
    case "Africa":
      return "Africa";
    case "Australia":
    case "Pacific":
      return "Oceania";
    case "Atlantic":
    case "Indian":
      return "Islands";
    default:
      return "Other";
  }
}

export function clockIcon(zone: string, at: number) {
  const day = isDaytime(wallClock(zone, at).hour);
  return day ? { source: Icons.sun, tint: "yellow" as const } : { source: Icons.moon, tint: "blue" as const };
}

export interface ClockOptions {
  at: number;
  hour12: boolean;
  section?: string;
  ids?: string[];
  /** The clock is part of a conversion: no reordering actions. */
  converted?: boolean;
  extraActions?: Action[];
}

export function clockItem(place: Place, o: ClockOptions): Item {
  const local = localZone();
  const at = o.at;
  const w = wallClock(place.zone, at);
  const time = formatTime(place.zone, at, o.hour12);
  const diffMin = zoneOffset(place.zone, at) - zoneOffset(local, at);
  const days = dayDiff(place.zone, local, at);
  const when = dayLabel(days);
  const abbr = zoneAbbreviation(place.zone, at);
  const name = displayName(place);
  const dst = nextTransition(place.zone, at);
  const working = isWorkingHours(w);
  const ids = o.ids ?? [];
  const index = ids.indexOf(place.id);

  const actions: Action[] = [
    ...(o.extraActions ?? []),
    copy(`${time} in ${name}`, "Copy Time", { shortcut: "<Ctrl><Shift>c" }),
    copy(`${time} ${name} (${formatUtcOffset(zoneOffset(place.zone, at))})`, "Copy Time with Offset", {
      section: "Copy",
    }),
    copy(new Date(at).toISOString(), "Copy as ISO 8601 (UTC)", { section: "Copy" }),
    copy(place.zone, "Copy Time Zone", { section: "Copy" }),
  ];
  if (!o.converted && index !== -1) {
    const reorder = (where: "top" | "up" | "down" | "bottom", title: string, icon: string, shortcut?: string) =>
      action(title, async () => {
        await saveIds(move(ids, place.id, where));
        return refresh();
      }, { icon, section: "Order", shortcut });
    if (index > 0) {
      actions.push(reorder("top", "Move to Top", Icons.arrowUp, "<Ctrl><Shift>Up"));
      actions.push(reorder("up", "Move Up", Icons.arrowUp, "<Ctrl><Alt>Up"));
    }
    if (index < ids.length - 1) actions.push(reorder("down", "Move Down", Icons.arrowDown, "<Ctrl><Alt>Down"));
    actions.push(action("Remove Clock", async () => {
      await saveIds(ids.filter((id) => id !== place.id));
      await toast(`${name} removed`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove ${name} from your clocks?`,
      section: "Danger",
      shortcut: "<Ctrl>Delete",
    }));
  }

  return {
    id: `${o.section ?? ""}:${place.id}`,
    title: name,
    subtitle: [place.local ? "Local time" : place.country, abbr].filter(Boolean).join(" · "),
    icon: clockIcon(place.zone, at),
    section: o.section,
    keywords: [place.zone, place.country ?? "", abbr, ...(place.local ? ["local", "here"] : [])].filter(Boolean),
    accessories: [
      ...(when ? [{ tag: when, color: days > 0 ? "purple" as const : "orange" as const }] : []),
      ...(place.local
        ? [{ tag: "Local", color: "green" as const }]
        : [{ text: formatDiff(diffMin), tooltip: "vs. local time" }]),
      { text: time, tooltip: formatDate(place.zone, at) },
    ],
    detail: {
      stats: [
        { label: "Time", value: time },
        {
          label: "vs. local",
          value: place.local ? "—" : formatDiff(diffMin),
          color: diffMin === 0 ? undefined : "blue",
        },
        { label: "UTC offset", value: formatUtcOffset(zoneOffset(place.zone, at)) },
      ],
      metadata: [
        meta.text("Date", formatDate(place.zone, at), { icon: Icons.calendar }),
        ...(when ? [meta.text("Day", when, { icon: Icons.calendar, color: days > 0 ? "purple" : "orange" })] : []),
        meta.text("Time zone", place.zone.replace(/_/g, " "), { icon: Icons.globe }),
        meta.text("Abbreviation", abbr),
        ...(place.country ? [meta.text("Country", place.country)] : []),
        meta.separator(),
        meta.text(
          "Daylight",
          isDaytime(w.hour) ? "Day" : "Night",
          isDaytime(w.hour) ? { icon: Icons.sun, color: "yellow" } : { icon: Icons.moon, color: "blue" },
        ),
        meta.text("Office hours", working ? "Yes (9:00–18:00, Mon–Fri)" : "No", {
          icon: Icons.clock,
          color: working ? "green" : "gray",
        }),
        dst
          ? meta.text(
            "Next clock change",
            `${shortDate(place.zone, dst.at)} (${formatDiff(dst.after - dst.before)})`,
            { icon: Icons.refresh },
          )
          : meta.text("Next clock change", "None this year", { icon: Icons.refresh }),
      ],
    },
    actions,
  };
}

export const isSaved = (ids: string[], c: City) => ids.includes(cityId(c));
export { LOCAL_ID };
