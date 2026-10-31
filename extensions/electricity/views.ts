// Rows and preview panels of the Electricity command.

import { type Action, copy, Icons, type Item, meta, open } from "@backslash/api";
import {
  canBeRed,
  centsPerKwh,
  cheapestWindow,
  COLORS,
  countColors,
  type EcowattDay,
  ecowattLevel,
  hourlyPrices,
  hourRange,
  longDay,
  parisDate,
  parisHour,
  perMwh,
  priceAt,
  type PricePoint,
  priceTable,
  priceTint,
  recentStrip,
  shortDay,
  summarizePrices,
  TEMPO_HOURS,
  type TempoDay,
  type TempoStats,
  tightHours,
} from "./lib.ts";

const EDF_TEMPO = "https://particulier.edf.fr/fr/accueil/gestion-contrat/options/tempo.html";
const MON_ECOWATT = "https://www.monecowatt.fr/";
const ENERGY_CHARTS = "https://www.energy-charts.info/charts/price_spot_market/chart.htm?l=en&c=FR";

function remainingStats(stats?: TempoStats) {
  if (!stats) return [];
  return [
    { label: "Blue left", value: stats.remaining.blue, color: "blue" as const },
    { label: "White left", value: stats.remaining.white },
    { label: "Red left", value: stats.remaining.red, color: "red" as const },
  ];
}

export function tempoItem(
  which: "Today" | "Tomorrow",
  day: TempoDay | undefined,
  o: { expected: string; stats?: TempoStats; season: TempoDay[]; extra: Action[] },
): Item {
  const color = day?.color ?? "unknown";
  const c = COLORS[color];
  const date = day?.date ?? o.expected;
  const pending = which === "Tomorrow" && color === "unknown";
  return {
    id: `tempo:${which}`,
    title: pending ? "Tomorrow: not announced yet" : `${which}: ${c.title}`,
    subtitle: longDay(date),
    icon: c.tint ? { source: Icons.bolt, tint: c.tint } : Icons.bolt,
    section: "EDF Tempo",
    keywords: ["tempo", c.french.toLowerCase(), c.title.toLowerCase(), "couleur", "jour"],
    accessories: [
      ...(color === "red"
        ? [{ tag: "Peak price", color: "red" as const, tooltip: "Red day: the most expensive" }]
        : []),
      ...(pending
        ? [{ text: "around 11:00", icon: Icons.clock, tooltip: "RTE announces tomorrow's color in the late morning" }]
        : [{ tag: c.french, color: c.tint }]),
    ],
    detail: {
      stats: remainingStats(o.stats),
      markdown: [
        `## ${c.dot} ${pending ? "Tomorrow's color is not known yet" : `${which} is a ${c.title.toLowerCase()} day`}`,
        "",
        pending
          ? "RTE announces it every day in the late morning (usually by 11:00), EDF publishes it right after."
          : TEMPO_HOURS,
        ...(pending && !canBeRed(date)
          ? ["", "_No red day is possible tomorrow: only weekdays from November to March._"]
          : []),
        ...(o.season.length ? ["", "**Last 14 days**", "", recentStrip(o.season, parisDate())] : []),
      ].join("\n"),
      metadata: [
        meta.text("Date", longDay(date), { icon: Icons.calendar }),
        meta.text("Color", pending ? "—" : `${c.title} (${c.french})`, { icon: Icons.bolt, color: c.tint }),
        ...(day?.period ? [meta.text("Season", day.period)] : []),
        meta.separator(),
        meta.link("Source", "api-couleur-tempo.fr", "https://www.api-couleur-tempo.fr/"),
      ],
    },
    actions: [
      open(EDF_TEMPO, "Open EDF Tempo", { icon: Icons.globe }),
      copy(`${which} (${longDay(date)}): Tempo ${pending ? "not announced yet" : c.title}`, "Copy Color"),
      ...o.extra,
    ],
  };
}

export function seasonItem(stats: TempoStats, season: TempoDay[], extra: Action[]): Item {
  const counts = countColors(season.filter((d) => d.date <= parisDate()));
  const total = (k: "blue" | "white" | "red") => stats.used[k] + stats.remaining[k];
  return {
    id: "tempo:season",
    title: `${stats.remaining.red} red · ${stats.remaining.white} white days left`,
    subtitle: `Season ${stats.period}, until 31 August`,
    icon: { source: Icons.calendar, tint: stats.remaining.red ? "red" : "gray" },
    section: "EDF Tempo",
    keywords: ["saison", "restants", "remaining", "jours rouges", "jours blancs"],
    accessories: [{ text: `${stats.remaining.blue} blue`, tooltip: "Blue days left" }],
    detail: {
      stats: remainingStats(stats),
      markdown: [
        `## Season ${stats.period}`,
        "",
        "| Color | Used | Left | Total |",
        "|---|---:|---:|---:|",
        ...(["blue", "white", "red"] as const).map((k) =>
          `| ${COLORS[k].dot} ${COLORS[k].title} | ${stats.used[k]} | ${stats.remaining[k]} | ${total(k)} |`
        ),
        "",
        "Red days fall on weekdays between 1 November and 31 March; white days on any day but Sunday.",
        ...(season.length ? ["", "**Last 14 days**", "", recentStrip(season, parisDate())] : []),
      ].join("\n"),
      metadata: [
        meta.progress(
          "Red days used",
          total("red") ? stats.used.red / total("red") : 0,
          `${stats.used.red} / ${total("red")}`,
        ),
        meta.progress(
          "White days used",
          total("white") ? stats.used.white / total("white") : 0,
          `${stats.used.white} / ${total("white")}`,
        ),
        ...(stats.lastIncluded ? [meta.text("Counted until", longDay(stats.lastIncluded))] : []),
        ...(counts.unknown ? [meta.text("Days not in the calendar", counts.unknown)] : []),
      ],
    },
    actions: [open(EDF_TEMPO, "Open EDF Tempo", { icon: Icons.globe }), ...extra],
  };
}

export function ecowattItem(day: EcowattDay, today: string, extra: Action[]): Item {
  const lv = ecowattLevel(day.level);
  const tight = tightHours(day.hours);
  const which = day.date === today ? "Today" : longDay(day.date);
  return {
    id: `ecowatt:${day.date}`,
    title: `${day.date === today ? "Today" : shortDay(day.date)}: ${lv.title}`,
    subtitle: day.message || (tight ? `Tight ${tight}` : "No alert"),
    icon: { source: Icons.activity, tint: lv.tint },
    section: "RTE EcoWatt",
    keywords: ["ecowatt", "rte", "signal", "coupure", "délestage", "alerte"],
    accessories: tight ? [{ text: tight, icon: Icons.clock, tooltip: "Hours above normal" }] : [],
    detail: {
      markdown: [
        `## ${lv.dot} ${which}: ${lv.title}`,
        "",
        day.message || "_No message from RTE._",
        "",
        "| Hour | Signal |",
        "|---|---|",
        ...day.hours.map((h, i) => `| ${hourRange(i)} | ${ecowattLevel(h).dot} ${ecowattLevel(h).title} |`),
      ].join("\n"),
      metadata: [
        meta.text("Day", longDay(day.date), { icon: Icons.calendar }),
        meta.text("Signal", lv.title, { color: lv.tint }),
        ...(tight ? [meta.text("Tight hours", tight, { icon: Icons.clock })] : []),
      ],
    },
    actions: [open(MON_ECOWATT, "Open monecowatt.fr", { icon: Icons.globe }), ...extra],
  };
}

export function ecowattSetupItem(error?: string): Item {
  return {
    id: "ecowatt:setup",
    title: error ? "EcoWatt is unavailable" : "Add EcoWatt to see grid alerts",
    subtitle: error ?? "Optional: free RTE credentials in Settings → Extensions → Electricity",
    icon: { source: error ? Icons.alert : Icons.activity, tint: error ? "orange" : "gray" },
    section: "RTE EcoWatt",
    detail: {
      markdown: [
        "## RTE EcoWatt",
        "",
        "EcoWatt tells a day or three ahead when the grid is tight (orange) or when power cuts are possible (red).",
        "",
        "1. Create a free account on **data.rte-france.com** and subscribe to the **Ecowatt** API.",
        "2. In *My applications*, copy the **base64** credentials (or `client_id:client_secret`).",
        "3. Paste them in **Settings → Extensions → Electricity → EcoWatt credentials**.",
        ...(error ? ["", `**Last error:** ${error}`] : []),
      ].join("\n"),
    },
    actions: [
      open("https://data.rte-france.com/catalog/-/api/consumption/Ecowatt/v5.0", "Open the EcoWatt API", {
        icon: Icons.globe,
      }),
      open(MON_ECOWATT, "Open monecowatt.fr", { icon: Icons.globe }),
    ],
  };
}

export function spotItems(points: PricePoint[], extra: Action[], now = Date.now()): Item[] {
  const today = parisDate(now);
  const tomorrow = parisDate(now + 86_400_000);
  const current = { day: today, hour: parisHour(now) };
  const items: Item[] = [];
  const slot = priceAt(points, now);
  for (const [day, label] of [[today, "Today"], [tomorrow, "Tomorrow"]] as const) {
    const hours = hourlyPrices(points, day);
    const sum = summarizePrices(hours);
    if (!sum) {
      if (label === "Tomorrow") {
        items.push({
          id: "spot:tomorrow",
          title: "Tomorrow: prices not out yet",
          subtitle: "The day-ahead auction results come out around 13:00",
          icon: { source: Icons.coin, tint: "gray" },
          section: "Day-ahead prices (France)",
          actions: [open(ENERGY_CHARTS, "Open Energy-Charts", { icon: Icons.chartUp }), ...extra],
        });
      }
      continue;
    }
    const win = cheapestWindow(hours, 3);
    const nowPrice = label === "Today" && slot ? slot.price : undefined;
    items.push({
      id: `spot:${label}`,
      title: nowPrice !== undefined ? `Now: ${perMwh(nowPrice)}` : `${label}: average ${perMwh(sum.average)}`,
      subtitle: `${label} ${perMwh(sum.min.price)} – ${perMwh(sum.max.price)}`,
      icon: { source: Icons.coin, tint: priceTint(nowPrice ?? sum.average, sum.average) },
      section: "Day-ahead prices (France)",
      keywords: ["spot", "epex", "prix", "marché", "price", "day-ahead"],
      accessories: [
        ...(sum.negative ? [{ tag: `${sum.negative} h negative`, color: "teal" as const }] : []),
        ...(win
          ? [{ text: `cheapest ${hourRange(win.from).slice(0, 5)}–${String(win.to % 24).padStart(2, "0")}:00` }]
          : []),
      ],
      detail: {
        stats: [
          ...(nowPrice !== undefined ? [{ label: "Now", value: centsPerKwh(nowPrice) }] : []),
          { label: "Average", value: centsPerKwh(sum.average) },
          { label: "Lowest", value: centsPerKwh(sum.min.price), color: "green" as const },
          { label: "Highest", value: centsPerKwh(sum.max.price), color: "red" as const },
        ],
        markdown: [
          `## ${label}, ${longDay(day)}`,
          "",
          "Wholesale price of the FR bidding zone (hourly averages), before taxes, network costs and your supplier's margin.",
          "",
          priceTable(hours, current, day),
        ].join("\n"),
        metadata: [
          meta.text("Lowest", `${perMwh(sum.min.price)} at ${hourRange(sum.min.hour)}`, { color: "green" }),
          meta.text("Highest", `${perMwh(sum.max.price)} at ${hourRange(sum.max.hour)}`, { color: "red" }),
          ...(win
            ? [
              meta.text(
                "Cheapest 3 hours",
                `${String(win.from).padStart(2, "0")}:00–${String(win.to % 24).padStart(2, "0")}:00`,
                {
                  icon: Icons.clock,
                },
              ),
            ]
            : []),
          meta.separator(),
          meta.link("Source", "Energy-Charts (Fraunhofer ISE)", ENERGY_CHARTS),
        ],
      },
      actions: [
        open(ENERGY_CHARTS, "Open Energy-Charts", { icon: Icons.chartUp }),
        copy(
          `${label}: ${perMwh(sum.average)} average, ${perMwh(sum.min.price)} at ${hourRange(sum.min.hour)}, ${
            perMwh(sum.max.price)
          } at ${hourRange(sum.max.hour)}`,
          "Copy Summary",
        ),
        ...extra,
      ],
    });
  }
  return items;
}

export function errorItem(id: string, section: string, title: string, e: unknown): Item {
  return {
    id,
    title,
    subtitle: (e as Error).message,
    icon: { source: Icons.alert, tint: "orange" },
    section,
  };
}
