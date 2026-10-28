import { action, Icons, type Item, list } from "@backslash/api";
import { client } from "../api.ts";
import { type Paging, type Playlist, present } from "../lib.ts";
import { likedSongsView, playlistItem, signOutAction } from "../views.ts";

export default list({
  placeholder: "Filter your playlists…",
  empty: { title: "No playlists yet", description: "Playlists you create or follow show up here", icon: Icons.music },
  status: (items) => `${items.length - 1} playlists · Spotify`,
  async items(ctx) {
    const api = await client(ctx);
    const [me, playlists] = await Promise.all([
      api.get<{ id: string; display_name?: string }>("/me", ctx.signal),
      (async () => {
        const all: Playlist[] = [];
        let next: string | undefined = "/me/playlists?limit=50";
        while (next && all.length < 300) {
          const page: Paging<Playlist> | undefined = await api.get(next, ctx.signal);
          all.push(...present(page));
          next = page?.next ?? undefined;
        }
        return all;
      })(),
    ]);
    const liked: Item = {
      id: "liked-songs",
      title: "Liked Songs",
      subtitle: me?.display_name ?? undefined,
      icon: { source: Icons.heartFilled, tint: "green" },
      section: "Library",
      detail: { markdown: "Every song you saved with the heart." },
      actions: [action("Show Liked Songs", () => likedSongsView(), { icon: Icons.heartFilled }), signOutAction],
    };
    const mine = playlists.filter((p) => p.owner?.id === me?.id);
    const followed = playlists.filter((p) => p.owner?.id !== me?.id);
    return [
      liked,
      ...mine.map((p) => playlistItem(p, "Your Playlists")),
      ...followed.map((p) => playlistItem(p, "Followed")),
    ];
  },
});
