import { Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import { gameItem, isRecent } from "../items.ts";
import { dedupe, formatSize, type Game, type ProtonSummary, sortGames, type Source, SOURCES } from "../lib.ts";
import { cachedProton, fetchProton, heroic, lutris, steam } from "../sources.ts";

function build(games: Game[], proton: Map<string, ProtonSummary | null>, filter: string, unreadable: string[]): Item[] {
  const now = Date.now();
  const recent = games.filter((g) => isRecent(g, now)).slice(0, 6);
  // Grouped by launcher (one section each), alphabetical inside.
  const order = Object.keys(SOURCES);
  const rest = games.filter((g) => !recent.includes(g))
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source) || a.title.localeCompare(b.title));
  const item = (g: Game, section: string): Item => ({
    ...gameItem(g, g.appid ? proton.get(g.appid) : undefined, now),
    section,
  });
  const items = [
    ...recent.map((g) => item(g, "Recently Played")),
    ...rest.map((g) => item(g, filter === "all" ? SOURCES[g.source].title : "Installed")),
  ];
  if (unreadable.length && (filter === "all" || filter === "steam")) {
    items.push({
      id: "unreadable",
      title: `${unreadable.length} Steam library folder${unreadable.length > 1 ? "s" : ""} not available`,
      subtitle: unreadable.join(", "),
      icon: { source: Icons.info, tint: "gray" },
      section: "Notes",
      detail: {
        markdown: "Steam lists games in these folders, but they can't be read: the drive may be unmounted, " +
          "or the folder is outside **/mnt**, **/media** and **/run/media**, where this extension may look.\n\n" +
          unreadable.map((u) => `- ${u}`).join("\n"),
      },
      actions: [],
    });
  }
  return items;
}

export default list({
  placeholder: "Search your games…",
  filter: {
    options: [
      { value: "all", title: "All" },
      ...(Object.keys(SOURCES) as Source[]).map((value) => ({ value, title: SOURCES[value].title })),
    ],
  },
  empty: {
    title: "No games found",
    description: "Installed games of Steam (native or Flatpak), Lutris and Heroic show up here",
    icon: Icons.gamepad,
  },
  status: (items) => {
    const games = items.filter((i) => i.id !== "unreadable");
    return `${games.length} game${games.length === 1 ? "" : "s"}`;
  },
  async *items({ filter, signal }) {
    const mode = filter ?? "all";
    const [s, l, h] = await Promise.all([
      mode === "all" || mode === "steam" ? steam() : undefined,
      mode === "all" || mode === "lutris" ? lutris(signal) : undefined,
      mode === "all" || mode === "heroic" ? heroic() : undefined,
    ]);
    const games = sortGames(dedupe([...(s?.games ?? []), ...(l?.games ?? []), ...(h?.games ?? [])]));
    const unreadable = s?.unreadable ?? [];
    if (mode === "all") {
      const total = formatSize(games.reduce((n, g) => n + (g.sizeBytes ?? 0), 0));
      updateCommandMetadata({ subtitle: games.length ? `${games.length} games${total ? ` · ${total}` : ""}` : null })
        .catch(() => {});
    }
    // ProtonDB ratings: the cached ones right away, the others as they come.
    const proton = new Map<string, ProtonSummary | null>();
    const ids = games.filter((g) => g.appid).map((g) => g.appid!);
    const missing: string[] = [];
    for (const id of ids) {
      const hit = await cachedProton(id);
      if (hit === undefined) missing.push(id);
      else proton.set(id, hit);
    }
    yield build(games, proton, mode, unreadable);
    // Batches of 12, six requests at a time, so the list fills in progressively.
    for (let i = 0; i < missing.length && !signal.aborted; i += 12) {
      const pending = missing.slice(i, i + 12);
      let changed = false;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (pending.length && !signal.aborted) {
          const id = pending.shift()!;
          const summary = await fetchProton(id, signal).catch(() => null);
          if (summary) {
            proton.set(id, summary);
            changed = true;
          }
        }
      }));
      if (changed) yield build(games, proton, mode, unreadable);
    }
  },
});
