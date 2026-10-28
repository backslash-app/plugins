import { type Context, Icons, type Item, list, type ListSpec } from "@backslash/api";
import { ENGINE_NAMES } from "../lib.ts";
import { chooseVoice, chosenVoices, voices } from "../system.ts";
import { engineFor, installItem, prefsOf, voiceItem } from "../ui.ts";

export function voicesList(ctx: Context): ListSpec {
  const prefs = prefsOf(ctx);
  return list({
    title: "Voices",
    placeholder: "Filter voices by name or language (fr, en-us)…",
    status: (items) =>
      `${items.length} voices${prefs.voice ? ` · the “voice” preference overrides: ${prefs.voice}` : ""}`,
    async items() {
      const { available, piperWithoutModel } = await engineFor(prefs);
      if (!available.size) return [await installItem(piperWithoutModel)];
      const chosen = await chosenVoices();
      const all = await Promise.all([...available].map((e) => voices(e, prefs)));
      const items: Item[] = all.flat().map((v) => voiceItem(v, chosen[v.engine] === v.id, () => chooseVoice(v), prefs));
      for (const e of available) {
        if (e === "festival") {
          items.push({
            id: "festival",
            title: "Festival's default voice",
            subtitle: "Festival picks its voice itself",
            icon: { source: Icons.speaker, tint: "gray" },
            section: ENGINE_NAMES.festival,
          });
        }
      }
      return items;
    },
  });
}

export default (ctx: Context) => voicesList(ctx);
