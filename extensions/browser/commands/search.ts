import { copy, type Item, list, open } from "@backslash/api";
import { favicons, type Page, pages, profiles } from "../browsers.ts";
import { ago, domain } from "../lib.ts";

function item(p: Page, several: boolean, icon?: string): Item {
  const host = domain(p.url);
  return {
    id: p.url,
    title: p.title,
    subtitle: host,
    icon: icon ?? (p.bookmark ? "⭐" : "web-browser"),
    section: p.bookmark ? "Bookmarks" : "History",
    keywords: [p.url, host],
    accessories: [
      ...(several ? [{ tag: p.browser }] : []),
      ...(p.time > 0 ? [{ text: ago(p.time) }] : []),
    ],
    actions: [
      open(p.url, "Open in Browser"),
      copy(p.url, "Copy URL"),
      copy(`[${p.title}](${p.url})`, "Copy as Markdown Link"),
    ],
  };
}

export default list({
  placeholder: "Search history and bookmarks…",
  empty: {
    title: "No browser found",
    description: "Firefox, Chrome, Brave, Chromium, Edge and Vivaldi are supported",
  },
  async *items() {
    const all = pages();
    const several = new Set(profiles().map((p) => p.browser)).size > 1;
    // Bookmarks first, then history from the most recent visit.
    all.sort((a, b) => Number(b.bookmark) - Number(a.bookmark) || b.time - a.time);
    yield all.map((p) => item(p, several));
    // Favicons are slower: show the list first, then decorate it.
    const icons = favicons(all.slice(0, 600).map((p) => p.url));
    if (icons.size > 0) yield all.map((p) => item(p, several, icons.get(p.url)));
  },
});
