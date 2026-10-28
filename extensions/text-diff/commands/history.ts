import { action, type Context, copy, Icons, type Item, list } from "@backslash/api";
import { type ClipEntry, firstLine, plural, relativeTime, splitLines } from "../lib.ts";
import { contextOf, diffView, type Prefs, readHistory } from "../views.ts";

function preview(e: ClipEntry): string {
  const lines = e.text.split("\n");
  const shown = lines.slice(0, 30).map((l) => (l.length > 200 ? `${l.slice(0, 199)}…` : l));
  return ["```", ...shown, ...(lines.length > 30 ? ["…"] : []), "```"].join("\n");
}

function entryItem(e: ClipEntry, actions: Item["actions"], section?: string): Item {
  const lines = splitLines(e.text).lines.length;
  return {
    id: String(e.id),
    title: firstLine(e.text) || "(blank)",
    subtitle: relativeTime(e.time),
    icon: { source: lines > 1 ? Icons.file : Icons.text, tint: "blue" },
    section,
    accessories: [
      ...(e.pinned ? [{ icon: Icons.pin, tooltip: "Pinned" }] : []),
      { text: plural(lines, "line") },
    ],
    detail: { markdown: preview(e) },
    actions,
  };
}

// Pick the original among recent copies, then what to compare it with.
export default (ctx: Context) => {
  const context = contextOf(ctx.preferences as Prefs);
  let count = 0;
  return list({
    placeholder: "Pick the original text…",
    empty: {
      title: "No clipboard history",
      description: "Backslash records what you copy (Settings → Clipboard). Copy two texts, then come back.",
      icon: Icons.history,
    },
    status: () => `${plural(count, "copy")} in Backslash's clipboard history · Enter picks the original`,
    async items() {
      const history = await readHistory();
      count = history.length;
      return history.map((first, index) => {
        const others = history.filter((e) => e.id !== first.id && e.text !== first.text);
        // The history is newest first: the next copy is the closest newer one.
        const next = history.slice(0, index).reverse().find((e) => e.text !== first.text);
        return entryItem(first, [
          action("Compare With…", () =>
            list({
              title: `Compare “${firstLine(first.text, 30)}” With`,
              placeholder: "Pick the changed text…",
              items: others.map((second) =>
                entryItem(second, [
                  action("Compare", () =>
                    diffView({
                      left: first.text,
                      right: second.text,
                      labels: [`copy ${relativeTime(first.time)}`, `copy ${relativeTime(second.time)}`],
                      options: {},
                      context,
                    }), { icon: Icons.arrowRight }),
                ], second.time > first.time ? "Newer" : "Older")
              ),
            }), { icon: Icons.arrowRight }),
          ...(next
            ? [
              action("Compare With the Next Copy", () =>
                diffView({
                  left: first.text,
                  right: next.text,
                  labels: [`copy ${relativeTime(first.time)}`, `copy ${relativeTime(next.time)}`],
                  options: {},
                  context,
                }), { icon: Icons.next, shortcut: "<Ctrl>n" }),
            ]
            : []),
          copy(first.text, "Copy Text", { section: "Copy" }),
        ]);
      });
    },
  });
};
