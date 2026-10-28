import { copy, Icons, type Item, list, meta, open } from "@backslash/api";
import { favicons, type Page, pages, profiles } from "../browsers.ts";
import { ago, domain } from "../lib.ts";

const when = (ms: number) =>
  new Date(ms).toLocaleString("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

function item(p: Page, several: boolean, icon?: string): Item {
  const host = domain(p.url);
  return {
    id: `${p.bookmark ? "b" : "h"}:${p.url}`,
    title: p.title || host,
    subtitle: host,
    icon: icon ?? (p.bookmark ? { source: Icons.starFilled, tint: "yellow" } : { source: Icons.globe, tint: "gray" }),
    section: p.bookmark ? "Bookmarks" : "History",
    keywords: [p.url, host],
    accessories: [
      ...(p.visits > 1 ? [{ text: `${p.visits}×`, tooltip: `${p.visits} visits` }] : []),
      ...(several ? [{ text: p.browser }] : []),
      ...(p.time > 0 ? [{ text: ago(p.time) }] : []),
    ],
    detail: {
      metadata: [
        meta.link("Address", p.url.length > 80 ? `${p.url.slice(0, 80)}…` : p.url, p.url),
        meta.text("Site", host, { icon: Icons.globe }),
        ...(p.bookmark ? [meta.text("Bookmark", "Yes", { icon: Icons.starFilled, color: "yellow" })] : []),
        ...(p.time > 0 ? [meta.text(p.bookmark ? "Added" : "Last visit", when(p.time), { icon: Icons.clock })] : []),
        ...(p.visits ? [meta.text("Visits", p.visits)] : []),
        meta.text("Browser", p.browser),
      ],
    },
    actions: [
      open(p.url, "Open in Browser"),
      copy(p.url, "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
      copy(`[${p.title}](${p.url})`, "Copy as Markdown Link", { section: "Copy" }),
      copy(p.title, "Copy Title", { section: "Copy" }),
    ],
  };
}

export default list({
  placeholder: "Search history and bookmarks…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "bookmarks", title: "Bookmarks" },
      { value: "history", title: "History" },
    ],
  },
  empty: {
    title: "No browser found",
    description: "Firefox, Chrome, Brave, Chromium, Edge and Vivaldi are supported",
    icon: "bs-globe",
  },
  status: (items) => `${items.length} page${items.length === 1 ? "" : "s"}`,
  async *items({ filter }) {
    let all = pages();
    if (filter === "bookmarks") all = all.filter((p) => p.bookmark);
    if (filter === "history") all = all.filter((p) => !p.bookmark);
    const several = new Set(profiles().map((p) => p.browser)).size > 1;
    // Bookmarks first, then history from the most recent visit.
    all.sort((a, b) => Number(b.bookmark) - Number(a.bookmark) || b.time - a.time);
    yield all.map((p) => item(p, several));
    // Favicons are slower: show the list first, then decorate it.
    const icons = favicons(all.slice(0, 600).map((p) => p.url));
    if (icons.size > 0) yield all.map((p) => item(p, several, icons.get(p.url)));
  },
});
