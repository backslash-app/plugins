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
import { airQuality, findPlaces, moveCity, removeCity, resolvePlace, saveCity, savedCities } from "../api.ts";
import {
  type AirQuality,
  aqiOf,
  aqiText,
  dayItem,
  hourItem,
  level,
  mapUrl,
  nowItem,
  type Place,
  placeLabel,
  pollenItems,
  pollutantItems,
  scaleOf,
  shareText,
  summary,
} from "../lib.ts";

const FILTER = {
  options: [
    { value: "overview", title: "Overview" },
    { value: "hours", title: "24 Hours" },
    { value: "days", title: "Next Days" },
  ],
};

// Set by "Refresh": the next load skips the 30 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Air Quality" });

function placeActions(place: Place, a: AirQuality | undefined, saved: boolean, home: boolean): Action[] {
  return [
    ...(a
      ? [copy(shareText(a, place), "Copy Air Quality", { shortcut: "<Ctrl><Shift>c", section: "Air Quality" })]
      : []),
    open(mapUrl(place), "Open Pollution Map", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Air Quality" }),
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

/** Now, then pollutants and pollen, the next 24 hours or the next days. */
function airItems(a: AirQuality, place: Place, view: string, actions: Action[]): Item[] {
  const now = nowItem(a, place, actions, `Now · ${place.name}`);
  if (view === "hours") return [now, ...a.hours.map((h) => hourItem(h, a, place, actions))];
  if (view === "days") return [now, ...a.days.map((d) => dayItem(d, a, place, actions))];
  return [now, ...pollutantItems(a, place, actions), ...pollenItems(a, place, actions)];
}

/** The air quality of one city, opened from the search results or saved cities. */
function cityView(place: Place): ListSpec {
  return list({
    title: placeLabel(place),
    placeholder: `Air quality in ${place.name}`,
    filter: FILTER,
    status: () => placeLabel(place),
    async items(ctx: Context) {
      const a = await airQuality(place, scaleOf(ctx.preferences.scale), ctx.signal, fresh);
      fresh = false;
      const saved = (await savedCities()).some((c) => c.id === place.id);
      return airItems(a, place, ctx.filter ?? "overview", placeActions(place, a, saved, false));
    },
  });
}

const showAirQuality = (place: Place) =>
  action("Show Air Quality", () => cityView(place), { icon: Icons.wind, section: "Air Quality" });

/** A saved city, with its current index. */
function cityItem(place: Place, a: AirQuality | undefined): Item {
  const actions = [showAirQuality(place), ...placeActions(place, a, true, false)];
  if (!a) {
    return {
      id: `city:${place.id}`,
      title: place.name,
      subtitle: "Air quality unavailable",
      icon: { source: Icons.wind, tint: "gray" },
      section: "Saved Cities",
      actions,
    };
  }
  const item = nowItem(a, place, actions, "Saved Cities");
  return { ...item, id: `city:${place.id}`, title: place.name, subtitle: item.title };
}

/** Typed query: matching cities, the first with its current index. */
async function search(query: string, ctx: Context): Promise<Item[]> {
  const places = await findPlaces(query, ctx.signal);
  const saved = new Set((await savedCities()).map((c) => c.id));
  const scale = scaleOf(ctx.preferences.scale);
  const first = places[0] ? await airQuality(places[0], scale, ctx.signal).catch(() => undefined) : undefined;
  return places.map((p, i) => {
    const a = i === 0 ? first : undefined;
    const aqi = a ? aqiOf(a.now, scale) : undefined;
    const lvl = aqi === undefined ? undefined : level(aqi, scale);
    return {
      id: `place:${p.id}`,
      title: p.name,
      subtitle: [p.admin1, p.country].filter(Boolean).join(", "),
      icon: lvl ? { source: Icons.wind, tint: lvl.color } : { source: Icons.pin, tint: "blue" as const },
      section: "Cities",
      accessories: [
        ...(aqi !== undefined ? [{ text: aqiText(aqi, scale) }] : []),
        ...(saved.has(p.id) ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Saved" }] : []),
        ...(p.country_code ? [{ tag: p.country_code }] : []),
      ],
      detail: a ? nowItem(a, p, []).detail : {
        metadata: [
          meta.text("Country", p.country ?? "—", { icon: Icons.globe }),
          ...(p.admin1 ? [meta.text("Region", p.admin1)] : []),
          ...(p.population ? [meta.text("Population", p.population.toLocaleString("en"))] : []),
          ...(p.timezone ? [meta.text("Time zone", p.timezone, { icon: Icons.clock })] : []),
          meta.text("Coordinates", `${p.latitude.toFixed(3)}, ${p.longitude.toFixed(3)}`, { icon: Icons.pin }),
        ],
      },
      actions: [showAirQuality(p), ...placeActions(p, a, saved.has(p.id), false)],
    };
  });
}

/** Empty query: the default city's air quality, then the saved cities. */
async function home(ctx: Context): Promise<Item[]> {
  const scale = scaleOf(ctx.preferences.scale);
  const cities = await savedCities();
  const name = String(ctx.preferences.city ?? "").trim();
  const main = name ? await resolvePlace(name, ctx.signal) : cities[0];
  if (name && !main) throw new Error(`No city named “${name}”: check the default city in the extension settings`);
  const others = cities.filter((c) => c.id !== main?.id);
  const [a, ...rest] = await Promise.all([
    main ? airQuality(main, scale, ctx.signal, fresh) : Promise.resolve(undefined),
    ...others.map((c) => airQuality(c, scale, ctx.signal, fresh).catch(() => undefined)),
  ]);
  fresh = false;
  const items: Item[] = [];
  if (main && a) {
    updateCommandMetadata({ subtitle: summary(a, main) }).catch(() => {});
    const isSaved = cities.some((c) => c.id === main.id);
    items.push(...airItems(a, main, ctx.filter ?? "overview", placeActions(main, a, isSaved, !!name)));
  }
  items.push(...others.map((c, i) => cityItem(c, rest[i])));
  return items;
}

export default list({
  placeholder: "Search for a city…",
  filter: FILTER,
  empty: {
    title: "Type a city name",
    description: "Or set a default city in Settings → Extensions → Air Quality",
    icon: Icons.wind,
  },
  status: (items) => {
    const now = items.find((i) => i.id?.startsWith("now:"));
    if (now) return `${now.subtitle} · Open-Meteo`;
    return items.length ? `${items.length} cities` : "Open-Meteo";
  },
  search: (query, ctx) => query.trim() ? search(query, ctx) : home(ctx),
});
