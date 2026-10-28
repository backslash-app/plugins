import { type Context, copy, Icons, type Item, list, meta, updateCommandMetadata } from "@backslash/api";
import type { Mpd } from "../client.ts";
import { audioFormat, clock, type Song, songLine, type Status } from "../lib.ts";
import { cover, type Prefs, queue, run, snapshot } from "../music.ts";
import { act, errorItem, libraryActions, modeTags, playerActions, prefsOf, queueActions, songMetadata } from "../ui.ts";

let status = "MPD";

function nowPlaying(st: Status, song: Song | undefined, art: string | undefined, prefs: Prefs): Item {
  const playing = st.state === "play";
  const where = st.duration
    ? `${clock(st.elapsed)} / ${clock(st.duration)}`
    : st.elapsed !== undefined
    ? clock(st.elapsed)
    : undefined;
  const actions = [
    ...playerActions(st, prefs),
    ...(song ? [copy(songLine(song), "Copy Song Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" })] : []),
    ...queueActions(st, prefs),
  ];
  if (!song) {
    return {
      id: "now",
      title: st.playlistLength ? "Stopped" : "Nothing to play",
      subtitle: st.playlistLength ? `${st.playlistLength} songs in the queue` : "Search the library to add songs",
      icon: { source: Icons.music, tint: "gray" },
      section: "Now Playing",
      detail: {
        metadata: [modeTags(st), ...(st.volume !== undefined ? [meta.progress("Volume", st.volume / 100)] : [])],
      },
      actions,
    };
  }
  return {
    id: "now",
    title: song.title,
    subtitle: [song.artist, song.album].filter(Boolean).join(" · ") || undefined,
    icon: art ?? { source: song.stream ? Icons.radio : Icons.music, tint: playing ? "green" : "gray" },
    section: "Now Playing",
    accessories: [
      ...(where ? [{ text: where }] : []),
      { icon: { source: playing ? Icons.play : Icons.pause, tint: playing ? "green" as const : "gray" as const } },
    ],
    detail: {
      image: art,
      metadata: songMetadata(song, [
        ...(st.duration ? [meta.progress("Position", (st.elapsed ?? 0) / st.duration, where)] : []),
        meta.text("State", playing ? "Playing" : st.state === "pause" ? "Paused" : "Stopped", {
          icon: playing ? Icons.play : Icons.pause,
          color: playing ? "green" : undefined,
        }),
        ...(st.volume !== undefined ? [meta.progress("Volume", st.volume / 100)] : []),
        modeTags(st),
        ...(audioFormat(st.audio)
          ? [meta.text("Format", `${audioFormat(st.audio)}${st.bitrate ? ` · ${st.bitrate} kbps` : ""}`)]
          : []),
        ...(st.error ? [meta.text("Error", st.error, { icon: Icons.alert, color: "red" })] : []),
      ]),
    },
    actions,
  };
}

function queueItem(s: Song, st: Status, prefs: Prefs): Item {
  const current = s.id === st.songId;
  const next = s.pos === st.nextSong;
  return {
    id: `queue:${s.id}`,
    title: s.title,
    subtitle: [s.artist, s.album].filter(Boolean).join(" · ") || undefined,
    icon: current
      ? { source: st.state === "play" ? Icons.play : Icons.pause, tint: "green" }
      : { source: s.stream ? Icons.radio : Icons.music, tint: "gray" },
    section: `Queue`,
    keywords: [s.artist ?? "", s.album ?? ""],
    accessories: [
      ...(current ? [{ tag: "Now", color: "green" as const }] : next ? [{ tag: "Next", color: "blue" as const }] : []),
      ...(s.duration ? [{ text: clock(s.duration) }] : []),
    ],
    detail: {
      metadata: songMetadata(s, [meta.text("Position in queue", `${(s.pos ?? 0) + 1} of ${st.playlistLength}`)]),
    },
    actions: [
      act(
        prefs,
        current && st.state === "play" ? "Pause" : "Play This Song",
        (m: Mpd) => m.command(current && st.state === "play" ? "pause 1" : `playid ${s.id}`),
        { icon: Icons.play },
      ),
      ...(st.song !== undefined && !current
        ? [
          act(prefs, "Play Next", (m: Mpd) =>
            m.command(`moveid ${s.id} ${(s.pos ?? 0) > st.song! ? st.song! + 1 : st.song!}`), {
            icon: Icons.next,
            shortcut: "<Ctrl>n",
          }),
        ]
        : []),
      act(prefs, "Remove from Queue", (m: Mpd) => m.command(`deleteid ${s.id}`), {
        icon: Icons.minus,
        shortcut: "<Ctrl>Delete",
        section: "Queue",
        destructive: true,
      }),
      ...playerActions(st, prefs).slice(1, 3),
      ...libraryActions(s, prefs).filter((a) => a.section === "Copy" || a.section === "Album").filter((a) =>
        !a.title.startsWith("Play Album")
      ),
      ...queueActions(st, prefs),
    ],
  };
}

export default (ctx: Context) => {
  const prefs = prefsOf(ctx);
  return list({
    placeholder: "Filter the queue…",
    status: () => status,
    empty: { title: "MPD", icon: Icons.music },
    // Polls every second for the position; the queue is reloaded only when it changes.
    async *items({ signal }) {
      let songs: Song[] = [];
      let version = -1;
      let lastKey = "";
      let lastSong = "";
      while (!signal.aborted) {
        let items: Item[];
        try {
          items = await run(prefs, async (m) => {
            const { status: st, current } = await snapshot(m);
            if (st.playlistVersion !== version) {
              songs = await queue(m);
              version = st.playlistVersion;
            }
            const art = prefs.covers === false ? undefined : await cover(m, current);
            const line = current && st.state !== "stop" ? songLine(current) : "";
            if (line !== lastSong) {
              lastSong = line;
              updateCommandMetadata({ subtitle: line ? `${st.state === "pause" ? "Paused · " : ""}${line}` : null })
                .catch(() => {});
            }
            const icon = st.state === "play" ? "▶" : st.state === "pause" ? "⏸" : "■";
            status = `${icon} ${st.playlistLength} song${st.playlistLength === 1 ? "" : "s"} in queue${
              st.volume !== undefined ? ` · volume ${st.volume} %` : ""
            }${st.updating ? " · updating library" : ""}`;
            return [nowPlaying(st, current, art, prefs), ...songs.map((s) => queueItem(s, st, prefs))];
          });
        } catch (e) {
          status = "MPD unavailable";
          items = [await errorItem(e)];
        }
        const key = JSON.stringify(
          items.map((
            i,
          ) => [i.id, i.title, i.subtitle, i.accessories, i.icon, i.detail, i.actions?.map((a) => a.title)]),
        );
        if (key !== lastKey) {
          lastKey = key;
          yield items;
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    },
  });
};
