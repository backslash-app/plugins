import { action, type Context, Icons, type Item, list, open, refresh } from "@backslash/api";
import { obsidianUri, score, snippet } from "../lib.ts";
import { indexVault, loadVaults, NO_VAULT, noteItem, todayNote } from "../vault.ts";

let footer = "";

export default async (_ctx: Context) => {
  const vaults = await loadVaults();
  const several = vaults.length > 1;
  return list({
    placeholder: several
      ? "Search notes in all vaults by title, alias, #tag or text…"
      : "Search notes by title, alias, #tag or text…",
    filter: several
      ? { options: [{ value: "all", title: "All Vaults" }, ...vaults.map((v) => ({ value: v.path, title: v.name }))] }
      : undefined,
    empty: vaults.length
      ? { title: "No matching note", description: "Press Enter on “Create” to start one", icon: Icons.note }
      : NO_VAULT,
    status: () => footer,
    actions: [action("Reload Vaults", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" })],
    async search(query, { filter }) {
      const shown = !filter || filter === "all" ? vaults : vaults.filter((v) => v.path === filter);
      if (!shown.length) return [];
      const notes = (await Promise.all(shown.map((v) => indexVault(v)))).flat();
      const q = query.trim();
      const items: Item[] = [];
      if (!q) {
        footer = `${notes.length} notes${several ? ` in ${shown.length} vaults` : ` · ${shown[0].name}`}`;
        const daily = await todayNote(shown[0]);
        items.push({
          id: "daily",
          title: daily.exists ? "Open Today's Daily Note" : "Create Today's Daily Note",
          subtitle: daily.path,
          icon: { source: Icons.calendar, tint: "purple" },
          section: "Daily",
          accessories: several ? [{ text: shown[0].name }] : [],
          actions: [
            open(
              daily.exists
                ? obsidianUri("open", { vault: shown[0].name, file: daily.path.replace(/\.md$/, "") })
                : obsidianUri("daily", { vault: shown[0].name }),
              daily.exists ? "Open Daily Note" : "Create Daily Note",
            ),
          ],
        });
        const recent = [...notes].sort((a, b) => b.modified - a.modified).slice(0, 40);
        for (const n of recent) items.push(noteItem(n, { several, section: "Recently Modified" }));
        return items;
      }
      const ranked = notes
        .map((n) => ({ n, s: score({ ...n, content: n.body }, q) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s || b.n.modified - a.n.modified);
      footer = `${ranked.length} of ${notes.length} notes`;
      for (const { n, s } of ranked.slice(0, 60)) {
        // Content-only matches show where the words are.
        const inContent = s < 3 * q.split(/\s+/).length;
        items.push(
          noteItem(n, {
            several,
            section: inContent ? "Text Matches" : "Notes",
            subtitle: inContent ? snippet(n.body, q) : undefined,
          }),
        );
      }
      const target = shown[0];
      items.push({
        id: "create",
        title: `Create “${q}”`,
        subtitle: several ? `New note in ${target.name}` : "New note",
        icon: { source: Icons.plus, tint: "green" },
        section: "Create",
        actions: [
          open(obsidianUri("new", { vault: target.name, name: q }), "Create Note in Obsidian", { icon: Icons.plus }),
        ],
      });
      return items;
    },
  });
};
