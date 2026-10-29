// Rows of stations, their preview panel and actions.

import { type Action, action, copy, Icons, type Item, list, meta, open, refresh, submenu, toast } from "@backslash/api";
import { stationsAround, toggleFavourite } from "./api.ts";
import {
  age,
  clampRadius,
  euros,
  formatDistance,
  type FuelId,
  fuelOf,
  FUELS,
  fullAddress,
  mapsUrl,
  openState,
  type Place,
  type Row,
  rows,
  summarize,
  weekHours,
} from "./lib.ts";

export interface Settings {
  fuel: FuelId;
  radius: number;
  sort: string;
  maps: string;
}

export function settings(preferences: Record<string, unknown>, fuel: FuelId): Settings {
  return {
    fuel,
    radius: clampRadius(preferences.radius),
    sort: String(preferences.sort ?? "price").trim().toLowerCase() === "distance" ? "distance" : "price",
    maps: String(preferences.maps ?? "openstreetmap"),
  };
}

const MAPS = [
  { id: "openstreetmap", title: "OpenStreetMap" },
  { id: "google", title: "Google Maps" },
  { id: "apple", title: "Apple Maps" },
  { id: "geo", title: "Maps App (geo:)" },
];

function stationDetail(row: Row, s: Settings, now: Date) {
  const st = row.station;
  const state = openState(st, now);
  const others = st.prices.filter((p) => p.fuel !== s.fuel);
  return {
    stats: [
      {
        label: fuelOf(s.fuel).title,
        value: row.price ? euros(row.price.price) : "—",
        color: row.stale ? "gray" as const : "green" as const,
      },
      { label: "Distance", value: formatDistance(row.distance) },
      { label: "Updated", value: `${age(row.price?.updated, now.getTime())} ago` },
    ],
    markdown: [
      `### ${st.address || st.city}`,
      fullAddress(st),
      "",
      "| Fuel | Price | Updated |",
      "|---|---|---|",
      ...st.prices.map((p) =>
        `| ${p.fuel === s.fuel ? `**${fuelOf(p.fuel).title}**` : fuelOf(p.fuel).title} | ${euros(p.price)} | ${
          age(p.updated, now.getTime())
        } ago |`
      ),
      ...(st.shortages.length ? ["", `**Out of stock:** ${st.shortages.join(", ")}`] : []),
      ...(st.days.length ? ["", "**Opening hours**", "", ...weekHours(st.days).map((l) => `- ${l}`)] : []),
      ...(row.stale ? ["", "_This price hasn't been updated for over a week: it may be outdated._"] : []),
    ].join("\n"),
    metadata: [
      meta.text("Now", state.text, {
        icon: Icons.clock,
        color: state.open === true ? "green" : state.open === false ? "red" : undefined,
      }),
      ...(st.automat24 ? [meta.text("Pumps", "24/7 with a card", { icon: Icons.bolt })] : []),
      ...(st.motorway ? [meta.text("Road", "Motorway station", { icon: Icons.flag })] : []),
      ...(others.length ? [meta.tags("Also sells", others.map((p) => fuelOf(p.fuel).title))] : []),
      ...(st.services.length ? [meta.tags("Services", st.services)] : []),
      meta.separator(),
      meta.text("Station ID", st.id, { icon: Icons.hash }),
    ],
  };
}

export function stationActions(row: Row, s: Settings, favourite: boolean): Action[] {
  const st = row.station;
  return [
    open(mapsUrl(st, s.maps), "Open in Maps", { icon: Icons.globe }),
    copy(fullAddress(st), "Copy Address", { shortcut: "<Ctrl><Shift>c" }),
    action(favourite ? "Remove from Favourites" : "Add to Favourites", async () => {
      const added = await toggleFavourite(st.id);
      await toast(added ? "Added to favourites" : "Removed from favourites", { style: "success" });
      return refresh();
    }, { icon: favourite ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>s" }),
    submenu(
      "Open in…",
      MAPS.filter((m) => m.id !== s.maps).map((m) => open(mapsUrl(st, m.id), m.title, { icon: Icons.globe })),
      { icon: Icons.external, shortcut: "<Ctrl>o" },
    ),
    ...(row.price
      ? [
        copy(`${fuelOf(s.fuel).title} ${euros(row.price.price)} · ${fullAddress(st)}`, "Copy Price", {
          section: "Copy",
        }),
      ]
      : []),
    copy(`${st.lat.toFixed(6)}, ${st.lon.toFixed(6)}`, "Copy Coordinates", { section: "Copy" }),
  ];
}

export function stationItem(
  row: Row,
  s: Settings,
  o: { cheapest?: number; favourite?: boolean; section?: string; now?: Date } = {},
): Item {
  const st = row.station;
  const now = o.now ?? new Date();
  const best = !row.stale && o.cheapest !== undefined && row.price && row.price.price <= o.cheapest + 0.0005;
  const state = openState(st, now);
  return {
    id: `${o.section ?? ""}:${st.id}`,
    title: st.address || st.city,
    subtitle: [st.city, st.motorway ? "motorway" : "", state.open === false ? "closed" : ""].filter(Boolean).join(
      " · ",
    ),
    icon: {
      source: o.favourite ? Icons.starFilled : Icons.droplet,
      tint: row.stale ? "gray" : best ? "green" : o.favourite ? "yellow" : "blue",
    },
    section: o.section,
    keywords: [st.postcode, st.city, ...st.services].filter(Boolean),
    accessories: [
      ...(st.shortages.includes(fuelOf(s.fuel).title) ? [{ tag: "Out of stock", color: "red" as const }] : []),
      ...(row.price
        ? [{
          tag: euros(row.price.price),
          color: row.stale ? "gray" as const : best ? "green" as const : "blue" as const,
          tooltip: best ? "Cheapest around" : fuelOf(s.fuel).title,
        }]
        : []),
      { text: formatDistance(row.distance), tooltip: "As the crow flies" },
      {
        text: age(row.price?.updated, now.getTime()),
        icon: { source: Icons.clock, tint: row.stale ? "orange" as const : "gray" as const },
        tooltip: row.price?.updated
          ? `Updated ${new Date(row.price.updated).toLocaleString("en-GB")}`
          : "Never updated",
      },
    ],
    detail: stationDetail(row, s, now),
    actions: stationActions(row, s, !!o.favourite),
  };
}

export function statusLine(list: Row[], s: Settings, place?: Place): string {
  const sum = summarize(list);
  const where = place ? ` within ${s.radius} km of ${place.label.split(",")[0]}` : "";
  if (!sum.count) return `No ${fuelOf(s.fuel).title}${where}`;
  return [
    `${sum.count} station${sum.count === 1 ? "" : "s"}${where}`,
    ...(sum.min !== undefined ? [`${euros(sum.min)} – ${euros(sum.max!)}`, `avg ${euros(sum.average!)}`] : []),
  ].join(" · ");
}

/** Station rows around a place, cheapest (or nearest) first. */
export async function nearbyItems(
  place: Place,
  s: Settings,
  favourites: string[],
  o: { signal?: AbortSignal; fresh?: boolean; section?: string } = {},
): Promise<{ items: Item[]; status: string }> {
  const { stations } = await stationsAround(place, s.fuel, s.radius, o);
  const list = rows(stations, place, s.fuel, { sort: s.sort, radius: s.radius });
  const cheapest = summarize(list).min;
  return {
    items: list.map((r) =>
      stationItem(r, s, { cheapest, favourite: favourites.includes(r.station.id), section: o.section })
    ),
    status: statusLine(list, s, place),
  };
}

/** A pushed list for another place than the one searched. */
export function placeView(place: Place, s: Settings, favourites: string[]) {
  let status = "";
  return list({
    title: `${fuelOf(s.fuel).title} around ${place.label}`,
    placeholder: "Filter stations…",
    status: () => status,
    empty: emptyFor(s),
    async items({ signal }) {
      const r = await nearbyItems(place, s, favourites, { signal });
      status = r.status;
      return r.items;
    },
  });
}

export function emptyFor(s: Settings) {
  return {
    title: "No station sells this fuel here",
    description: `Within ${s.radius} km. Try another fuel with Tab, or a larger radius in Settings`,
    icon: Icons.droplet,
  };
}

export const FUEL_FILTER = FUELS.map((f) => ({ value: f.id, title: f.title }));

export function setupItem(message: string): Item {
  return {
    id: "setup",
    title: message,
    subtitle: "Settings → Extensions → Fuel Prices",
    icon: { source: Icons.settings, tint: "orange" },
    detail: {
      markdown: [
        "## Where should we look?",
        "",
        "Type a French town, a postcode or `latitude, longitude` in the search field, or set your **Home location**",
        "in **Settings → Extensions → Fuel Prices → Configure** to see the stations around it when the command opens.",
        "",
        "Prices come from the government's live feed (_prix-des-carburants-en-france-flux-instantane-v2_ on",
        "data.economie.gouv.fr): stations report them themselves, most within the hour.",
      ].join("\n"),
    },
    actions: [open("https://www.prix-carburants.gouv.fr/", "Open prix-carburants.gouv.fr", { icon: Icons.globe })],
  };
}
