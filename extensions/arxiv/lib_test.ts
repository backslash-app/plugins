import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  age,
  apaAuthors,
  bibEscape,
  bibtex,
  buildQuery,
  citation,
  citationKey,
  daySection,
  decodeEntities,
  normalizeCategory,
  type Paper,
  parseCategories,
  parseFeed,
  parseId,
  queryUrl,
  splitName,
  zoteroItem,
} from "./lib.ts";
import { paperItem } from "./views.ts";

// Shaped like an answer of export.arxiv.org/api/query.
const FEED = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link href="http://arxiv.org/api/query?search_query%3Dall%3Aattention" rel="self" type="application/atom+xml"/>
  <title type="html">ArXiv Query: search_query=all:attention&amp;id_list=&amp;start=0&amp;max_results=2</title>
  <id>http://arxiv.org/api/abc</id>
  <updated>2026-10-29T00:00:00-04:00</updated>
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">104213</opensearch:totalResults>
  <opensearch:startIndex xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">0</opensearch:startIndex>
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <updated>2023-08-02T00:41:18Z</updated>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All You
  Need</title>
    <summary>  The dominant sequence transduction models are based on complex recurrent or
convolutional neural networks &amp; attention.
</summary>
    <author>
      <name>Ashish Vaswani</name>
      <arxiv:affiliation xmlns:arxiv="http://arxiv.org/schemas/atom">Google Brain</arxiv:affiliation>
    </author>
    <author>
      <name>Noam Shazeer</name>
    </author>
    <author>
      <name>Łukasz Kaiser</name>
    </author>
    <arxiv:comment xmlns:arxiv="http://arxiv.org/schemas/atom">15 pages, 5 figures</arxiv:comment>
    <link href="http://arxiv.org/abs/1706.03762v7" rel="alternate" type="text/html"/>
    <link title="pdf" href="http://arxiv.org/pdf/1706.03762v7" rel="related" type="application/pdf"/>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.CL" scheme="http://arxiv.org/schemas/atom"/>
    <category term="cs.LG" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
  <entry>
    <id>http://arxiv.org/abs/hep-th/9711200v3</id>
    <updated>1998-01-22T19:28:36Z</updated>
    <published>1997-11-27T20:19:05Z</published>
    <title>The Large N Limit of Superconformal Field Theories and Supergravity</title>
    <summary>We show that the large N limit of certain conformal field theories...</summary>
    <author><name>Juan M. Maldacena</name></author>
    <arxiv:doi xmlns:arxiv="http://arxiv.org/schemas/atom">10.1023/A:1026654312961</arxiv:doi>
    <arxiv:journal_ref xmlns:arxiv="http://arxiv.org/schemas/atom">Adv.Theor.Math.Phys.2:231-252,1998</arxiv:journal_ref>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
    <category term="hep-th" scheme="http://arxiv.org/schemas/atom"/>
  </entry>
</feed>`;

const ERROR_FEED = `<feed xmlns="http://www.w3.org/2005/Atom">
  <opensearch:totalResults xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/">1</opensearch:totalResults>
  <entry>
    <id>http://arxiv.org/api/errors#incorrect_id_format_for_1234</id>
    <title>Error</title>
    <summary>incorrect id format for 1234</summary>
  </entry>
</feed>`;

const [attention, maldacena] = parseFeed(FEED).papers;

Deno.test("Atom feed: papers, totals and fields", () => {
  const feed = parseFeed(FEED);
  assertEquals(feed.total, 104213);
  assertEquals(feed.papers.length, 2);
  assertEquals(attention.id, "1706.03762");
  assertEquals(attention.version, 7);
  assertEquals(attention.title, "Attention Is All You Need");
  assertEquals(
    attention.abstract,
    "The dominant sequence transduction models are based on complex recurrent or convolutional neural networks & attention.",
  );
  assertEquals(attention.authors.map((a) => a.name), ["Ashish Vaswani", "Noam Shazeer", "Łukasz Kaiser"]);
  assertEquals(attention.authors[0].affiliation, "Google Brain");
  assertEquals(attention.primaryCategory, "cs.CL");
  assertEquals(attention.categories, ["cs.CL", "cs.LG"]);
  assertEquals(attention.comment, "15 pages, 5 figures");
  assertEquals(attention.published, "2017-06-12T17:57:34Z");
  assertEquals(maldacena.id, "hep-th/9711200");
  assertEquals(maldacena.doi, "10.1023/A:1026654312961");
  assertEquals(maldacena.journalRef, "Adv.Theor.Math.Phys.2:231-252,1998");
});

Deno.test("Atom feed: an error entry is thrown, an empty feed is empty", () => {
  assertThrows(() => parseFeed(ERROR_FEED), Error, "incorrect id format");
  assertEquals(parseFeed("<feed></feed>"), { papers: [], total: 0 });
});

Deno.test("entities", () => {
  assertEquals(
    decodeEntities("a &amp; b &lt;c&gt; &#233;t&#xE9; &quot;x&quot; &unknown;"),
    'a & b <c> été "x" &unknown;',
  );
});

Deno.test("arXiv ids from what is typed", () => {
  assertEquals(parseId("1706.03762"), { id: "1706.03762", version: 1 });
  assertEquals(parseId("https://arxiv.org/abs/2401.01234v2"), { id: "2401.01234", version: 2 });
  assertEquals(parseId("arxiv.org/pdf/2401.01234v3.pdf"), { id: "2401.01234", version: 3 });
  assertEquals(parseId("arXiv:2310.12345"), { id: "2310.12345", version: 1 });
  assertEquals(parseId("hep-th/9711200"), { id: "hep-th/9711200", version: 1 });
  assertEquals(parseId("math.GT/0309136"), { id: "math.GT/0309136", version: 1 });
  assertEquals(parseId("transformers"), undefined);
  assertEquals(parseId("12345"), undefined);
});

Deno.test("categories", () => {
  assertEquals(normalizeCategory("CS.ai"), "cs.AI");
  assertEquals(normalizeCategory("cond-mat.Mes-Hall"), "cond-mat.mes-hall");
  assertEquals(normalizeCategory("hep-th"), "hep-th");
  assertEquals(normalizeCategory("not a category"), undefined);
  assertEquals(parseCategories("cs.AI, cs.lg; stat.ML  cs.AI\nx"), ["cs.AI", "cs.LG", "stat.ML"]);
  assertEquals(parseCategories(undefined), []);
});

Deno.test("search queries", () => {
  assertEquals(buildQuery("attention transformer"), "all:attention AND all:transformer");
  assertEquals(buildQuery('"large language" au:hinton'), 'all:"large language" AND au:hinton');
  assertEquals(buildQuery('ti:"neural radiance" cat:cs.cv'), 'ti:"neural radiance" AND cat:cs.CV');
  assertEquals(buildQuery("diffusion #cs.LG #stat.ML"), "all:diffusion AND (cat:cs.LG OR cat:stat.ML)");
  assertEquals(buildQuery("protein and folding"), "all:protein AND all:folding");
  assertEquals(buildQuery("graph", ["math.CO"]), "all:graph AND cat:math.CO");
  assertEquals(buildQuery("(weird)"), "all:weird");
});

Deno.test("API addresses", () => {
  const url = new URL(queryUrl({ query: "all:attention AND cat:cs.CL", sort: "submittedDate", max: 10 }));
  assertEquals(url.host, "export.arxiv.org");
  assertEquals(url.searchParams.get("search_query"), "all:attention AND cat:cs.CL");
  assertEquals(url.searchParams.get("sortBy"), "submittedDate");
  assertEquals(url.searchParams.get("sortOrder"), "descending");
  assertEquals(url.searchParams.get("max_results"), "10");
  assertEquals(
    new URL(queryUrl({ ids: ["1706.03762", "hep-th/9711200"] })).searchParams.get("id_list"),
    "1706.03762,hep-th/9711200",
  );
});

Deno.test("names", () => {
  assertEquals(splitName("Ashish Vaswani"), { given: "Ashish", family: "Vaswani", suffix: undefined });
  assertEquals(splitName("Ludwig van Beethoven"), { given: "Ludwig", family: "van Beethoven", suffix: undefined });
  assertEquals(splitName("Martin Luther King Jr."), { given: "Martin Luther", family: "King", suffix: "Jr." });
  assertEquals(splitName("Plato"), { given: "", family: "Plato", suffix: undefined });
});

Deno.test("APA authors and citation", () => {
  assertEquals(
    apaAuthors(attention.authors),
    "Vaswani, A., Shazeer, N., & Kaiser, Ł.",
  );
  assertEquals(apaAuthors([{ name: "Jean-Paul Sartre" }]), "Sartre, J.-P.");
  const many = Array.from({ length: 25 }, (_, i) => ({ name: `Ann Author${i}` }));
  const text = apaAuthors(many);
  assertStringIncludes(text, "Author18, A., … Author24, A.");
  assertEquals(
    citation(attention),
    "Vaswani, A., Shazeer, N., & Kaiser, Ł. (2017). Attention Is All You Need. arXiv. https://doi.org/10.48550/arXiv.1706.03762",
  );
});

Deno.test("BibTeX", () => {
  assertEquals(citationKey(attention), "vaswani2017attention");
  assertEquals(citationKey(maldacena), "maldacena1997large");
  assertEquals(
    bibtex(attention),
    [
      "@misc{vaswani2017attention,",
      "  title = {{Attention Is All You Need}},",
      "  author = {Vaswani, Ashish and Shazeer, Noam and Kaiser, Łukasz},",
      "  year = {2017},",
      "  eprint = {1706.03762},",
      "  archivePrefix = {arXiv},",
      "  primaryClass = {cs.CL},",
      "  doi = {10.48550/arXiv.1706.03762},",
      "  url = {https://arxiv.org/abs/1706.03762},",
      "}",
    ].join("\n"),
  );
  const m = bibtex(maldacena);
  assertStringIncludes(m, "doi = {10.1023/A:1026654312961}");
  assertStringIncludes(m, "note = {Adv.Theor.Math.Phys.2:231-252,1998}");
  assertEquals(bibEscape("50% of R&D_x #1"), "50\\% of R\\&D\\_x \\#1");
});

Deno.test("Zotero connector item", () => {
  const z = zoteroItem(attention) as Record<string, any>;
  assertEquals(z.itemType, "preprint");
  assertEquals(z.archiveID, "arXiv:1706.03762");
  assertEquals(z.creators[0], { firstName: "Ashish", lastName: "Vaswani", creatorType: "author" });
  assertEquals(z.date, "2017-06-12");
  assertEquals(z.tags, [{ tag: "cs.CL", type: 1 }, { tag: "cs.LG", type: 1 }]);
  assertEquals(z.extra, "Comment: 15 pages, 5 figures");
});

Deno.test("dates", () => {
  const now = Date.parse("2026-10-29T15:00:00Z");
  assertEquals(age("2026-10-29T01:00:00Z", now), "today");
  assertEquals(age("2026-10-20T01:00:00Z", now), "9d");
  assertEquals(age("2017-06-12T17:57:34Z", now), "9y");
  assertEquals(daySection("2026-10-29T01:00:00Z", now), "Today");
  assertEquals(daySection("2026-10-28T01:00:00Z", now), "Yesterday");
  assertEquals(daySection("2026-10-24T01:00:00Z", now), "This Week");
  assertEquals(daySection("2026-09-01T01:00:00Z", now), "Earlier");
});

Deno.test("a paper as an item", () => {
  const p: Paper = attention;
  const item = paperItem(p, { saved: new Set(["1706.03762"]) }, { section: "Today" });
  assertEquals(item.id, "1706.03762");
  assertEquals(item.subtitle, "Ashish Vaswani, Noam Shazeer, Łukasz Kaiser");
  assertEquals(item.section, "Today");
  assertEquals(item.actions?.[0].title, "Open Abstract Page");
  assertEquals(item.actions?.[1].title, "Open PDF");
  assertEquals(item.actions?.some((a) => a.title === "Remove from Saved"), true);
  assertStringIncludes(item.detail?.markdown ?? "", "## Attention Is All You Need");
});
