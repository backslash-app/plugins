import { assertEquals, assertStringIncludes } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import {
  addArgs,
  addedIds,
  apaName,
  authArgs,
  type Book,
  calibreDate,
  citation,
  copiedFiles,
  coverPath,
  expandHome,
  exportArgs,
  formatOrder,
  formatPath,
  htmlToMarkdown,
  identifierLinks,
  isLocked,
  libraryArg,
  libraryFromGlobal,
  libraryIdOf,
  parseQuery,
  preferredFormat,
  search,
  seriesLabel,
  serverBookUrl,
  size,
  sortBooks,
  stars,
} from "./lib.ts";
import { books, type Library } from "./library.ts";
import { bookItem } from "./views.ts";

// The tables of Calibre's metadata.db that the extension reads.
const SCHEMA = `
CREATE TABLE books (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL DEFAULT 'Unknown', sort TEXT,
  timestamp TIMESTAMP, pubdate TIMESTAMP, series_index REAL NOT NULL DEFAULT 1.0, author_sort TEXT, isbn TEXT DEFAULT '',
  lccn TEXT DEFAULT '', path TEXT NOT NULL DEFAULT '', flags INTEGER NOT NULL DEFAULT 1, uuid TEXT,
  has_cover BOOL DEFAULT 0, last_modified TIMESTAMP);
CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort TEXT, link TEXT NOT NULL DEFAULT '');
CREATE TABLE books_authors_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, author INTEGER NOT NULL);
CREATE TABLE series (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort TEXT);
CREATE TABLE books_series_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, series INTEGER NOT NULL);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE books_tags_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, tag INTEGER NOT NULL);
CREATE TABLE publishers (id INTEGER PRIMARY KEY, name TEXT NOT NULL, sort TEXT);
CREATE TABLE books_publishers_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, publisher INTEGER NOT NULL);
CREATE TABLE ratings (id INTEGER PRIMARY KEY, rating INTEGER);
CREATE TABLE books_ratings_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, rating INTEGER NOT NULL);
CREATE TABLE languages (id INTEGER PRIMARY KEY, lang_code TEXT NOT NULL);
CREATE TABLE books_languages_link (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, lang_code INTEGER NOT NULL,
  item_order INTEGER NOT NULL DEFAULT 0);
CREATE TABLE data (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, format TEXT NOT NULL COLLATE NOCASE,
  uncompressed_size INTEGER NOT NULL, name TEXT NOT NULL);
CREATE TABLE identifiers (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, type TEXT NOT NULL DEFAULT 'isbn',
  val TEXT NOT NULL);
CREATE TABLE comments (id INTEGER PRIMARY KEY, book INTEGER NOT NULL, text TEXT NOT NULL);

INSERT INTO books (id, title, sort, timestamp, pubdate, series_index, author_sort, path, uuid, has_cover, last_modified) VALUES
  (1, 'The Fellowship of the Ring', 'Fellowship of the Ring, The', '2024-03-01 10:00:00.123456+00:00',
   '1954-07-29 00:00:00+00:00', 1.0, 'Tolkien, J. R. R.', 'J. R. R. Tolkien/The Fellowship of the Ring (1)', 'u1', 1,
   '2024-03-02 10:00:00+00:00'),
  (2, 'The Left Hand of Darkness', 'Left Hand of Darkness, The', '2025-01-15 08:30:00+00:00',
   '0101-01-01 00:00:00+00:00', 6.0, 'Le Guin, Ursula K.', 'Ursula K. Le Guin/The Left Hand of Darkness (2)', 'u2', 0,
   '2025-01-15 08:30:00+00:00'),
  (3, 'Good Omens', 'Good Omens', '2023-06-01 00:00:00+00:00', '1990-05-01 00:00:00+00:00', 1.0,
   'Pratchett, Terry & Gaiman, Neil', 'Terry Pratchett/Good Omens (3)', 'u3', 1, '2023-06-01 00:00:00+00:00');
INSERT INTO authors VALUES (1, 'J. R. R. Tolkien', 'Tolkien, J. R. R.', ''), (2, 'Ursula K. Le Guin', 'Le Guin, Ursula K.', ''),
  (3, 'Terry Pratchett', 'Pratchett, Terry', ''), (4, 'Neil Gaiman', 'Gaiman, Neil', '');
INSERT INTO books_authors_link (id, book, author) VALUES (1, 1, 1), (2, 2, 2), (3, 3, 3), (4, 3, 4);
INSERT INTO series VALUES (1, 'The Lord of the Rings', 'Lord of the Rings, The'), (2, 'Hainish Cycle', 'Hainish Cycle');
INSERT INTO books_series_link (book, series) VALUES (1, 1), (2, 2);
INSERT INTO tags VALUES (1, 'Fantasy'), (2, 'Science Fiction'), (3, 'Humor');
INSERT INTO books_tags_link (book, tag) VALUES (1, 1), (2, 2), (3, 1), (3, 3);
INSERT INTO publishers VALUES (1, 'Allen & Unwin', NULL), (2, 'Ace Books', NULL);
INSERT INTO books_publishers_link (book, publisher) VALUES (1, 1), (2, 2);
INSERT INTO ratings VALUES (1, 10), (2, 7);
INSERT INTO books_ratings_link (book, rating) VALUES (1, 1), (2, 2);
INSERT INTO languages VALUES (1, 'eng'), (2, 'fra');
INSERT INTO books_languages_link (book, lang_code, item_order) VALUES (1, 1, 0), (3, 1, 0), (3, 2, 1);
INSERT INTO data (book, format, uncompressed_size, name) VALUES
  (1, 'EPUB', 812345, 'The Fellowship of the Ring - J. R. R. Tolkien'),
  (1, 'PDF', 3456789, 'The Fellowship of the Ring - J. R. R. Tolkien'),
  (2, 'AZW3', 512000, 'The Left Hand of Darkness - Ursula K. Le Guin'),
  (3, 'MOBI', 400000, 'Good Omens - Terry Pratchett');
INSERT INTO identifiers (book, type, val) VALUES (1, 'isbn', '9780261103573'), (1, 'goodreads', '34'), (3, 'amazon', 'B000');
INSERT INTO comments (book, text) VALUES (1, '<p>The first part of <i>The Lord of the Rings</i>.</p><p>Frodo &amp; friends.</p>');
`;

async function fixture(): Promise<{ lib: Library; all: Book[] }> {
  const dir = await Deno.makeTempDir({ prefix: "backslash-calibre-test-" });
  const db = new DatabaseSync(`${dir}/metadata.db`);
  db.exec(SCHEMA);
  db.close();
  const lib: Library = { path: dir, from: "preference", id: libraryIdOf(dir) };
  return { lib, all: await books(lib) };
}

Deno.test("metadata.db: every field of every book, newest first", async () => {
  const { lib, all } = await fixture();
  try {
    assertEquals(all.map((b) => b.id), [2, 1, 3]);
    const lotr = all.find((b) => b.id === 1)!;
    assertEquals(lotr.title, "The Fellowship of the Ring");
    assertEquals(lotr.authors, ["J. R. R. Tolkien"]);
    assertEquals(lotr.series, "The Lord of the Rings");
    assertEquals(lotr.seriesIndex, 1);
    assertEquals(lotr.tags, ["Fantasy"]);
    assertEquals(lotr.publisher, "Allen & Unwin");
    assertEquals(new Date(lotr.published!).getUTCFullYear(), 1954);
    assertEquals(lotr.rating, 5);
    assertEquals(lotr.languages, ["eng"]);
    assertEquals(lotr.formats.map((f) => f.format), ["EPUB", "PDF"]);
    assertEquals(lotr.identifiers, { isbn: "9780261103573", goodreads: "34" });
    assertEquals(lotr.hasCover, true);
    assertStringIncludes(lotr.comments ?? "", "Frodo");
    const omens = all.find((b) => b.id === 3)!;
    assertEquals(omens.authors, ["Terry Pratchett", "Neil Gaiman"]);
    assertEquals(omens.series, undefined);
    assertEquals(omens.languages, ["eng", "fra"]);
    const left = all.find((b) => b.id === 2)!;
    assertEquals(left.published, undefined);
    assertEquals(left.rating, 3.5);
    assertEquals(left.hasCover, false);
    // Read again: the same list, from memory.
    assertEquals(await books(lib), all);
  } finally {
    await Deno.remove(lib.path, { recursive: true });
  }
});

Deno.test("search: words, fields and tags", async () => {
  const { lib, all } = await fixture();
  try {
    assertEquals(search(all, "fellowship").map((b) => b.id), [1]);
    assertEquals(search(all, "tolkien").map((b) => b.id), [1]);
    assertEquals(search(all, "#fantasy").map((b) => b.id).sort(), [1, 3]);
    assertEquals(search(all, "author:gaiman").map((b) => b.id), [3]);
    assertEquals(search(all, 'series:"lord of"').map((b) => b.id), [1]);
    assertEquals(search(all, "format:azw3").map((b) => b.id), [2]);
    assertEquals(search(all, "darkness le guin").map((b) => b.id), [2]);
    assertEquals(search(all, "9780261103573").map((b) => b.id), [1]);
    assertEquals(search(all, "nothing like this"), []);
    // A title match ranks above a tag match.
    assertEquals(search(all, "omens fantasy")[0].id, 3);
    assertEquals(parseQuery('tag:"science fiction" #humor by:pratchett x').tag, ["science fiction", "humor"]);
  } finally {
    await Deno.remove(lib.path, { recursive: true });
  }
});

Deno.test("orders", async () => {
  const { lib, all } = await fixture();
  try {
    assertEquals(sortBooks(all, "recent").map((b) => b.id), [2, 1, 3]);
    assertEquals(sortBooks(all, "title").map((b) => b.id), [1, 3, 2]);
    assertEquals(sortBooks(all, "author").map((b) => b.id), [2, 3, 1]);
    assertEquals(sortBooks(all, "series").map((b) => b.id), [2, 1]);
  } finally {
    await Deno.remove(lib.path, { recursive: true });
  }
});

Deno.test("dates", () => {
  assertEquals(calibreDate("2024-03-01 10:00:00.123456+00:00"), Date.parse("2024-03-01T10:00:00.123Z"));
  assertEquals(calibreDate("0101-01-01 00:00:00+00:00"), undefined);
  assertEquals(calibreDate(null), undefined);
  assertEquals(calibreDate("garbage"), undefined);
});

Deno.test("library location", () => {
  assertEquals(expandHome("~/Calibre Library/", "/home/me"), "/home/me/Calibre Library");
  assertEquals(expandHome("/mnt/books", "/home/me"), "/mnt/books");
  assertEquals(libraryFromGlobal('{"library_path": "/home/me/Books", "other": 1}'), "/home/me/Books");
  assertEquals(libraryFromGlobal("{}"), undefined);
  assertEquals(libraryFromGlobal("not json"), undefined);
  assertEquals(libraryIdOf("/home/me/Calibre Library"), "Calibre_Library");
});

const BOOK: Book = {
  id: 1,
  title: "The Fellowship of the Ring",
  sort: "Fellowship of the Ring, The",
  authors: ["J. R. R. Tolkien"],
  authorSort: "Tolkien, J. R. R.",
  series: "The Lord of the Rings",
  seriesIndex: 1,
  tags: ["Fantasy"],
  publisher: "Allen & Unwin",
  published: Date.parse("1954-07-29T00:00:00Z"),
  added: 0,
  languages: ["eng"],
  formats: [
    { format: "PDF", name: "The Fellowship of the Ring - J. R. R. Tolkien", size: 3456789 },
    { format: "EPUB", name: "The Fellowship of the Ring - J. R. R. Tolkien", size: 812345 },
  ],
  identifiers: { isbn: "9780261103573" },
  path: "J. R. R. Tolkien/The Fellowship of the Ring (1)",
  hasCover: true,
};

Deno.test("paths and formats", () => {
  assertEquals(
    formatPath("/lib", BOOK, BOOK.formats[1]),
    "/lib/J. R. R. Tolkien/The Fellowship of the Ring (1)/The Fellowship of the Ring - J. R. R. Tolkien.epub",
  );
  assertEquals(coverPath("/lib", BOOK), "/lib/J. R. R. Tolkien/The Fellowship of the Ring (1)/cover.jpg");
  assertEquals(coverPath("/lib", { ...BOOK, hasCover: false }), undefined);
  assertEquals(preferredFormat(BOOK.formats)?.format, "EPUB");
  assertEquals(preferredFormat(BOOK.formats, formatOrder("pdf"))?.format, "PDF");
  assertEquals(preferredFormat([{ format: "ZZZ", name: "x" }])?.format, "ZZZ");
  assertEquals(preferredFormat([]), undefined);
});

Deno.test("citations", () => {
  assertEquals(apaName("J. R. R. Tolkien"), "Tolkien, J. R. R.");
  assertEquals(apaName("Ursula K. Le Guin"), "Le Guin, U. K.");
  assertEquals(apaName("Jean-Paul Sartre"), "Sartre, J.-P.");
  assertEquals(apaName("Homer"), "Homer");
  assertEquals(
    citation(BOOK),
    "Tolkien, J. R. R. (1954). The Fellowship of the Ring (The Lord of the Rings, 1). Allen & Unwin.",
  );
  assertEquals(
    citation({ ...BOOK, authors: ["Terry Pratchett", "Neil Gaiman"], series: undefined, published: undefined }),
    "Pratchett, T., & Gaiman, N. (n.d.). The Fellowship of the Ring. Allen & Unwin.",
  );
  assertEquals(
    citation({ ...BOOK, authors: [], publisher: undefined, series: undefined }),
    "The Fellowship of the Ring. (1954).",
  );
});

Deno.test("copied files", () => {
  assertEquals(
    copiedFiles("x-special/nautilus-clipboard\ncopy\nfile:///home/me/Books/A%20Book.epub\nfile:///home/me/b.pdf\n"),
    ["/home/me/Books/A Book.epub", "/home/me/b.pdf"],
  );
  assertEquals(copiedFiles("/home/me/c.mobi\r\nhello\n# comment"), ["/home/me/c.mobi"]);
  assertEquals(copiedFiles(""), []);
});

Deno.test("calibredb command lines", () => {
  assertEquals(addArgs("/lib", ["/a.epub"]), ["add", "--with-library", "/lib", "--", "/a.epub"]);
  assertEquals(libraryArg({ library: "/lib" }), "/lib");
  assertEquals(
    libraryArg({ library: "/lib", server: "http://localhost:8080/", libraryId: "Calibre_Library" }),
    "http://localhost:8080/#Calibre_Library",
  );
  assertEquals(authArgs("me", "pw"), ["--username", "me", "--password", "pw"]);
  assertEquals(authArgs(), []);
  const ex = exportArgs("/lib", 12, "/home/me/Downloads");
  assertEquals(ex.slice(0, 3), ["export", "--with-library", "/lib"]);
  assertEquals(ex.slice(-3), ["--to-dir", "/home/me/Downloads", "12"]);
  assertEquals(addedIds("Added book ids: 12, 13"), [12, 13]);
  assertEquals(addedIds("The following books were not added as they already exist"), []);
  assertEquals(
    isLocked("Another calibre program such as calibre-server or the main calibre program is running."),
    true,
  );
  assertEquals(
    serverBookUrl("http://localhost:8080/", "Calibre_Library", 7),
    "http://localhost:8080/#book_id=7&library_id=Calibre_Library&panel=book_details",
  );
});

Deno.test("formatting", () => {
  assertEquals(
    htmlToMarkdown(
      '<div><p>The <b>first</b> part of <i>LOTR</i>.</p><ul><li>One</li><li>Two</li></ul><a href="https://x.org">x</a> &amp; y</div>',
    ),
    "The **first** part of *LOTR*.\n\n- One\n- Two\n\n[x](https://x.org) & y",
  );
  assertEquals(htmlToMarkdown(undefined), "");
  assertEquals(stars(3.5), "★★★½☆");
  assertEquals(stars(5), "★★★★★");
  assertEquals(size(812345), "793 KB");
  assertEquals(size(3456789), "3.3 MB");
  assertEquals(seriesLabel(BOOK), "The Lord of the Rings #1");
  assertEquals(seriesLabel({ series: "S", seriesIndex: 2.5 }), "S #2.5");
  assertEquals(identifierLinks({ isbn: "123", foo: "bar" }), [
    { label: "ISBN", value: "123", url: "https://openlibrary.org/isbn/123" },
    { label: "foo", value: "bar" },
  ]);
});

Deno.test("a book as an item", () => {
  const lib: Library = { path: "/lib", from: "preference", id: "lib" };
  const item = bookItem(BOOK, { lib, server: {}, order: formatOrder(""), exportDir: "/tmp/out" });
  assertEquals(item.icon, "/lib/J. R. R. Tolkien/The Fellowship of the Ring (1)/cover.jpg");
  assertEquals(item.subtitle, "J. R. R. Tolkien");
  assertEquals(item.actions?.[0].title, "Open EPUB");
  assertEquals(item.actions?.[1].title, "Open in E-book Viewer");
  const remove = item.actions?.find((a) => a.title === "Remove from Library");
  assertEquals(remove?.destructive, true);
  assertEquals(item.actions?.some((a) => a.title === "Open in Content Server"), false);
  const served = bookItem(BOOK, { lib, server: { url: "http://localhost:8080" }, order: [], exportDir: "/tmp" });
  assertEquals(served.actions?.some((a) => a.title === "Open in Content Server"), true);
});
