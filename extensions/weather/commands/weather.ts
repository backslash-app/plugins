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
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { findPlaces, forecast, moveCity, removeCity, resolvePlace, saveCity, savedCities } from "../api.ts";
import {
  condition,
  dayItem,
  deg,
  type Forecast,
  hourItem,
  mapUrl,
  nowItem,
  type Place,
  placeLabel,
  shareText,
  summary,
  toKmh,
  unitsOf,
} from "../lib.ts";

const FILTER = {
  options: [{ value: "days", title: "7 Days" }, { value: "hours", title: "24 Hours" }],
};

// Set by "Refresh": the next load skips the 15 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Forecast" });

function placeActions(place: Place, f: Forecast | undefined, saved: boolean, home: boolean): Action[] {
  return [
    ...(f ? [copy(shareText(f, place), "Copy Forecast", { shortcut: "<Ctrl><Shift>c", section: "Forecast" })] : []),
    open(mapUrl(place), "Open Weather Map", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Forecast" }),
    refreshAction,
    ...(home ? [] : saved
      ? [
        action("Move Up", async () => {
          await moveCity(place, -1);
          return refresh();
        }, { icon: Icons.arrowUp, shortcut: "<Ctrl><Shift>Up", section: "Saved Cities" }),
        action("Move Down", async () => {
          await moveCity(place, 1);
          return refresh();
        }, { icon: Icons.arrowDown, shortcut: "<Ctrl><Shift>Down", section: "Saved Cities" }),
        action("Remove City", async () => {
          await removeCity(place);
          await toast(`${place.name} removed`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.trash,
          destructive: true,
          confirm: `Remove ${place.name}?`,
          shortcut: "<Ctrl>x",
          section: "Saved Cities",
        }),
      ]
      : [
        action("Save City", async () => {
          await saveCity(place);
          await toast(`${place.name} saved`, { style: "success" });
          return refresh();
        }, { icon: Icons.star, shortcut: "<Ctrl>s", section: "Saved Cities" }),
      ]),
    copy(`${place.latitude}, ${place.longitude}`, "Copy Coordinates", { icon: Icons.pin, section: "Copy" }),
  ];
}

/** Now, then the next 24 hours or 7 days. */
function forecastItems(f: Forecast, place: Place, range: string, actions: Action[]): Item[] {
  return [
    nowItem(f, place, actions, `Now · ${place.name}`),
    ...(range === "hours"
      ? f.hours.map((h) => hourItem(h, f, place, actions))
      : f.days.map((d) => dayItem(d, f, place, actions))),
  ];
}

/** The forecast of one city, opened from the search results or saved cities. */
function forecastView(place: Place): ListSpec {
  return list({
    title: placeLabel(place),
    placeholder: `Forecast for ${place.name}`,
    filter: FILTER,
    status: () => placeLabel(place),
    async items(ctx: Context) {
      const units = unitsOf(ctx.preferences.units);
      const f = await forecast(place, units, ctx.signal, fresh);
      fresh = false;
      const saved = (await savedCities()).some((c) => c.id === place.id);
      return forecastItems(f, place, ctx.filter ?? "days", placeActions(place, f, saved, false));
    },
  });
}

const showForecast = (place: Place) =>
  action("Show Forecast", () => forecastView(place), { icon: Icons.cloudSun, section: "Forecast" });

/** A saved city, with its current conditions. */
function cityItem(place: Place, f: Forecast | undefined): Item {
  const actions = [showForecast(place), ...placeActions(place, f, true, false)];
  if (!f) {
    return {
      id: `city:${place.id}`,
      title: place.name,
      subtitle: "Forecast unavailable",
      icon: { source: Icons.cloud, tint: "gray" },
      section: "Saved Cities",
      actions,
    };
  }
  const item = nowItem(f, place, actions, "Saved Cities");
  return { ...item, id: `city:${place.id}`, title: place.name, subtitle: item.title };
}

/** Typed query: matching cities, the first with its current temperature. */
async function search(query: string, ctx: Context): Promise<Item[]> {
  const places = await findPlaces(query, ctx.signal);
  const saved = new Set((await savedCities()).map((c) => c.id));
  const units = unitsOf(ctx.preferences.units);
  const first = places[0] ? await forecast(places[0], units, ctx.signal).catch(() => undefined) : undefined;
  return places.map((p, i) => {
    const f = i === 0 ? first : undefined;
    const cond = f ? condition(f.now.code, f.now.isDay, toKmh(f.now.wind, units)) : undefined;
    return {
      id: `place:${p.id}`,
      title: p.name,
      subtitle: [p.admin1, p.country].filter(Boolean).join(", "),
      icon: cond ? { source: cond.icon, tint: cond.tint } : { source: Icons.pin, tint: "blue" as const },
      section: "Cities",
      accessories: [
        ...(f && cond ? [{ text: `${deg(f.now.temp)} ${cond.label}` }] : []),
        ...(saved.has(p.id) ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Saved" }] : []),
        ...(p.country_code ? [{ tag: p.country_code }] : []),
      ],
      detail: f ? nowItem(f, p, []).detail : {
        metadata: [
          meta.text("Country", p.country ?? "—", { icon: Icons.globe }),
          ...(p.admin1 ? [meta.text("Region", p.admin1)] : []),
          ...(p.population ? [meta.text("Population", p.population.toLocaleString("en"))] : []),
          ...(p.elevation !== undefined ? [meta.text("Elevation", `${Math.round(p.elevation)} m`)] : []),
          ...(p.timezone ? [meta.text("Time zone", p.timezone, { icon: Icons.clock })] : []),
          meta.text("Coordinates", `${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)}`, { icon: Icons.pin }),
        ],
      },
      actions: [showForecast(p), ...placeActions(p, f, saved.has(p.id), false)],
    };
  });
}

/** Empty query: the default city's forecast, then the saved cities. */
async function home(ctx: Context): Promise<Item[]> {
  const units = unitsOf(ctx.preferences.units);
  const cities = await savedCities();
  const name = String(ctx.preferences.city ?? "").trim();
  const main = name ? await resolvePlace(name, ctx.signal) : cities[0];
  if (name && !main) throw new Error(`No city named “${name}”: check the default city in the extension settings`);
  const others = cities.filter((c) => c.id !== main?.id);
  const [f, ...rest] = await Promise.all([
    main ? forecast(main, units, ctx.signal, fresh) : Promise.resolve(undefined),
    ...others.map((c) => forecast(c, units, ctx.signal, fresh).catch(() => undefined)),
  ]);
  fresh = false;
  const items: Item[] = [];
  if (main && f) {
    updateCommandMetadata({ subtitle: summary(f, main) }).catch(() => {});
    const isSaved = cities.some((c) => c.id === main.id);
    items.push(...forecastItems(f, main, ctx.filter ?? "days", placeActions(main, f, isSaved, !!name)));
  }
  items.push(...others.map((c, i) => cityItem(c, rest[i])));
  return items;
}

export default list({
  placeholder: "Search for a city…",
  filter: FILTER,
  empty: {
    title: "Type a city name",
    description: "Or set a default city in Settings → Extensions → Weather",
    icon: Icons.cloudSun,
  },
  status: (items) => {
    const now = items.find((i) => i.id?.startsWith("now:"));
    if (now) return `${now.subtitle} · Open-Meteo`;
    return items.length ? `${items.length} cities` : "Open-Meteo";
  },
  search: (query, ctx) => query.trim() ? search(query, ctx) : home(ctx),
});
