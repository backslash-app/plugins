import { Icons, list } from "@backslash/api";
import { readingList, searchBooks } from "../api.ts";
import { sortSaved, STATUSES } from "../lib.ts";
import { bookItem } from "../views.ts";

let total = 0;

export default list({
  placeholder: "Search books by title, author or ISBN…",
  empty: {
    title: "Search Open Library",
    description: "Type a title (dune), an author (le guin) or an ISBN (9780441172719)",
    icon: Icons.book,
  },
  status: (items) =>
    items.some((i) => !i.section)
      ? `${items.length} of ${new Intl.NumberFormat("en-US").format(total)} book${
        total === 1 ? "" : "s"
      } · Open Library`
      : items.length
      ? "Your reading list · type to search Open Library"
      : "Open Library",
  async search(query, { signal }) {
    const saved = await readingList();
    if (!query.trim()) {
      return sortSaved(saved).filter((s) => s.status !== "read").map((s) =>
        bookItem(s.book, { status: s.status, section: STATUSES[s.status].title })
      );
    }
    const status = new Map(saved.map((s) => [s.book.key, s.status]));
    const found = await searchBooks(query, signal);
    total = found.total;
    return found.books.map((b) => bookItem(b, { status: status.get(b.key) }));
  },
});
