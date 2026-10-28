import { action, type Context, Icons, type Item, list, meta } from "@backslash/api";
import { type Playlist, quote } from "../lib.ts";
import { playlists, playlistSongs, type Prefs, replaceAndPlay, run } from "../music.ts";
import { act, errorItem, prefsOf, savePlaylistForm, songsList } from "../ui.ts";

export function playlistItem(p: Playlist, prefs: Prefs): Item {
  const modified = p.modified ? new Date(p.modified) : undefined;
  return {
    id: `playlist:${p.name}`,
    title: p.name,
    icon: { source: Icons.music, tint: "purple" },
    section: "Playlists",
    detail: {
      metadata: [
        meta.text("Playlist", p.name, { icon: Icons.music }),
        ...(modified && !Number.isNaN(modified.getTime())
          ? [
            meta.text("Modified", modified.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }), {
              icon: Icons.clock,
            }),
          ]
          : []),
      ],
    },
    actions: [
      act(prefs, "Play Playlist", (m) => replaceAndPlay(m, { playlist: p.name }), { icon: Icons.play }),
      act(prefs, "Add to Queue", (m) => m.command(`load ${quote(p.name)}`), { icon: Icons.plus, shortcut: "<Ctrl>a" }),
      act(prefs, "Shuffle Play", (m) => m.commands(["clear", `load ${quote(p.name)}`, "shuffle", "play 0"]), {
        icon: Icons.shuffle,
      }),
      action("Show Songs", () =>
        songsList(p.name, () => run(prefs, (m) => playlistSongs(m, p.name)), prefs, [
          act(prefs, "Play Playlist", (m) => replaceAndPlay(m, { playlist: p.name }), { icon: Icons.play }),
        ]), { icon: Icons.eye, shortcut: "<Ctrl>o" }),
      act(prefs, "Delete Playlist", (m) => m.command(`rm ${quote(p.name)}`), {
        icon: Icons.trash,
        section: "Danger",
        destructive: true,
        confirm: `Delete the playlist “${p.name}”?`,
      }),
    ],
  };
}

export default (ctx: Context) => {
  const prefs = prefsOf(ctx);
  return list({
    placeholder: "Filter playlists…",
    status: (items) => `${items.filter((i) => i.section === "Playlists").length} playlists`,
    empty: { title: "No playlist yet", description: "Save the queue as a playlist from Ctrl+K", icon: Icons.music },
    actions: [
      action("Save Queue as Playlist…", () => savePlaylistForm(prefs), { icon: Icons.plus, shortcut: "<Ctrl>n" }),
    ],
    async items() {
      try {
        return (await run(prefs, playlists)).map((p) => playlistItem(p, prefs));
      } catch (e) {
        return [await errorItem(e)];
      }
    },
  });
};
