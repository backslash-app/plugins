import { type Context, Icons, list } from "@backslash/api";
import { mapUnsplash, mapWallhaven, unsplashUrl, wallhavenUrl } from "../lib.ts";
import { downloadedNames, type Prefs, unsplashHeaders } from "../system.ts";
import { errorItem, onlineItem, unsplashSetupItem } from "../ui.ts";

let count = 0;
let source = "Wallhaven";

export default (ctx: Context) => {
  const prefs = ctx.preferences as Prefs;
  return list({
    layout: "grid",
    columns: 4,
    placeholder: "Search wallpapers: mountains, city night, minimal…",
    filter: {
      options: [{ value: "wallhaven", title: "Wallhaven" }, { value: "unsplash", title: "Unsplash" }],
      default: "wallhaven",
    },
    empty: { title: "No wallpapers found", description: "Try other words", icon: Icons.search },
    status: () => (count ? `${count} from ${source}` : source),
    async search(query, { filter, signal }) {
      const names = await downloadedNames(prefs);
      if (filter === "unsplash") {
        source = "Unsplash";
        count = 0;
        const key = String(prefs.unsplashKey ?? "").trim();
        if (!key) return [unsplashSetupItem()];
        const res = await fetch(unsplashUrl(query), { headers: unsplashHeaders(key), signal }).catch((e) => {
          if (signal.aborted) throw e;
          return undefined;
        });
        if (!res) return [errorItem("Unsplash can't be reached", "Check your connection")];
        if (res.status === 401) return [unsplashSetupItem()];
        if (res.status === 403) {
          return [errorItem("Unsplash's hourly limit is reached", "Demo apps get 50 requests an hour")];
        }
        if (!res.ok) return [errorItem("Unsplash didn't answer", `HTTP ${res.status}`)];
        const photos = mapUnsplash(await res.json());
        count = photos.length;
        return photos.map((w) => onlineItem(w, prefs, names.has(`unsplash-${w.id}.jpg`)));
      }
      source = query.trim() ? "Wallhaven" : "Wallhaven · top this month";
      count = 0;
      const url = wallhavenUrl(query, { sketchy: !!prefs.sketchy, atleast: String(prefs.minResolution ?? "").trim() });
      const res = await fetch(url, { signal }).catch((e) => {
        if (signal.aborted) throw e;
        return undefined;
      });
      if (!res) return [errorItem("Wallhaven can't be reached", "Check your connection")];
      if (res.status === 429) return [errorItem("Wallhaven asks to slow down", "Wait a minute and search again")];
      if (!res.ok) return [errorItem("Wallhaven didn't answer", `HTTP ${res.status}`)];
      const walls = mapWallhaven(await res.json());
      count = walls.length;
      return walls.map((w) => onlineItem(w, prefs, names.has(`wallhaven-${w.id}.${w.ext}`)));
    },
  });
};
