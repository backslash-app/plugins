import { action, copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { albumAssets, albums, type Server, server, SetupError, setupItem, thumbnails } from "../api.ts";
import { type Album, albumUrl, assetView, dateRange, plural } from "../lib.ts";
import { assetItem } from "../views.ts";

function albumGrid(s: Server, album: Album) {
  return list({
    title: album.albumName,
    layout: "grid",
    columns: 5,
    placeholder: `Filter ${album.albumName} by date, place, people…`,
    empty: { title: "This album is empty", icon: Icons.image },
    status: () => plural(album.assetCount, "item"),
    actions: [open(albumUrl(s.base, album.id), "Open Album in Immich", { icon: Icons.external })],
    async *items({ signal }) {
      const views = (await albumAssets(s, album.id, signal)).map(assetView);
      yield views.map((a) => assetItem(s, a));
      const thumbs = await thumbnails(s, views.map((a) => a.id), { signal, deadline: 8000 });
      yield views.map((a) => assetItem(s, a, thumbs.get(a.id)));
    },
  });
}

function albumItem(s: Server, a: Album, thumb?: string): Item {
  const range = dateRange(a.startDate, a.endDate);
  const people = (a.albumUsers ?? []).map((u) => u.user?.name).filter((n): n is string => !!n);
  return {
    id: a.id,
    title: a.albumName || "Untitled",
    subtitle: range,
    icon: thumb ?? { source: Icons.layers, tint: "blue" },
    section: a.shared ? "Shared" : "My Albums",
    keywords: [a.description ?? "", ...people],
    accessories: [
      ...(a.hasSharedLink ? [{ icon: Icons.link, tooltip: "Has a shared link" }] : []),
      ...(a.shared
        ? [{ icon: Icons.person, tooltip: people.length ? `Shared with ${people.join(", ")}` : "Shared" }]
        : []),
      { tag: String(a.assetCount), tooltip: plural(a.assetCount, "item") },
    ],
    detail: {
      image: thumb,
      markdown: a.description || undefined,
      stats: [{ label: "Items", value: a.assetCount }],
      metadata: [
        ...(range ? [meta.text("Dates", range, { icon: Icons.calendar })] : []),
        ...(a.owner?.name ? [meta.person("Owner", a.owner.name)] : []),
        ...(people.length ? [meta.tags("Shared with", people)] : []),
      ],
    },
    actions: [
      action("Show Photos", () => albumGrid(s, a), { icon: Icons.image }),
      open(albumUrl(s.base, a.id), "Open in Immich", { icon: Icons.external }),
      copy(albumUrl(s.base, a.id), "Copy Album Link", { section: "Copy" }),
      copy(a.albumName, "Copy Album Name", { section: "Copy" }),
    ],
  };
}

let footer = "";

export default list({
  placeholder: "Filter albums…",
  empty: { title: "No albums yet", description: "Create albums in Immich to see them here", icon: Icons.layers },
  status: () => footer,
  async *items({ preferences, signal }) {
    let s: Server;
    let list: Album[];
    try {
      s = server(preferences);
      list = await albums(s, signal);
    } catch (e) {
      if (e instanceof SetupError) {
        yield [setupItem(e)];
        return;
      }
      throw e;
    }
    list.sort((a, b) =>
      Number(!!a.shared) - Number(!!b.shared) ||
      Date.parse(b.endDate ?? b.updatedAt ?? "") - Date.parse(a.endDate ?? a.updatedAt ?? "") ||
      a.albumName.localeCompare(b.albumName)
    );
    const total = list.reduce((n, a) => n + a.assetCount, 0);
    footer = `${plural(list.length, "album")} · ${plural(total, "item")}`;
    yield list.map((a) => albumItem(s, a));
    const covers = list.flatMap((a) => a.albumThumbnailAssetId ? [a.albumThumbnailAssetId] : []);
    const thumbs = await thumbnails(s, covers, { signal, deadline: 6000 });
    yield list.map((a) => albumItem(s, a, a.albumThumbnailAssetId ? thumbs.get(a.albumThumbnailAssetId) : undefined));
  },
});
