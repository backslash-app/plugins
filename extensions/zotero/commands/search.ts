import { Icons, list } from "@backslash/api";
import { find, SetupError } from "../source.ts";
import { setupItems, zoteroItem } from "../zotero.ts";

let footer = "";

export default list({
  placeholder: "Search by title, author, year or #tag…",
  empty: { title: "No matching item", description: "Titles, creators and years; #tag for tags", icon: Icons.book },
  status: () => footer,
  async search(query, { signal }) {
    try {
      const { items, kind, total } = await find(query, signal);
      const source = kind === "api"
        ? "Zotero local API"
        : `Zotero database${total ? ` · ${total.toLocaleString("en")} items` : ""}`;
      footer = `${
        query.trim() ? `${items.length} result${items.length === 1 ? "" : "s"}` : "Recently added"
      } · ${source}`;
      return items.map((i) => ({ ...zoteroItem(i, kind), section: query.trim() ? "Items" : "Recently Added" }));
    } catch (e) {
      if (!(e instanceof SetupError)) throw e;
      footer = "";
      return await setupItems(e);
    }
  },
});
