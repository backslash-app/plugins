// Calibre books as launcher items.

import {
  type Action,
  action,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  authorLine,
  type Book,
  bookDir,
  citation,
  coverPath,
  type Family,
  formatPath,
  htmlToMarkdown,
  identifierLinks,
  installCommand,
  languageName,
  preferredFormat,
  seriesLabel,
  serverBookUrl,
  size,
  stars,
  VIEWABLE,
} from "./lib.ts";
import { exportBook, HOME, type Library, removeBook, type Server, SetupError, view } from "./library.ts";

export interface Ctx {
  lib: Library;
  server: Server;
  /** Format preference order. */
  order: string[];
  /** Where exported books go. */
  exportDir: string;
}

const date = (ms: number) =>
  new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

function bookMetadata(b: Book, c: Ctx): Metadata[] {
  const lines: Metadata[] = [];
  for (const a of b.authors.slice(0, 5)) lines.push(meta.person("Author", a));
  const series = seriesLabel(b);
  if (series) lines.push(meta.text("Series", series, { icon: Icons.layers }));
  if (b.rating) lines.push(meta.text("Rating", stars(b.rating), { icon: Icons.star, color: "yellow" }));
  if (b.tags.length) lines.push(meta.tags("Tags", b.tags.slice(0, 12)));
  if (b.formats.length) {
    lines.push(meta.tags(
      "Formats",
      b.formats.map((f) => ({ text: [f.format, size(f.size)].filter(Boolean).join(" · ") })),
    ));
  }
  lines.push(meta.separator());
  if (b.publisher) lines.push(meta.text("Publisher", b.publisher, { icon: Icons.archive }));
  if (b.published) {
    lines.push(meta.text("Published", String(new Date(b.published).getUTCFullYear()), { icon: Icons.calendar }));
  }
  if (b.languages.length) {
    lines.push(meta.text("Language", b.languages.map(languageName).join(", "), { icon: Icons.globe }));
  }
  for (const id of identifierLinks(b.identifiers).slice(0, 5)) {
    lines.push(id.url ? meta.link(id.label, id.value, id.url) : meta.text(id.label, id.value));
  }
  lines.push(meta.text("Added", date(b.added), { icon: Icons.clock }));
  if (c.server.url) {
    lines.push(meta.link("Content server", `Book ${b.id}`, serverBookUrl(c.server.url, c.lib.id, b.id)));
  }
  return lines;
}

export function bookActions(b: Book, c: Ctx): Action[] {
  const main = preferredFormat(b.formats, c.order);
  const viewable = b.formats.filter((f) => VIEWABLE.has(f.format.toUpperCase()));
  const best = main && VIEWABLE.has(main.format.toUpperCase()) ? main : viewable[0];
  const actions: Action[] = [];
  if (main) actions.push(open(formatPath(c.lib.path, b, main), `Open ${main.format}`, { icon: Icons.book }));
  if (best) {
    actions.push(action("Open in E-book Viewer", async () => {
      await view(formatPath(c.lib.path, b, best), b.title);
      await toast(`Opening ${b.title}`, { style: "success" });
    }, { icon: Icons.eye, shortcut: "<Ctrl>Return" }));
  }
  if (b.formats.length > 1) {
    actions.push(submenu(
      "Open Format",
      b.formats.map((f) =>
        open(formatPath(c.lib.path, b, f), `${f.format}${size(f.size) ? ` · ${size(f.size)}` : ""}`)
      ),
      { icon: Icons.file, shortcut: "<Ctrl>f" },
    ));
  }
  actions.push(open(bookDir(c.lib.path, b), "Show in Folder", { icon: Icons.folder, shortcut: "<Ctrl>o" }));
  if (c.server.url) {
    actions.push(open(serverBookUrl(c.server.url, c.lib.id, b.id), "Open in Content Server", { icon: Icons.globe }));
  }
  actions.push(
    copy(citation(b), "Copy Citation (APA)", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(`${b.title} – ${authorLine(b)}`, "Copy Title and Author", { section: "Copy", icon: Icons.text }),
  );
  if (b.identifiers.isbn) actions.push(copy(b.identifiers.isbn, "Copy ISBN", { section: "Copy", icon: Icons.hash }));
  if (main) {
    actions.push(copy(formatPath(c.lib.path, b, main), "Copy File Path", { section: "Copy", icon: Icons.file }));
  }
  actions.push(
    action("Export to Folder", async () => {
      await exportBook(c.lib, c.server, b.id, c.exportDir);
      await toast(`Exported to ${c.exportDir.replace(HOME, "~")}`, { style: "success" });
    }, { icon: Icons.download, shortcut: "<Ctrl>e", section: "Library" }),
    action("Remove from Library", async () => {
      await removeBook(c.lib, c.server, b.id);
      await toast(`${b.title} moved to Calibre's trash`, { style: "success" });
      return refresh();
    }, {
      icon: Icons.trash,
      destructive: true,
      confirm: `Remove “${b.title}” from the library? Calibre keeps it in its trash for a while.`,
      shortcut: "<Ctrl>BackSpace",
      section: "Library",
    }),
  );
  return actions;
}

export function bookItem(b: Book, c: Ctx, o: { section?: string } = {}): Item {
  const cover = coverPath(c.lib.path, b);
  const series = seriesLabel(b);
  const markdown = htmlToMarkdown(b.comments);
  return {
    id: String(b.id),
    title: b.title,
    subtitle: authorLine(b),
    icon: cover ?? { source: Icons.book, tint: "orange" },
    section: o.section,
    keywords: [...b.authors, ...(b.series ? [b.series] : []), ...b.tags],
    accessories: [
      ...(series ? [{ text: series, icon: Icons.layers }] : []),
      ...b.formats.slice(0, 3).map((f) => ({ tag: f.format })),
    ],
    detail: {
      image: cover,
      markdown: markdown || undefined,
      metadata: bookMetadata(b, c),
    },
    actions: bookActions(b, c),
  };
}

export function setupItems(e: SetupError, family: Family | undefined, hasCalibre: boolean): Item[] {
  const where = (e.path ?? "").replace(HOME, "~");
  const items: Item[] = [{
    id: "setup",
    title: e.reason === "no-library" ? `No Calibre library in ${where}` : "The Calibre library can't be read",
    subtitle: e.reason === "no-library" ? "Set the library folder in Settings → Extensions → Calibre" : e.message,
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        e.reason === "no-library" ? "## Where is your library?" : "## The library can't be read",
        "",
        e.reason === "no-library"
          ? `There is no **metadata.db** in \`${where}\`. Set the folder of your Calibre library (the one with metadata.db) in the extension's preferences. Calibre shows it in **Preferences → Library**, or on the library button.`
          : e.message,
      ].join("\n"),
    },
    actions: [open(e.path && e.reason !== "no-library" ? e.path : HOME, "Open Folder", { icon: Icons.folder })],
  }];
  if (!hasCalibre) {
    const cmd = installCommand(family);
    items.push({
      id: "no-calibre",
      title: "Install Calibre",
      subtitle: family ? cmd : "calibre-ebook.com/download_linux",
      icon: { source: Icons.download, tint: "blue" },
      actions: family
        ? [copy(cmd, "Copy Install Command"), open("https://calibre-ebook.com/download_linux", "Open Download Page")]
        : [open("https://calibre-ebook.com/download_linux", "Open Download Page")],
    });
  }
  return items;
}
