import { Icons, list } from "@backslash/api";
import { metadataSearch, type Server, server, SetupError, setupItem, smartSearch, thumbnails } from "../api.ts";
import { assetView, plural } from "../lib.ts";
import { assetItem } from "../views.ts";

let footer = "";

export default list({
  layout: "grid",
  columns: 5,
  placeholder: "Describe a photo: “dog on the beach”, “snow in Paris”…",
  filter: {
    options: [
      { value: "smart", title: "Smart" },
      { value: "filename", title: "File Name" },
      { value: "favorites", title: "Favorites" },
    ],
    default: "smart",
  },
  empty: {
    title: "No photos found",
    description: "Describe what is in the picture, or search by file name with Tab",
    icon: Icons.image,
  },
  status: () => footer,
  async search(query, { preferences, signal, filter }) {
    let s: Server;
    try {
      s = server(preferences);
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
    const q = query.trim();
    try {
      const assets = filter === "favorites"
        ? await metadataSearch(s, { isFavorite: true }, signal)
        : !q
        ? await metadataSearch(s, {}, signal)
        : filter === "filename"
        ? await metadataSearch(s, { originalFileName: q }, signal)
        : await smartSearch(s, q, signal);
      if (signal.aborted) return [];
      const views = assets.map(assetView);
      // Favorites are filtered here by the launcher as the user types.
      const shown = filter === "favorites" && q
        ? views.filter((a) =>
          [a.name, a.place, a.camera, ...a.people].join(" ").toLowerCase().includes(q.toLowerCase())
        )
        : views;
      const thumbs = await thumbnails(s, shown.map((a) => a.id), { signal, deadline: 4000 });
      footer = !q && filter !== "favorites"
        ? `${plural(shown.length, "recent photo")}`
        : plural(shown.length, "result");
      return shown.map((a) => assetItem(s, a, thumbs.get(a.id)));
    } catch (e) {
      if (e instanceof SetupError) return [setupItem(e)];
      throw e;
    }
  },
});
