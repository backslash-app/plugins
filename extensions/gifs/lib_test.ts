import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  addRecent,
  apiError,
  cleanTitle,
  fileName,
  fileUri,
  freeName,
  type Gif,
  giphyUrl,
  mapGiphy,
  mapTenor,
  parseLanguage,
  parseProvider,
  parseRating,
  stripTracking,
  tenorFilter,
  tenorShareUrl,
  tenorUrl,
} from "./lib.ts";

const TENOR_JSON = JSON.stringify({
  results: [
    {
      id: "14596258",
      title: "",
      media_formats: {
        tinygif: {
          url: "https://media.tenor.com/ZhfMGWrmCTcAAAAM/cute-kitty-best-kitty.gif",
          duration: 0,
          preview: "",
          dims: [220, 167],
          size: 155672,
        },
        gif: {
          url: "https://media.tenor.com/ZhfMGWrmCTcAAAAC/cute-kitty-best-kitty.gif",
          duration: 1.9,
          preview: "",
          dims: [498, 378],
          size: 906718,
        },
        mp4: {
          url: "https://media.tenor.com/ZhfMGWrmCTcAAAPo/cute-kitty-best-kitty.mp4",
          duration: 1.9,
          preview: "",
          dims: [640, 486],
          size: 155238,
        },
      },
      created: 1563903413.442579,
      content_description: "Cute Kitty Best Kitty GIF",
      itemurl: "https://tenor.com/view/cute-kitty-best-kitty-alex-cute-pp-kitty-omg-yay-gif-14596258",
      url: "https://tenor.com/bae9q.gif",
      tags: ["cute", "kitty", "best kitty"],
      flags: [],
      hasaudio: false,
    },
    { id: "broken", media_formats: { tinygif: { url: "https://media.tenor.com/x.gif" } } },
  ],
  next: "CAgQo8XG",
});

const GIPHY_JSON = JSON.stringify({
  data: [
    {
      type: "gif",
      id: "3oEjI6SIIHBdRxXI40",
      url: "https://giphy.com/gifs/mashable-3oEjI6SIIHBdRxXI40",
      slug: "mashable-3oEjI6SIIHBdRxXI40",
      username: "mashable",
      rating: "g",
      title: "Happy Dance GIF by Mashable",
      images: {
        original: {
          height: "200",
          width: "355",
          size: "1306488",
          url:
            "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif?cid=ecf05e47abc&ep=v1_gifs_search&rid=giphy.gif&ct=g",
          mp4: "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.mp4?cid=ecf05e47abc&rid=giphy.mp4&ct=g",
        },
        fixed_width_small: {
          height: "56",
          width: "100",
          url: "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/100w.gif?cid=ecf05e47abc&rid=100w.gif&ct=g",
        },
      },
      user: { display_name: "Mashable", username: "mashable" },
    },
    { id: "nothing", images: {} },
  ],
  pagination: { total_count: 1, count: 1, offset: 0 },
  meta: { status: 200, msg: "OK" },
});

Deno.test("Tenor results: full GIF, tiny thumbnail, mp4, dims and size", () => {
  const [gif, ...rest] = mapTenor(JSON.parse(TENOR_JSON));
  assertEquals(rest, []);
  assertEquals(gif.provider, "tenor");
  assertEquals(gif.id, "14596258");
  assertEquals(gif.title, "Cute Kitty Best Kitty");
  assertEquals(gif.url, "https://media.tenor.com/ZhfMGWrmCTcAAAAC/cute-kitty-best-kitty.gif");
  assertEquals(gif.thumbnail, "https://media.tenor.com/ZhfMGWrmCTcAAAAM/cute-kitty-best-kitty.gif");
  assertEquals(gif.mp4, "https://media.tenor.com/ZhfMGWrmCTcAAAPo/cute-kitty-best-kitty.mp4");
  assertEquals(gif.page, "https://tenor.com/view/cute-kitty-best-kitty-alex-cute-pp-kitty-omg-yay-gif-14596258");
  assertEquals([gif.width, gif.height, gif.size, gif.duration], [498, 378, 906718, 1.9]);
  assertEquals(gif.tags, ["cute", "kitty", "best kitty"]);
});

Deno.test("Tenor: no description falls back to the first tag", () => {
  const [gif] = mapTenor({
    results: [{ id: "1", content_description: "", tags: ["thank you"], media_formats: { gif: { url: "u.gif" } } }],
  });
  assertEquals(gif.title, "Thank you");
  assertEquals(gif.thumbnail, "u.gif");
});

Deno.test("Giphy results: original GIF without tracking, small thumbnail, author", () => {
  const [gif, ...rest] = mapGiphy(JSON.parse(GIPHY_JSON));
  assertEquals(rest, []);
  assertEquals(gif.title, "Happy Dance GIF by Mashable");
  assertEquals(gif.url, "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.gif");
  assertEquals(gif.thumbnail, "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/100w.gif");
  assertEquals(gif.mp4, "https://media4.giphy.com/media/3oEjI6SIIHBdRxXI40/giphy.mp4");
  assertEquals(gif.page, "https://giphy.com/gifs/mashable-3oEjI6SIIHBdRxXI40");
  assertEquals([gif.width, gif.height, gif.size], [355, 200, 1306488]);
  assertEquals(gif.author, "Mashable");
});

Deno.test("odd answers give no GIFs instead of throwing", () => {
  assertEquals(mapTenor(null), []);
  assertEquals(mapTenor({ results: "nope" }), []);
  assertEquals(mapGiphy({}), []);
  assertEquals(mapGiphy({ data: [null] }), []);
});

Deno.test("Tenor URLs: search, featured when empty, filter and locale", () => {
  const s = { key: "K", rating: "pg" as const, language: "fr" };
  const search = new URL(tenorUrl(" happy dance ", s));
  assertEquals(search.pathname, "/v2/search");
  assertEquals(search.searchParams.get("q"), "happy dance");
  assertEquals(search.searchParams.get("key"), "K");
  assertEquals(search.searchParams.get("client_key"), "backslash");
  assertEquals(search.searchParams.get("contentfilter"), "medium");
  assertEquals(search.searchParams.get("locale"), "fr");
  assertEquals(search.searchParams.get("media_filter"), "gif,tinygif,mp4");
  const featured = new URL(tenorUrl("", s));
  assertEquals(featured.pathname, "/v2/featured");
  assertEquals(featured.searchParams.has("q"), false);
  assertStringIncludes(tenorShareUrl("123", "cat", "K"), "/v2/registershare?id=123&key=K&client_key=backslash&q=cat");
});

Deno.test("Giphy URLs: search with language, trending when empty, rating", () => {
  const s = { key: "G", rating: "pg-13" as const, language: "en", limit: 25 };
  const search = new URL(giphyUrl("thank you", s));
  assertEquals(search.pathname, "/v1/gifs/search");
  assertEquals(search.searchParams.get("q"), "thank you");
  assertEquals(search.searchParams.get("lang"), "en");
  assertEquals(search.searchParams.get("rating"), "pg-13");
  assertEquals(search.searchParams.get("limit"), "25");
  assertEquals(new URL(giphyUrl("", s)).pathname, "/v1/gifs/trending");
  assertEquals(new URL(giphyUrl("x".repeat(80), s)).searchParams.get("q")?.length, 50);
});

Deno.test("preferences: rating, language, provider", () => {
  assertEquals(parseRating("PG13"), "pg-13");
  assertEquals(parseRating(" g "), "g");
  assertEquals(parseRating("R"), "r");
  assertEquals(parseRating(undefined), "pg-13");
  assertEquals(tenorFilter("g"), "high");
  assertEquals(tenorFilter("r"), "off");
  assertEquals(parseLanguage("FR_fr"), "fr");
  assertEquals(parseLanguage("1"), "en");
  assertEquals(parseProvider("Giphy"), "giphy");
  assertEquals(parseProvider("whatever"), "tenor");
});

Deno.test("API errors become sentences", () => {
  assertEquals(
    apiError("tenor", 400, '{"error":{"code":400,"message":"API key not valid."}}'),
    "Tenor refused the API key: check it in Settings",
  );
  assertEquals(apiError("giphy", 401, '{"message":"Unauthorized"}'), "Giphy refused the API key: check it in Settings");
  assertEquals(apiError("giphy", 429, ""), "Giphy's rate limit is reached: wait a minute");
  assertEquals(
    apiError("tenor", 500, '{"error":{"message":"Backend Error"}}'),
    "Tenor didn't answer (HTTP 500: Backend Error)",
  );
  assertEquals(apiError("giphy", 502, "<html>"), "Giphy didn't answer (HTTP 502)");
});

Deno.test("titles, file names and URIs", () => {
  assertEquals(cleanTitle("  a cat  dancing GIF "), "A cat dancing");
  assertEquals(cleanTitle("", "GIF"), "GIF");
  assertEquals(fileName({ title: "Café Dance!", id: "abc/123", provider: "tenor" }), "cafe-dance-abc123.gif");
  assertEquals(fileName({ title: "!!!", id: "x", provider: "giphy" }), "giphy-x.gif");
  assertEquals(fileUri("/home/me/a b.gif"), "file:///home/me/a%20b.gif");
  const taken = new Set(["a.gif", "a (2).gif"]);
  assertEquals(freeName("a.gif", (n) => taken.has(n)), "a (3).gif");
  assertEquals(freeName("b.gif", (n) => taken.has(n)), "b.gif");
  assertEquals(stripTracking("https://example.com/a.gif?cid=1"), "https://example.com/a.gif?cid=1");
});

Deno.test("recent GIFs: newest first, no duplicates, capped", () => {
  const g = (id: string): Gif => ({ provider: "tenor", id, title: id, url: "", thumbnail: "", page: "", tags: [] });
  let list: Gif[] = [];
  for (const id of ["a", "b", "c", "a"]) list = addRecent(list, g(id), 3);
  assertEquals(list.map((x) => x.id), ["a", "c", "b"]);
  assertEquals(addRecent(list, { ...g("a"), provider: "giphy" }, 3).map((x) => `${x.provider}:${x.id}`), [
    "giphy:a",
    "tenor:a",
    "tenor:c",
  ]);
});
