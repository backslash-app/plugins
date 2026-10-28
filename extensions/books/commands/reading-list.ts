import { type Context, Icons, list, updateCommandMetadata } from "@backslash/api";
import { readingList } from "../api.ts";
import { sortSaved, type Status, STATUSES } from "../lib.ts";
import { bookItem } from "../views.ts";

let counts: Record<Status, number> = { want: 0, reading: 0, read: 0 };

export default (_ctx: Context) =>
  list({
    placeholder: "Filter your books by title, author or subject…",
    filter: {
      options: [
        { value: "all", title: "All" },
        ...(Object.keys(STATUSES) as Status[]).map((value) => ({ value, title: STATUSES[value].title })),
      ],
    },
    empty: {
      title: "No books here",
      description: "Add books from Search Books: Ctrl+S on a book picks Want to Read, Reading or Read",
      icon: Icons.bookmark,
    },
    status: () => [`${counts.reading} reading`, `${counts.want} to read`, `${counts.read} read`].join(" · "),
    async items({ filter }) {
      const saved = await readingList();
      counts = { want: 0, reading: 0, read: 0 };
      for (const s of saved) counts[s.status]++;
      const current = sortSaved(saved).find((s) => s.status === "reading");
      updateCommandMetadata({
        subtitle: current ? `Reading ${current.book.title}` : counts.want ? `${counts.want} to read` : null,
      }).catch(() => {});
      const shown = filter && filter in STATUSES ? saved.filter((s) => s.status === filter) : saved;
      return sortSaved(shown).map((s) =>
        bookItem(s.book, {
          status: s.status,
          section: filter && filter in STATUSES ? undefined : STATUSES[s.status].title,
        })
      );
    },
  });
