import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  articleItem,
  compact,
  decodeEntities,
  type DevArticle,
  devTags,
  devUrl,
  domain,
  htmlText,
  languageSlug,
  type LobstersStory,
  mergeTrending,
  parseCount,
  parseLanguages,
  parseTrending,
  repoItem,
  storyItem,
  submitter,
  trendingUrl,
} from "./lib.ts";

// Shaped like github.com/trending in 2025-2026, with the noise around the list.
const TRENDING = `<!DOCTYPE html><html><head><title>Trending repositories on GitHub today</title></head><body>
<div class="Box">
  <div class="Box-header d-md-flex flex-items-center flex-justify-between">…</div>
  <div data-hpc>
    <article class="Box-row">
      <div class="float-right d-flex">
        <a href="/login?return_to=%2Facme%2Frocket" class="btn-sm btn" aria-label="You must be signed in to star a repository">Star</a>
      </div>
      <h2 class="h3 lh-condensed">
        <a data-hydro-click="{&quot;event_type&quot;:&quot;explore.click&quot;}" href="/acme/rocket" data-view-component="true" class="Link">
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" class="octicon octicon-repo mr-1 color-fg-muted"><path d="M2 2.5"></path></svg>
          <span data-view-component="true" class="text-normal">
            acme /
          </span>
          rocket
        </a>
      </h2>
      <p class="col-9 color-fg-muted my-1 pr-4">
        A blazing fast &amp; &quot;safe&quot; launcher &#x1F680; written in <em>Rust</em>
      </p>
      <div class="f6 color-fg-muted mt-2">
        <span class="d-inline-block ml-0 mr-3">
          <span class="repo-language-color" style="background-color: #dea584"></span>
          <span itemprop="programmingLanguage">Rust</span>
        </span>
        <a href="/acme/rocket/stargazers" data-view-component="true" class="Link Link--muted d-inline-block mr-3">
          <svg aria-label="star" role="img" height="16" class="octicon octicon-star"><path d="M8"></path></svg>
          12,345
        </a>
        <a href="/acme/rocket/forks" data-view-component="true" class="Link Link--muted d-inline-block mr-3">
          <svg aria-label="fork" role="img" height="16" class="octicon octicon-repo-forked"><path d="M5"></path></svg>
          1,024
        </a>
        <span data-view-component="true" class="d-inline-block mr-3">
          Built by
          <a class="d-inline-block" href="/ada" data-hovercard-type="user"><img class="avatar mb-1 avatar-user" src="https://avatars.githubusercontent.com/u/1?s=40&amp;v=4" width="20" height="20" alt="@ada" /></a>
          <a class="d-inline-block" href="/bob"><img class="avatar mb-1" src="https://avatars.githubusercontent.com/u/2?s=40&amp;v=4" width="20" height="20" alt="@bob" /></a>
        </span>
        <span class="d-inline-block float-sm-right">
          <svg aria-hidden="true" height="16" class="octicon octicon-star"><path d="M8"></path></svg>
          1,234 stars today
        </span>
      </div>
    </article>
    <article class="Box-row">
      <h2 class="h3 lh-condensed"><a href="/solo/tiny-thing" class="Link"><span class="text-normal">solo /</span> tiny-thing</a></h2>
      <div class="f6 color-fg-muted mt-2">
        <a href="/solo/tiny-thing/stargazers" class="Link Link--muted d-inline-block mr-3">87</a>
        <span class="d-inline-block float-sm-right">1 star today</span>
      </div>
    </article>
    <article class="Box-row"><h2>No link here</h2></article>
  </div>
</div>
<article class="something-else"><h2><a href="/not/a-repo">x</a></h2></article>
</body></html>`;

Deno.test("text helpers", () => {
  assertEquals(decodeEntities("a &amp; b &#39;c&#x27; &hellip; &bogus;"), "a & b 'c' … &bogus;");
  assertEquals(htmlText("<p> Hello\n <b>world</b> </p>"), "Hello world");
  assertEquals([parseCount("12,345"), parseCount("1.2k"), parseCount(" 87 "), parseCount("")], [12345, 1200, 87, 0]);
  assertEquals([compact(950), compact(1234), compact(45_600), compact(1_200_000)], ["950", "1.2k", "46k", "1.2M"]);
  assertEquals(domain("https://www.example.com/a?b"), "example.com");
  assertEquals(domain("not a url"), undefined);
});

Deno.test("GitHub trending URLs and languages", () => {
  assertEquals(languageSlug("Jupyter Notebook"), "jupyter-notebook");
  assertEquals(parseLanguages(" Rust, c++ ,rust, C#"), ["rust", "c++", "c#"]);
  assertEquals(parseLanguages(undefined), []);
  assertEquals(trendingUrl("daily"), "https://github.com/trending?since=daily");
  assertEquals(trendingUrl("weekly", "C#"), "https://github.com/trending/c%23?since=weekly");
  assertEquals(trendingUrl("monthly", "c++"), "https://github.com/trending/c%2B%2B?since=monthly");
});

Deno.test("parse GitHub trending HTML", () => {
  const repos = parseTrending(TRENDING);
  assertEquals(repos.length, 2);
  const [r, tiny] = repos;
  assertEquals([r.owner, r.name, r.url, r.rank], ["acme", "rocket", "https://github.com/acme/rocket", 1]);
  assertEquals(r.description, 'A blazing fast & "safe" launcher 🚀 written in Rust');
  assertEquals([r.language, r.languageColor, r.stars, r.forks, r.starsInPeriod], [
    "Rust",
    "#dea584",
    12345,
    1024,
    1234,
  ]);
  assertEquals(r.builtBy, [
    { login: "ada", avatar: "https://avatars.githubusercontent.com/u/1?s=40&v=4" },
    { login: "bob", avatar: "https://avatars.githubusercontent.com/u/2?s=40&v=4" },
  ]);
  assertEquals([tiny.name, tiny.description, tiny.language, tiny.stars, tiny.forks, tiny.starsInPeriod], [
    "tiny-thing",
    undefined,
    undefined,
    87,
    0,
    1,
  ]);
  assertEquals(parseTrending("<html>nothing</html>"), []);
  const weekly = parseTrending(TRENDING.replace("1,234 stars today", "5,678 stars this week"));
  assertEquals(weekly[0].starsInPeriod, 5678);
});

Deno.test("GitHub trending items", () => {
  const [r, tiny] = parseTrending(TRENDING);
  const item = repoItem(r, "daily");
  assertEquals([item.title, item.subtitle], ["acme/rocket", r.description]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), ["Rust", "+1.2k", "12k"]);
  assertEquals(item.accessories?.[1].tooltip, "1,234 stars today");
  assertEquals(item.icon, { source: "bs-repo", tint: "orange" });
  assertEquals(item.detail?.stats?.[0], { label: "Stars today", value: "+1,234", color: "orange" });
  assertEquals(repoItem(tiny, "weekly").detail?.stats?.[0].label, "Stars this week");
  assertEquals(mergeTrending([[tiny], [r, tiny]]).map((x) => x.name), ["rocket", "tiny-thing"]);
});

const story: LobstersStory = {
  short_id: "abc123",
  short_id_url: "https://lobste.rs/s/abc123",
  created_at: "2026-10-29T08:00:00.000-05:00",
  title: "Writing a launcher in Rust",
  url: "https://www.example.com/post",
  score: 42,
  flags: 0,
  comment_count: 17,
  description: "<p>Some &amp; text</p>",
  comments_url: "https://lobste.rs/s/abc123/writing_launcher_rust",
  submitter_user: "ada",
  user_is_author: true,
  tags: ["rust", "show", "linux", "programming"],
};

Deno.test("Lobsters stories", () => {
  assertEquals(submitter(story), "ada");
  assertEquals(submitter({ ...story, submitter_user: { username: "bob" } }), "bob");
  const item = storyItem(story, 3);
  assertEquals([item.id, item.subtitle], ["abc123", "example.com"]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text).slice(0, 5), ["rust", "show", "linux", "42", "17"]);
  assertStringIncludes(item.detail?.markdown ?? "", "Some & text");
  assertEquals(item.detail?.metadata?.[1].value, "ada (author)");
  const text = storyItem({ ...story, url: "", description_plain: "Ask: why?" }, 1);
  assertEquals((text.actions?.[0] as { title: string; target: string }).target, story.comments_url);
  assertEquals(text.actions?.[0].title, "Open on Lobsters");
});

const article: DevArticle = {
  id: 99,
  title: "Ten Deno tricks",
  description: "Make your scripts faster.",
  url: "https://dev.to/ada/ten-deno-tricks-1abc",
  comments_count: 12,
  public_reactions_count: 345,
  published_at: "2026-10-25T09:00:00Z",
  tag_list: ["deno", "typescript", "webdev"],
  reading_time_minutes: 6,
  cover_image: "https://media2.dev.to/dynamic/image/cover.png",
  user: { name: "Ada Lovelace", username: "ada", profile_image_90: "https://media2.dev.to/ada.png" },
  organization: null,
};

Deno.test("DEV articles", () => {
  assertEquals(devUrl("week"), "https://dev.to/api/articles?per_page=30&top=7");
  assertEquals(devUrl("year", "#Rust"), "https://dev.to/api/articles?per_page=30&top=365&tag=rust");
  assertEquals(devUrl("latest", "go", 10), "https://dev.to/api/articles/latest?per_page=10&tag=go");
  assertEquals(devTags({ ...article, tag_list: "deno, rust" }), ["deno", "rust"]);
  const item = articleItem(article);
  assertEquals([item.title, item.subtitle], ["Ten Deno tricks", "Ada Lovelace"]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), [
    "#deno",
    "#typescript",
    "#webdev",
    "345",
    "12",
    "6 min",
  ]);
  assertEquals(item.detail?.image, article.cover_image);
  assertEquals(item.icon, { source: "bs-book", tint: "purple" });
});
