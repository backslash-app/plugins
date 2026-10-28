// The "Add City" list, shared by its command and the clocks' action.

import { action, Icons, type Item, list, type ListSpec, refresh, replace, toast, type View } from "@backslash/api";
import { CITIES, cityId, formatDiff, formatTime, formatUtcOffset, localZone, zoneOffset } from "./lib.ts";
import { addCity, clockIcon, region, savedIds } from "./clocks.ts";

const REGIONS = ["Europe", "Americas", "Asia", "Africa", "Oceania", "Islands", "Other"];

/** `back` builds the view to return to after adding (the clocks); without it the list stays open. */
export function addCityList(options: { back?: () => View } = {}): ListSpec {
  return list({
    title: "Add City",
    placeholder: "Search 230 cities by name, country, airport or zone…",
    empty: { title: "No such city", description: "Try a country or a capital nearby", icon: Icons.globe },
    status: (items) => `${items.length} cit${items.length === 1 ? "y" : "ies"}`,
    async items({ preferences }) {
      const hour12 = preferences.hour12 === true;
      const ids = await savedIds();
      const now = Date.now();
      const local = localZone();
      const sorted = [...CITIES].sort((a, b) =>
        REGIONS.indexOf(region(a.zone)) - REGIONS.indexOf(region(b.zone)) || a.name.localeCompare(b.name)
      );
      return sorted.map((c): Item => {
        const saved = ids.includes(cityId(c));
        const diff = zoneOffset(c.zone, now) - zoneOffset(local, now);
        return {
          id: cityId(c),
          title: c.name,
          subtitle: c.country,
          icon: clockIcon(c.zone, now),
          section: region(c.zone),
          keywords: [c.country, c.zone, ...c.aliases],
          accessories: [
            ...(saved ? [{ icon: { source: Icons.check, tint: "green" as const }, tooltip: "In your clocks" }] : []),
            { text: formatDiff(diff), tooltip: formatUtcOffset(zoneOffset(c.zone, now)) },
            { text: formatTime(c.zone, now, hour12) },
          ],
          actions: [
            action(saved ? "Already in Your Clocks" : "Add to Clocks", async () => {
              if (!(await addCity(c))) {
                await toast(`${c.name} is already in your clocks`);
                return;
              }
              await toast(`${c.name} added`, { style: "success" });
              return options.back ? replace(options.back()) : refresh();
            }, { icon: Icons.plus }),
          ],
        };
      });
    },
  });
}
