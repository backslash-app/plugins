// List items shared by the two commands.

import { type Action, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import {
  CATEGORY,
  ceiling,
  conditionsSummary,
  flightCategory,
  groupsTable,
  humidity,
  type Metar,
  metarInWords,
  metarSummary,
  pageUrl,
  PERIOD_TAG,
  periodTitle,
  pressureText,
  relative,
  type Taf,
  type TafPeriod,
  temperatureText,
  visibilityText,
  windShort,
  windText,
  zulu,
} from "./lib.ts";

const thousands = (n: number) => n.toLocaleString("en-US");

function categoryTag(c: ReturnType<typeof flightCategory>) {
  return c ? [{ tag: c, color: CATEGORY[c].color }] : [];
}

function categoryMeta(c: ReturnType<typeof flightCategory>): Metadata[] {
  return c ? [meta.tags("Flight category", [{ text: c, color: CATEGORY[c].color }])] : [];
}

export function metarItem(m: Metar, o: { name?: string; section?: string; actions?: Action[]; now?: Date } = {}): Item {
  const cat = flightCategory(m);
  const ceil = ceiling(m);
  const title = o.name ? `${m.station} · ${o.name}` : m.station;
  const trends = m.trends.flatMap((t) => [`**${t.raw}**`, "", groupsTable(t.groups, t.undecoded), ""]);
  const markdown = [
    "```",
    m.raw,
    "```",
    "",
    groupsTable(m.groups, m.undecoded),
    "",
    ...(m.trends.length ? ["### Trend", "", ...trends] : []),
    ...(m.remarks ? ["### Remarks", "", `\`${m.remarks}\``, "", groupsTable(m.remarkGroups)] : []),
  ].join("\n");
  const metadata: Metadata[] = [
    ...categoryMeta(cat),
    ...(cat ? [meta.text("", CATEGORY[cat].text)] : []),
    ...(m.time ? [meta.text("Observed", `${zulu(m.time)} · ${relative(m.time, o.now)}`, { icon: Icons.clock })] : []),
    meta.separator(),
    ...(m.wind ? [meta.text("Wind", windText(m.wind), { icon: Icons.wind })] : []),
    ...(m.visibility ? [meta.text("Visibility", visibilityText(m.visibility), { icon: Icons.eye })] : []),
    meta.text("Ceiling", ceil === undefined ? "None" : `${thousands(ceil)} ft`, { icon: Icons.cloud }),
    ...(m.weather.length ? [meta.text("Weather", m.weather.join(", "), { icon: Icons.cloudRain })] : []),
    ...(m.temperature !== undefined
      ? [meta.text("Temperature", temperatureText(m.temperature), { icon: Icons.thermometer })]
      : []),
    ...(m.dewpoint !== undefined ? [meta.text("Dew point", temperatureText(m.dewpoint))] : []),
    ...(m.temperature !== undefined && m.dewpoint !== undefined
      ? [meta.text("Humidity", `${humidity(m.temperature, m.dewpoint)} %`, { icon: Icons.droplet })]
      : []),
    ...(m.pressure ? [meta.text("QNH", pressureText(m.pressure))] : []),
    ...(m.auto ? [meta.text("Station", "Automatic")] : []),
    meta.separator(),
    meta.link("aviationweather.gov", m.station, pageUrl(m.station)),
  ];
  return {
    id: `metar:${m.station}`,
    title,
    subtitle: metarSummary(m),
    icon: { source: Icons.wind, tint: cat ? CATEGORY[cat].color : "gray" },
    section: o.section,
    keywords: [m.station, o.name ?? "", m.raw],
    accessories: [
      ...categoryTag(cat),
      ...(m.time ? [{ text: relative(m.time, o.now), tooltip: zulu(m.time) }] : []),
    ],
    detail: {
      stats: [
        ...(cat ? [{ label: "Category", value: cat, color: CATEGORY[cat].color }] : []),
        ...(m.wind ? [{ label: "Wind", value: windShort(m.wind) }] : []),
        ...(m.temperature !== undefined ? [{ label: "Temp", value: `${m.temperature} °C` }] : []),
        ...(m.pressure ? [{ label: "QNH", value: `${Math.round(m.pressure.hpa)}` }] : []),
      ],
      markdown,
      metadata,
    },
    actions: [
      ...(o.actions ?? []),
      copy(m.raw, "Copy METAR"),
      copy(metarInWords(m), "Copy Decoded METAR", { icon: Icons.text, shortcut: "<Ctrl><Shift>c" }),
      open(pageUrl(m.station), "Open on aviationweather.gov", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    ],
  };
}

export function periodItem(
  taf: Taf,
  p: TafPeriod,
  index: number,
  o: { section?: string; actions?: Action[] } = {},
): Item {
  const cat = flightCategory(p);
  const tag = PERIOD_TAG[p.kind];
  const temps = index === 0 && taf.temperatures.length
    ? taf.temperatures.map((t) =>
      meta.text(
        t.kind === "max" ? "Maximum" : "Minimum",
        `${temperatureText(t.value)}${t.at ? ` · ${zulu(t.at)}` : ""}`,
        { icon: Icons.thermometer },
      )
    )
    : [];
  return {
    id: `taf:${taf.station}:${index}`,
    title: periodTitle(p),
    subtitle: conditionsSummary(p),
    icon: { source: Icons.calendar, tint: cat ? CATEGORY[cat].color : "gray" },
    section: o.section,
    keywords: [taf.station, p.raw],
    accessories: [{ tag: tag.text(p), color: tag.color }, ...categoryTag(cat)],
    detail: {
      markdown: [
        "```",
        p.raw,
        "```",
        "",
        groupsTable(p.groups, p.undecoded),
        "",
        "### Whole TAF",
        "",
        "```",
        taf.raw.replace(/ (?=FM\d{6}|BECMG|TEMPO|INTER|PROB\d{2})/g, "\n  ").replace(/\n {2}(TEMPO|INTER)/g, " $1"),
        "```",
      ].join("\n"),
      metadata: [
        ...categoryMeta(cat),
        ...(p.from ? [meta.text("From", zulu(p.from), { icon: Icons.clock })] : []),
        ...(p.to ? [meta.text("Until", zulu(p.to))] : []),
        ...(p.probability ? [meta.text("Probability", `${p.probability} %`)] : []),
        meta.separator(),
        ...(p.wind ? [meta.text("Wind", windText(p.wind), { icon: Icons.wind })] : []),
        ...(p.visibility ? [meta.text("Visibility", visibilityText(p.visibility), { icon: Icons.eye })] : []),
        ...(p.weather.length ? [meta.text("Weather", p.weather.join(", "), { icon: Icons.cloudRain })] : []),
        ...temps,
        meta.separator(),
        ...(taf.issued ? [meta.text("Issued", zulu(taf.issued))] : []),
        ...(taf.from && taf.to ? [meta.text("Valid", `${zulu(taf.from)} → ${zulu(taf.to)}`)] : []),
        ...(taf.amended ? [meta.text("Amended", "Yes")] : []),
      ],
    },
    actions: [
      ...(o.actions ?? []),
      copy(taf.raw, "Copy TAF"),
      copy(p.raw, "Copy This Period", { icon: Icons.text }),
      open(pageUrl(taf.station), "Open on aviationweather.gov", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    ],
  };
}

export function tafSection(taf: Taf, name?: string): string {
  const valid = taf.from && taf.to ? ` · valid ${zulu(taf.from)} → ${zulu(taf.to)}` : "";
  return `TAF ${taf.station}${name ? ` ${name}` : ""}${taf.amended ? " (amended)" : ""}${valid}`;
}
