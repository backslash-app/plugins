import * as api from "@backslash/api";
import { copy, list } from "@backslash/api";

// paste() came with Backslash 0.4; older launchers only copy.
const pasteFirst = (text: string) => ("paste" in api ? [api.paste(text, "Paste Emoji")] : []);
import data from "../emoji.json" with { type: "json" };

// Names are "common words · official unicode name"; the title keeps the
// official name and the common words become search keywords.
const official = (name: string) => name.split(" · ").pop()!;
const title = (name: string) => official(name).replace(/\b\w/g, (c) => c.toUpperCase());

export default list({
  placeholder: "Search emoji and symbols…",
  layout: "grid",
  columns: 8,
  items: (data as [string, string][]).map(([emoji, name]) => {
    const codepoints = [...emoji]
      .filter((c) => c !== "️")
      .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
      .join(" ");
    return {
      id: codepoints,
      title: title(name),
      subtitle: codepoints,
      icon: emoji,
      keywords: name.includes(" · ") ? [name.split(" · ")[0], ...name.split(" ")] : name.split(" "),
      actions: [
        ...pasteFirst(emoji),
        copy(emoji, "Copy Emoji"),
        copy(title(name), "Copy Name"),
        copy(codepoints, "Copy Code Point"),
      ],
    };
  }),
});
