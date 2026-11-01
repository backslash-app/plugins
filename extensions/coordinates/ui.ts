// List items for each kind of query.

import { type Action, copy, Icons, type Item, meta, open } from "@backslash/api";
import {
  allFormats,
  bearing,
  compass,
  EXAMPLES,
  formatDecimal,
  formatDistance,
  formatMiles,
  type Formatted,
  googleMapsUrl,
  haversineKm,
  midpoint,
  normLon,
  NOTATION_TITLE,
  osmRouteUrl,
  osmUrl,
  type Parsed,
  type Point,
  type Query,
  vincenty,
} from "./lib.ts";

const SYNTAX = [
  "## What you can type",
  "",
  "| Notation | Example |",
  "|---|---|",
  "| Decimal degrees | `48.8584, 2.2945` or `-33.857 151.215` |",
  "| Degrees, minutes, seconds | `48°51'30\"N 2°17'40\"E` or `40 26 46 N 79 58 56 W` |",
  "| Degrees and decimal minutes | `N 48° 51.504' E 2° 17.670'` |",
  "| UTM | `31U 448251 5411943` or `31N 448251 5411943` |",
  "| MGRS | `31UDQ4825111943` or `31U DQ 48251 11943` |",
  "| Geohash | `u09tunquc` |",
  "| Plus Code | `8FW4V75V+8Q` |",
  "| Distance | `48.8584, 2.2945 to 40.6892, -74.0445` |",
].join("\n");

const geoUri = (p: Point) => `geo:${formatDecimal(p).replace(" ", "")}`;

function mapActions(p: Point): Action[] {
  return [
    open(osmUrl(p), "Open in OpenStreetMap", { icon: Icons.globe, shortcut: "<Ctrl>o" }),
    open(googleMapsUrl(p), "Open in Google Maps", { icon: Icons.external }),
    copy(geoUri(p), "Copy geo: Link", { icon: Icons.link }),
  ];
}

function formatsTable(formats: Formatted[]): string {
  return [
    "| Notation | Value |",
    "|---|---|",
    ...formats.map((f) => `| ${NOTATION_TITLE[f.notation]} | \`${f.text}\` |`),
  ].join("\n");
}

export function pointItems(parsed: Parsed): Item[] {
  const p = parsed.point;
  const formats = allFormats(p);
  const decimal = formatDecimal(p);
  const markdown = [
    `## ${decimal}`,
    "",
    `Read as ${NOTATION_TITLE[parsed.notation].toLowerCase()}${parsed.note ? `: ${parsed.note.toLowerCase()}` : ""}.`,
    "",
    formatsTable(formats),
    ...(formats.some((f) => f.notation === "utm") ? [] : ["", "> UTM and MGRS cover 80°S to 84°N; the poles use UPS."]),
  ].join("\n");
  const head: Item = {
    id: "point",
    title: decimal,
    subtitle: parsed.note ?? `From ${NOTATION_TITLE[parsed.notation]}`,
    icon: { source: Icons.pin, tint: "red" },
    section: "Point",
    accessories: [{ text: `${p.lat >= 0 ? "North" : "South"} · ${normLon(p.lon) >= 0 ? "East" : "West"}` }],
    detail: {
      markdown,
      metadata: [
        meta.text("Latitude", String(Math.round(p.lat * 1e6) / 1e6)),
        meta.text("Longitude", String(Math.round(normLon(p.lon) * 1e6) / 1e6)),
        meta.link("Map", "OpenStreetMap", osmUrl(p)),
      ],
    },
    actions: [copy(decimal, "Copy Decimal Degrees"), ...mapActions(p)],
  };
  const items = formats
    .filter((f) => f.notation !== "decimal")
    .map((f): Item => ({
      id: `format:${f.notation}`,
      title: f.text,
      subtitle: NOTATION_TITLE[f.notation],
      icon: { source: Icons.hash, tint: "blue" },
      section: "In Other Notations",
      keywords: [f.notation],
      accessories: f.precision ? [{ text: f.precision }] : [],
      detail: { markdown, metadata: [meta.text(NOTATION_TITLE[f.notation], f.text)] },
      actions: [
        copy(f.text, `Copy ${NOTATION_TITLE[f.notation]}`),
        ...(f.compact && f.compact !== f.text
          ? [
            copy(
              f.compact,
              f.notation === "geohash" || f.notation === "pluscode" ? "Copy Longer Code" : "Copy Compact",
              {
                icon: Icons.copy,
              },
            ),
          ]
          : []),
        copy(decimal, "Copy Decimal Degrees", { icon: Icons.pin }),
        ...mapActions(p),
      ],
    }));
  return [head, ...items];
}

export function distanceItems(from: Parsed, to: Parsed): Item[] {
  const a = from.point, b = to.point;
  const ellipsoid = vincenty(a, b);
  const sphereKm = haversineKm(a, b);
  const km = ellipsoid ? ellipsoid.meters / 1000 : sphereKm;
  const initial = ellipsoid?.initial ?? bearing(a, b);
  const final = ellipsoid?.final ?? (bearing(b, a) + 180) % 360;
  const mid = midpoint(a, b);
  const fa = formatDecimal(a), fb = formatDecimal(b);
  const markdown = [
    `## ${formatDistance(km)}`,
    "",
    `From \`${fa}\` to \`${fb}\`.`,
    "",
    "| | |",
    "|---|---|",
    `| On the WGS 84 ellipsoid (Vincenty) | ${
      ellipsoid ? formatDistance(km) : "does not converge for nearly opposite points"
    } |`,
    `| On a sphere (haversine) | ${formatDistance(sphereKm)} |`,
    `| In miles | ${formatMiles(km)} |`,
    `| Initial bearing | ${initial.toFixed(1)}° (${compass(initial)}) |`,
    `| Final bearing | ${final.toFixed(1)}° (${compass(final)}) |`,
    `| Midpoint | \`${formatDecimal(mid)}\` |`,
    "",
    "> Great-circle distances: as the crow flies, not by road.",
  ].join("\n");
  const detail = { markdown };
  const route = open(osmRouteUrl(a, b), "Open Route in OpenStreetMap", { icon: Icons.globe, shortcut: "<Ctrl>o" });
  const deg = (x: number) => `${x.toFixed(1)}°`;
  return [
    {
      id: "distance",
      title: formatDistance(km),
      subtitle: `${formatMiles(km)} · as the crow flies`,
      icon: { source: Icons.arrowRight, tint: "blue" },
      section: "Distance",
      accessories: [{ tag: ellipsoid ? "Ellipsoid" : "Sphere", color: "blue" }],
      detail,
      actions: [copy(formatDistance(km), "Copy Distance"), route],
    },
    {
      id: "haversine",
      title: formatDistance(sphereKm),
      subtitle: "On a sphere (haversine), as most apps compute it",
      icon: { source: Icons.globe, tint: "teal" },
      section: "Distance",
      detail,
      actions: [copy(formatDistance(sphereKm), "Copy Distance"), route],
    },
    {
      id: "initial",
      title: `${deg(initial)} ${compass(initial)}`,
      subtitle: "Initial bearing: the heading to leave on",
      icon: { source: Icons.arrowUp, tint: "orange" },
      section: "Bearing",
      detail,
      actions: [copy(deg(initial), "Copy Bearing"), route],
    },
    {
      id: "final",
      title: `${deg(final)} ${compass(final)}`,
      subtitle: "Final bearing: the heading on arrival",
      icon: { source: Icons.arrowUp, tint: "purple" },
      section: "Bearing",
      detail,
      actions: [copy(deg(final), "Copy Bearing"), route],
    },
    {
      id: "midpoint",
      title: formatDecimal(mid),
      subtitle: "Halfway along the great circle",
      icon: { source: Icons.pin, tint: "green" },
      section: "Midpoint",
      detail,
      actions: [copy(formatDecimal(mid), "Copy Midpoint"), ...mapActions(mid)],
    },
    ...[[from, "From"], [to, "To"]].map(([x, label]): Item => {
      const p = (x as Parsed).point;
      return {
        id: `end:${label}`,
        title: formatDecimal(p),
        subtitle: `${label} · ${NOTATION_TITLE[(x as Parsed).notation]}`,
        icon: { source: Icons.pin, tint: label === "From" ? "gray" : "red" },
        section: "Points",
        detail,
        actions: [copy(formatDecimal(p), "Copy Decimal Degrees"), ...mapActions(p)],
      };
    }),
  ];
}

export function exampleItems(): Item[] {
  return EXAMPLES.map((e) => ({
    id: `example:${e.query}`,
    title: e.query,
    subtitle: e.title,
    icon: { source: Icons.lightbulb, tint: "yellow" },
    section: "Examples: type one",
    detail: { markdown: SYNTAX },
    actions: [copy(e.query, "Copy Example")],
  }));
}

export function itemsFor(q: Query): Item[] {
  switch (q.kind) {
    case "empty":
      return exampleItems();
    case "point":
      return pointItems(q.parsed);
    case "distance":
      return distanceItems(q.from, q.to);
    case "error":
      return [{
        id: "error",
        title: q.message,
        subtitle: "Not a coordinate",
        icon: { source: Icons.alert, tint: "red" },
        detail: { markdown: SYNTAX },
        actions: [],
      }, ...exampleItems()];
  }
}
