import { assertEquals } from "@std/assert";
import {
  apaName,
  bestIsbn,
  type Book,
  byline,
  citation,
  cleanSubjects,
  coverUrl,
  description,
  fromDoc,
  isbnQuery,
  languageNames,
  type Saved,
  type SearchDoc,
  setStatus,
  sortSaved,
} from "./lib.ts";
import { bookItem } from "./views.ts";

// Shaped like `GET /search.json?q=dune&fields=…`.
const dune: SearchDoc = {
  key: "/works/OL893415W",
  title: "Dune",
  author_name: ["Frank Herbert"],
  author_key: ["OL79034A"],
  first_publish_year: 1965,
  edition_count: 120,
  cover_i: 11481354,
  isbn: ["0441172717", "9780441172719", "9780340960196"],
  subject: ["Science Fiction", "Fiction, general", "Dune (Imaginary place)", "Science fiction", "nyt:paperback=2021"],
  number_of_pages_median: 604,
  ratings_average: 4.27,
  ratings_count: 512,
  publisher: ["Chilton Books", "Ace"],
  language: ["eng", "fre"],
  want_to_read_count: 2300,
  already_read_count: 650,
};

Deno.test("search documents", () => {
  const b = fromDoc(dune);
  assertEquals(b.isbn, "9780441172719");
  assertEquals(b.subjects, ["Science Fiction", "Dune (Imaginary place)"]);
  assertEquals(b.rating, 4.27);
  assertEquals(b.publisher, "Chilton Books");
  const bare = fromDoc({ key: "/works/OL1W", title: "Untitled", ratings_average: 3, ratings_count: 0 });
  assertEquals(bare.authors, []);
  assertEquals(bare.rating, undefined);
  assertEquals(bare.isbn, undefined);
});

Deno.test("ISBNs", () => {
  assertEquals(bestIsbn(["0441172717"]), "0441172717");
  assertEquals(bestIsbn(["978-0-441-17271-9", "0441172717"]), "9780441172719");
  assertEquals(bestIsbn(["080442957x"]), "080442957X");
  assertEquals(bestIsbn([]), undefined);
  assertEquals(isbnQuery("978-0441172719"), "9780441172719");
  assertEquals(isbnQuery("0 441 17271 7"), "0441172717");
  assertEquals(isbnQuery("dune 1965"), undefined);
  assertEquals(isbnQuery("1234567890123"), undefined);
});

Deno.test("descriptions", () => {
  assertEquals(
    description({
      type: "/type/text",
      value: "Set on the desert planet Arrakis.\r\n\r\n----------\r\nContains:\r\n[1]: https://example.org",
    }),
    "Set on the desert planet Arrakis.",
  );
  assertEquals(
    description("A tale ([source][1])\n\nSee [the wiki][2].\n\n[1]: https://a.org\n[2]: https://b.org"),
    "A tale \n\nSee the wiki.",
  );
  assertEquals(description(undefined), undefined);
  assertEquals(description({ value: "  " }), undefined);
});

Deno.test("subjects", () => {
  assertEquals(
    cleanSubjects([
      "Fantasy",
      "fantasy",
      "Accessible book",
      "Protected DAISY",
      "Fiction, fantasy, general",
      "Large type books",
      "A subject that is much too long to show as a tag",
      "Magic",
    ]),
    ["Fantasy", "Magic"],
  );
});

Deno.test("APA citations", () => {
  assertEquals(apaName("Frank Herbert"), "Herbert, F.");
  assertEquals(apaName("J. R. R. Tolkien"), "Tolkien, J. R. R.");
  assertEquals(apaName("Ursula K. Le Guin"), "Le Guin, U. K.");
  assertEquals(apaName("Jean-Paul Sartre"), "Sartre, J.-P.");
  assertEquals(apaName("Ludwig van Beethoven"), "van Beethoven, L.");
  assertEquals(apaName("Homer"), "Homer");
  assertEquals(citation(fromDoc(dune)), "Herbert, F. (1965). Dune. Chilton Books.");
  assertEquals(
    citation({ authors: ["Terry Pratchett", "Neil Gaiman"], year: 1990, title: "Good Omens", subtitle: "The Nice" }),
    "Pratchett, T., & Gaiman, N. (1990). Good Omens: The Nice.",
  );
  assertEquals(
    citation({ authors: ["A B", "C D", "E F"], title: "What?", publisher: "Pub" }),
    "B, A., D, C., & F, E. (n.d.). What? Pub.",
  );
  assertEquals(citation({ authors: [], year: 2001, title: "Anonymous" }), "(2001). Anonymous.");
});

Deno.test("formatting", () => {
  assertEquals(byline([]), "Unknown author");
  assertEquals(byline(["A", "B"]), "A & B");
  assertEquals(byline(["A", "B", "C"]), "A, B & 1 other");
  assertEquals(byline(["A", "B", "C", "D"]), "A, B & 2 others");
  assertEquals(languageNames(["eng", "fre", "xyz"]), ["English", "French", "xyz"]);
  assertEquals(coverUrl(11481354, "L"), "https://covers.openlibrary.org/b/id/11481354-L.jpg");
  assertEquals(coverUrl(-1, "S"), undefined);
  assertEquals(coverUrl(undefined, "S"), undefined);
});

Deno.test("reading list", () => {
  const a: Book = fromDoc(dune);
  const b: Book = fromDoc({ key: "/works/OL2W", title: "Hyperion" });
  const c: Book = fromDoc({ key: "/works/OL3W", title: "Solaris" });
  let list: Saved[] = [];
  list = setStatus(list, a, "want", 1);
  list = setStatus(list, b, "read", 2);
  list = setStatus(list, c, "want", 3);
  list = setStatus(list, a, "reading", 4);
  assertEquals(list.find((s) => s.book.key === a.key)?.added, 1);
  assertEquals(sortSaved(list).map((s) => s.book.title), ["Dune", "Solaris", "Hyperion"]);
  assertEquals(setStatus(list, b, undefined).length, 2);
});

Deno.test("book item", () => {
  const item = bookItem(fromDoc(dune), { status: "reading" });
  assertEquals(item.icon, "https://covers.openlibrary.org/b/id/11481354-S.jpg");
  assertEquals(item.detail?.image, "https://covers.openlibrary.org/b/id/11481354-L.jpg");
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), ["Reading", "1965"]);
  assertEquals(item.detail?.stats?.map((s) => s.value), [1965, 120, "★ 4.3"]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 3), [
    "Show Description",
    "Open on Open Library",
    "Reading List: Reading",
  ]);
  const cite = item.actions?.find((a) => a.title === "Copy Citation (APA)");
  assertEquals(cite && "text" in cite ? cite.text : undefined, "Herbert, F. (1965). Dune. Chilton Books.");
  const inSection = bookItem(fromDoc(dune), { status: "reading", section: "Reading" });
  assertEquals(inSection.accessories?.map((a) => a.text), ["1965"]);
});
