import { action, close, copy, detail, Icons, type Item, list, meta, open, openExternal, storage } from "@backslash/api";
import { parseWikiSearch, type WikiHit, wikitextToMarkdown, wikiUrl } from "../lib.ts";
import { reach } from "../devdocs.ts";

const API = "https://wiki.archlinux.org/api.php";

async function remember(title: string) {
  const recent = (await storage.get<string[]>("wiki-recent")) ?? [];
  await storage.set("wiki-recent", [title, ...recent.filter((t) => t !== title)].slice(0, 12));
}

async function article(title: string) {
  const url = `${API}?action=parse&format=json&formatversion=2&redirects=1&prop=wikitext|sections&page=${
    encodeURIComponent(title)
  }`;
  const res = await reach(url);
  if (!res.ok) throw new Error(`wiki.archlinux.org answered ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error.info ?? "Page not found");
  await remember(data.parse.title);
  const page = data.parse.title as string;
  const sections = (data.parse.sections ?? []) as { line: string; toclevel: number }[];
  const markdown = wikitextToMarkdown(data.parse.wikitext ?? "");
  const words = (data.parse.wikitext as string).split(/\s+/).length;
  return detail({
    title: page,
    markdown: `# ${page}\n\n${markdown}`,
    metadata: [
      meta.text("Article", page, { icon: Icons.book }),
      meta.text("Sections", sections.filter((s) => s.toclevel === 1).length, { icon: Icons.text }),
      meta.text("Reading time", `${Math.max(1, Math.round(words / 230))} min`, { icon: Icons.clock }),
      ...(sections.length
        ? [
          meta.tags(
            "Contents",
            sections.filter((s) => s.toclevel === 1).slice(0, 10).map((s) => s.line.replace(/<[^>]+>/g, "")),
          ),
        ]
        : []),
      meta.separator(),
      meta.link("Wiki", `wiki.archlinux.org/title/${page.replace(/ /g, "_")}`.slice(0, 60), wikiUrl(page)),
    ],
    status: "Arch Wiki · CC BY-SA 4.0",
    actions: [
      open(wikiUrl(page), "Open in Browser"),
      copy(wikiUrl(page), "Copy URL", { shortcut: "<Ctrl><Shift>c" }),
      copy(`[${page}](${wikiUrl(page)})`, "Copy as Markdown Link"),
    ],
  });
}

function item(hit: WikiHit, section?: string): Item {
  const url = wikiUrl(hit.title);
  const updated = hit.timestamp ? new Date(hit.timestamp) : undefined;
  return {
    id: hit.title,
    title: hit.title,
    subtitle: hit.snippet || undefined,
    icon: { source: Icons.book, tint: "blue" },
    section,
    accessories: hit.words ? [{ text: `${hit.words.toLocaleString("en")} words`, tooltip: "Article length" }] : [],
    detail: section ? undefined : {
      markdown: hit.snippet ? `…${hit.snippet}…` : undefined,
      metadata: [
        meta.text("Article", hit.title, { icon: Icons.book }),
        ...(hit.words ? [meta.text("Words", hit.words.toLocaleString("en"), { icon: Icons.text })] : []),
        ...(hit.words
          ? [meta.text("Reading time", `${Math.max(1, Math.round(hit.words / 230))} min`, { icon: Icons.clock })]
          : []),
        ...(updated
          ? [
            meta.text("Updated", updated.toLocaleDateString("en-GB", { dateStyle: "medium" }), {
              icon: Icons.calendar,
            }),
          ]
          : []),
        meta.separator(),
        meta.link("Wiki", url.replace(/^https:\/\//, "").slice(0, 60), url),
      ],
    },
    actions: [
      action("Read Here", () => article(hit.title), { icon: Icons.book }),
      action("Open in Browser", async () => {
        await openExternal(url);
        await remember(hit.title);
        return close();
      }, { icon: Icons.external }),
      copy(url, "Copy URL", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
      copy(`[${hit.title}](${url})`, "Copy as Markdown Link", { section: "Copy" }),
    ],
  };
}

let summary = "";

export default list({
  placeholder: "Search the Arch Wiki…",
  empty: { title: "Nothing found on the Arch Wiki", icon: Icons.search },
  status: () => summary,
  async search(query, { signal }) {
    summary = "";
    if (!query.trim()) {
      const recent = (await storage.get<string[]>("wiki-recent")) ?? [];
      return recent.map((title) => item({ title, snippet: "" }, "Recently Read"));
    }
    const url = `${API}?action=query&list=search&format=json&formatversion=2&srlimit=25` +
      `&srprop=snippet|wordcount|size|timestamp&srsearch=${encodeURIComponent(query)}`;
    const res = await reach(url, signal);
    if (!res.ok) throw new Error(`wiki.archlinux.org answered ${res.status}`);
    const { total, hits } = parseWikiSearch(await res.text());
    summary = `${total.toLocaleString("en")} article${total === 1 ? "" : "s"}`;
    const search = `https://wiki.archlinux.org/index.php?search=${encodeURIComponent(query)}&fulltext=1`;
    return [
      ...hits.map((h) => item(h)),
      {
        id: "search-web",
        title: `Search “${query}” on wiki.archlinux.org`,
        icon: { source: Icons.globe, tint: "gray" },
        section: "More",
        actions: [open(search, "Open Search Page")],
      },
    ];
  },
});
