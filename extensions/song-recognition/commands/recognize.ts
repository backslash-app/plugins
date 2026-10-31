import { action, type Context, Icons, type Item, list, refresh } from "@backslash/api";
import { parseSeconds, parseSource, type Source } from "../lib.ts";
import { family, history, recognize, record, remember, tools } from "../system.ts";
import { historyItems, missingItem, songItem } from "../ui.ts";

let footer = "";

const again = action("Listen Again", () => refresh(), { icon: Icons.mic, shortcut: "<Ctrl>r" });

function listeningItem(source: Source, elapsed: number, seconds: number): Item {
  return {
    id: "listening",
    title: elapsed < seconds ? "Listening…" : "Asking Shazam…",
    subtitle: source === "mic" ? "Hold the microphone near the music" : "To what plays on this computer",
    icon: { source: source === "mic" ? Icons.mic : Icons.speaker, tint: "blue" },
    section: "Now",
    accessories: elapsed < seconds ? [{ text: `${seconds - elapsed} s` }] : undefined,
    detail: {
      metadata: [{
        label: "Listening",
        progress: Math.min(1, elapsed / seconds),
        value: `${Math.min(elapsed, seconds)} / ${seconds} s`,
      }],
    },
    actions: [again],
  };
}

function failedItem(title: string, subtitle: string, source: Source): Item {
  return {
    id: "failed",
    title,
    subtitle,
    icon: { source: Icons.question, tint: "orange" },
    section: "Now",
    detail: {
      markdown: source === "output"
        ? `**${title}**\n\n${subtitle}\n\nTab switches to the microphone.`
        : `**${title}**\n\n${subtitle}\n\nTab switches to what plays on this computer.`,
    },
    actions: [again],
  };
}

export default (start: Context) =>
  list({
    placeholder: "Recognized songs…",
    filter: {
      options: [{ value: "output", title: "This Computer" }, { value: "mic", title: "Microphone" }],
      default: parseSource(start.preferences.source),
    },
    empty: { title: "No songs yet", description: "Play some music and open Recognize Song", icon: Icons.music },
    status: () => footer,
    async *items(ctx) {
      const { signal } = ctx;
      const source = parseSource(ctx.filter ?? ctx.preferences.source);
      const seconds = parseSeconds(ctx.preferences.seconds);
      const [t, past] = await Promise.all([tools(), history()]);
      const rest = historyItems(past, [again]);
      footer = `${past.length} songs recognized`;
      if (!t.songrec || !t.recorder) {
        yield [missingItem(t, await family()), ...rest];
        return;
      }
      // A countdown while recording.
      let elapsed = 0;
      let settled = false;
      const recording = record(t.recorder, source, seconds, signal, (s) => (elapsed = s));
      recording.then(() => (settled = true), () => (settled = true));
      while (!settled && !signal.aborted) {
        yield [listeningItem(source, elapsed, seconds), ...rest];
        await Promise.race([recording.catch(() => {}), new Promise((r) => setTimeout(r, 1000))]);
      }
      let file: string;
      try {
        file = await recording;
      } catch (e) {
        if (signal.aborted) return;
        yield [failedItem("Couldn't listen", (e as Error).message, source), ...rest];
        return;
      }
      yield [listeningItem(source, seconds, seconds), ...rest];
      try {
        const song = await recognize(file, source);
        if (signal.aborted) return;
        if (!song) {
          yield [
            failedItem(
              "No match",
              source === "mic"
                ? "Get closer to the music, or try when it's louder"
                : "Turn the volume up, or try another part of the song",
              source,
            ),
            ...rest,
          ];
          return;
        }
        await remember(song);
        footer = `${past.length + 1} songs recognized`;
        yield [songItem(song, "Just Now", [again]), ...historyItems((await history()).slice(1), [again])];
      } catch (e) {
        yield [failedItem("Couldn't recognize the song", (e as Error).message, source), ...rest];
      }
    },
  });
