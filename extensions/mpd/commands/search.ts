import { type Context, Icons, type Item, list } from "@backslash/api";
import { quote, type Song } from "../lib.ts";
import { playlists, run, search, stats } from "../music.ts";
import { act, errorItem, prefsOf, songItem } from "../ui.ts";
import { playlistItem } from "./playlists.ts";

let status = "";

/** Albums and artists found among the songs, most songs first. */
function groups(songs: Song[]) {
  const albums = new Map<string, { album: string; artist?: string; songs: Song[] }>();
  const artists = new Map<string, number>();
  for (const s of songs) {
    if (s.album) {
      const key = `${s.albumArtist ?? s.artist ?? ""}\n${s.album}`;
      const g = albums.get(key) ?? { album: s.album, artist: s.albumArtist ?? s.artist, songs: [] };
      g.songs.push(s);
      albums.set(key, g);
    }
    if (s.artist) artists.set(s.artist, (artists.get(s.artist) ?? 0) + 1);
  }
  return {
    albums: [...albums.values()].sort((a, b) => b.songs.length - a.songs.length).slice(0, 8),
    artists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 5),
  };
}

export default (ctx: Context) => {
  const prefs = prefsOf(ctx);
  return list({
    placeholder: "Search songs, artists, albums…",
    status: () => status,
    empty: {
      title: "Nothing found",
      description: "Search matches titles, artists, albums and file names",
      icon: Icons.music,
    },
    async search(query) {
      const text = query.trim();
      try {
        return await run(prefs, async (m) => {
          if (!text) {
            const [st, pls] = await Promise.all([stats(m), playlists(m)]);
            status = `${st.songs.toLocaleString("en-US")} songs · ${st.albums.toLocaleString("en-US")} albums · ${
              st.artists.toLocaleString("en-US")
            } artists`;
            return [
              {
                id: "hint",
                title: "Type to search your library",
                subtitle: status,
                icon: { source: Icons.search, tint: "gray" },
                section: "Library",
                actions: [act(prefs, "Update Library", (mm) => mm.command("update"), { icon: Icons.refresh })],
              },
              ...pls.map((p) => playlistItem(p, prefs)),
            ];
          }
          const songs = await search(m, text);
          status = `${songs.length}${songs.length === 150 ? "+" : ""} songs`;
          const { albums, artists } = groups(songs);
          const albumItems = albums.filter((g) =>
            g.songs.length > 1 || g.album.toLowerCase().includes(text.toLowerCase())
          ).map((g): Item => ({
            id: `album:${g.artist}:${g.album}`,
            title: g.album,
            subtitle: g.artist,
            icon: { source: Icons.layers, tint: "purple" },
            section: "Albums",
            accessories: [{ text: `${g.songs.length} found` }],
            actions: [
              act(
                prefs,
                "Play Album",
                (mm) =>
                  mm.commands([
                    "clear",
                    `findadd album ${quote(g.album)}${g.artist ? ` albumartist ${quote(g.artist)}` : ""}`,
                    "play 0",
                  ]),
                { icon: Icons.play },
              ),
              act(
                prefs,
                "Add Album to Queue",
                (mm) =>
                  mm.command(`findadd album ${quote(g.album)}${g.artist ? ` albumartist ${quote(g.artist)}` : ""}`),
                { icon: Icons.plus },
              ),
            ],
          }));
          const artistItems = artists.filter(([a]) => a.toLowerCase().includes(text.toLowerCase())).map((
            [a, n],
          ): Item => ({
            id: `artist:${a}`,
            title: a,
            icon: { source: Icons.person, tint: "blue" },
            section: "Artists",
            accessories: [{ text: `${n} found` }],
            actions: [
              act(prefs, `Play ${a}`, (mm) => mm.commands(["clear", `findadd artist ${quote(a)}`, "play 0"]), {
                icon: Icons.play,
              }),
              act(prefs, "Add to Queue", (mm) => mm.command(`findadd artist ${quote(a)}`), { icon: Icons.plus }),
              act(
                prefs,
                "Shuffle Artist",
                (mm) => mm.commands(["clear", `findadd artist ${quote(a)}`, "shuffle", "play 0"]),
                { icon: Icons.shuffle },
              ),
            ],
          }));
          return [...songs.map((s) => songItem(s, prefs, "Songs")), ...albumItems, ...artistItems];
        });
      } catch (e) {
        status = "MPD unavailable";
        return [await errorItem(e)];
      }
    },
  });
};
