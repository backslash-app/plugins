import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { favorites, searchStations, topStations } from "../api.ts";
import { countryParams, mergeResults, playerChoice, type Station } from "../lib.ts";
import { distro, findPlayer, nowPlaying, song } from "../player.ts";
import { noPlayerItem, nowPlayingItem, stationItem } from "../views.ts";

type View = "stations" | "country" | "favorites";

let playingName: string | undefined;

const matches = (s: Station, q: string) =>
  !q || `${s.name} ${s.tags ?? ""} ${s.country ?? ""}`.toLowerCase().includes(q.toLowerCase());

export default (ctx: Context) => {
  const choices = playerChoice(ctx.preferences.player);
  const home = String(ctx.preferences.country ?? "").trim();
  const player = findPlayer(choices);
  return list({
    placeholder: "Search stations by name or genre: fip, jazz, lofi, bbc…",
    filter: {
      options: [
        { value: "stations", title: "Stations" },
        { value: "country", title: "By Country" },
        { value: "favorites", title: "Favorites" },
      ],
    },
    empty: { title: "No station found", description: "Try a genre (jazz) or another spelling", icon: Icons.radio },
    status: (items) => {
      const n = items.filter((i) => !["now-playing", "no-player", "country-hint"].includes(i.id ?? "")).length;
      return [playingName && `Playing ${playingName}`, `${n} station${n === 1 ? "" : "s"}`, "radio-browser.info"]
        .filter(Boolean).join(" · ");
    },
    async search(query, { signal, filter }) {
      const view = (filter ?? "stations") as View;
      const q = query.trim();
      const [favs, current, found] = await Promise.all([favorites(), nowPlaying(), player]);
      playingName = current?.station.name.trim();
      updateCommandMetadata({ subtitle: current ? `Playing ${current.station.name.trim()}` : null }).catch(() => {});
      const fav = new Set(favs.map((f) => f.stationuuid));
      const item = (s: Station, section?: string) =>
        stationItem(s, {
          favorite: fav.has(s.stationuuid),
          playing: current?.station.stationuuid === s.stationuuid,
          choices,
          section,
        });

      const head: Item[] = [];
      if (!found) head.push(noPlayerItem(await distro()));
      if (current && !q) head.push(nowPlayingItem(current, current.player === "mpv" ? await song() : undefined));

      if (view === "favorites") return [...head, ...favs.filter((s) => matches(s, q)).map((s) => item(s, "Favorites"))];

      if (view === "country") {
        const where = q || home;
        if (!where) {
          return [...head, {
            id: "country-hint",
            title: "Type a country: France, FR, Japan, US…",
            subtitle: "or set your country in the extension's preferences",
            icon: { source: Icons.globe, tint: "blue" },
          }];
        }
        const stations = await searchStations(countryParams(where), signal, 60);
        return [...head, ...stations.map((s) => item(s, `Top in ${stations[0]?.country || where}`))];
      }

      if (!q) {
        const top = await topStations(signal);
        return [
          ...head,
          ...favs.map((s) => item(s, "Favorites")),
          ...top.filter((s) => !fav.has(s.stationuuid)).map((s) => item(s, "Top Voted")),
        ];
      }
      const [byName, byTag] = await Promise.all([
        searchStations({ name: q }, signal),
        searchStations({ tag: q.toLowerCase() }, signal).catch((e) => {
          if (signal.aborted) throw e;
          return [] as Station[];
        }),
      ]);
      return [...head, ...mergeResults(byName, byTag, q).map((s) => item(s))];
    },
  });
};
