// Pieces shared by the commands: icons, posters, the search command.

import { action, type Icon, Icons, toast } from "@backslash/api";
import { api, type App, posterKey, posters } from "./api.ts";
import { APPS, type Kind, mediaCoverPath, POSTER_HOSTS } from "./lib.ts";

export const KIND_ICON: Record<Kind, { source: string; tint: "blue" | "orange" | "green" }> = {
  sonarr: { source: Icons.monitor, tint: "blue" },
  radarr: { source: Icons.film, tint: "orange" },
  lidarr: { source: Icons.music, tint: "green" },
};

const publicPoster = (url?: string) =>
  url && POSTER_HOSTS.some((h) => url.startsWith(`https://${h}/`)) ? url : undefined;

export interface WithPoster {
  kind: Kind;
  libraryId?: number;
  poster?: { path?: string; remote?: string };
}

/** Each entry's poster: the server's cached cover, else the public one (TheTVDB, TMDB). */
export async function loadPosters<T extends WithPoster>(
  entries: [App, T][],
  signal?: AbortSignal,
): Promise<Map<T, string>> {
  const wanted = entries.flatMap(([app, e]) => {
    const path = mediaCoverPath(e.kind, e.poster?.path, e.libraryId);
    return path ? [{ app, path, entry: e }] : [];
  });
  const files = await posters(wanted, { signal, deadline: 2500 });
  const out = new Map<T, string>();
  for (const w of wanted) {
    const file = files.get(posterKey(w.app, w.path));
    if (file) out.set(w.entry, file);
  }
  for (const [, e] of entries) {
    const remote = publicPoster(e.poster?.remote);
    if (!out.has(e) && remote) out.set(e, remote);
  }
  return out;
}

export const iconFor = (kind: Kind, poster?: string): Icon => poster ?? KIND_ICON[kind];

/** Asks the app to search for a release now (Sonarr EpisodeSearch, Radarr MoviesSearch, Lidarr AlbumSearch). */
export function searchAction(app: App, ids: { episode?: number; movie?: number; album?: number; series?: number }) {
  const body = ids.episode
    ? { name: "EpisodeSearch", episodeIds: [ids.episode] }
    : ids.movie
    ? { name: "MoviesSearch", movieIds: [ids.movie] }
    : ids.album
    ? { name: "AlbumSearch", albumIds: [ids.album] }
    : ids.series
    ? { name: "SeriesSearch", seriesId: ids.series }
    : undefined;
  if (!body) return [];
  return [
    action("Search for Release", async () => {
      await api(app, "/command", { method: "POST", body });
      await toast(`${APPS[app.kind].title} is searching the indexers`, { style: "success" });
    }, { icon: Icons.search, shortcut: "<Ctrl>s" }),
  ];
}
