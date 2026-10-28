// Books as launcher items, the work page and the reading list actions.

import {
  type Accessory,
  type Action,
  action,
  type Context,
  copy,
  detail,
  type DetailSpec,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  type Outcome,
  refresh,
  replace,
  type Stat,
  submenu,
  toast,
} from "@backslash/api";
import { setBookStatus, work } from "./api.ts";
import {
  authorUrl,
  type Book,
  byline,
  citation,
  cleanSubjects,
  compact,
  coverUrl,
  description,
  languageNames,
  type Status,
  STATUSES,
  workUrl,
} from "./lib.ts";

/** What to show after a status change: the list reloads, a book page is redrawn with the new status. */
type After = (status: Status | undefined, ctx: Context) => Awaitable<Outcome>;
type Awaitable<T> = T | Promise<T>;

const reload: After = () => refresh();

function statusActions(book: Book, current: Status | undefined, after: After): Action[] {
  const set = (status: Status | undefined) => async (ctx: Context) => {
    await setBookStatus(book, status);
    await toast(status ? `${book.title}: ${STATUSES[status].title}` : `${book.title} removed from the reading list`, {
      style: "success",
    });
    return after(status, ctx);
  };
  return [
    ...(Object.keys(STATUSES) as Status[]).filter((s) => s !== current).map((s) =>
      action(STATUSES[s].title, set(s), { icon: STATUSES[s].icon })
    ),
    ...(current ? [action("Remove from Reading List", set(undefined), { icon: Icons.trash, destructive: true })] : []),
  ];
}

function bookStats(b: Book): Stat[] {
  const stats: Stat[] = [];
  if (b.year) stats.push({ label: "First published", value: b.year });
  if (b.editions) stats.push({ label: "Editions", value: b.editions });
  if (b.rating !== undefined) stats.push({ label: "Rating", value: `★ ${b.rating.toFixed(1)}` });
  else if (b.pages) stats.push({ label: "Pages", value: b.pages });
  return stats;
}

function bookMetadata(b: Book, status: Status | undefined): Metadata[] {
  const lines: Metadata[] = [];
  if (status) lines.push(meta.tags("Reading list", [{ text: STATUSES[status].title, color: STATUSES[status].color }]));
  b.authors.slice(0, 4).forEach((name, i) => lines.push(meta.person(i ? "" : "By", name)));
  if (b.subjects.length) lines.push(meta.tags("Subjects", b.subjects.slice(0, 6)));
  if (b.pages) lines.push(meta.text("Pages", b.pages, { icon: Icons.file }));
  if (b.publisher) lines.push(meta.text("Publisher", b.publisher));
  if (b.languages.length) lines.push(meta.text("Languages", languageNames(b.languages).slice(0, 5).join(", ")));
  if (b.isbn) lines.push(meta.text("ISBN", b.isbn, { icon: Icons.hash }));
  if (b.rating !== undefined && b.ratings) {
    lines.push(meta.progress("Rating", b.rating / 5, `${b.rating.toFixed(2)} / 5 · ${compact(b.ratings)} ratings`));
  }
  if (b.wantToRead || b.alreadyRead) {
    lines.push(
      meta.text(
        "Readers",
        [
          b.alreadyRead ? `${compact(b.alreadyRead)} read` : "",
          b.wantToRead ? `${compact(b.wantToRead)} want to` : "",
        ].filter(Boolean).join(" · "),
        { icon: Icons.person },
      ),
    );
  }
  lines.push(meta.separator(), meta.link("Open Library", `openlibrary.org${b.key}`, workUrl(b.key)));
  return lines;
}

function bookActions(b: Book, status: Status | undefined, withDetails: boolean, after: After = reload): Action[] {
  return [
    ...(withDetails
      ? [action("Show Description", (ctx) => bookView(b, status, ctx.signal), { icon: Icons.book })]
      : []),
    open(workUrl(b.key), "Open on Open Library"),
    submenu(
      status ? `Reading List: ${STATUSES[status].title}` : "Add to Reading List",
      statusActions(b, status, after),
      {
        icon: Icons.bookmark,
        shortcut: "<Ctrl>s",
      },
    ),
    ...(b.authorKeys[0]
      ? [open(authorUrl(b.authorKeys[0]), `Open ${b.authors[0] ?? "Author"} on Open Library`, {
        icon: Icons.person,
        section: "Open",
      })]
      : []),
    ...(b.isbn ? [copy(b.isbn, "Copy ISBN", { section: "Copy", shortcut: "<Ctrl><Shift>i" })] : []),
    copy(citation(b), "Copy Citation (APA)", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(workUrl(b.key), "Copy Open Library Link", { section: "Copy" }),
    copy(`${b.title} by ${byline(b.authors)}`, "Copy Title and Author", { section: "Copy" }),
  ];
}

export function bookItem(b: Book, o: { status?: Status; section?: string } = {}): Item {
  const accessories: Accessory[] = [];
  if (o.status && !o.section?.startsWith(STATUSES[o.status].title)) {
    accessories.push({
      tag: STATUSES[o.status].title,
      color: STATUSES[o.status].color,
      tooltip: "In your reading list",
    });
  }
  if (b.year) accessories.push({ text: String(b.year), tooltip: "First published" });
  return {
    id: `${o.section ?? ""}:${b.key}`,
    title: b.title,
    subtitle: byline(b.authors),
    section: o.section,
    icon: coverUrl(b.cover, "S") ?? { source: Icons.book, tint: "orange" },
    keywords: [...b.authors, ...(b.isbn ? [b.isbn] : []), ...b.subjects.slice(0, 4)],
    accessories,
    detail: {
      image: coverUrl(b.cover, "L"),
      stats: bookStats(b),
      markdown: `**${b.title}**${b.subtitle ? `\n\n*${b.subtitle}*` : ""}`,
      metadata: bookMetadata(b, o.status),
    },
    actions: bookActions(b, o.status, true),
  };
}

/** The work's description, subjects, places and times. */
export async function bookView(b: Book, status: Status | undefined, signal: AbortSignal): Promise<DetailSpec> {
  const w = await work(b.key, signal);
  const text = description(w.description);
  const first = description(w.first_sentence);
  const md = [
    `# ${w.title || b.title}`,
    ...(w.subtitle || b.subtitle ? [`*${w.subtitle || b.subtitle}*`] : []),
    "",
    `by **${byline(b.authors)}**${b.year ? ` · ${b.year}` : ""}`,
    "",
    text ?? (first ? `> ${first}` : "Open Library has no description of this book yet."),
    ...(w.links?.length ? ["", "## Links", "", ...w.links.slice(0, 6).map((l) => `- [${l.title}](${l.url})`)] : []),
  ];
  const metadata: Metadata[] = [...bookMetadata(b, status)];
  const subjects = cleanSubjects(w.subjects, 10);
  const extra: Metadata[] = [];
  if (subjects.length) extra.push(meta.tags("Subjects", subjects));
  const places = cleanSubjects(w.subject_places, 5);
  if (places.length) extra.push(meta.tags("Places", places.map((text) => ({ text, color: "teal" as const }))));
  const times = cleanSubjects(w.subject_times, 4);
  if (times.length) extra.push(meta.tags("Times", times.map((text) => ({ text, color: "purple" as const }))));
  const people = cleanSubjects(w.subject_people, 5);
  if (people.length) extra.push(meta.tags("Characters", people.map((text) => ({ text, color: "pink" as const }))));
  return detail({
    title: b.title,
    markdown: md.join("\n"),
    stats: bookStats(b),
    metadata: [...metadata.filter((m) => m.label !== "Subjects"), meta.separator(), ...extra],
    status: `${b.editions ? `${b.editions} edition${b.editions === 1 ? "" : "s"} · ` : ""}Open Library`,
    actions: bookActions(
      b,
      status,
      false,
      async (next, ctx) => replace(await bookView(b, next, ctx.signal)),
    ),
  });
}
