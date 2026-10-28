// Photo tiles and their actions, shared by the commands.

import {
  type Action,
  action,
  clipboard,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  openExternal,
  refresh,
  toast,
} from "@backslash/api";
import { createShareLink, downloadOriginal, externalDomain, type Server, setFavorite } from "./api.ts";
import { assetUrl, type AssetView, bytes, mapUrl, shareUrl, takenText } from "./lib.ts";

const tilde = (p: string) => p.replace(/^\/home\/[^/]+/, "~");

export function assetActions(s: Server, a: AssetView): Action[] {
  const actions: Action[] = [
    open(assetUrl(s.base, a.id), "Open in Immich", { icon: Icons.external }),
    action("Download Original", async () => {
      await toast(`Downloading ${a.name}…`);
      const path = await downloadOriginal(s, a);
      await toast(`Saved ${tilde(path)}`, { style: "success" });
    }, { icon: Icons.download, shortcut: "<Ctrl>d" }),
    action("Download and Open", async () => {
      await toast(`Downloading ${a.name}…`);
      const path = await downloadOriginal(s, a);
      await openExternal(path);
    }, { icon: Icons.image, shortcut: "<Ctrl>o" }),
    action("Copy Share Link", async () => {
      const [link, domain] = await Promise.all([createShareLink(s, a.id), externalDomain(s)]);
      const url = shareUrl(s.base, domain, link);
      await clipboard.write(url);
      await toast("Share link copied", { style: "success", message: url });
    }, { icon: Icons.link, shortcut: "<Ctrl><Shift>c", section: "Share" }),
    copy(assetUrl(s.base, a.id), "Copy Immich Link", { section: "Share" }),
    action(a.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
      await setFavorite(s, a.id, !a.favorite);
      await toast(a.favorite ? "Removed from favorites" : "Added to favorites", { style: "success" });
      return refresh();
    }, { icon: a.favorite ? Icons.heart : Icons.heartFilled, shortcut: "<Ctrl>f", section: "Edit" }),
  ];
  if (a.coords) {
    actions.push(open(mapUrl(a.coords.lat, a.coords.lon), "Show on Map", { icon: Icons.globe, section: "Share" }));
  }
  actions.push(copy(a.name, "Copy File Name", { section: "Copy" }));
  return actions;
}

export function assetItem(s: Server, a: AssetView, thumb?: string, section?: string): Item {
  const metadata: Metadata[] = [];
  if (a.taken !== undefined) metadata.push(meta.text("Taken", takenText(a.taken), { icon: Icons.calendar }));
  if (a.place) {
    metadata.push(
      a.coords
        ? meta.link("Place", a.place, mapUrl(a.coords.lat, a.coords.lon))
        : meta.text("Place", a.place, { icon: Icons.pin }),
    );
  }
  if (a.camera) metadata.push(meta.text("Camera", a.camera, { icon: Icons.camera }));
  if (a.lens) metadata.push(meta.text("Lens", a.lens, { icon: Icons.dottedCircle }));
  if (a.exposure) metadata.push(meta.text("Exposure", a.exposure, { icon: Icons.sun }));
  if (a.duration) metadata.push(meta.text("Duration", a.duration, { icon: Icons.video }));
  if (a.people.length) metadata.push(meta.tags("People", a.people));
  metadata.push(meta.separator());
  metadata.push(meta.text("File", a.name, { icon: a.video ? Icons.video : Icons.image }));
  if (a.dimensions) metadata.push(meta.text("Size", [a.dimensions, bytes(a.size)].filter(Boolean).join(" · ")));
  if (a.favorite) metadata.push(meta.text("Favorite", "Yes", { icon: Icons.heartFilled, color: "red" }));

  return {
    id: a.id,
    title: a.taken !== undefined ? takenText(a.taken, false) : a.name,
    subtitle: a.place ?? a.name,
    icon: thumb ?? { source: a.video ? Icons.video : Icons.image, tint: "gray" },
    section,
    keywords: [a.name, a.place ?? "", a.camera ?? "", a.description ?? "", ...a.people, a.video ? "video" : "photo"],
    accessories: [
      ...(a.favorite ? [{ icon: { source: Icons.heartFilled, tint: "red" as const }, tooltip: "Favorite" }] : []),
      ...(a.duration ? [{ text: a.duration, icon: Icons.play }] : []),
    ],
    detail: {
      image: thumb,
      markdown: a.description,
      metadata,
    },
    actions: assetActions(s, a),
  };
}
