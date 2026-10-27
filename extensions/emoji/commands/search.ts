import * as api from "@backslash/api";
import { copy, list, storage } from "@backslash/api";

// paste() came with Backslash 0.4; older launchers only copy.
const pasteFirst = (text: string) => ("paste" in api ? [api.paste(text, "Paste Emoji")] : []);
import data from "../emoji.json" with { type: "json" };

// Names are "common words · official unicode name"; the title keeps the
// official name and the common words become search keywords.
const official = (name: string) => name.split(" · ").pop()!;
const title = (name: string) => official(name).replace(/\b\w/g, (c) => c.toUpperCase());

/** Emoji picked recently, most recent first. */
async function recent(): Promise<string[]> {
  return ((await storage.get<string[]>("recent").catch(() => undefined)) ?? []).slice(0, 16);
}

async function remember(emoji: string) {
  const list = (await recent()).filter((e) => e !== emoji);
  await storage.set("recent", [emoji, ...list].slice(0, 16));
}

/** Runs `then` after remembering the emoji, for the "Recently used" row. */
const remembering = (emoji: string, actions: api.Action[]): api.Action[] =>
  actions.map((a) =>
    a.title.startsWith("Paste") || a.title === "Copy Emoji"
      ? api.action(a.title, async () => {
        await remember(emoji);
        if (a.title.startsWith("Paste")) await api.clipboard.paste(emoji);
        else {
          await api.clipboard.write(emoji);
          return api.close("Copied");
        }
      }, { icon: a.icon, shortcut: a.shortcut })
      : a
  );

const all = (data as [string, string][]).map(([emoji, name]) => {
  const codepoints = [...emoji]
    .filter((c) => c !== "️")
    .map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`)
    .join(" ");
  return {
    id: codepoints,
    title: title(name),
    subtitle: codepoints,
    icon: emoji,
    section: "All",
    keywords: name.includes(" · ") ? [name.split(" · ")[0], ...name.split(" ")] : name.split(" "),
    actions: remembering(emoji, [
      ...pasteFirst(emoji),
      copy(emoji, "Copy Emoji"),
      copy(title(name), "Copy Name"),
      copy(codepoints, "Copy Code Point"),
    ]),
  };
});

export default list({
  placeholder: "Search emoji and symbols…",
  layout: "grid",
  columns: 8,
  status: (items) => `${items.length} emoji`,
  items: async () => {
    const used = await recent();
    const byEmoji = new Map(all.map((i) => [i.icon, i]));
    const top = used.map((e) => byEmoji.get(e)).filter((i) => i !== undefined).map((i) => ({
      ...i!,
      id: `recent:${i!.id}`,
      section: "Recently used",
    }));
    return [...top, ...all];
  },
});
