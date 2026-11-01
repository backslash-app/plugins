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
  updateCommandMetadata,
} from "@backslash/api";
import { clouds, findPlaces, kpForecast, ovation, resolvePlace, solarWind } from "../api.ts";
import {
  bzVerdict,
  clock,
  cloudCover,
  currentKp,
  darkWindow,
  DASHBOARD_URL,
  dayName,
  days,
  formatLatitude,
  geomagneticLatitude,
  gScale,
  horizonLatitude,
  kpColor,
  kpDuring,
  type KpEntry,
  kpLabel,
  kpNeeded,
  kpText,
  overheadLatitude,
  type Place,
  placeLabel,
  relative,
  shareText,
  type SolarWind,
  speedVerdict,
  THREE_DAY_URL,
  verdict,
} from "../lib.ts";

// Set by "Refresh": the next load skips the caches.
let fresh = false;

const refreshAction = action("Refresh", () => {
  fresh = true;
  return refresh();
}, { icon: Icons.refresh, shortcut: "<Ctrl>r" });

const noaaActions: Action[] = [
  open(DASHBOARD_URL, "Open NOAA Aurora Forecast", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
  open(THREE_DAY_URL, "Open NOAA 3-Day Forecast", { icon: Icons.calendar }),
  refreshAction,
];

function kpNowItem(kp: KpEntry | undefined, timeZone: string | undefined, now: number): Item {
  if (!kp) {
    return { id: "kp-now", title: "Kp unavailable", icon: { source: Icons.activity, tint: "gray" }, section: "Now" };
  }
  return {
    id: "kp-now",
    title: `Kp ${kpText(kp.kp)} · ${kpLabel(kp.kp)}`,
    subtitle: `${kp.kind === "observed" ? "Observed" : "Estimated"} for ${clock(kp.time, timeZone)}–${
      clock(kp.time + 3 * 3_600_000, timeZone)
    }`,
    icon: { source: Icons.activity, tint: kpColor(kp.kp) },
    section: "Now",
    accessories: [
      ...(gScale(kp.kp) ? [{ tag: gScale(kp.kp)!, color: kpColor(kp.kp) }] : []),
      { text: relative(kp.time, now) },
    ],
    detail: {
      stats: [{ label: "Kp", value: kpText(kp.kp), color: kpColor(kp.kp) }],
      markdown: [
        "The **Kp index** measures geomagnetic activity from 0 to 9 every 3 hours.",
        "",
        "| Kp | Level | Aurora overhead down to |",
        "|---|---|---|",
        ...[3, 4, 5, 6, 7, 8, 9].map((k) =>
          `| ${k} | ${kpLabel(k)}${gScale(k) ? ` (${gScale(k)})` : ""} | ${
            overheadLatitude(k).toFixed(0)
          }° geomagnetic |`
        ),
      ].join("\n"),
    },
    actions: noaaActions,
  };
}

function windItem(w: SolarWind, timeZone: string | undefined): Item {
  const bz = w.bz !== undefined ? bzVerdict(w.bz) : undefined;
  const speed = w.speed !== undefined ? speedVerdict(w.speed) : undefined;
  return {
    id: "solar-wind",
    title: [
      w.speed !== undefined ? `${Math.round(w.speed)} km/s` : undefined,
      w.bz !== undefined ? `Bz ${w.bz > 0 ? "+" : ""}${w.bz} nT` : undefined,
    ].filter(Boolean).join(" · ") || "Solar wind unavailable",
    subtitle: bz?.text ?? "",
    icon: { source: Icons.wind, tint: bz?.color ?? "gray" },
    section: "Now",
    accessories: speed ? [{ tag: speed.text, color: speed.color }] : [],
    detail: {
      stats: [
        ...(w.speed !== undefined
          ? [{ label: "Speed", value: `${Math.round(w.speed)} km/s`, color: speed!.color }]
          : []),
        ...(w.bz !== undefined ? [{ label: "Bz", value: `${w.bz} nT`, color: bz!.color }] : []),
        ...(w.bt !== undefined ? [{ label: "Bt", value: `${w.bt} nT` }] : []),
      ],
      markdown: [
        "Measured at L1, about an hour upstream of Earth.",
        "",
        "- A **southward Bz** (negative) lets the solar wind in: the more negative and the longer, the better.",
        "- A **fast wind** (above 500 km/s) strengthens displays.",
      ].join("\n"),
      metadata: w.time ? [meta.text("Measured at", clock(w.time, timeZone), { icon: Icons.clock })] : [],
    },
    actions: noaaActions,
  };
}

function dayItems(entries: KpEntry[], now: number, timeZone: string | undefined): Item[] {
  return days(entries, now, timeZone).map((d) => ({
    id: `day:${d.date}`,
    title: dayName(d.date, now, timeZone),
    subtitle: `Up to Kp ${kpText(d.max)} · ${kpLabel(d.max)}`,
    icon: { source: Icons.calendar, tint: kpColor(d.max) },
    section: "Kp Forecast",
    accessories: [
      ...(d.scale ? [{ tag: d.scale, color: kpColor(d.max) }] : []),
      { text: d.entries.map((e) => kpText(e.kp)).join(" ") },
    ],
    detail: {
      stats: [{ label: "Highest Kp", value: kpText(d.max), color: kpColor(d.max) }],
      markdown: [
        `## ${dayName(d.date, now, timeZone)}`,
        "",
        "| Time | Kp | Level | |",
        "|---|---|---|---|",
        ...d.entries.map((e) =>
          `| ${clock(e.time, timeZone)}–${clock(e.time + 3 * 3_600_000, timeZone)} | ${kpText(e.kp)} | ${
            kpLabel(e.kp)
          } | ${e.kind} |`
        ),
        "",
        timeZone ? `Times in ${timeZone}.` : "Times in UTC.",
      ].join("\n"),
    },
    actions: noaaActions,
  }));
}

/** The verdict for a place, then Kp now, solar wind and the next days. */
async function placeItems(place: Place, ctx: Context): Promise<Item[]> {
  const now = Date.now();
  const [entries, wind, ov, cl] = await Promise.all([
    kpForecast(ctx.signal, fresh),
    solarWind(ctx.signal, fresh).catch(() => ({} as SolarWind)),
    ovation(place, ctx.signal, fresh).catch(() => undefined),
    clouds(place, ctx.signal, fresh).catch(() => undefined),
  ]);
  fresh = false;
  const timeZone = place.timezone ?? cl?.timezone;
  const kpNow = currentKp(entries, now);
  const magLat = geomagneticLatitude(place.latitude, place.longitude);
  const dark = darkWindow(now, place.latitude, place.longitude);
  const kpTonight = dark ? kpDuring(entries, dark, kpNow?.kp) ?? 0 : kpNow?.kp ?? 0;
  const cover = dark ? cloudCover(cl, dark) : undefined;
  const v = verdict({ magLat, kp: kpTonight, dark, now, ovation: ov, clouds: cover });
  const needOverhead = kpNeeded(magLat, false);
  const needHorizon = kpNeeded(magLat, true);
  const darkText = dark
    ? dark.start <= now
      ? `Dark now, until ${clock(dark.end, timeZone)}`
      : `${clock(dark.start, timeZone)}–${clock(dark.end, timeZone)}`
    : "Not dark enough";
  updateCommandMetadata({ subtitle: `${place.name}: ${v.title}` }).catch(() => {});

  const share = shareText(place, v, kpNow?.kp, kpTonight);
  const verdictItem: Item = {
    id: "verdict",
    title: v.title,
    subtitle: v.detail,
    icon: { source: v.chance === "bright" ? Icons.sun : Icons.sparkle, tint: v.color },
    section: `Tonight · ${place.name}`,
    accessories: [{ tag: `Kp ${kpText(kpTonight)}`, color: kpColor(kpTonight) }],
    detail: {
      stats: [
        { label: "Kp tonight", value: kpText(kpTonight), color: kpColor(kpTonight) },
        ...(ov
          ? [{ label: "Aurora here", value: `${ov.here} %`, color: ov.here >= 30 ? "green" as const : undefined }]
          : []),
        ...(cover !== undefined
          ? [{ label: "Clouds", value: `${cover} %`, color: cover >= 80 ? "orange" as const : undefined }]
          : []),
      ],
      markdown: [
        `## ${v.title}`,
        "",
        v.detail,
        "",
        "Aurora shows best between 22:00 and 02:00, far from city lights, after your eyes get used to the dark.",
      ].join("\n"),
      metadata: [
        meta.text("Place", placeLabel(place), { icon: Icons.pin }),
        meta.text("Geomagnetic latitude", formatLatitude(magLat)),
        meta.text("Dark", darkText, { icon: Icons.moon }),
        meta.separator(),
        meta.text(
          "Kp for aurora overhead",
          needOverhead === undefined
            ? "Out of reach"
            : `${kpText(needOverhead)}${gScale(needOverhead) ? ` (${gScale(needOverhead)})` : ""}`,
        ),
        meta.text(
          "Kp for the horizon",
          needHorizon === undefined
            ? "Out of reach"
            : `${kpText(needHorizon)}${gScale(needHorizon) ? ` (${gScale(needHorizon)})` : ""}`,
        ),
        meta.text("Oval reaches tonight", `${horizonLatitude(kpTonight).toFixed(0)}° (horizon)`),
        ...(ov
          ? [
            meta.separator(),
            meta.text("OVATION here", `${ov.here} %`),
            meta.text("OVATION poleward", `${ov.poleward} %`),
            ...(ov.forecast ? [meta.text("Model valid for", clock(ov.forecast, timeZone), { icon: Icons.clock })] : []),
          ]
          : []),
      ],
    },
    actions: [
      copy(share, "Copy Forecast", { shortcut: "<Ctrl><Shift>c" }),
      ...noaaActions,
      copy(`${place.latitude}, ${place.longitude}`, "Copy Coordinates", { icon: Icons.pin }),
    ],
  };
  return [verdictItem, kpNowItem(kpNow, timeZone, now), windItem(wind, timeZone), ...dayItems(entries, now, timeZone)];
}

function placeView(place: Place): ListSpec {
  return list({
    title: placeLabel(place),
    status: () => `${placeLabel(place)} · NOAA SWPC`,
    items: (ctx: Context) => placeItems(place, ctx),
  });
}

/** No place set: Kp and solar wind only, and how to set one. */
async function globalItems(ctx: Context): Promise<Item[]> {
  const now = Date.now();
  const [entries, wind] = await Promise.all([
    kpForecast(ctx.signal, fresh),
    solarWind(ctx.signal, fresh).catch(() => ({} as SolarWind)),
  ]);
  fresh = false;
  return [
    {
      id: "set-place",
      title: "Type a city to see your chances tonight",
      subtitle: "Or set your location in Settings → Extensions → Aurora Forecast",
      icon: { source: Icons.pin, tint: "blue" },
      section: "Tonight",
    },
    kpNowItem(currentKp(entries, now), undefined, now),
    windItem(wind, undefined),
    ...dayItems(entries, now, undefined),
  ];
}

async function search(query: string, ctx: Context): Promise<Item[]> {
  const places = await findPlaces(query, ctx.signal);
  return places.map((p) => {
    const m = geomagneticLatitude(p.latitude, p.longitude);
    const need = kpNeeded(m, true);
    return {
      id: `place:${p.id}:${p.latitude},${p.longitude}`,
      title: p.name,
      subtitle: [p.admin1, p.country].filter(Boolean).join(", "),
      icon: { source: Icons.pin, tint: "blue" as const },
      section: "Places",
      accessories: [
        {
          text: need === undefined ? "Out of reach" : `Needs Kp ${kpText(need)}`,
          tooltip: "Kp to see aurora on the horizon",
        },
        ...(p.country_code ? [{ tag: p.country_code }] : []),
      ],
      actions: [
        action("Show Aurora Forecast", () => placeView(p), { icon: Icons.sparkle }),
        copy(`${p.latitude}, ${p.longitude}`, "Copy Coordinates", { icon: Icons.pin }),
      ],
    };
  });
}

async function home(ctx: Context): Promise<Item[]> {
  const name = String(ctx.preferences.location ?? "").trim();
  if (!name) return await globalItems(ctx);
  const place = await resolvePlace(name, ctx.signal);
  if (!place) throw new Error(`No place named “${name}”: check the location in the extension settings`);
  return await placeItems(place, ctx);
}

export default list({
  placeholder: "Search for a city or type latitude, longitude…",
  empty: { title: "No place found", description: "Try a city name or coordinates like 69.65, 18.96", icon: Icons.pin },
  status: (items) => {
    const v = items.find((i) => i.id === "verdict");
    return v ? `${v.section?.replace("Tonight · ", "")}: ${v.title} · NOAA SWPC` : "NOAA SWPC";
  },
  search: (query, ctx) => query.trim() ? search(query, ctx) : home(ctx),
});
