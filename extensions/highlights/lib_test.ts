import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  age,
  bookMarkdown,
  byBook,
  citation,
  cleanAuthor,
  clippingCandidates,
  expandHome,
  fromHypothesis,
  fromReadwise,
  type Highlight,
  hypothesisAccount,
  type HypothesisRow,
  kindleHighlights,
  locationRange,
  markdownQuote,
  mergeHighlights,
  newestFirst,
  oneLine,
  parseClippings,
  parseKindleDate,
  type ReadwiseBook,
  setupItem,
  splitTitle,
  whereIn,
} from "./lib.ts";

// A real-looking My Clippings.txt: BOM, CRLF, an English Kindle (two date
// styles), an edited highlight, a note, a bookmark, the clipping limit, an
// old Kindle's format and a French Kindle.
const CLIPPINGS = [
  "﻿The Pragmatic Programmer (David Thomas;Andrew Hunt)",
  "- Your Highlight on page 12 | Location 170-172 | Added on Sunday, 3 March 2024 10:15:32",
  "",
  "Care About Your Craft",
  "==========",
  "The Pragmatic Programmer (David Thomas;Andrew Hunt)",
  "- Your Highlight on page 12 | Location 170-173 | Added on Sunday, 3 March 2024 10:16:01",
  "",
  "Care About Your Craft. Why spend your life developing software unless you care about doing it well?",
  "==========",
  "The Pragmatic Programmer (David Thomas;Andrew Hunt)",
  "- Your Note on page 12 | Location 173 | Added on Sunday, 3 March 2024 10:16:40",
  "",
  "The whole book in one line",
  "==========",
  "The Pragmatic Programmer (David Thomas;Andrew Hunt)",
  "- Your Bookmark on page 30 | Location 455 | Added on Monday, 4 March 2024 08:00:00",
  "",
  "",
  "==========",
  "Nineteen Eighty-Four (Orwell, George)",
  "- Your Highlight at location 1520-1524 | Added on Thursday, March 7, 2024 9:15:32 PM",
  "",
  "Who controls the past controls the future: who controls the present controls the past.",
  "==========",
  "Nineteen Eighty-Four (Orwell, George)",
  "- Your Highlight at location 1600-1601 | Added on Thursday, March 7, 2024 9:20:00 PM",
  "",
  "<You have reached the clipping limit for this item>",
  "==========",
  "Dune (Dune Chronicles, Book 1) (Frank Herbert)",
  "- Highlight Loc. 1520-24  | Added on Tuesday, January 14, 2014, 08:12 AM",
  "",
  "I must not fear. Fear is the mind-killer.",
  "==========",
  "Le Petit Prince (Antoine de Saint-Exupéry)",
  "- Votre surlignement sur la page 72 | emplacement 1001-1002 | Ajouté le dimanche 3 mars 2024 10:15:32",
  "",
  "On ne voit bien qu'avec le cœur. L'essentiel est invisible pour les yeux.",
  "==========",
  "Le Petit Prince (Antoine de Saint-Exupéry)",
  "- Votre note sur la page 72 | emplacement 1002 | Ajouté le dimanche 3 mars 2024 10:16:00",
  "",
  "La phrase du renard",
  "==========",
  "notes-de-reunion.pdf",
  "- Your Highlight on page 3 | Added on Friday, 1 November 2024 14:02:11",
  "",
  "Decide by Friday",
  "==========",
  "",
].join("\r\n");

Deno.test("Kindle dates in several languages", () => {
  assertEquals(parseKindleDate("Sunday, 3 March 2024 10:15:32"), "2024-03-03T10:15:32");
  assertEquals(parseKindleDate("Thursday, March 7, 2024 9:15:32 PM"), "2024-03-07T21:15:32");
  assertEquals(parseKindleDate("Tuesday, January 14, 2014, 08:12 AM"), "2014-01-14T08:12:00");
  assertEquals(parseKindleDate("Monday, December 1, 2025 12:05:00 AM"), "2025-12-01T00:05:00");
  assertEquals(parseKindleDate("dimanche 3 mars 2024 10:15:32"), "2024-03-03T10:15:32");
  assertEquals(parseKindleDate("Sonntag, 3. März 2024 10:15:32"), "2024-03-03T10:15:32");
  assertEquals(parseKindleDate("domingo, 3 de marzo de 2024 10:15:32"), "2024-03-03T10:15:32");
  assertEquals(parseKindleDate("2024年3月7日木曜日 21:15:32"), "2024-03-07T21:15:32");
  assertEquals(parseKindleDate("no date here"), undefined);
});

Deno.test("Kindle titles, authors and locations", () => {
  assertEquals(splitTitle("The Pragmatic Programmer (David Thomas;Andrew Hunt)"), {
    title: "The Pragmatic Programmer",
    author: "David Thomas, Andrew Hunt",
  });
  assertEquals(splitTitle("Dune (Dune Chronicles, Book 1) (Frank Herbert)"), {
    title: "Dune (Dune Chronicles, Book 1)",
    author: "Frank Herbert",
  });
  assertEquals(splitTitle("Nineteen Eighty-Four (Orwell, George)").author, "George Orwell");
  assertEquals(splitTitle("notes.pdf"), { title: "notes.pdf" });
  assertEquals(splitTitle("Foundation (Book 1)"), { title: "Foundation (Book 1)" });
  assertEquals(cleanAuthor("Thomas, David; Hunt, Andrew"), "David Thomas, Andrew Hunt");
  assertEquals(locationRange("1520-24"), [1520, 1524]);
  assertEquals(locationRange(" 170-172 "), [170, 172]);
  assertEquals(locationRange("455"), [455, 455]);
  assertEquals(locationRange("9-1"), [9, 9]);
});

Deno.test("parsing My Clippings.txt", () => {
  const clips = parseClippings(CLIPPINGS);
  assertEquals(clips.map((c) => c.kind), [
    "highlight",
    "highlight",
    "note",
    "bookmark",
    "highlight",
    "highlight",
    "highlight",
    "note",
    "highlight",
  ]);
  assertEquals(clips[0].title, "The Pragmatic Programmer");
  assertEquals(clips[0].page, "12");
  assertEquals([clips[0].start, clips[0].end], [170, 172]);
  assertEquals(clips[0].date, "2024-03-03T10:15:32");
  assertEquals(clips[4].author, "George Orwell");
  assertEquals(clips[4].page, undefined);
  assertEquals([clips[4].start, clips[4].end], [1520, 1524]);
  assertEquals(clips[5].title, "Dune (Dune Chronicles, Book 1)");
  assertEquals([clips[5].start, clips[5].end], [1520, 1524]);
  assertEquals(clips[5].date, "2014-01-14T08:12:00");
  assertEquals(clips[6].page, "72");
  assertEquals(clips[6].start, 1001);
  assertEquals(clips[6].date, "2024-03-03T10:15:32");
  assertEquals(clips[8].title, "notes-de-reunion.pdf");
  assertEquals(clips[8].start, undefined);
  assertEquals(clips[8].page, "3");
  assertEquals(parseClippings(""), []);
  assertEquals(parseClippings("garbage\nwithout\nseparators"), []);
});

Deno.test("Kindle highlights: edits merged, notes attached", () => {
  const hs = kindleHighlights(parseClippings(CLIPPINGS));
  assertEquals(hs.length, 5);
  const craft = hs.find((h) => h.text.startsWith("Care About"))!;
  assertStringIncludes(craft.text, "Why spend your life");
  assertEquals(craft.note, "The whole book in one line");
  assertEquals(craft.location, "170-173");
  assertEquals(craft.author, "David Thomas, Andrew Hunt");
  const prince = hs.find((h) => h.title === "Le Petit Prince")!;
  assertEquals(prince.note, "La phrase du renard");
  assertEquals(whereIn(prince), "p. 72 · loc. 1001-1002");
  assert(hs.every((h) => h.id.startsWith("kindle:")));
  // Same input, same ids: the list keeps its selection across reloads.
  assertEquals(kindleHighlights(parseClippings(CLIPPINGS)).map((h) => h.id), hs.map((h) => h.id));
  // A note with no highlight under it stays, on its own.
  const lone = kindleHighlights(parseClippings(
    "Book (Me)\n- Your Note on Location 99 | Added on Sunday, 3 March 2024 10:15:32\n\nJust a thought\n==========\n",
  ));
  assertEquals(lone.map((h) => [h.text, h.tags]), [["Just a thought", ["note"]]]);
});

// GET https://readwise.io/api/v2/export/
const READWISE: ReadwiseBook[] = [
  {
    user_book_id: 12345,
    title: "Atomic Habits",
    readable_title: "Atomic Habits",
    author: "James Clear",
    source: "kindle",
    category: "books",
    source_url: null,
    unique_url: null,
    readwise_url: "https://readwise.io/bookreview/12345",
    book_tags: [],
    highlights: [
      {
        id: 111,
        text: "You do not rise to the level of your goals. You fall to the level of your systems.",
        location: 233,
        location_type: "location",
        note: "Systems > goals",
        color: "yellow",
        highlighted_at: "2025-02-01T09:00:00Z",
        created_at: "2025-02-02T10:00:00Z",
        updated_at: "2025-02-02T10:00:00Z",
        url: null,
        tags: [{ id: 1, name: "habits" }, { id: 2, name: "favorite" }],
        is_favorite: true,
        is_discard: false,
        readwise_url: "https://readwise.io/open/111",
      },
      { id: 112, text: "Discarded", location: 10, location_type: "location", is_discard: true },
    ],
  },
  {
    user_book_id: 999,
    title: "How to Write a Good Commit Message",
    readable_title: "How to Write a Good Commit Message",
    author: "Chris Beams",
    category: "articles",
    source_url: "https://cbea.ms/git-commit/",
    highlights: [
      {
        id: 222,
        text: "A well-crafted Git commit message is the best way to communicate context.",
        location: 1200,
        location_type: "offset",
        highlighted_at: null,
        created_at: "2026-10-30T08:00:00Z",
        url: "https://cbea.ms/git-commit/#intro",
        tags: [],
      },
    ],
  },
];

Deno.test("Readwise export", () => {
  const { keep, drop } = fromReadwise(READWISE);
  assertEquals(drop, ["readwise:112"]);
  assertEquals(keep.length, 2);
  const [habit, commit] = keep;
  assertEquals(habit.location, "233");
  assertEquals(habit.page, undefined);
  assertEquals(habit.tags, ["habits"]);
  assertEquals(habit.favorite, true);
  assertEquals(habit.url, "https://readwise.io/open/111");
  assertEquals(commit.date, "2026-10-30T08:00:00Z");
  assertEquals(commit.sourceUrl, "https://cbea.ms/git-commit/#intro");
  assertEquals(commit.location, undefined);
  // An incremental sync: one edited, one deleted.
  const merged = mergeHighlights(keep, {
    keep: [{ ...habit, note: "Edited" }],
    drop: ["readwise:222"],
  });
  assertEquals(merged.map((h) => [h.id, h.note]), [["readwise:111", "Edited"]]);
});

// GET https://api.hypothes.is/api/search?user=acct:ada@hypothes.is
const HYPOTHESIS: HypothesisRow[] = [
  {
    id: "Zx9_aBcDEe-1",
    created: "2026-10-20T12:00:00.000000+00:00",
    updated: "2026-10-20T12:05:00.000000+00:00",
    user: "acct:ada@hypothes.is",
    uri: "https://en.wikipedia.org/wiki/Analytical_engine",
    text: "First general-purpose design",
    tags: ["computing", "history"],
    target: [{
      source: "https://en.wikipedia.org/wiki/Analytical_engine",
      selector: [
        { type: "RangeSelector" },
        { type: "TextPositionSelector", start: 4521 },
        {
          type: "TextQuoteSelector",
          exact: "The Analytical Engine was a proposed mechanical general-purpose computer",
        },
      ],
    }],
    document: { title: ["Analytical engine - Wikipedia"] },
    links: {
      html: "https://hypothes.is/a/Zx9_aBcDEe-1",
      incontext: "https://hyp.is/Zx9_aBcDEe-1/en.wikipedia.org/wiki/Analytical_engine",
    },
  },
  {
    id: "PageNote1",
    created: "2026-10-21T12:00:00+00:00",
    user: "acct:ada@hypothes.is",
    uri: "https://example.com/post",
    text: "Read again later",
    target: [{ source: "https://example.com/post" }],
    document: {},
  },
  {
    id: "Reply1",
    created: "2026-10-22T12:00:00+00:00",
    user: "acct:ada@hypothes.is",
    uri: "x",
    text: "+1",
    references: ["Zx9"],
  },
  { id: "Empty", created: "2026-10-22T12:00:00+00:00", user: "acct:ada@hypothes.is", uri: "x", text: "" },
];

Deno.test("Hypothes.is annotations", () => {
  assertEquals(hypothesisAccount("ada"), "acct:ada@hypothes.is");
  assertEquals(hypothesisAccount("@ada"), "acct:ada@hypothes.is");
  assertEquals(hypothesisAccount("acct:ada@hypothes.is"), "acct:ada@hypothes.is");
  assertEquals(hypothesisAccount("ada@example.org"), "acct:ada@example.org");
  assertEquals(hypothesisAccount(" "), undefined);
  const hs = fromHypothesis(HYPOTHESIS);
  assertEquals(hs.length, 2);
  assertEquals(hs[0].text, "The Analytical Engine was a proposed mechanical general-purpose computer");
  assertEquals(hs[0].note, "First general-purpose design");
  assertEquals(hs[0].title, "Analytical engine - Wikipedia");
  assertEquals(hs[0].url, "https://hyp.is/Zx9_aBcDEe-1/en.wikipedia.org/wiki/Analytical_engine");
  assertEquals(hs[0].order, 4521);
  assertEquals(hs[1].text, "Read again later");
  assertEquals(hs[1].note, undefined);
  assertEquals(hs[1].title, "example.com");
  assertEquals(hs[1].category, "notes");
});

Deno.test("citations and Markdown", () => {
  const [habit, commit] = fromReadwise(READWISE).keep;
  assertEquals(
    citation(habit),
    "“You do not rise to the level of your goals. You fall to the level of your systems.”\n— James Clear, Atomic Habits, loc. 233",
  );
  assertEquals(
    citation(commit),
    "“A well-crafted Git commit message is the best way to communicate context.”\n— Chris Beams, How to Write a Good Commit Message https://cbea.ms/git-commit/#intro",
  );
  assertEquals(
    markdownQuote(commit),
    "> A well-crafted Git commit message is the best way to communicate context.\n>\n> — Chris Beams, [How to Write a Good Commit Message](https://cbea.ms/git-commit/#intro)",
  );
  assertStringIncludes(markdownQuote(habit), "\n\nSystems > goals");
  const prince = kindleHighlights(parseClippings(CLIPPINGS)).find((h) => h.title === "Le Petit Prince")!;
  assertStringIncludes(citation(prince), "— Antoine de Saint-Exupéry, Le Petit Prince, p. 72");
  assertEquals(oneLine("a\n\n b   c"), "a b c");
  assertEquals(oneLine("x".repeat(200), 10), "xxxxxxxxx…");
  assertStringIncludes(setupItem().detail!.markdown!, "readwise.io/access_token");
});

Deno.test("books, ordering and ages", () => {
  const all: Highlight[] = [
    ...kindleHighlights(parseClippings(CLIPPINGS)),
    ...fromReadwise(READWISE).keep,
    ...fromHypothesis(HYPOTHESIS),
  ];
  const books = byBook(all);
  assertEquals(books[0].title, "How to Write a Good Commit Message");
  assertEquals(books.slice(1, 4).map((b) => b.title), [
    "example.com",
    "Analytical engine - Wikipedia",
    "Atomic Habits",
  ]);
  const pp = books.find((b) => b.title === "The Pragmatic Programmer")!;
  assertEquals(pp.count, 1);
  const prince = books.find((b) => b.title === "Le Petit Prince")!;
  assertStringIncludes(bookMarkdown(prince), "# Le Petit Prince\n\n*Antoine de Saint-Exupéry*\n\n> On ne voit bien");
  assertStringIncludes(bookMarkdown(prince), "> — p. 72 · loc. 1001-1002\n\nLa phrase du renard");
  assertEquals(newestFirst(all)[0].source, "readwise");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age("2026-10-31T08:00:00Z", now), "today");
  assertEquals(age("2026-10-28T08:00:00Z", now), "3d");
  assertEquals(age("2026-06-01T08:00:00Z", now), "5mo");
  assertEquals(age("2024-03-03T10:15:32", now), "2y");
  assertEquals(age(undefined, now), "");
});

Deno.test("where to look for My Clippings.txt", () => {
  assertEquals(expandHome("~/Documents/My Clippings.txt", "/home/ada"), "/home/ada/Documents/My Clippings.txt");
  assertEquals(expandHome("/media/x", "/home/ada"), "/media/x");
  const c = clippingCandidates("/home/ada", "ada", ["/run/media/ada/KINDLE", "/run/media/ada/Kindle"]);
  assertEquals(c[0], "/run/media/ada/KINDLE/documents/My Clippings.txt");
  assertEquals(c.filter((p) => p === "/run/media/ada/Kindle/documents/My Clippings.txt").length, 1);
  assertEquals(c.at(-1), "/home/ada/Downloads/My Clippings.txt");
});

Deno.test("manifest reads where the candidates are", async () => {
  const toml = await Deno.readTextFile(new URL("./backslash.toml", import.meta.url));
  for (
    const p of [
      "/run/media",
      "/media",
      "~/My Clippings.txt",
      "~/Documents/My Clippings.txt",
      "~/Downloads/My Clippings.txt",
    ]
  ) {
    assertStringIncludes(toml, `"${p}"`);
  }
});
