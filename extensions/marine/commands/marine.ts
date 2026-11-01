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
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { findPlaces, removeSpot, resolvePlace, savedSpots, saveSpot, sea } from "../api.ts";
import {
  bestHours,
  compass,
  type Conditions,
  type DayConditions,
  dayName,
  height,
  hourOf,
  mapUrl,
  period,
  type Place,
  placeKey,
  placeLabel,
  type Sea,
  shareText,
  speed,
  summary,
  surf,
  swellText,
  temperature,
  type Units,
  unitsOf,
  type WindUnit,
  windUnitOf,
} from "../lib.ts";

const FILTER = {
  options: [{ value: "days", title: "7 Days" }, { value: "hours", title: "24 Hours" }],
};

// Set by "Refresh": the next load skips the 30 minute cache.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Forecast" });

interface Prefs {
  units: Units;
  wind: WindUnit;
}

const prefsOf = (ctx: Context): Prefs => ({
  units: unitsOf(ctx.preferences.units),
  wind: windUnitOf(ctx.preferences.windUnit),
});

const NOTICE = "Model data for open water near the coast: check local reports before going out. Not for navigation.";

function placeActions(place: Place, s: Sea | undefined, p: Prefs, saved: boolean, home: boolean): Action[] {
  return [
    ...(s && !s.inland
      ? [
        copy(shareText(s, place, p.units, p.wind), "Copy Conditions", {
          shortcut: "<Ctrl><Shift>c",
          section: "Forecast",
        }),
      ]
      : []),
    open(mapUrl(place), "Open Wave Map", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Forecast" }),
    refreshAction,
    ...(home ? [] : saved
      ? [
        action("Remove Spot", async () => {
          await removeSpot(place);
          await toast(`${place.name} removed`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.trash,
          destructive: true,
          confirm: `Remove ${place.name}?`,
          shortcut: "<Ctrl>x",
          section: "Saved Spots",
        }),
      ]
      : [
        action("Save Spot", async () => {
          await saveSpot(place);
          await toast(`${place.name} saved`, { style: "success" });
          return refresh();
        }, { icon: Icons.star, shortcut: "<Ctrl>s", section: "Saved Spots" }),
      ]),
    copy(`${place.latitude}, ${place.longitude}`, "Copy Coordinates", { icon: Icons.pin, section: "Copy" }),
  ];
}

function inlandItem(place: Place, actions: Action[], section: string): Item {
  return {
    id: `inland:${placeKey(place)}`,
    title: "No sea data here",
    subtitle: `${place.name} looks inland: type a beach, or coordinates just off the coast`,
    icon: { source: Icons.droplet, tint: "gray" },
    section,
    detail: {
      markdown: [
        `## No sea data at ${place.name}`,
        "",
        "The ocean model only covers the sea. Search for a coastal town or a beach, or type the coordinates of your spot, e.g. `43.66, -1.44`.",
      ].join("\n"),
    },
    actions,
  };
}

function conditionMetadata(c: Conditions, p: Prefs): Metadata[] {
  const lines: Metadata[] = [];
  if (c.waveHeight !== undefined) {
    lines.push(meta.text("Waves", swellText(c.waveHeight, c.wavePeriod, c.waveDirection, p.units)));
  }
  if (c.swellHeight !== undefined) {
    lines.push(meta.text("Swell", swellText(c.swellHeight, c.swellPeriod, c.swellDirection, p.units)));
  }
  if (c.windWaveHeight !== undefined) {
    lines.push(meta.text("Wind waves", swellText(c.windWaveHeight, c.windWavePeriod, c.windWaveDirection, p.units)));
  }
  if (c.wind !== undefined) {
    lines.push(meta.separator());
    lines.push(
      meta.text(
        "Wind",
        `${speed(c.wind, p.wind)}${c.windDirection !== undefined ? ` from ${compass(c.windDirection)}` : ""}`,
        { icon: Icons.wind },
      ),
    );
    if (c.gusts !== undefined) lines.push(meta.text("Gusts", speed(c.gusts, p.wind)));
  }
  if (c.seaTemperature !== undefined || c.currentSpeed !== undefined || c.seaLevel !== undefined) {
    lines.push(meta.separator());
  }
  if (c.seaTemperature !== undefined) {
    lines.push(meta.text("Water", temperature(c.seaTemperature, p.units), { icon: Icons.thermometer }));
  }
  if (c.currentSpeed !== undefined) {
    lines.push(
      meta.text(
        "Current",
        `${speed(c.currentSpeed, p.wind)}${
          c.currentDirection !== undefined ? ` toward ${compass(c.currentDirection)}` : ""
        }`,
      ),
    );
  }
  if (c.seaLevel !== undefined) {
    lines.push(meta.text("Sea level (tide)", `${c.seaLevel > 0 ? "+" : ""}${height(c.seaLevel, p.units)}`));
  }
  return lines;
}

function nowItem(s: Sea, place: Place, p: Prefs, actions: Action[], section: string): Item {
  const n = s.now;
  const rating = surf(n);
  const today = s.days[0];
  const best = today ? bestHours(s.hours, today.sunrise, today.sunset) : [];
  const bestText = best.length ? `${hourOf(best[0].time)}–${hourOf(best.at(-1)!.time).slice(0, 2)}:59` : undefined;
  return {
    id: `now:${placeKey(place)}`,
    title: swellText(
      n.swellHeight ?? n.waveHeight,
      n.swellPeriod ?? n.wavePeriod,
      n.swellDirection ?? n.waveDirection,
      p.units,
    ),
    subtitle: [
      n.wind !== undefined
        ? `Wind ${speed(n.wind, p.wind)}${n.windDirection !== undefined ? ` ${compass(n.windDirection)}` : ""}`
        : undefined,
      rating?.relation,
      n.seaTemperature !== undefined ? `Water ${temperature(n.seaTemperature, p.units)}` : undefined,
    ].filter(Boolean).join(" · "),
    icon: { source: Icons.droplet, tint: rating?.color ?? "blue" },
    section,
    accessories: rating ? [{ tag: rating.label, color: rating.color }] : [],
    detail: {
      stats: [
        { label: "Waves", value: height(n.waveHeight, p.units) },
        { label: "Period", value: period(n.swellPeriod ?? n.wavePeriod) },
        ...(n.wind !== undefined ? [{ label: "Wind", value: speed(n.wind, p.wind) }] : []),
        ...(n.seaTemperature !== undefined ? [{ label: "Water", value: temperature(n.seaTemperature, p.units) }] : []),
      ],
      markdown: [
        rating ? `## Surf: ${rating.label}` : "## Sea now",
        "",
        ...(rating?.notes.length ? rating.notes.map((x) => `- ${x}`) : []),
        ...(bestText ? ["", `**Best today:** ${bestText}`] : []),
        "",
        `> ${NOTICE}`,
      ].join("\n"),
      metadata: [meta.text("Spot", placeLabel(place), { icon: Icons.pin }), ...conditionMetadata(n, p)],
    },
    actions,
  };
}

function hourItem(c: Conditions, place: Place, p: Prefs, actions: Action[]): Item {
  const rating = surf(c);
  return {
    id: `hour:${placeKey(place)}:${c.time}`,
    title: hourOf(c.time),
    subtitle: swellText(
      c.swellHeight ?? c.waveHeight,
      c.swellPeriod ?? c.wavePeriod,
      c.swellDirection ?? c.waveDirection,
      p.units,
    ),
    icon: { source: Icons.clock, tint: rating?.color ?? "gray" },
    section: `Next 24 Hours · ${place.name}`,
    accessories: [
      ...(c.wind !== undefined
        ? [{
          text: `${speed(c.wind, p.wind)}${c.windDirection !== undefined ? ` ${compass(c.windDirection)}` : ""}`,
          icon: Icons.wind,
        }]
        : []),
      ...(rating ? [{ tag: rating.label, color: rating.color }] : []),
    ],
    detail: {
      markdown: [
        `## ${hourOf(c.time)}${rating ? ` · ${rating.label}` : ""}`,
        "",
        ...(rating?.notes ?? []).map((x) => `- ${x}`),
      ]
        .join("\n"),
      metadata: conditionMetadata(c, p),
    },
    actions,
  };
}

function dayItem(d: DayConditions, today: string, place: Place, p: Prefs, actions: Action[]): Item {
  const rating = surf({
    waveHeight: d.waveHeight,
    swellHeight: d.swellHeight,
    swellPeriod: d.swellPeriod,
    wavePeriod: d.wavePeriod,
    swellDirection: d.swellDirection,
    waveDirection: d.waveDirection,
    wind: d.wind,
    windDirection: d.windDirection,
  });
  const name = dayName(d.date, today);
  return {
    id: `day:${placeKey(place)}:${d.date}`,
    title: name,
    subtitle: `Up to ${
      swellText(
        d.swellHeight ?? d.waveHeight,
        d.swellPeriod ?? d.wavePeriod,
        d.swellDirection ?? d.waveDirection,
        p.units,
      )
    }`,
    icon: { source: Icons.calendar, tint: rating?.color ?? "gray" },
    section: `7 Days · ${place.name}`,
    accessories: [
      ...(d.wind !== undefined
        ? [{
          text: `${speed(d.wind, p.wind)}${d.windDirection !== undefined ? ` ${compass(d.windDirection)}` : ""}`,
          icon: Icons.wind,
        }]
        : []),
      ...(rating ? [{ tag: rating.label, color: rating.color }] : []),
    ],
    detail: {
      markdown: [
        `## ${name}${rating ? ` · ${rating.label}` : ""}`,
        "",
        "Daily highs: the rating uses the biggest swell and the strongest wind of the day.",
        ...(rating?.notes.length ? ["", ...rating.notes.map((x) => `- ${x}`)] : []),
      ].join("\n"),
      metadata: [
        meta.text("Waves", swellText(d.waveHeight, d.wavePeriod, d.waveDirection, p.units)),
        meta.text("Swell", swellText(d.swellHeight, d.swellPeriod, d.swellDirection, p.units)),
        ...(d.windWaveHeight !== undefined ? [meta.text("Wind waves", height(d.windWaveHeight, p.units))] : []),
        ...(d.wind !== undefined
          ? [
            meta.separator(),
            meta.text(
              "Wind",
              `up to ${speed(d.wind, p.wind)}${
                d.windDirection !== undefined ? ` from ${compass(d.windDirection)}` : ""
              }`,
              { icon: Icons.wind },
            ),
            ...(d.gusts !== undefined ? [meta.text("Gusts", speed(d.gusts, p.wind))] : []),
          ]
          : []),
        ...(d.sunrise && d.sunset
          ? [meta.separator(), meta.text("Daylight", `${hourOf(d.sunrise)}–${hourOf(d.sunset)}`, { icon: Icons.sun })]
          : []),
      ],
    },
    actions,
  };
}

function seaItems(s: Sea, place: Place, p: Prefs, range: string, actions: Action[]): Item[] {
  if (s.inland) return [inlandItem(place, actions, `Now · ${place.name}`)];
  const today = s.days[0]?.date ?? s.now.time.slice(0, 10);
  return [
    nowItem(s, place, p, actions, `Now · ${place.name}`),
    ...(range === "hours"
      ? s.hours.map((h) => hourItem(h, place, p, actions))
      : s.days.map((d) => dayItem(d, today, place, p, actions))),
  ];
}

function spotView(place: Place): ListSpec {
  return list({
    title: placeLabel(place),
    placeholder: `Sea at ${place.name}`,
    filter: FILTER,
    status: () => `${placeLabel(place)} · Open-Meteo`,
    async items(ctx: Context) {
      const p = prefsOf(ctx);
      const s = await sea(place, ctx.signal, fresh);
      fresh = false;
      const saved = (await savedSpots()).some((x) => placeKey(x) === placeKey(place));
      return seaItems(s, place, p, ctx.filter ?? "days", placeActions(place, s, p, saved, false));
    },
  });
}

const showSea = (place: Place) =>
  action("Show Forecast", () => spotView(place), { icon: Icons.droplet, section: "Forecast" });

function spotItem(place: Place, s: Sea | undefined, p: Prefs): Item {
  const actions = [showSea(place), ...placeActions(place, s, p, true, false)];
  if (!s || s.inland) {
    return {
      id: `spot:${placeKey(place)}`,
      title: place.name,
      subtitle: s ? "No sea data here" : "Forecast unavailable",
      icon: { source: Icons.droplet, tint: "gray" },
      section: "Saved Spots",
      actions,
    };
  }
  const item = nowItem(s, place, p, actions, "Saved Spots");
  return { ...item, id: `spot:${placeKey(place)}`, title: place.name, subtitle: item.title };
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const p = prefsOf(ctx);
  const places = await findPlaces(query, ctx.signal);
  const saved = new Set((await savedSpots()).map(placeKey));
  const first = places[0] ? await sea(places[0], ctx.signal).catch(() => undefined) : undefined;
  return places.map((place, i) => {
    const s = i === 0 ? first : undefined;
    const rating = s && !s.inland ? surf(s.now) : undefined;
    return {
      id: `place:${placeKey(place)}`,
      title: place.name,
      subtitle: [place.admin1, place.country].filter(Boolean).join(", "),
      icon: { source: Icons.pin, tint: "blue" as const },
      section: "Places",
      accessories: [
        ...(s ? [{ text: s.inland ? "Inland" : summary(s, p.units, p.wind) }] : []),
        ...(rating ? [{ tag: rating.label, color: rating.color }] : []),
        ...(saved.has(placeKey(place))
          ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Saved" }]
          : []),
      ],
      actions: [showSea(place), ...placeActions(place, s, p, saved.has(placeKey(place)), false)],
    };
  });
}

async function home(ctx: Context): Promise<Item[]> {
  const p = prefsOf(ctx);
  const spots = await savedSpots();
  const name = String(ctx.preferences.spot ?? "").trim();
  const main = name ? await resolvePlace(name, ctx.signal) : spots[0];
  if (name && !main) throw new Error(`No place named “${name}”: check the default spot in the extension settings`);
  const others = spots.filter((s) => placeKey(s) !== (main ? placeKey(main) : ""));
  const [s, ...rest] = await Promise.all([
    main ? sea(main, ctx.signal, fresh) : Promise.resolve(undefined),
    ...others.map((o) => sea(o, ctx.signal, fresh).catch(() => undefined)),
  ]);
  fresh = false;
  const items: Item[] = [];
  if (main && s) {
    if (!s.inland) updateCommandMetadata({ subtitle: `${main.name}: ${summary(s, p.units, p.wind)}` }).catch(() => {});
    const isSaved = spots.some((x) => placeKey(x) === placeKey(main));
    items.push(...seaItems(s, main, p, ctx.filter ?? "days", placeActions(main, s, p, isSaved, !!name)));
  }
  items.push(...others.map((o, i) => spotItem(o, rest[i], p)));
  return items;
}

export default list({
  placeholder: "Search for a beach, a town or coordinates…",
  filter: FILTER,
  empty: {
    title: "Type a beach or coastal town",
    description: "Or set a default spot in Settings → Extensions → Marine & Surf",
    icon: Icons.droplet,
  },
  status: (items) => {
    const now = items.find((i) => i.id?.startsWith("now:"));
    if (now) return `${now.title} · Open-Meteo`;
    return items.length ? `${items.length} places` : "Open-Meteo";
  },
  search: (query, ctx) => query.trim() ? search(query, ctx) : home(ctx),
});
