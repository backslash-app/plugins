import {
  action,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  updateCommandMetadata,
} from "@backslash/api";
import { clock, type Player } from "../lib.ts";
import { call, cover, players, raise, setLoop, setShuffle, setVolume } from "../mpris.ts";

async function item(p: Player): Promise<Item> {
  const playing = p.status === "Playing";
  const act = (title: string, run: () => Promise<unknown>, options = {}) =>
    action(title, async () => {
      await run();
      return refresh();
    }, options);
  const art = await cover(p);
  const progress = p.length > 0 ? p.position / p.length : undefined;
  const where = p.length > 0 ? `${clock(p.position)} / ${clock(p.length)}` : undefined;
  const song = [p.title, p.artist].filter(Boolean).join(" – ");
  return {
    id: p.bus,
    title: p.title,
    subtitle: p.artist || undefined,
    icon: art ?? { source: Icons.music, tint: playing ? "green" : "gray" },
    section: playing ? "Playing" : "Paused",
    keywords: [p.name, p.artist, p.album],
    accessories: [
      ...(where ? [{ text: where }] : []),
      { icon: { source: playing ? Icons.play : Icons.pause, tint: playing ? "green" : "gray" }, text: p.name },
    ],
    detail: {
      image: art,
      metadata: [
        ...(p.artist ? [meta.text("Artist", p.artist, { icon: Icons.person })] : []),
        ...(p.album ? [meta.text("Album", p.album, { icon: Icons.music })] : []),
        meta.text("Player", `${p.name} · ${playing ? "playing" : p.status.toLowerCase()}`, {
          icon: playing ? Icons.play : Icons.pause,
          color: playing ? "green" : undefined,
        }),
        ...(progress !== undefined ? [meta.progress("Position", progress, where)] : []),
        ...(p.volume !== undefined ? [meta.progress("Volume", p.volume)] : []),
        ...(p.shuffle !== undefined ? [meta.text("Shuffle", p.shuffle ? "On" : "Off", { icon: Icons.shuffle })] : []),
        ...(p.loop ? [meta.text("Repeat", p.loop === "None" ? "Off" : p.loop, { icon: Icons.repeat })] : []),
      ],
    },
    actions: [
      act(playing ? "Pause" : "Play", () => call(p, "PlayPause"), { icon: playing ? Icons.pause : Icons.play }),
      ...(p.canNext ? [act("Next Track", () => call(p, "Next"), { icon: Icons.next, shortcut: "<Ctrl>n" })] : []),
      ...(p.canPrevious
        ? [act("Previous Track", () => call(p, "Previous"), { icon: Icons.previous, shortcut: "<Ctrl>p" })]
        : []),
      ...(p.volume !== undefined
        ? [
          act(`Volume Up (${Math.round(p.volume * 100)} %)`, () => setVolume(p, p.volume! + 0.1), {
            icon: Icons.speaker,
            shortcut: "<Ctrl>Up",
            section: "Volume",
          }),
          act("Volume Down", () => setVolume(p, p.volume! - 0.1), {
            icon: Icons.speaker,
            shortcut: "<Ctrl>Down",
            section: "Volume",
          }),
          submenu(
            "Set Volume",
            [100, 75, 50, 25, 0].map((v) =>
              act(v === 0 ? "Mute" : `${v} %`, () => setVolume(p, v / 100), { icon: Icons.speaker })
            ),
            { icon: Icons.speaker, section: "Volume" },
          ),
        ]
        : []),
      ...(p.shuffle !== undefined
        ? [act(p.shuffle ? "Turn Shuffle Off" : "Turn Shuffle On", () => setShuffle(p, !p.shuffle), {
          icon: Icons.shuffle,
          shortcut: "<Ctrl>s",
          section: "Player",
        })]
        : []),
      ...(p.loop
        ? [submenu(
          "Repeat",
          (["None", "Track", "Playlist"] as const).map((l) =>
            act(l === "None" ? "Off" : l, () => setLoop(p, l), { icon: Icons.repeat })
          ),
          { icon: Icons.repeat, section: "Player" },
        )]
        : []),
      ...(p.canRaise
        ? [action(`Show ${p.name}`, () => raise(p).then(() => undefined), { icon: Icons.window, section: "Player" })]
        : []),
      ...(p.url ? [open(p.url, "Open Track Page", { section: "Player" })] : []),
      copy(song, "Copy Song Name", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      ...(p.url ? [copy(p.url, "Copy Track Link", { section: "Copy" })] : []),
    ],
  };
}

export default list({
  placeholder: "Filter players…",
  empty: {
    title: "Nothing is playing",
    description: "Start Spotify, a video in your browser, VLC or mpv",
    icon: "bs-music",
  },
  status: (items) => items.length > 1 ? `${items.length} players` : items[0]?.subtitle ?? "Media",
  // Refreshed every two seconds while open, for the position and track changes.
  async *items({ signal }) {
    let last = "";
    let lastSong = "";
    while (!signal.aborted) {
      const found = await players();
      const items = await Promise.all(found.map(item));
      const now = found.find((p) => p.status === "Playing");
      const song = now ? [now.artist, now.title].filter(Boolean).join(" — ") : "";
      if (song !== lastSong) {
        lastSong = song;
        updateCommandMetadata({ subtitle: song || null }).catch(() => {});
      }
      const key = JSON.stringify(items.map((i) => [i.title, i.accessories, i.icon, i.detail]));
      if (key !== last) {
        last = key;
        yield items;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
});
