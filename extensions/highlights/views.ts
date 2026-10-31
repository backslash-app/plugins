// Rows for highlights and books, and how load errors are shown.

import { type Action, action, copy, Icons, type Item, list, meta, open, paste, refresh, toast } from "@backslash/api";
import {
  age,
  type Book,
  bookMarkdown,
  citation,
  type Highlight,
  highlightMarkdown,
  hostOf,
  iconOf,
  markdownQuote,
  oneLine,
  SetupError,
  setupItem,
  SOURCE_NAMES,
  whereIn,
} from "./lib.ts";
import type { Loaded } from "./source.ts";

export const reloadAction = (): Action =>
  action("Reload", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" });

/** A setup row when nothing could load; a toast when one source failed. */
export async function problems(l: Loaded): Promise<Item[] | undefined> {
  if (!l.sources.length) return [setupItem()];
  if (!l.errors.length) return undefined;
  if (!l.items.length) {
    const setup = l.errors.find((e) => e.error instanceof SetupError);
    if (setup) return [setupItem(setup.error.message)];
    throw l.errors[0].error;
  }
  await toast(`${l.errors.map((e) => SOURCE_NAMES[e.source]).join(", ")} didn't load: showing last time's`, {
    style: "failure",
    message: l.errors.map((e) => e.error.message).join(" · "),
  });
  return undefined;
}

export function highlightActions(h: Highlight): Action[] {
  return [
    copy(citation(h), "Copy with Citation"),
    ...(h.url
      ? [open(h.url, `Open in ${SOURCE_NAMES[h.source]}`, { shortcut: "<Ctrl>o" })]
      : h.sourceUrl
      ? [open(h.sourceUrl, "Open Source", { shortcut: "<Ctrl>o" })]
      : []),
    paste(citation(h), "Paste with Citation", { section: "Copy" }),
    copy(h.text, "Copy Text", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
    copy(markdownQuote(h), "Copy as Markdown Quote", { shortcut: "<Ctrl>m", section: "Copy" }),
    ...(h.note ? [copy(h.note, "Copy Note", { section: "Copy" })] : []),
    ...(h.url && h.sourceUrl ? [open(h.sourceUrl, "Open Source", { icon: Icons.globe, section: "Open" })] : []),
    reloadAction(),
  ];
}

export function highlightItem(
  h: Highlight,
  o: { showSource: boolean; showBook?: boolean } = { showSource: true },
): Item {
  const where = whereIn(h);
  return {
    id: h.id,
    title: oneLine(h.text),
    subtitle: o.showBook === false ? where : [h.title, h.author].filter(Boolean).join(" — "),
    icon: iconOf(h),
    keywords: [h.title, h.author ?? "", h.note ?? "", ...h.tags.map((t) => `#${t}`)],
    accessories: [
      ...(h.favorite ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const }, tooltip: "Favorite" }] : []),
      ...(h.note ? [{ icon: Icons.note, tooltip: oneLine(h.note, 80) }] : []),
      ...h.tags.slice(0, 2).map((t) => ({ text: `#${t}`, color: "blue" as const })),
      ...(o.showSource ? [{ tag: SOURCE_NAMES[h.source], color: "gray" as const }] : []),
      ...(h.date ? [{ text: age(h.date), tooltip: new Date(h.date).toLocaleString("en-GB") }] : []),
    ],
    detail: {
      markdown: highlightMarkdown(h),
      metadata: [
        meta.text(h.category === "books" ? "Book" : "Title", h.title, { icon: iconOf(h).source }),
        ...(h.author ? [meta.text("Author", h.author, { icon: Icons.person })] : []),
        ...(where ? [meta.text("Where", where)] : []),
        ...(h.date
          ? [meta.text("Highlighted", new Date(h.date).toLocaleDateString("en-GB", { dateStyle: "long" }), {
            icon: Icons.calendar,
          })]
          : []),
        ...(h.tags.length ? [meta.tags("Tags", h.tags.map((t) => `#${t}`))] : []),
        ...(h.sourceUrl ? [meta.link("Source", hostOf(h.sourceUrl), h.sourceUrl)] : []),
        meta.separator(),
        meta.text("From", SOURCE_NAMES[h.source]),
      ],
    },
    actions: highlightActions(h),
  };
}

export function bookItem(b: Book, showSource: boolean): Item {
  const icon = iconOf(b);
  return {
    id: b.key,
    title: b.title,
    subtitle: b.author,
    icon,
    keywords: [b.author ?? "", b.category ?? ""],
    accessories: [
      ...(showSource ? [{ tag: SOURCE_NAMES[b.source], color: "gray" as const }] : []),
      { text: `${b.count}`, icon: Icons.bookmark, tooltip: `${b.count} highlight${b.count === 1 ? "" : "s"}` },
      ...(b.last ? [{ text: age(b.last), tooltip: "Last highlight" }] : []),
    ],
    detail: {
      stats: [{ label: "Highlights", value: b.count }, ...(b.last ? [{ label: "Last", value: age(b.last) }] : [])],
      markdown: b.highlights.slice(0, 3).map((h) => `> ${oneLine(h.text, 300)}`).join("\n\n"),
      metadata: [
        ...(b.author ? [meta.text("Author", b.author, { icon: Icons.person })] : []),
        ...(b.category ? [meta.text("Kind", b.category.replace(/^\w/, (c) => c.toUpperCase()))] : []),
        ...(b.sourceUrl ? [meta.link("Source", hostOf(b.sourceUrl), b.sourceUrl)] : []),
        meta.text("From", SOURCE_NAMES[b.source]),
      ],
    },
    actions: [
      action("Show Highlights", () => bookHighlights(b), { icon: Icons.bookmark }),
      copy(bookMarkdown(b), "Copy All as Markdown", { shortcut: "<Ctrl><Shift>c" }),
      ...(b.sourceUrl ? [open(b.sourceUrl, "Open Source", { shortcut: "<Ctrl>o" })] : []),
      reloadAction(),
    ],
  };
}

function bookHighlights(b: Book) {
  return list({
    title: b.title,
    placeholder: `Filter ${b.count} highlight${b.count === 1 ? "" : "s"} of ${b.title}…`,
    status: b.author ?? SOURCE_NAMES[b.source],
    items: b.highlights.map((h) => {
      const item = highlightItem(h, { showSource: false, showBook: false });
      return {
        ...item,
        actions: [
          ...(item.actions ?? []).filter((a) => a.title !== "Reload"),
          copy(bookMarkdown(b), "Copy All as Markdown", { section: "Book" }),
        ],
      };
    }),
  });
}
