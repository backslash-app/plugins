// Station rows, their preview panel and actions.

import { type Action, action, copy, Icons, type Item, meta, open, refresh, toast } from "@backslash/api";
import { toggleFavorite } from "./api.ts";
import {
  age,
  directionsUrl,
  formatDistance,
  mapsUrl,
  type Point,
  type Row,
  STATE_LOOK,
  stateOf,
  summary,
  type System,
  walkMinutes,
} from "./lib.ts";

export function stationItem(
  row: Row,
  o: { system: System; home?: Point; favorite: boolean; section: string; extra: Action[]; now?: number },
): Item {
  const { station: st, status: s } = row;
  const state = stateOf(s);
  const look = STATE_LOOK[state];
  const split = s?.ebikes !== undefined;
  const now = o.now ?? Date.now();
  return {
    id: `${o.section}:${st.id}`,
    title: st.name,
    subtitle: [
      row.distance !== undefined ? `${formatDistance(row.distance)} · ${walkMinutes(row.distance)} min walk` : "",
      state === "closed" || state === "unknown" ? look.text : "",
    ].filter(Boolean).join(" · ") || st.address,
    icon: { source: o.favorite ? Icons.starFilled : Icons.pin, tint: look.tint },
    section: o.section,
    keywords: [st.code ?? "", st.address ?? ""].filter(Boolean),
    accessories: s && state !== "closed"
      ? [
        ...(split
          ? [
            { text: String(s.mechanical ?? 0), icon: Icons.cycle, tooltip: "Mechanical bikes" },
            {
              text: String(s.ebikes),
              icon: { source: Icons.bolt, tint: s.ebikes ? "blue" as const : "gray" as const },
              tooltip: "E-bikes",
            },
          ]
          : [{
            text: `${s.bikes}`,
            icon: { source: Icons.cycle, tint: s.bikes ? "green" as const : "red" as const },
            tooltip: "Bikes",
          }]),
        {
          tag: `${s.docks} dock${s.docks === 1 ? "" : "s"}`,
          color: s.docks ? "gray" as const : "orange" as const,
          tooltip: "Free docks",
        },
      ]
      : [{ tag: look.text, color: "gray" }],
    detail: {
      stats: s
        ? [
          { label: "Bikes", value: s.bikes, color: s.bikes ? "green" : "red" },
          ...(split
            ? [{ label: "Mechanical", value: s.mechanical ?? 0 }, {
              label: "E-bikes",
              value: s.ebikes ?? 0,
              color: "blue" as const,
            }]
            : []),
          { label: "Free docks", value: s.docks, color: s.docks ? undefined : "orange" },
        ]
        : [],
      markdown: [
        `### ${st.name}`,
        st.address && st.address !== st.name ? st.address : "",
        "",
        s ? summary(s) : "_This station sends no live data._",
        ...(s && !s.renting && s.installed ? ["", "**Renting is off**: you can't take a bike here right now."] : []),
        ...(s && !s.returning && s.installed
          ? ["", "**Returns are off**: you can't leave a bike here right now."]
          : []),
      ].filter((l, i, a) => l || a[i - 1]).join("\n"),
      metadata: [
        meta.text("State", look.text, { color: look.tint }),
        ...(row.distance !== undefined
          ? [meta.text("Distance", `${formatDistance(row.distance)} (${walkMinutes(row.distance)} min walk)`, {
            icon: Icons.pin,
          })]
          : []),
        ...(st.capacity !== undefined ? [meta.text("Capacity", `${st.capacity} docks`)] : []),
        ...(s?.disabledBikes ? [meta.text("Out of order", `${s.disabledBikes} bikes`, { icon: Icons.alert })] : []),
        ...(s?.reported ? [meta.text("Reported", age(s.reported, now), { icon: Icons.clock })] : []),
        meta.separator(),
        meta.text("System", o.system.city ? `${o.system.name}, ${o.system.city}` : o.system.name),
        ...(st.code ? [meta.text("Station code", st.code, { icon: Icons.hash })] : []),
      ],
    },
    actions: [
      open(directionsUrl(o.home, st), o.home ? "Walking Directions" : "Open in Maps", { icon: Icons.globe }),
      action(o.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
        const added = await toggleFavorite(o.system, st.id);
        await toast(added ? "Added to favorites" : "Removed from favorites", { style: "success" });
        return refresh();
      }, { icon: o.favorite ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>s" }),
      ...(o.home ? [open(mapsUrl(st), "Open in Maps", { icon: Icons.globe, shortcut: "<Ctrl>o" })] : []),
      copy(`${st.name}: ${summary(s)}`, "Copy Availability", { section: "Copy" }),
      copy(`${st.lat.toFixed(6)}, ${st.lon.toFixed(6)}`, "Copy Coordinates", { section: "Copy" }),
      ...(st.code ? [copy(st.code, "Copy Station Code", { section: "Copy" })] : []),
      ...o.extra,
    ],
  };
}

export function messageItem(
  title: string,
  subtitle: string,
  o: { icon?: string; tint?: "orange" | "gray" } = {},
): Item {
  return {
    id: `message:${title}`,
    title,
    subtitle,
    icon: { source: o.icon ?? Icons.alert, tint: o.tint ?? "orange" },
    detail: {
      markdown: [
        "## Bike Share settings",
        "",
        "In **Settings → Extensions → Bike Share → Configure**:",
        "",
        "- **System**: a name from the list (`velib`, `velov`, `vlille`, `bicloo`, `velotoulouse`, `velhop`, `bicing`,",
        "  `citibike`, `bixi`…), or the URL of any `gbfs.json` feed (see github.com/MobilityData/gbfs, systems.csv).",
        "- **Home**: `latitude, longitude` (right-click → Show address in OpenStreetMap shows them) to sort by distance.",
      ].join("\n"),
    },
    actions: [open("https://github.com/MobilityData/gbfs/blob/master/systems.csv", "Open the List of GBFS Systems")],
  };
}
