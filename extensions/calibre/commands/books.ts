import {
  action,
  clipboard,
  type Context,
  Icons,
  type Item,
  list,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { BOOK_EXTENSIONS, copiedFiles, expandHome, formatOrder, type Order, search, sortBooks } from "../lib.ts";
import { addBooks, books, distro, HOME, installed, locate, SetupError } from "../library.ts";
import { bookItem, type Ctx, setupItems } from "../views.ts";

let footer = "";

const ORDERS: { value: Order; title: string }[] = [
  { value: "recent", title: "Recently Added" },
  { value: "title", title: "Title" },
  { value: "author", title: "Author" },
  { value: "series", title: "Series" },
];

export default async (ctx: Context) => {
  const p = ctx.preferences;
  const lib = await locate(p.library);
  const c: Ctx = {
    lib,
    server: {
      url: String(p.serverUrl ?? "").trim() || undefined,
      user: String(p.serverUser ?? "").trim() || undefined,
      password: String(p.serverPassword ?? "") || undefined,
    },
    order: formatOrder(p.formats),
    exportDir: expandHome(String(p.exportDir ?? "").trim() || "~/Downloads", HOME),
  };
  return list({
    placeholder: "Search by title, author, series or #tag; author:, series:, format: work too…",
    filter: { options: ORDERS },
    empty: {
      title: "No book found",
      description: "Titles, authors, series and tags; #tag for a tag",
      icon: Icons.book,
    },
    status: () => footer,
    actions: [action("Add Copied Files to Calibre", async () => {
      const files = copiedFiles(await clipboard.read()).filter((f) => BOOK_EXTENSIONS.test(f));
      if (!files.length) {
        await toast("Copy book files in your file manager first", { style: "failure" });
        return;
      }
      const ids = await addBooks(lib, c.server, files);
      await toast(`${ids.length || files.length} book${(ids.length || files.length) === 1 ? "" : "s"} added`, {
        style: "success",
      });
      return refresh();
    }, { icon: Icons.plus, shortcut: "<Ctrl>n" })],
    async search(query, { filter }) {
      let all;
      try {
        all = await books(lib);
      } catch (e) {
        if (!(e instanceof SetupError)) throw e;
        footer = "";
        return setupItems(e, await distro(), await installed("calibredb"));
      }
      updateCommandMetadata({ subtitle: `${all.length.toLocaleString("en")} books` }).catch(() => {});
      const q = query.trim();
      const where = lib.path.replace(HOME, "~");
      if (q) {
        const found = search(all, q);
        footer = `${found.length}${found.length === 100 ? "+" : ""} result${found.length === 1 ? "" : "s"} · ${where}`;
        return found.map((b) => bookItem(b, c));
      }
      const order = (ORDERS.some((o) => o.value === filter) ? filter : "recent") as Order;
      const sorted = sortBooks(all, order).slice(0, 300);
      footer = `${all.length.toLocaleString("en")} books · ${where}`;
      const section = (i: number): string | undefined => {
        const b = sorted[i];
        if (order === "series") return b.series;
        if (order === "author") return b.authors[0] ?? "Unknown";
        if (order === "title") return (b.sort[0] ?? "#").toUpperCase().replace(/[^A-Z]/, "#");
        return undefined;
      };
      const items: Item[] = sorted.map((b, i) => bookItem(b, c, { section: section(i) }));
      return items;
    },
  });
};
