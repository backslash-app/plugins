import { action, clipboard, type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { ENGINE_NAMES, preview } from "../lib.ts";
import { last, selection, speaking } from "../system.ts";
import { engineFor, installItem, prefsOf, stopAction, textItem } from "../ui.ts";
import { voicesList } from "./voices.ts";

let status = "";

export default (ctx: Context) => {
  const prefs = prefsOf(ctx);
  return list({
    placeholder: "Type something to read aloud…",
    status: () => status,
    async search(query) {
      const [{ engine, piperWithoutModel }, busy] = await Promise.all([engineFor(prefs), speaking()]);
      if (!engine) {
        status = "No speech engine";
        return [await installItem(piperWithoutModel)];
      }
      status = `${ENGINE_NAMES[engine]}${busy ? " · speaking" : ""}`;
      if (!busy) updateCommandMetadata({ subtitle: null }).catch(() => {});
      const items: Item[] = [];
      if (busy) {
        items.push({
          id: "stop",
          title: "Stop Speaking",
          subtitle: "Reading in the background",
          icon: { source: Icons.stop, tint: "red" },
          section: "Now",
          actions: [stopAction()],
        });
      }
      if (query.trim()) {
        items.push(textItem("typed", "Speak Text", query, prefs, "Speak", Icons.text));
        return items;
      }
      const [clip, sel, prev] = await Promise.all([clipboard.read().catch(() => ""), selection(), last()]);
      if (clip.trim()) items.push(textItem("clipboard", "Speak Clipboard", clip, prefs, "Speak", Icons.paste));
      if (sel.trim() && sel.trim() !== clip.trim()) {
        items.push(textItem("selection", "Speak Selected Text", sel, prefs, "Speak", Icons.text));
      }
      if (prev && prev.text.trim() !== clip.trim()) {
        const item = textItem("last", "Speak Again", prev.text, prefs, "Recent", Icons.history);
        items.push({ ...item, subtitle: preview(prev.text, 70) });
      }
      items.push({
        id: "voices",
        title: "Voices",
        subtitle: "Choose the default voice of each engine",
        icon: { source: Icons.settings, tint: "gray" },
        section: "Settings",
        actions: [action("Show Voices", () => voicesList(ctx), { icon: Icons.speaker })],
      });
      return items;
    },
  });
};
