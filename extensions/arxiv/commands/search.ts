import { type Context, Icons, list } from "@backslash/api";
import { byIds, saved, search } from "../api.ts";
import { buildQuery, parseId, type Sort } from "../lib.ts";
import { paperItem } from "../views.ts";

let footer = "";

export default (_ctx: Context) =>
  list({
    placeholder: 'Search arXiv: words, "a phrase", au:hinton, ti:transformer, cat:cs.LG, or an arXiv ID…',
    filter: {
      options: [
        { value: "relevance", title: "Relevance" },
        { value: "submittedDate", title: "Newest" },
        { value: "lastUpdatedDate", title: "Recently Updated" },
      ],
    },
    empty: { title: "No paper found", description: "Try fewer words, or au:name for an author", icon: Icons.file },
    status: () => footer,
    async search(query, { signal, filter }) {
      const q = query.trim();
      const c = { saved: new Set((await saved()).map((p) => p.id)) };
      if (!q) {
        footer = "arXiv.org";
        return [{
          id: "hint",
          title: "Type to search 2.5 million papers",
          subtitle: 'au:lecun · ti:diffusion · cat:cs.CV · "exact phrase" · 1706.03762',
          icon: { source: Icons.search, tint: "blue" },
          detail: {
            markdown: [
              "## Searching arXiv",
              "",
              "- Words are searched in titles, abstracts, authors and comments, all of them must match.",
              '- `"exact phrase"` keeps words together.',
              "- `au:hinton`, `ti:attention`, `abs:protein` search one field.",
              "- `cat:cs.LG` or `#cs.LG` limits to a category.",
              "- An arXiv ID or address (`2401.01234`, `arxiv.org/abs/…`) opens that paper.",
              "",
              "Tab switches between relevance, newest and recently updated.",
            ].join("\n"),
          },
        }];
      }
      const id = parseId(q);
      if (id && !/\s/.test(q)) {
        const found = await byIds([id.id], signal);
        footer = found.length ? `arXiv:${id.id}` : "No paper with this ID";
        return found.map((p) => paperItem(p, c));
      }
      const sort = (filter ?? "relevance") as Sort;
      const { papers, total } = await search(buildQuery(q), sort, signal);
      footer = `${total.toLocaleString("en")} result${total === 1 ? "" : "s"} · arXiv.org`;
      return papers.map((p) => paperItem(p, c, { date: sort === "lastUpdatedDate" ? "updated" : "published" }));
    },
  });
