import { copy, Icons, list, meta, open } from "@backslash/api";
import { ago, obsidianUri } from "../lib.ts";
import { indexVault, loadVaults, NO_VAULT, tildify } from "../vault.ts";

export default list({
  placeholder: "Open an Obsidian vault…",
  empty: NO_VAULT,
  status: (items) => `${items.length} vault${items.length === 1 ? "" : "s"}`,
  async *items() {
    const vaults = await loadVaults();
    const item = (v: (typeof vaults)[number], stats?: { notes: number; tags: number; words: string }) => ({
      id: v.path,
      title: v.name,
      subtitle: tildify(v.path),
      icon: { source: Icons.archive, tint: "purple" as const },
      accessories: [
        ...(v.open ? [{ tag: "Open", color: "green" as const }] : []),
        ...(stats ? [{ text: `${stats.notes} notes` }] : []),
        ...(v.ts ? [{ text: ago(v.ts), tooltip: "Last opened" }] : []),
      ],
      detail: {
        stats: stats
          ? [{ label: "Notes", value: stats.notes }, { label: "Tags", value: stats.tags }, {
            label: "Words",
            value: stats.words,
          }]
          : [],
        metadata: [
          meta.text("Path", tildify(v.path), { icon: Icons.folder }),
          ...(v.ts
            ? [
              meta.text(
                "Last opened",
                new Date(v.ts).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" }),
                { icon: Icons.clock },
              ),
            ]
            : []),
        ],
      },
      actions: [
        open(obsidianUri("open", { vault: v.name }), "Open in Obsidian"),
        open(v.path, "Show in Folder", { icon: Icons.folder }),
        copy(v.path, "Copy Path", { shortcut: "<Ctrl><Shift>c" }),
      ],
    });
    yield vaults.map((v) => item(v));
    // Counting notes reads every file: show the vaults first.
    const stats = await Promise.all(vaults.map(async (v) => {
      const notes = await indexVault(v);
      const words = notes.reduce((n, x) => n + x.body.split(/\s+/).filter(Boolean).length, 0);
      return {
        notes: notes.length,
        tags: new Set(notes.flatMap((n) => n.tags)).size,
        words: words >= 1000 ? `${Math.round(words / 1000)}k` : String(words),
      };
    }));
    yield vaults.map((v, i) => item(v, stats[i]));
  },
});
