import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  absolute,
  articleUrl,
  extractToMarkdown,
  firstParagraph,
  isLanguage,
  onThisDayUrl,
  pageUrl,
  parseArticle,
  parseLangLinks,
  parseOnThisDay,
  parseSearch,
  parseSummary,
  preferredLanguage,
  readingTime,
  searchUrl,
  sortLangLinks,
  splitLanguage,
  stripMath,
  summaryUrl,
  truncate,
  wordCount,
} from "./lib.ts";

// Trimmed from https://fr.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=tour+eiffel&prop=extracts|pageimages|description|info…
const SEARCH = {
  batchcomplete: true,
  continue: { gsroffset: 2, continue: "gsroffset||" },
  query: {
    pages: [
      {
        pageid: 1359783,
        ns: 0,
        title: "Champ-de-Mars",
        index: 2,
        thumbnail: {
          source:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/Tour_Eiffel_Wikimedia_Commons.jpg/480px-Tour_Eiffel_Wikimedia_Commons.jpg",
          width: 480,
          height: 720,
        },
        description: "jardin public à Paris",
        descriptionsource: "central",
        contentmodel: "wikitext",
        pagelanguage: "fr",
        touched: "2026-10-20T08:12:44Z",
        length: 48213,
        fullurl: "https://fr.wikipedia.org/wiki/Champ-de-Mars",
        canonicalurl: "https://fr.wikipedia.org/wiki/Champ-de-Mars",
        extract: "Le Champ-de-Mars est un vaste jardin public entièrement ouvert, situé à Paris.",
      },
      {
        pageid: 1359,
        ns: 0,
        title: "Tour Eiffel",
        index: 1,
        thumbnail: {
          source:
            "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel_Wikimedia_Commons_%28cropped%29.jpg/320px-Tour_Eiffel.jpg",
          width: 320,
          height: 480,
        },
        description: "tour de fer puddlé de 330 m de hauteur située à Paris",
        touched: "2026-10-27T19:01:02Z",
        length: 182044,
        fullurl: "https://fr.wikipedia.org/wiki/Tour_Eiffel",
        canonicalurl: "https://fr.wikipedia.org/wiki/Tour_Eiffel",
        extract:
          "La tour Eiffel est une tour de fer puddlé de 330 m de hauteur située à Paris.\nConstruite en deux ans par Gustave Eiffel et ses collaborateurs pour l'Exposition universelle de 1889.",
      },
      { ns: 0, title: "Ghost", missing: true },
    ],
  },
};

const SUMMARY = {
  type: "standard",
  title: "Eiffel_Tower",
  displaytitle: '<span class="mw-page-title-main">Eiffel Tower</span>',
  titles: { canonical: "Eiffel_Tower", normalized: "Eiffel Tower", display: "Eiffel Tower" },
  pageid: 9232,
  thumbnail: {
    source: "https://upload.wikimedia.org/wikipedia/commons/thumb/8/85/Tour_Eiffel.jpg/330px-Tour_Eiffel.jpg",
    width: 330,
    height: 495,
  },
  lang: "en",
  dir: "ltr",
  timestamp: "2026-10-25T10:05:12Z",
  description: "Tower in Paris, France",
  coordinates: { lat: 48.85822222, lon: 2.2945 },
  content_urls: {
    desktop: { page: "https://en.wikipedia.org/wiki/Eiffel_Tower" },
    mobile: { page: "https://en.m.wikipedia.org/wiki/Eiffel_Tower" },
  },
  extract: "The Eiffel Tower is a wrought-iron lattice tower on the Champ de Mars in Paris, France.",
};

const ARTICLE_TEXT = `The Eiffel Tower is a wrought-iron lattice tower.
It is named after the engineer Gustave Eiffel.

== History ==

=== Origin ===
The design of the Eiffel Tower is attributed to Maurice Koechlin.
=== Construction ===

Work on the foundations started on 28 January 1887.

== Design ==
The tower is {\\displaystyle h=330{\\text{ m}}} tall.

== See also ==

== References ==


== External links ==
`;

Deno.test("languages", () => {
  assertEquals(preferredLanguage("FR", "en_US.UTF-8"), "fr");
  assertEquals(preferredLanguage("", "de_DE.UTF-8"), "de");
  assertEquals(preferredLanguage(undefined, "C.UTF-8"), "en");
  assertEquals(preferredLanguage("not a code!", undefined), "en");
  assert(isLanguage("zh-yue") && isLanguage("simple") && !isLanguage("e"));
  assertEquals(splitLanguage("fr: Tour Eiffel", "en"), { lang: "fr", text: "Tour Eiffel", override: true });
  assertEquals(splitLanguage("DE:Berlin", "en"), { lang: "de", text: "Berlin", override: true });
  assertEquals(splitLanguage("Star Wars: Episode IV", "en"), {
    lang: "en",
    text: "Star Wars: Episode IV",
    override: false,
  });
  assertEquals(splitLanguage("ja:", "en"), { lang: "ja", text: "", override: true });
});

Deno.test("urls", () => {
  assertEquals(pageUrl("en", "C++ (language)"), "https://en.wikipedia.org/wiki/C%2B%2B_(language)");
  assertEquals(summaryUrl("fr", "Tour Eiffel"), "https://fr.wikipedia.org/api/rest_v1/page/summary/Tour_Eiffel");
  const s = new URL(searchUrl("fr", "tour eiffel", 5));
  assertEquals(s.hostname, "fr.wikipedia.org");
  assertEquals(s.searchParams.get("gsrsearch"), "tour eiffel");
  assertEquals(s.searchParams.get("gsrlimit"), "5");
  assertEquals(s.searchParams.get("prop"), "extracts|pageimages|description|info");
  assertEquals(new URL(articleUrl("en", "Paris")).searchParams.get("exsectionformat"), "wiki");
  assertEquals(
    onThisDayUrl("en", new Date(2026, 9, 3)),
    "https://en.wikipedia.org/api/rest_v1/feed/onthisday/all/10/03",
  );
  assertEquals(absolute("//upload.wikimedia.org/x.jpg"), "https://upload.wikimedia.org/x.jpg");
});

Deno.test("search results in order, with their picture", () => {
  const pages = parseSearch("fr", SEARCH);
  assertEquals(pages.map((p) => p.title), ["Tour Eiffel", "Champ-de-Mars"]);
  const [tour] = pages;
  assertEquals(tour.url, "https://fr.wikipedia.org/wiki/Tour_Eiffel");
  assertEquals(tour.image?.width, 320);
  assert(tour.image?.url.startsWith("https://upload.wikimedia.org/"));
  assertEquals(tour.description, "tour de fer puddlé de 330 m de hauteur située à Paris");
  assertEquals(tour.length, 182044);
  assertEquals(
    firstParagraph(tour.extract),
    "La tour Eiffel est une tour de fer puddlé de 330 m de hauteur située à Paris.",
  );
  assertEquals(parseSearch("fr", { batchcomplete: true }), []);
});

Deno.test("summaries and articles", () => {
  const p = parseSummary("en", SUMMARY);
  assertEquals([p.title, p.lang, p.url], ["Eiffel Tower", "en", "https://en.wikipedia.org/wiki/Eiffel_Tower"]);
  assertEquals(p.coordinates, { lat: 48.85822222, lon: 2.2945 });
  assertEquals(p.disambiguation, undefined);
  assert(parseSummary("en", { ...SUMMARY, type: "disambiguation" }).disambiguation);
  assertEquals(parseArticle("en", { query: { pages: [{ ns: 0, title: "Nope", missing: true }] } }), undefined);
  const a = parseArticle("en", {
    query: { pages: [{ pageid: 9232, title: "Eiffel Tower", extract: ARTICLE_TEXT, length: 120000 }] },
  })!;
  assertEquals(a.url, "https://en.wikipedia.org/wiki/Eiffel_Tower");
});

Deno.test("plain text extract to markdown", () => {
  assertEquals(
    extractToMarkdown(ARTICLE_TEXT),
    [
      "The Eiffel Tower is a wrought-iron lattice tower.",
      "It is named after the engineer Gustave Eiffel.",
      "## History",
      "### Origin",
      "The design of the Eiffel Tower is attributed to Maurice Koechlin.",
      "### Construction",
      "Work on the foundations started on 28 January 1887.",
      "## Design",
      "The tower is  tall.",
    ].join("\n\n"),
  );
  assertEquals(stripMath("a {\\displaystyle {\\frac {1}{2}}} b"), "a  b");
  assertEquals(extractToMarkdown(""), "");
});

Deno.test("language links, known languages first", () => {
  const links = parseLangLinks({
    query: {
      pages: [{
        title: "Eiffel Tower",
        langlinks: [
          { lang: "eo", title: "Eiffel-Turo", autonym: "Esperanto", url: "https://eo.wikipedia.org/wiki/Eiffel-Turo" },
          { lang: "fr", title: "Tour Eiffel", autonym: "français", url: "https://fr.wikipedia.org/wiki/Tour_Eiffel" },
          { lang: "de", title: "Eiffelturm", autonym: "Deutsch" },
        ],
      }],
    },
  });
  assertEquals(sortLangLinks(links).map((l) => l.lang), ["fr", "de", "eo"]);
  assertEquals(links[2].url, "https://de.wikipedia.org/wiki/Eiffelturm");
  assertEquals(parseLangLinks({ query: { pages: [{ title: "X" }] } }), []);
});

Deno.test("on this day feed", () => {
  const entries = parseOnThisDay("en", {
    selected: [{ text: "The Statue of Liberty is dedicated in New York Harbor.", year: 1886, pages: [SUMMARY] }],
    births: [{ text: "Bill Gates, American businessman", year: 1955, pages: [] }],
    holidays: [{ text: "Ochi Day (Greece)", pages: [] }],
  });
  assertEquals(entries.map((e) => [e.kind, e.year]), [["selected", 1886], ["births", 1955], ["holidays", undefined]]);
  assertEquals(entries[0].pages[0].title, "Eiffel Tower");
});

Deno.test("text helpers", () => {
  const long = "First sentence here. Second sentence is longer than the first one. Third.";
  assertEquals(truncate(long, 50), "First sentence here.");
  assertEquals(truncate("short", 50), "short");
  assertStringIncludes(truncate("a".repeat(30) + " " + "b".repeat(30), 40), "…");
  assertEquals(wordCount("L'été 2026, à Paris."), 5);
  assertEquals(readingTime(460), "2 min");
  assertEquals(readingTime(30000), "2 h 10 min");
});
