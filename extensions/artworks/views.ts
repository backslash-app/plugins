// Artworks as launcher items.

import { type Accessory, copy, Icons, type Item, meta, type Metadata, open } from "@backslash/api";
import { type Artwork, byline, citation, markdown, MUSEUMS } from "./lib.ts";

export function artworkItem(a: Artwork, o: { section?: string; subtitle?: string } = {}): Item {
  const museum = MUSEUMS[a.museum];
  const accessories: Accessory[] = [{ tag: museum.short, color: a.museum === "met" ? "red" : "blue" }];
  if (a.publicDomain) accessories.push({ tag: "Public domain", color: "green", tooltip: "Free to reuse" });
  const metadata: Metadata[] = [];
  if (a.artist) metadata.push(meta.person("Artist", a.artist));
  if (a.date) metadata.push(meta.text("Date", a.date, { icon: Icons.calendar }));
  if (a.medium) metadata.push(meta.text("Medium", a.medium));
  if (a.dimensions) metadata.push(meta.text("Dimensions", a.dimensions));
  if (a.classification) metadata.push(meta.text("Type", a.classification));
  if (a.style) metadata.push(meta.tags("Style", [{ text: a.style, color: "purple" }]));
  if (a.origin) metadata.push(meta.text("Origin", a.origin, { icon: Icons.globe }));
  if (a.department) metadata.push(meta.text("Department", a.department));
  metadata.push(
    meta.tags("Rights", [
      a.publicDomain ? { text: "Public domain", color: "green" } : { text: "In copyright", color: "orange" },
    ]),
  );
  if (a.credit) metadata.push(meta.text("Credit", a.credit));
  metadata.push(meta.separator(), meta.link(museum.short, museum.title, a.url));

  return {
    id: `${o.section ?? ""}:${a.museum}:${a.id}`,
    title: a.title,
    subtitle: o.subtitle ?? byline(a),
    icon: a.thumb ?? { source: Icons.image, tint: "gray" },
    section: o.section,
    keywords: [a.artist, a.date, a.medium, a.department, a.origin, a.style].filter((k): k is string => !!k),
    accessories,
    detail: { image: a.image, markdown: markdown(a), metadata },
    actions: [
      open(a.url, `Open on ${museum.short} Website`),
      ...(a.image ? [open(a.image, "Open Picture", { icon: Icons.image, shortcut: "<Ctrl>o" })] : []),
      copy(citation(a), "Copy Citation", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(a.url, "Copy Link", { section: "Copy" }),
      ...(a.image && a.publicDomain ? [copy(a.image, "Copy Picture Link", { section: "Copy" })] : []),
      copy(`${a.title} — ${byline(a)}`, "Copy Title and Artist", { section: "Copy" }),
    ],
  };
}
