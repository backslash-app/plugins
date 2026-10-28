import { assert, assertEquals } from "@std/assert";
import {
  apaAuthors,
  apaCitation,
  apiParams,
  attachmentFrom,
  bibtex,
  citationKey,
  creatorSummary,
  type DbRow,
  displayDate,
  fromApi,
  fromDb,
  initials,
  inTextCitation,
  mainPdf,
  matchScore,
  openPdfUrl,
  publication,
  search,
  selectUrl,
  typeName,
  year,
  type ZItem,
} from "./lib.ts";
import { queryFor } from "./source.ts";
import { sqliteInstall, zoteroItem } from "./zotero.ts";

const STORAGE = "/home/me/Zotero/storage";

// A row as `sqlite3 -json` prints it for the query in source.ts.
const ROW: DbRow = {
  key: "ABCD1234",
  groupID: null,
  typeName: "journalArticle",
  fields: JSON.stringify({
    title: "Sketch of the Analytical Engine",
    date: "1843-00-00 1843",
    publicationTitle: "Scientific Memoirs",
    volume: "3",
    issue: "2",
    pages: "666-731",
    DOI: "https://doi.org/10.1000/xyz123",
  }),
  creators: JSON.stringify([
    { first: "Luigi F.", last: "Menabrea", mode: 0, type: "author", i: 1 },
    { first: "Ada", last: "Lovelace", mode: 0, type: "author", i: 0 },
  ]),
  tags: JSON.stringify(["history", "computing"]),
  attachments: JSON.stringify([
    { key: "ATT1", path: "storage:Sketch.pdf", contentType: "application/pdf", linkMode: 0, title: "Full Text PDF" },
    { key: "ATT2", path: null, contentType: "text/html", linkMode: 3, title: "Snapshot link" },
  ]),
  dateAdded: "2026-10-01 10:00:00",
  dateModified: "2026-10-02 10:00:00",
};

const article = fromDb(ROW, STORAGE);

const book = (extra: Partial<ZItem> = {}): ZItem => ({
  key: "BOOK0001",
  itemType: "book",
  title: "The Art of Computer Programming",
  creators: [{ creatorType: "author", firstName: "Donald E.", lastName: "Knuth" }],
  fields: { date: "1997", publisher: "Addison-Wesley", place: "Reading, MA", edition: "3" },
  tags: [],
  attachments: [],
  ...extra,
});

Deno.test("database rows: creators in order, dates, attachments in storage", () => {
  assertEquals(article.creators.map((c) => c.lastName), ["Lovelace", "Menabrea"]);
  assertEquals(article.tags, ["computing", "history"]);
  assertEquals(article.attachments[0], {
    key: "ATT1",
    title: "Full Text PDF",
    contentType: "application/pdf",
    linkMode: "imported_file",
    path: `${STORAGE}/ATT1/Sketch.pdf`,
  });
  assertEquals(article.attachments[1].path, undefined);
  assertEquals(article.dateAdded, "2026-10-01T10:00:00Z");
  assertEquals(year(article), "1843");
  assertEquals(displayDate(article.fields.date), "1843");
  assertEquals(displayDate("March 2019"), "March 2019");
  // Organizations (single-field names) and broken JSON.
  const org = fromDb({
    ...ROW,
    creators: JSON.stringify([{ first: "", last: "World Health Organization", mode: 1, type: "author", i: 0 }]),
    tags: "oops",
  }, STORAGE);
  assertEquals(org.creators, [{ creatorType: "author", name: "World Health Organization" }]);
  assertEquals(org.tags, []);
  assertEquals(fromDb({ ...ROW, groupID: 4242 }, STORAGE).groupId, 4242);
});

Deno.test("local API items", () => {
  const raw = {
    key: "ABCD1234",
    library: { type: "group", id: 7 },
    meta: { numChildren: 1 },
    data: {
      key: "ABCD1234",
      itemType: "journalArticle",
      title: "T",
      creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
      date: "1843",
      tags: [{ tag: "computing" }, { tag: "history", type: 1 }],
      collections: ["X"],
      relations: {},
      extra: "",
    },
  };
  const child = {
    key: "ATT1",
    data: {
      itemType: "attachment",
      linkMode: "imported_file",
      filename: "a.pdf",
      contentType: "application/pdf",
      title: "PDF",
    },
  };
  const linked = {
    key: "ATT2",
    data: {
      itemType: "attachment",
      linkMode: "linked_file",
      path: "/home/me/Papers/b.pdf",
      contentType: "application/pdf",
      title: "B",
    },
  };
  const note = { key: "N", data: { itemType: "note" } };
  const item = fromApi(raw, [child, linked, note], STORAGE);
  assertEquals(item.groupId, 7);
  assertEquals(item.tags, ["computing", "history"]);
  assertEquals(item.fields, { title: "T", date: "1843" });
  assertEquals(item.attachments.map((a) => a.path), [`${STORAGE}/ATT1/a.pdf`, "/home/me/Papers/b.pdf"]);
  assertEquals(attachmentFrom({ key: "K", linkMode: "linked_url", title: "Site" }, STORAGE).path, undefined);
});

Deno.test("names, types and publications", () => {
  assertEquals(initials("Ada"), "A.");
  assertEquals(initials("Luigi F."), "L. F.");
  assertEquals(initials("Jean-Paul"), "J.-P.");
  assertEquals(initials("Émile"), "É.");
  assertEquals(creatorSummary(article), "Lovelace and Menabrea");
  assertEquals(creatorSummary(book()), "Knuth");
  assertEquals(
    creatorSummary({ creators: [1, 2, 3].map((n) => ({ creatorType: "author", lastName: `L${n}` })) }),
    "L1 et al.",
  );
  assertEquals(typeName("journalArticle"), "Journal Article");
  assertEquals(typeName("videoRecording"), "Video Recording");
  assertEquals(publication(article), "Scientific Memoirs");
  assertEquals(publication(book()), "Addison-Wesley");
});

Deno.test("APA authors: ampersand, 20 names, organizations", () => {
  const people = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ creatorType: "author", firstName: "A", lastName: `L${i + 1}` }));
  assertEquals(apaAuthors(people(1)), "L1, A.");
  assertEquals(apaAuthors(people(2)), "L1, A., & L2, A.");
  assertEquals(apaAuthors(people(3)), "L1, A., L2, A., & L3, A.");
  const many = apaAuthors(people(25));
  assert(many.startsWith("L1, A., L2, A.,"));
  assert(many.endsWith("L19, A., … L25, A."));
  assertEquals(apaAuthors([{ creatorType: "author", name: "World Health Organization" }]), "World Health Organization");
});

Deno.test("APA references for common types", () => {
  assertEquals(
    apaCitation(article),
    "Lovelace, A., & Menabrea, L. F. (1843). Sketch of the Analytical Engine. Scientific Memoirs, 3(2), 666–731. https://doi.org/10.1000/xyz123",
  );
  assertEquals(apaCitation(book()), "Knuth, D. E. (1997). The Art of Computer Programming (3rd ed.). Addison-Wesley.");
  assertEquals(
    apaCitation({
      key: "S",
      itemType: "bookSection",
      title: "On Computable Numbers",
      creators: [{ creatorType: "author", firstName: "Alan", lastName: "Turing" }, {
        creatorType: "editor",
        firstName: "B. Jack",
        lastName: "Copeland",
      }],
      fields: { date: "2004", bookTitle: "The Essential Turing", pages: "58-90", publisher: "Oxford University Press" },
      tags: [],
      attachments: [],
    }),
    "Turing, A. (2004). On Computable Numbers. In B. J. Copeland (Ed.), The Essential Turing (pp. 58–90). Oxford University Press.",
  );
  assertEquals(
    apaCitation({
      key: "W",
      itemType: "webpage",
      title: "Zotero Documentation",
      creators: [],
      fields: { url: "https://www.zotero.org/support/", websiteTitle: "Zotero" },
      tags: [],
      attachments: [],
    }),
    "Zotero Documentation. (n.d.). Zotero. https://www.zotero.org/support/",
  );
  assertEquals(
    apaCitation({
      key: "T",
      itemType: "thesis",
      title: "Deep Things",
      creators: [{ creatorType: "author", firstName: "Grace", lastName: "Hopper" }],
      fields: { date: "1934", thesisType: "Doctoral dissertation", university: "Yale University" },
      tags: [],
      attachments: [],
    }),
    "Hopper, G. (1934). Deep Things [Doctoral dissertation, Yale University].",
  );
  assertEquals(
    apaCitation(
      book({ creators: [{ creatorType: "editor", firstName: "Ann", lastName: "Ed" }], fields: { date: "2001" } }),
    ),
    "Ed, A. (Ed.). (2001). The Art of Computer Programming.",
  );
  assertEquals(inTextCitation(article), "(Lovelace & Menabrea, 1843)");
  assertEquals(inTextCitation(book({ fields: {} })), "(Knuth, n.d.)");
});

Deno.test("citation keys and BibTeX", () => {
  assertEquals(citationKey(article), "lovelace1843sketch");
  assertEquals(citationKey(book()), "knuth1997art");
  assertEquals(citationKey(book({ fields: { extra: "Citation Key: knuthTAOCP\nother" } })), "knuthTAOCP");
  assertEquals(
    citationKey(
      book({
        creators: [{ creatorType: "author", firstName: "Kurt", lastName: "Gödel" }],
        title: "Über formal unentscheidbare Sätze",
        fields: { date: "1931" },
      }),
    ),
    "godel1931uber",
  );
  assertEquals(
    bibtex(article),
    [
      "@article{lovelace1843sketch,",
      "  title = {{Sketch of the Analytical Engine}},",
      "  author = {Lovelace, Ada and Menabrea, Luigi F.},",
      "  journal = {Scientific Memoirs},",
      "  year = {1843},",
      "  volume = {3},",
      "  number = {2},",
      "  pages = {666--731},",
      "  doi = {https://doi.org/10.1000/xyz123},",
      "  keywords = {computing, history},",
      "}",
    ].join("\n"),
  );
  const b = bibtex(book({ title: "R&D: 100% {fun}" }));
  assert(b.startsWith("@book{knuth1997rd,"));
  assert(b.includes("title = {{R\\&D: 100\\% \\{fun\\}}},"));
  assert(b.includes("publisher = {Addison-Wesley},"));
  assert(b.includes("address = {Reading, MA},"));
  assert(!b.includes("howpublished"));
  assert(
    bibtex({ ...book(), itemType: "thesis", fields: { thesisType: "Master's thesis", university: "MIT" } }).startsWith(
      "@mastersthesis{",
    ),
  );
});

Deno.test("searching the database copy", () => {
  const items = [article, book({ tags: ["algorithms"], dateAdded: "2026-10-20T08:00:00Z" })];
  assertEquals(search(items, "").map((i) => i.key), ["BOOK0001", "ABCD1234"]);
  assertEquals(search(items, "lovelace").map((i) => i.key), ["ABCD1234"]);
  assertEquals(search(items, "analytical eng").map((i) => i.key), ["ABCD1234"]);
  assertEquals(search(items, "#algo").map((i) => i.key), ["BOOK0001"]);
  assertEquals(search(items, "knuth 1997").map((i) => i.key), ["BOOK0001"]);
  assertEquals(search(items, "knuth 1843"), []);
  assertEquals(matchScore(article, "#nope"), 0);
  assert(matchScore(article, "sketch") > matchScore(article, "memoirs"));
});

Deno.test("local API parameters", () => {
  assertEquals(apiParams("lovelace #computing #history"), {
    format: "json",
    limit: "40",
    itemType: "-attachment",
    q: "lovelace",
    qmode: "titleCreatorYear",
    sort: "dateModified",
    direction: "desc",
    tag: ["computing", "history"],
  });
  assertEquals(apiParams("").sort, "dateAdded");
});

Deno.test("links and PDFs", () => {
  assertEquals(selectUrl(article), "zotero://select/library/items/ABCD1234");
  assertEquals(selectUrl({ key: "K", groupId: 9 }), "zotero://select/groups/9/items/K");
  assertEquals(mainPdf(article)?.key, "ATT1");
  assertEquals(openPdfUrl(article, mainPdf(article)!), "zotero://open-pdf/library/items/ATT1");
  assertEquals(mainPdf(book()), undefined);
});

Deno.test("item and setup", () => {
  const item = zoteroItem(article, "db");
  assertEquals(item.subtitle, "Lovelace and Menabrea · Scientific Memoirs");
  assertEquals(item.actions?.slice(0, 4).map((a) => a.title), [
    "Show in Zotero",
    "Open PDF in Zotero",
    "Open PDF in Default App",
    "Copy Citation",
  ]);
  assertEquals(sqliteInstall("ID=fedora"), "sudo dnf install sqlite");
  assertEquals(sqliteInstall('ID=pop\nID_LIKE="ubuntu debian"'), "sudo apt install sqlite3");
  assertEquals(sqliteInstall("ID=arch"), "sudo pacman -S sqlite");
});

Deno.test("the SQL query runs against a Zotero-shaped database", async () => {
  // Only when a sqlite3 program is installed (CI may not have it).
  let ok = false;
  try {
    ok = (await new Deno.Command("sqlite3", { args: ["-version"], stdout: "null", stderr: "null" }).output()).success;
  } catch { /* not installed */ }
  if (!ok) return;
  const dir = await Deno.makeTempDir();
  try {
    const schema = `
CREATE TABLE itemTypesCombined (itemTypeID INT, typeName TEXT);
CREATE TABLE fieldsCombined (fieldID INT, fieldName TEXT);
CREATE TABLE items (itemID INTEGER PRIMARY KEY, itemTypeID INT, dateAdded TEXT, dateModified TEXT, libraryID INT, key TEXT);
CREATE TABLE itemDataValues (valueID INTEGER PRIMARY KEY, value);
CREATE TABLE itemData (itemID INT, fieldID INT, valueID INT);
CREATE TABLE creators (creatorID INTEGER PRIMARY KEY, firstName TEXT, lastName TEXT, fieldMode INT);
CREATE TABLE creatorTypes (creatorTypeID INT, creatorType TEXT);
CREATE TABLE itemCreators (itemID INT, creatorID INT, creatorTypeID INT, orderIndex INT);
CREATE TABLE tags (tagID INTEGER PRIMARY KEY, name TEXT);
CREATE TABLE itemTags (itemID INT, tagID INT, type INT);
CREATE TABLE itemAttachments (itemID INT, parentItemID INT, linkMode INT, contentType TEXT, path TEXT);
CREATE TABLE deletedItems (itemID INT);
CREATE TABLE groups (groupID INT, libraryID INT);
INSERT INTO itemTypesCombined VALUES (1, 'book'), (2, 'attachment');
INSERT INTO fieldsCombined VALUES (1, 'title');
INSERT INTO items VALUES (1, 1, '2026-01-01 00:00:00', '2026-01-01 00:00:00', 1, 'BOOK'), (2, 2, '', '', 1, 'ATT'), (3, 1, '', '', 1, 'GONE');
INSERT INTO itemDataValues VALUES (1, 'A Book'), (2, 'PDF');
INSERT INTO itemData VALUES (1, 1, 1), (2, 1, 2);
INSERT INTO creators VALUES (1, 'Ada', 'Lovelace', 0);
INSERT INTO creatorTypes VALUES (1, 'author');
INSERT INTO itemCreators VALUES (1, 1, 1, 0);
INSERT INTO itemAttachments VALUES (2, 1, 0, 'application/pdf', 'storage:a.pdf');
INSERT INTO deletedItems VALUES (3);`;
    const db = `${dir}/z.sqlite`;
    await new Deno.Command("sqlite3", { args: [db, schema] }).output();
    const out = await new Deno.Command("sqlite3", { args: ["-json", db], stdin: "piped", stdout: "piped" }).spawn();
    const w = out.stdin.getWriter();
    await w.write(new TextEncoder().encode(queryFor(true)));
    await w.close();
    const rows = JSON.parse(new TextDecoder().decode((await out.output()).stdout)) as DbRow[];
    const items = rows.map((r) => fromDb(r, STORAGE));
    assertEquals(items.map((i) => [i.key, i.title, i.creators[0]?.lastName, i.attachments[0]?.path]), [
      ["BOOK", "A Book", "Lovelace", `${STORAGE}/ATT/a.pdf`],
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
