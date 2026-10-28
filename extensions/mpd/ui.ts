// Items and actions shared by the commands.

import {
  type Action,
  action,
  type Context,
  copy,
  field,
  form,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  pop,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { type Mpd, MpdError, Unreachable } from "./client.ts";
import {
  albumLine,
  clock,
  installMarkdown,
  modeName,
  nextMode,
  quote,
  type Song,
  songLine,
  type Status,
} from "./lib.ts";
import { add, family, playNext, playNow, type Prefs, run, setVolume, startService } from "./music.ts";

export const prefsOf = (ctx: Context) => ctx.preferences as Prefs;

/** An action that talks to MPD, then reloads the view. */
export const act = (
  prefs: Prefs,
  title: string,
  fn: (mpd: Mpd) => Promise<unknown>,
  options: Parameters<typeof action>[2] = {},
) =>
  action(title, async () => {
    try {
      await run(prefs, fn);
    } catch (e) {
      if (e instanceof MpdError) {
        await toast(e.message, { style: "failure" });
        return;
      }
      throw e;
    }
    return refresh();
  }, options);

/** The empty state when MPD can't be reached, or refuses the password. */
export async function errorItem(e: unknown): Promise<Item> {
  if (e instanceof MpdError && /password|permission/i.test(e.message)) {
    return {
      id: "password",
      title: "MPD wants a password",
      subtitle: e.message,
      icon: { source: Icons.lock, tint: "orange" },
      detail: { markdown: "Set the **Password** preference of this extension to MPD's `password` setting." },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    };
  }
  if (e instanceof MpdError) {
    return {
      id: "error",
      title: "MPD answered with an error",
      subtitle: e.message,
      icon: { source: Icons.alert, tint: "red" },
      detail: { markdown: `\`${e.message}\`` },
      actions: [action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    };
  }
  if (!(e instanceof Unreachable)) throw e;
  return {
    id: "unreachable",
    title: e.message,
    subtitle: "Start it, or install the Music Player Daemon",
    icon: { source: Icons.alert, tint: "orange" },
    detail: { markdown: installMarkdown(await family()) },
    actions: [
      action("Start MPD", async () => {
        try {
          await startService();
        } catch (err) {
          await toast("Couldn't start mpd.service", { style: "failure", message: (err as Error).message });
          return;
        }
        return refresh();
      }, { icon: Icons.play }),
      action("Check Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

export function songMetadata(s: Song, extra: Metadata[] = []): Metadata[] {
  return [
    ...(s.artist ? [meta.text("Artist", s.artist, { icon: Icons.person })] : []),
    ...(albumLine(s) ? [meta.text("Album", albumLine(s)!, { icon: Icons.music })] : []),
    ...(s.albumArtist && s.albumArtist !== s.artist ? [meta.text("Album artist", s.albumArtist)] : []),
    ...(s.track ? [meta.text("Track", s.track, { icon: Icons.hash })] : []),
    ...(s.genre ? [meta.tags("Genre", s.genre.split(/[;,]\s*/))] : []),
    ...(s.duration ? [meta.text("Duration", clock(s.duration), { icon: Icons.clock })] : []),
    ...(s.stream ? [meta.text("Stream", s.name ?? s.file, { icon: Icons.radio })] : []),
    ...extra,
    meta.separator(),
    meta.text("File", s.file, { icon: Icons.file }),
  ];
}

/** Play now, play next, add to the queue, the whole album. */
export function libraryActions(s: Song, prefs: Prefs): Action[] {
  return [
    act(prefs, "Play Now", (m) => playNow(m, [s.file]), { icon: Icons.play }),
    act(prefs, "Play Next", (m) => playNext(m, [s.file]), { icon: Icons.next, shortcut: "<Ctrl>n" }),
    act(prefs, "Add to Queue", (m) => add(m, [s.file]), { icon: Icons.plus, shortcut: "<Ctrl>a" }),
    ...(s.album
      ? [
        act(prefs, "Play Album", async (m) => {
          await m.commands([
            "clear",
            `findadd album ${quote(s.album!)}${s.albumArtist ? ` albumartist ${quote(s.albumArtist)}` : ""}`,
            "play 0",
          ]);
        }, { icon: Icons.music, section: "Album" }),
        act(prefs, "Add Album to Queue", (m) =>
          m.command(`findadd album ${quote(s.album!)}${s.albumArtist ? ` albumartist ${quote(s.albumArtist)}` : ""}`), {
          icon: Icons.plus,
          section: "Album",
        }),
      ]
      : []),
    ...(s.artist
      ? [act(prefs, `Add Everything by ${s.artist}`, (m) => m.command(`findadd artist ${quote(s.artist!)}`), {
        icon: Icons.person,
        section: "Album",
      })]
      : []),
    copy(songLine(s), "Copy Song Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(s.file, "Copy File Path", { section: "Copy" }),
  ];
}

export function songItem(s: Song, prefs: Prefs, section?: string): Item {
  return {
    id: `song:${s.file}`,
    title: s.title,
    subtitle: [s.artist, s.album].filter(Boolean).join(" · "),
    icon: { source: s.stream ? Icons.radio : Icons.music, tint: "gray" },
    section,
    keywords: [s.artist ?? "", s.album ?? "", s.file],
    accessories: s.duration ? [{ text: clock(s.duration) }] : [],
    detail: { metadata: songMetadata(s) },
    actions: libraryActions(s, prefs),
  };
}

// ---------------------------------------------------------------------------
// Player controls

export function modeTags(st: Status): Metadata {
  return meta.tags("Modes", [
    { text: "Random", color: st.random ? "green" : "gray" },
    { text: "Repeat", color: st.repeat ? "green" : "gray" },
    { text: `Single${st.single === "oneshot" ? " once" : ""}`, color: st.single !== "0" ? "green" : "gray" },
    { text: `Consume${st.consume === "oneshot" ? " once" : ""}`, color: st.consume !== "0" ? "green" : "gray" },
  ]);
}

export function playerActions(st: Status, prefs: Prefs): Action[] {
  const playing = st.state === "play";
  const vol = st.volume;
  return [
    act(prefs, playing ? "Pause" : "Play", (m) => m.command(playing ? "pause 1" : "play"), {
      icon: playing ? Icons.pause : Icons.play,
    }),
    act(prefs, "Next Track", (m) => m.command("next"), { icon: Icons.next, shortcut: "<Ctrl>n" }),
    act(prefs, "Previous Track", (m) => m.command("previous"), { icon: Icons.previous, shortcut: "<Ctrl>p" }),
    act(prefs, "Stop", (m) => m.command("stop"), { icon: Icons.stop, section: "Playback" }),
    submenu("Seek", [
      act(prefs, "Forward 10 Seconds", (m) => m.command("seekcur +10"), { icon: Icons.arrowRight }),
      act(prefs, "Forward 1 Minute", (m) => m.command("seekcur +60"), { icon: Icons.arrowRight }),
      act(prefs, "Back 10 Seconds", (m) => m.command("seekcur -10"), { icon: Icons.previous }),
      act(prefs, "Restart Song", (m) => m.command("seekcur 0"), { icon: Icons.refresh }),
    ], { icon: Icons.clock, section: "Playback" }),
    ...(vol !== undefined
      ? [
        act(prefs, `Volume Up (${vol} %)`, (m) => setVolume(m, vol + 5), {
          icon: Icons.speaker,
          shortcut: "<Ctrl>Up",
          section: "Volume",
        }),
        act(prefs, "Volume Down", (m) => setVolume(m, vol - 5), {
          icon: Icons.speaker,
          shortcut: "<Ctrl>Down",
          section: "Volume",
        }),
        submenu(
          "Set Volume",
          [100, 80, 60, 40, 20, 0].map((v) =>
            act(prefs, v === 0 ? "Mute" : `${v} %`, (m) => setVolume(m, v), {
              icon: v ? Icons.speaker : Icons.speakerOff,
            })
          ),
          { icon: Icons.speaker, section: "Volume" },
        ),
      ]
      : []),
    submenu("Modes", [
      act(prefs, `Random: ${st.random ? "On" : "Off"}`, (m) => m.command(`random ${st.random ? 0 : 1}`), {
        icon: Icons.shuffle,
      }),
      act(prefs, `Repeat: ${st.repeat ? "On" : "Off"}`, (m) => m.command(`repeat ${st.repeat ? 0 : 1}`), {
        icon: Icons.repeat,
      }),
      act(prefs, `Single: ${modeName(st.single)}`, (m) => m.command(`single ${nextMode(st.single)}`), {
        icon: Icons.repeat,
      }),
      act(prefs, `Consume: ${modeName(st.consume)}`, (m) => m.command(`consume ${nextMode(st.consume)}`), {
        icon: Icons.trash,
      }),
    ], { icon: Icons.settings, shortcut: "<Ctrl>m", section: "Playback" }),
    act(prefs, st.random ? "Turn Random Off" : "Turn Random On", (m) => m.command(`random ${st.random ? 0 : 1}`), {
      icon: Icons.shuffle,
      shortcut: "<Ctrl>s",
      section: "Playback",
    }),
  ];
}

export function queueActions(st: Status, prefs: Prefs): Action[] {
  if (!st.playlistLength) return [];
  return [
    act(prefs, "Shuffle Queue", (m) => m.command("shuffle"), { icon: Icons.shuffle, section: "Queue" }),
    action("Save Queue as Playlist…", () => savePlaylistForm(prefs), { icon: Icons.plus, section: "Queue" }),
    act(prefs, "Clear Queue", (m) => m.command("clear"), {
      icon: Icons.trash,
      section: "Danger",
      destructive: true,
      confirm: `Remove the ${st.playlistLength} songs from the queue?`,
    }),
  ];
}

export function savePlaylistForm(prefs: Prefs) {
  return form({
    title: "Save Queue as Playlist",
    submitTitle: "Save",
    fields: [field.text("name", "Playlist name", { required: true })],
    async submit(values) {
      const name = String(values.name).trim();
      try {
        await run(prefs, (m) => m.command(`save ${quote(name)}`));
      } catch (e) {
        if (e instanceof MpdError) {
          await toast(e.message, { style: "failure" });
          return;
        }
        throw e;
      }
      await toast(`Saved “${name}”`, { style: "success" });
      return pop();
    },
  });
}

/** A list of songs (a playlist's), each playable from there. */
export function songsList(title: string, load: () => Promise<Song[]>, prefs: Prefs, extra: Action[] = []): ListSpec {
  return list({
    title,
    placeholder: "Filter songs…",
    status: (items) => `${items.length} songs`,
    actions: extra,
    items: async () => (await load()).map((s) => songItem(s, prefs)),
  });
}
