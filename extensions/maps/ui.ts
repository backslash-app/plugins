// A place as a list item: the preview panel and its actions.

import {
  type Action,
  action,
  copy,
  field,
  form,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  pop,
  refresh,
  toast,
} from "@backslash/api";
import { movePlace, removePlace, renamePlace, savePlace } from "./api.ts";
import {
  addressLines,
  appleUrl,
  contactOf,
  coords,
  directionsUrl,
  distance,
  formatDistance,
  fullAddress,
  geoUri,
  googleDirectionsUrl,
  googleUrl,
  hoursLines,
  iconOf,
  type Mode,
  osmUrl,
  type Place,
  subtitleOf,
  telUrl,
  typeLabel,
  wikipediaUrl,
} from "./lib.ts";

export interface Where {
  home?: Place;
  mode: Mode;
  saved: Place[];
}

const MODE_NAMES: Record<Mode, string> = { car: "by car", bike: "by bike", foot: "on foot" };

function renameForm(p: Place) {
  return form({
    title: `Rename ${p.name}`,
    submitTitle: "Rename",
    fields: [field.text("name", "Name", { value: p.name, required: true })],
    async submit(values) {
      const name = String(values.name ?? "").trim();
      if (!name) return;
      await renamePlace(p, name);
      await toast(`Renamed to ${name}`, { style: "success" });
      return pop();
    },
  });
}

function actionsFor(p: Place, w: Where, isSaved: boolean, isHome: boolean): Action[] {
  const c = contactOf(p.tags);
  const out: Action[] = [open(osmUrl(p), "Open in OpenStreetMap", { icon: Icons.globe })];
  if (w.home && !isHome) {
    out.push(
      open(directionsUrl(w.home, p, w.mode), "Directions from Home", { icon: Icons.arrowRight, shortcut: "<Ctrl>d" }),
    );
  }
  out.push(
    open(googleUrl(p), "Open in Google Maps", { icon: Icons.external, shortcut: "<Ctrl>g", section: "Open In" }),
    open(appleUrl(p), "Open in Apple Maps", { icon: Icons.external, section: "Open In" }),
    open(geoUri(p), "Open in Maps App", { icon: Icons.pin, section: "Open In" }),
  );
  if (w.home && !isHome) {
    out.push(
      open(googleDirectionsUrl(w.home, p, w.mode), "Directions in Google Maps", {
        icon: Icons.arrowRight,
        section: "Open In",
      }),
    );
  }
  if (c.website) out.push(open(c.website, "Open Website", { icon: Icons.link, shortcut: "<Ctrl>w", section: "Place" }));
  if (c.phone) out.push(open(telUrl(c.phone), `Call ${c.phone}`, { icon: Icons.comment, section: "Place" }));
  out.push(
    copy(coords(p), "Copy Coordinates", { icon: Icons.pin, shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(geoUri({ lat: p.lat, lon: p.lon }), "Copy geo: URI", { section: "Copy" }),
    copy(fullAddress(p), "Copy Address", { icon: Icons.home, shortcut: "<Ctrl><Shift>a", section: "Copy" }),
    copy(osmUrl(p), "Copy OpenStreetMap Link", { icon: Icons.link, section: "Copy" }),
  );
  if (c.phone) out.push(copy(c.phone, "Copy Phone Number", { section: "Copy" }));
  if (isHome) return out;
  if (isSaved) {
    out.push(
      action("Rename…", () => renameForm(p), { icon: Icons.text, section: "Saved Places" }),
      action("Move Up", async () => {
        await movePlace(p, -1);
        return refresh();
      }, { icon: Icons.arrowUp, shortcut: "<Ctrl><Shift>Up", section: "Saved Places" }),
      action("Move Down", async () => {
        await movePlace(p, 1);
        return refresh();
      }, { icon: Icons.arrowDown, shortcut: "<Ctrl><Shift>Down", section: "Saved Places" }),
      action("Remove from Saved Places", async () => {
        await removePlace(p);
        await toast(`${p.name} removed`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Remove ${p.name} from your saved places?`,
        shortcut: "<Ctrl>x",
        section: "Saved Places",
      }),
    );
  } else {
    out.push(action("Save Place", async () => {
      await savePlace(p);
      await toast(`${p.name} saved`, { style: "success" });
      return refresh();
    }, { icon: Icons.star, shortcut: "<Ctrl>s", section: "Saved Places" }));
  }
  return out;
}

export function placeItem(p: Place, w: Where, o: { section: string; home?: boolean } = { section: "Results" }): Item {
  const c = contactOf(p.tags);
  const isSaved = w.saved.some((s) => s.id === p.id);
  const away = w.home && !o.home ? distance(w.home, p) : undefined;
  const type = typeLabel(p);
  const lines: Metadata[] = [
    meta.text("Type", type, { icon: iconOf(p).source }),
    ...addressLines(p).map((l, i) => meta.text(i ? "" : "Address", l, i ? {} : { icon: Icons.home })),
    meta.text("Coordinates", coords(p), { icon: Icons.pin }),
  ];
  if (away !== undefined) {
    lines.push(meta.text("From home", `${formatDistance(away)} as the crow flies`, { icon: Icons.arrowRight }));
  }
  if (c.openingHours || c.phone || c.website || c.email || c.cuisine || c.wheelchair || c.operator || c.wikipedia) {
    lines.push(meta.separator());
  }
  if (c.openingHours) {
    hoursLines(c.openingHours).forEach((h, i) =>
      lines.push(meta.text(i ? "" : "Opening hours", h, i ? {} : { icon: Icons.clock }))
    );
  }
  if (c.phone) lines.push(meta.link("Phone", c.phone, telUrl(c.phone)));
  if (c.website) lines.push(meta.link("Website", c.website.replace(/^https?:\/\/(www\.)?|\/$/g, ""), c.website));
  if (c.email) lines.push(meta.link("Email", c.email, `mailto:${c.email}`));
  if (c.cuisine) lines.push(meta.text("Cuisine", c.cuisine));
  if (c.operator) lines.push(meta.text("Operator", c.operator));
  if (c.wheelchair) {
    lines.push(meta.text("Wheelchair", c.wheelchair, {
      color: c.wheelchair === "yes" ? "green" : c.wheelchair === "no" ? "red" : "orange",
    }));
  }
  const wiki = c.wikipedia ? wikipediaUrl(c.wikipedia) : undefined;
  if (wiki) lines.push(meta.link("Wikipedia", c.wikipedia!.replace(/^[a-z-]+:/, ""), wiki));
  if (p.osmType) lines.push(meta.link("OpenStreetMap", `${p.osmType} ${p.osmId}`, osmUrl(p)));
  return {
    id: `${o.section}:${p.id}`,
    title: o.home ? "Home" : p.name,
    subtitle: o.home ? p.name : subtitleOf(p),
    icon: o.home ? { source: Icons.home, tint: "green" } : iconOf(p),
    section: o.section,
    keywords: [type, ...Object.values(p.address)].slice(0, 20),
    accessories: [
      ...(c.openingHours ? [{ icon: Icons.clock, tooltip: c.openingHours }] : []),
      ...(isSaved && o.section !== "Saved Places"
        ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Saved" }]
        : []),
      ...(away !== undefined ? [{ text: formatDistance(away), color: "gray" as const }] : []),
      { tag: type },
    ],
    detail: { metadata: lines },
    actions: actionsFor(p, w, isSaved, !!o.home),
  };
}

export const modeName = (m: Mode) => MODE_NAMES[m];
