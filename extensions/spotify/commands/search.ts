import { type Context, Icons, type Item, list } from "@backslash/api";
import { client, liked } from "../api.ts";
import { KINDS, present, type SearchResponse, searchUrl } from "../lib.ts";
import { albumItem, artistItem, playlistItem, trackItem } from "../views.ts";

async function search(query: string, ctx: Context): Promise<Item[]> {
  if (!query.trim()) return [];
  const api = await client(ctx);
  const all = !ctx.filter || ctx.filter === "all";
  let res: SearchResponse | undefined;
  try {
    res = await api.get<SearchResponse>(searchUrl(query.trim(), ctx.filter, all ? 8 : 20), ctx.signal);
  } catch (e) {
    // Smaller pages for apps limited by Spotify.
    if (all || ctx.signal.aborted || !/limit/i.test((e as Error).message)) throw e;
    res = await api.get<SearchResponse>(searchUrl(query.trim(), ctx.filter, 10), ctx.signal);
  }
  const tracks = present(res?.tracks);
  const likedSet = await liked(api, tracks.map((t) => t.id));
  return [
    ...tracks.map((t) => trackItem(t, { liked: likedSet, section: all ? "Tracks" : undefined })),
    ...present(res?.artists).map((a) => artistItem(a, all ? "Artists" : undefined)),
    ...present(res?.albums).map((a) => albumItem(a, all ? "Albums" : undefined)),
    ...present(res?.playlists).map((p) => playlistItem(p, all ? "Playlists" : undefined)),
  ];
}

export default list({
  placeholder: "Search songs, artists, albums and playlists…",
  filter: { options: KINDS },
  empty: {
    title: "Search Spotify",
    description: "Enter plays on your active device; Ctrl+K for the queue, devices and more",
    icon: Icons.music,
  },
  status: (items) => items.length ? `${items.length} results · Spotify` : "Spotify",
  search,
});
