import { assertEquals } from "@std/assert";
import {
  auth,
  duration,
  fromDetails,
  fromResult,
  longDate,
  matches,
  normalizeLanguage,
  normalizeRegion,
  pickTrailer,
  poster,
  ratingColor,
  summaryLine,
  type TmdbDetails,
  type TmdbResult,
  tmdbUrl,
} from "./lib.ts";
import { titleItem } from "./views.ts";

// Shaped like `/trending/all/week` and `/search/multi` results.
const dune: TmdbResult = {
  adult: false,
  id: 693134,
  title: "Dune: Part Two",
  original_title: "Dune: Part Two",
  overview: "Follow the mythic journey of Paul Atreides as he unites with Chani and the Fremen.",
  poster_path: "/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg",
  media_type: "movie",
  original_language: "en",
  genre_ids: [878, 12],
  release_date: "2024-02-27",
  vote_average: 8.153,
  vote_count: 6234,
};
const amelie: TmdbResult = {
  id: 194,
  title: "Amélie",
  original_title: "Le Fabuleux Destin d'Amélie Poulain",
  media_type: "movie",
  poster_path: null,
  release_date: "2001-04-25",
  vote_average: 7.9,
  vote_count: 11000,
  genre_ids: [35, 10749],
  original_language: "fr",
  overview: "",
};
const person: TmdbResult = { id: 1190668, name: "Timothée Chalamet", media_type: "person" };

// `/movie/693134?append_to_response=credits,videos,watch/providers,release_dates`.
const duneDetails: TmdbDetails = {
  ...dune,
  genre_ids: undefined,
  genres: [{ id: 878, name: "Science Fiction" }, { id: 12, name: "Adventure" }],
  runtime: 167,
  tagline: "Long live the fighters.",
  status: "Released",
  imdb_id: "tt15239678",
  credits: {
    cast: [
      { name: "Zendaya", character: "Chani", order: 1 },
      { name: "Timothée Chalamet", character: "Paul Atreides", order: 0 },
      { name: "Rebecca Ferguson", character: "Lady Jessica", order: 2 },
      { name: "Javier Bardem", character: "Stilgar", order: 3 },
      { name: "Josh Brolin", character: "Gurney Halleck", order: 4 },
      { name: "Austin Butler", character: "Feyd-Rautha", order: 5 },
    ],
    crew: [{ name: "Denis Villeneuve", job: "Director" }, { name: "Hans Zimmer", job: "Original Music Composer" }],
  },
  videos: {
    results: [
      { key: "teaser", site: "YouTube", type: "Teaser", official: true, published_at: "2023-05-03T13:00:00.000Z" },
      { key: "fan", site: "YouTube", type: "Trailer", official: false },
      { key: "Way9Dexny3w", site: "YouTube", type: "Trailer", official: true, published_at: "2023-12-18T17:00:00Z" },
      { key: "vimeo", site: "Vimeo", type: "Trailer", official: true },
    ],
  },
  "watch/providers": {
    results: {
      US: {
        link: "https://www.themoviedb.org/movie/693134-dune-part-two/watch?locale=US",
        flatrate: [{ provider_id: 1899, provider_name: "Max", display_priority: 2 }],
        rent: [
          { provider_id: 2, provider_name: "Apple TV", display_priority: 4 },
          { provider_id: 10, provider_name: "Amazon Video", display_priority: 1 },
        ],
      },
    },
  },
  release_dates: {
    results: [{
      iso_3166_1: "US",
      release_dates: [{ certification: "", type: 1 }, { certification: "PG-13", type: 3 }],
    }],
  },
};

// `/tv/126308?append_to_response=aggregate_credits,…`.
const shogun: TmdbDetails = {
  id: 126308,
  name: "Shōgun",
  first_air_date: "2024-02-27",
  poster_path: "/7O4iVfOMQmdCSxhOg1WnzG1AgYT.jpg",
  vote_average: 8.6,
  vote_count: 1100,
  genres: [{ id: 18, name: "Drama" }],
  episode_run_time: [58],
  number_of_seasons: 1,
  number_of_episodes: 10,
  created_by: [{ name: "Rachel Kondo" }, { name: "Justin Marks" }],
  networks: [{ name: "FX" }],
  next_episode_to_air: { air_date: "2026-11-12", season_number: 2, episode_number: 1, name: "Return" },
  aggregate_credits: { cast: [{ name: "Hiroyuki Sanada", roles: [{ character: "Yoshii Toranaga" }], order: 0 }] },
  content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }] },
  external_ids: { imdb_id: "tt2788316" },
};

Deno.test("results", () => {
  const t = fromResult(dune)!;
  assertEquals(t.kind, "movie");
  assertEquals(t.year, "2024");
  assertEquals(t.genres, ["Science Fiction", "Adventure"]);
  assertEquals(t.originalTitle, undefined);
  assertEquals(fromResult(person), undefined);
  const a = fromResult(amelie)!;
  assertEquals(a.originalTitle, "Le Fabuleux Destin d'Amélie Poulain");
  assertEquals(a.poster, undefined);
  assertEquals(a.overview, undefined);
  // `/trending/tv/week` results have no media_type.
  assertEquals(
    fromResult({ id: 1, name: "Severance", first_air_date: "2022-02-17", genre_ids: [18, 9648] }, "tv")?.genres,
    [
      "Drama",
      "Mystery",
    ],
  );
});

Deno.test("movie details", () => {
  const t = fromDetails(duneDetails, "movie", "US");
  assertEquals(t.full, true);
  assertEquals(t.runtime, 167);
  assertEquals(t.certification, "PG-13");
  assertEquals(t.directors, ["Denis Villeneuve"]);
  assertEquals(t.cast?.map((c) => c.name), [
    "Timothée Chalamet",
    "Zendaya",
    "Rebecca Ferguson",
    "Javier Bardem",
    "Josh Brolin",
  ]);
  assertEquals(t.trailer?.key, "Way9Dexny3w");
  assertEquals(t.watch?.stream, ["Max"]);
  assertEquals(t.watch?.rent, ["Amazon Video", "Apple TV"]);
  assertEquals(t.imdb, "tt15239678");
  assertEquals(fromDetails(duneDetails, "movie", "FR").watch, undefined);
  assertEquals(summaryLine(t), "Movie · 2024 · 2 h 47 min");
});

Deno.test("show details", () => {
  const t = fromDetails(shogun, "tv", "US");
  assertEquals(t.seasons, 1);
  assertEquals(t.runtime, 58);
  assertEquals(t.certification, "TV-MA");
  assertEquals(t.directors, ["Rachel Kondo", "Justin Marks"]);
  assertEquals(t.cast, [{ name: "Hiroyuki Sanada", character: "Yoshii Toranaga" }]);
  assertEquals(t.network, "FX");
  assertEquals(t.nextEpisode, "S2E1 “Return” · 12 Nov 2026");
  assertEquals(t.imdb, "tt2788316");
  assertEquals(t.trailer, undefined);
  assertEquals(summaryLine(t), "TV · 2024 · 1 season");
});

Deno.test("trailers", () => {
  assertEquals(pickTrailer([{ key: "t", site: "YouTube", type: "Teaser" }])?.key, "t");
  assertEquals(pickTrailer([{ key: "v", site: "Vimeo", type: "Trailer" }]), undefined);
  assertEquals(pickTrailer(undefined), undefined);
});

Deno.test("formatting", () => {
  assertEquals(duration(167), "2 h 47 min");
  assertEquals(duration(120), "2 h");
  assertEquals(duration(45), "45 min");
  assertEquals(duration(65), "1 h 05 min");
  assertEquals(duration(undefined), undefined);
  assertEquals(longDate("2024-02-27"), "27 Feb 2024");
  assertEquals(ratingColor(8.2), "green");
  assertEquals(ratingColor(6.4), "yellow");
  assertEquals(ratingColor(4), "red");
  assertEquals(poster("/a.jpg", "w342"), "https://image.tmdb.org/t/p/w342/a.jpg");
  assertEquals(poster(undefined, "w92"), undefined);
  assertEquals(tmdbUrl({ kind: "tv", id: 1 }), "https://www.themoviedb.org/tv/1");
});

Deno.test("preferences and auth", () => {
  assertEquals(auth("eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln"), {
    headers: { Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJ4In0.c2ln" },
  });
  assertEquals(auth(" 0123456789abcdef0123456789abcdef "), {
    headers: {},
    param: "api_key=0123456789abcdef0123456789abcdef",
  });
  assertEquals(normalizeRegion("fr"), "FR");
  assertEquals(normalizeRegion("France"), "US");
  assertEquals(normalizeLanguage("fr"), "fr-FR");
  assertEquals(normalizeLanguage("en"), "en-US");
  assertEquals(normalizeLanguage("pt_br"), "pt-BR");
  assertEquals(normalizeLanguage("klingon"), "en-US");
});

Deno.test("watchlist matching", () => {
  const a = fromResult(amelie)!;
  assertEquals(matches(a, "fabuleux"), true);
  assertEquals(matches(a, "romance"), true);
  assertEquals(matches(a, "2001"), true);
  assertEquals(matches(a, "dune"), false);
  assertEquals(matches(a, ""), true);
});

Deno.test("title item", () => {
  const item = titleItem(fromDetails(duneDetails, "movie", "US"), { watched: true, region: "US" });
  assertEquals(item.icon, "https://image.tmdb.org/t/p/w92/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg");
  assertEquals(item.detail?.image, "https://image.tmdb.org/t/p/w342/1pdfLvkbY9ohJlCjQH2CZjjYVvJ.jpg");
  assertEquals(item.detail?.stats?.map((s) => s.value), ["★ 8.2", "2024", "2 h 47 min"]);
  assertEquals(item.actions?.map((a) => a.title).slice(0, 4), [
    "Open on TMDB",
    "Watch Trailer on YouTube",
    "Where to Watch in US",
    "Remove from Watchlist",
  ]);
  assertEquals(item.accessories?.map((a) => a.tag ?? a.text), [undefined, "Max", "8.2"]);
  const cast = item.detail?.metadata?.filter((m) => m.avatar);
  assertEquals(cast?.[1], { label: "Cast", value: "Timothée Chalamet as Paul Atreides", avatar: "Timothée Chalamet" });

  const bare = titleItem(fromResult(amelie)!, { watched: false, region: "FR" });
  assertEquals(bare.icon, { source: "bs-film", tint: "purple" });
  assertEquals(bare.detail?.markdown, "No overview yet.");
});
