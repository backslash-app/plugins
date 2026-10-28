import { action, copy, Icons, type Item, list, type ListSpec, refresh, replace, toast } from "@backslash/api";
import { addCityList } from "../add.ts";
import { addCity, clockItem, displayName, isSaved, savedIds } from "../clocks.ts";
import {
  dayDiff,
  dayLabel,
  fold,
  formatDiff,
  formatTime,
  formatUtcOffset,
  localZone,
  parseConversion,
  placesFromIds,
  searchCities,
  zoneOffset,
} from "../lib.ts";

let shown = 0;

function clocksView(): ListSpec {
  const addAction = action("Add City…", () => replace(addCityList({ back: clocksView })), {
    icon: Icons.plus,
    shortcut: "<Ctrl>n",
    section: "Clocks",
  });
  return list({
    placeholder: "Filter clocks, add a city, or convert: “3pm NY in Paris”, “15:00 paris to tokyo”…",
    empty: {
      title: "No clock matches",
      description: "Type a city to add it, or a time to convert: “9am London to Tokyo”",
      icon: Icons.clock,
    },
    actions: [addAction],
    status: () => `${shown} clock${shown === 1 ? "" : "s"} · local ${localZone().replace(/_/g, " ")}`,
    async search(query, { preferences }) {
      const hour12 = preferences.hour12 === true;
      const now = Date.now();
      const ids = await savedIds();
      const places = placesFromIds(ids);
      shown = places.length;
      const items: Item[] = [];

      const conv = parseConversion(query, now);
      if (conv) {
        const fromName = displayName(conv.from);
        const fromTime = formatTime(conv.from.zone, conv.at, hour12);
        const targets = conv.to ? [conv.to] : places.filter((p) => p.zone !== conv.from.zone || p.id !== conv.from.id);
        for (const to of targets) {
          const toName = displayName(to);
          const toTime = formatTime(to.zone, conv.at, hour12);
          const days = dayDiff(to.zone, conv.from.zone, conv.at);
          const when = dayLabel(days);
          const diff = zoneOffset(to.zone, conv.at) - zoneOffset(conv.from.zone, conv.at);
          const sentence = `${fromTime} in ${fromName} is ${toTime}${
            when ? ` ${when.toLowerCase()}` : ""
          } in ${toName}`;
          items.push({
            id: `conv:${to.id}`,
            title: `${toTime} in ${toName}`,
            subtitle: `${fromTime} in ${fromName}`,
            icon: { source: Icons.arrowRight, tint: "blue" },
            section: conv.time === "now" ? "Right Now" : "Conversion",
            accessories: [
              ...(when ? [{ tag: when, color: days > 0 ? "purple" as const : "orange" as const }] : []),
              { text: formatDiff(diff), tooltip: `${toName} vs. ${fromName}` },
            ],
            detail: {
              stats: [
                { label: fromName, value: fromTime },
                { label: toName, value: toTime, color: "blue" },
                { label: "Difference", value: formatDiff(diff) },
              ],
              markdown: `**${sentence}.**`,
              metadata: [],
            },
            actions: [
              copy(toTime, "Copy Converted Time"),
              copy(sentence, "Copy Sentence", { shortcut: "<Ctrl><Shift>c" }),
              copy(new Date(conv.at).toISOString(), "Copy as ISO 8601 (UTC)", { section: "Copy" }),
            ],
          });
        }
        const section = conv.time === "now" ? "Your Clocks" : `At ${fromTime} in ${fromName}`;
        for (const p of places) items.push(clockItem(p, { at: conv.at, hour12, section, ids, converted: true }));
        return items;
      }

      // Not a conversion: filter the clocks, then offer to add matching cities.
      const q = fold(query);
      const matching = q
        ? places.filter((p) =>
          [displayName(p), p.country ?? "", p.zone.replace(/_/g, " "), p.local ? "local" : ""].some((s) =>
            fold(s).includes(q)
          )
        )
        : places;
      for (const p of matching) items.push(clockItem(p, { at: now, hour12, section: "Your Clocks", ids }));

      if (q.length >= 2) {
        const local = localZone();
        for (const c of searchCities(q).filter((c) => !isSaved(ids, c)).slice(0, 6)) {
          const diff = zoneOffset(c.zone, now) - zoneOffset(local, now);
          const when = dayLabel(dayDiff(c.zone, local, now));
          items.push({
            id: `add:${c.zone}#${c.name}`,
            title: c.name,
            subtitle: c.country,
            icon: { source: Icons.plus, tint: "green" },
            section: "Add City",
            accessories: [
              ...(when ? [{ tag: when }] : []),
              { text: formatDiff(diff), tooltip: formatUtcOffset(zoneOffset(c.zone, now)) },
              { text: formatTime(c.zone, now, hour12) },
            ],
            actions: [
              action("Add to Clocks", async () => {
                await addCity(c);
                await toast(`${c.name} added`, { style: "success" });
                return refresh();
              }, { icon: Icons.plus }),
            ],
          });
        }
      }
      if (!q) {
        items.push({
          id: "add-city",
          title: "Add City…",
          subtitle: "Search 230 cities",
          icon: { source: Icons.plus, tint: "gray" },
          section: "Clocks",
          actions: [addAction],
        });
      }
      return items;
    },
  });
}

export default clocksView();
