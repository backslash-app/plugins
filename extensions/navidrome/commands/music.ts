import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { type CoverRequest, covers, subsonicCover } from "../api.ts";
import { distro, mpvInstalled, nowPlaying } from "../player.ts";
import {
  albumItem,
  artistItem,
  type Ctx,
  noMpvItem,
  nowPlayingItem,
  playlistItem,
  problemItem,
  randomMixAction,
  serversFrom,
  setupItem,
  songItem,
} from "../views.ts";

type View = "newest" | "recent" | "random" | "starred" | "frequent" | "playlists";

const VIEWS: { value: View; title: string }[] = [
  { value: "newest", title: "Recently Added" },
  { value: "recent", title: "Recently Played" },
  { value: "starred", title: "Starred" },
  { value: "playlists", title: "Playlists" },
  { value: "random", title: "Random" },
  { value: "frequent", title: "Most Played" },
];

let status = "";

export default (ctx: Context) => {
  const { sub, abs, problems } = serversFrom(ctx.preferences);
  const c: Ctx = { sub, abs, pics: new Map(), speed: 1 };
  const mpv = mpvInstalled();
  return list({
    placeholder: "Search artists, albums and songs…",
    filter: { options: VIEWS },
    empty: { title: "Nothing found", description: "Try another title or artist", icon: Icons.music },
    status: () => status,
    actions: sub ? [randomMixAction(sub, c)] : [],
    async search(query, { signal, filter }) {
      const head: Item[] = problems.filter((p) => p.id === "problem:subsonic");
      if (!sub) {
        status = "Not connected";
        return head.length ? head : [setupItem("subsonic")];
      }
      const q = query.trim();
      const [player, hasMpv] = await Promise.all([nowPlaying(abs), mpv]);
      updateCommandMetadata({ subtitle: player ? `Playing ${player.entry?.title ?? player.playing.title}` : null })
        .catch(
          () => {},
        );
      if (!hasMpv) head.push(noMpvItem(await distro()));
      if (player && !q) head.push(nowPlayingItem(player, c));
      const view = (VIEWS.some((v) => v.value === filter) ? filter : "newest") as View;
      try {
        const want = (rs: (CoverRequest | undefined)[]) =>
          covers(rs.filter((r): r is CoverRequest => r !== undefined), { signal, deadline: q ? 2000 : 3000 });
        if (q) {
          const { artists, albums, songs } = await sub.search(q, signal);
          c.pics = await want([
            ...albums.map((a) => subsonicCover(sub, a.coverArt)),
            ...songs.map((s) => subsonicCover(sub, s.coverArt)),
          ]);
          status = `${artists.length} artists · ${albums.length} albums · ${songs.length} songs`;
          return [
            ...head,
            ...artists.map((a) => artistItem(sub, a, c)),
            ...albums.map((a) => albumItem(sub, a, c, { section: "Albums" })),
            ...songs.map((s) => songItem(sub, s, c, { section: "Songs" })),
          ];
        }
        if (view === "playlists") {
          const lists = await sub.playlists(signal);
          c.pics = await want(lists.map((p) => subsonicCover(sub, p.coverArt)));
          status = `${lists.length} playlist${lists.length === 1 ? "" : "s"}`;
          return [...head, ...lists.map((p) => playlistItem(sub, p, c))];
        }
        if (view === "starred") {
          const { artists, albums, songs } = await sub.starred(signal);
          c.pics = await want([
            ...albums.map((a) => subsonicCover(sub, a.coverArt)),
            ...songs.map((s) => subsonicCover(sub, s.coverArt)),
          ]);
          status = `${albums.length} starred albums · ${songs.length} songs`;
          return [
            ...head,
            ...albums.map((a) => albumItem(sub, a, c, { section: "Starred Albums" })),
            ...songs.map((s, i) =>
              songItem(sub, s, c, { section: "Starred Songs", queue: songs, index: i, queueTitle: "Starred Songs" })
            ),
            ...artists.map((a) => artistItem(sub, a, c)),
          ];
        }
        const albums = await sub.albums(view, 40, signal);
        c.pics = await want(albums.map((a) => subsonicCover(sub, a.coverArt)));
        status = `${albums.length} albums · ${sub.base.replace(/^https?:\/\//, "")}`;
        const section = VIEWS.find((v) => v.value === view)!.title;
        return [...head, ...albums.map((a) => albumItem(sub, a, c, { section }))];
      } catch (e) {
        if (signal.aborted) throw e;
        status = "";
        return [...head, problemItem(e as Error, "subsonic", sub.base)];
      }
    },
  });
};
