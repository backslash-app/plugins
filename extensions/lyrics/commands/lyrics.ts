import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { lyricsFor } from "../api.ts";
import { sameSong, type Track } from "../lib.ts";
import { current, distro, NoPlayerctl } from "../system.ts";
import { idleItem, liveItems, type Lyrics, lyricsOf, noPlayerctlItem, searchList } from "../views.ts";

let footer = "";

/** Waits `ms`, or less if the view is left. */
const pause = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const t = setTimeout(done, ms);
    function done() {
      clearTimeout(t);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done);
  });

export default (ctx: Context) => {
  const preferred = String(ctx.preferences.player ?? "").trim();
  const offset = (Number(ctx.preferences.offset) || 0) / 1000;
  const searchView = () => searchList(preferred);
  return list({
    placeholder: "Filter lines…",
    empty: { title: "No line matches", icon: Icons.text },
    status: () => footer,
    // Re-reads the player every second and yields the lines again, the one sung now under "Now".
    async *items({ signal }) {
      let song: Track | undefined;
      let lyrics: Lyrics | undefined;
      let failed: Item | undefined;
      while (!signal.aborted) {
        let track: Track | undefined;
        try {
          track = await current(preferred, signal);
        } catch (e) {
          if (!(e instanceof NoPlayerctl)) throw e;
          footer = "";
          yield [noPlayerctlItem(await distro())];
          return;
        }
        if (!track) {
          song = undefined;
          footer = "Nothing playing";
          yield [idleItem(searchView)];
          await pause(3000, signal);
          continue;
        }
        if (!sameSong(track, song)) {
          song = track;
          lyrics = undefined;
          failed = undefined;
          footer = `Looking up ${track.title}…`;
          try {
            const record = await lyricsFor(track, signal);
            lyrics = record ? lyricsOf(record) : undefined;
          } catch (e) {
            if (signal.aborted) return;
            failed = {
              id: "error",
              title: "Couldn't fetch the lyrics",
              subtitle: (e as Error).message,
              icon: { source: Icons.alert, tint: "red" },
              actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
            };
          }
          if (signal.aborted) return;
          // The lookup took a while: read the position again.
          track = (await current(preferred, signal).catch(() => undefined)) ?? track;
        }
        footer = [
          track.player,
          lyrics ? (lyrics.lines.length ? "synced lyrics" : lyrics.plain ? "plain lyrics" : "instrumental") : "",
          "LRCLIB",
        ].filter(Boolean).join(" · ");
        const items = failed ? [failed] : liveItems(track, lyrics, { position: track.position, offset, searchView });
        yield items;
        // Follow closely while synced lines are sung; check for a new song now and then otherwise.
        await pause(lyrics?.lines.length && track.status === "Playing" ? 1000 : 3000, signal);
      }
    },
  });
};
