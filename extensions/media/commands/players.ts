import { action, copy, type Item, list, refresh } from "@backslash/api";
import { clock, type Player } from "../lib.ts";
import { call, cover, players, raise, setVolume } from "../mpris.ts";

async function item(p: Player): Promise<Item> {
  const playing = p.status === "Playing";
  const act = (title: string, method: string, options = {}) =>
    action(title, async () => {
      await call(p, method);
      return refresh();
    }, options);
  const progress = p.length > 0 ? `${clock(p.position)} / ${clock(p.length)}` : undefined;
  return {
    id: p.bus,
    title: p.title,
    subtitle: [p.artist, p.album].filter(Boolean).join(" — ") || p.name,
    icon: (await cover(p)) ?? (playing ? "▶️" : "⏸️"),
    keywords: [p.name, p.artist, p.album],
    accessories: [
      ...(progress ? [{ text: progress }] : []),
      { tag: p.name, color: playing ? "green" : "gray" },
    ],
    actions: [
      act(playing ? "Pause" : "Play", "PlayPause", { icon: playing ? "media-playback-pause" : "media-playback-start" }),
      ...(p.canNext ? [act("Next Track", "Next", { icon: "media-skip-forward", shortcut: "<Ctrl>n" })] : []),
      ...(p.canPrevious
        ? [act("Previous Track", "Previous", { icon: "media-skip-backward", shortcut: "<Ctrl>p" })]
        : []),
      ...(p.volume !== undefined
        ? [
          action(`Volume Up (${Math.round(p.volume * 100)}%)`, async () => {
            await setVolume(p, p.volume! + 0.1);
            return refresh();
          }, { icon: "audio-volume-high", shortcut: "<Ctrl>Up" }),
          action("Volume Down", async () => {
            await setVolume(p, p.volume! - 0.1);
            return refresh();
          }, { icon: "audio-volume-low", shortcut: "<Ctrl>Down" }),
        ]
        : []),
      ...(p.canRaise ? [action(`Show ${p.name}`, () => raise(p).then(() => undefined), { icon: "window-new" })] : []),
      copy([p.title, p.artist].filter(Boolean).join(" – "), "Copy Song Name"),
    ],
  };
}

export default list({
  placeholder: "Filter players…",
  empty: { title: "Nothing is playing", description: "Start Spotify, a video in your browser, VLC or mpv" },
  // Refreshed every two seconds while open, for the position and track changes.
  async *items({ signal }) {
    let last = "";
    while (!signal.aborted) {
      const items = await Promise.all((await players()).map(item));
      const key = JSON.stringify(items.map((i) => [i.title, i.accessories, i.icon]));
      if (key !== last) {
        last = key;
        yield items;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
  },
});
