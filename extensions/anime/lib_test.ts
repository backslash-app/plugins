import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  aired,
  anilistError,
  behind,
  chooseTitle,
  countdown,
  dayHeader,
  type Entry,
  formatName,
  HOSTS,
  LIST_QUERY,
  malListUrl,
  nextBroadcast,
  parseAniListCollection,
  parseByMal,
  parseMalList,
  parseSchedule,
  parseSearch,
  plain,
  progressUpdate,
  settings,
  sortEntries,
  sourceOf,
  tintOf,
  withAiring,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  assert(HOSTS.includes(new URL(malListUrl("x")).host));
});

Deno.test("settings and the list source", () => {
  assertEquals(sourceOf(settings({})), undefined);
  assertEquals(sourceOf(settings({ anilistUser: "Josh" })), "anilist");
  assertEquals(sourceOf(settings({ malUser: "Xinil" })), undefined); // a Client ID is needed too
  assertEquals(sourceOf(settings({ malUser: "Xinil", malClientId: "abc" })), "myanimelist");
  assertEquals(settings({ anilistToken: "Bearer eyJ0" }).anilistToken, "eyJ0");
  assertEquals(settings({ titles: "English" }).titles, "english");
  assertEquals(settings({ titles: "klingon" }).titles, "romaji");
  assertStringIncludes(LIST_QUERY, "status_in: [CURRENT, REPEATING]");
});

const now = Date.parse("2026-10-31T12:00:00Z");
const at = (h: number) => Math.floor((now + h * 3_600_000) / 1000);

// Shaped like AniList's MediaListCollection answer.
const COLLECTION = {
  data: {
    MediaListCollection: {
      lists: [
        {
          entries: [
            {
              id: 401,
              status: "CURRENT",
              progress: 3,
              score: 8.5,
              updatedAt: 1793400000,
              media: {
                id: 170942,
                idMal: 57334,
                type: "ANIME",
                format: "TV",
                status: "RELEASING",
                episodes: 12,
                title: {
                  romaji: "Dandadan 2nd Season",
                  english: "DAN DA DAN Season 2",
                  native: "ダンダダン 第2期",
                  userPreferred: "Dandadan 2nd Season",
                },
                coverImage: {
                  large: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/medium/bx170942.jpg",
                  color: "#e4a15d",
                },
                siteUrl: "https://anilist.co/anime/170942",
                averageScore: 84,
                genres: ["Action", "Comedy", "Supernatural"],
                season: "SUMMER",
                seasonYear: 2026,
                isAdult: false,
                nextAiringEpisode: { episode: 6, airingAt: at(50), timeUntilAiring: 180000 },
                studios: { nodes: [{ name: "Science SARU" }] },
              },
            },
            {
              id: 402,
              status: "CURRENT",
              progress: 20,
              updatedAt: 1793300000,
              media: {
                id: 21,
                idMal: 21,
                type: "ANIME",
                format: "TV",
                status: "FINISHED",
                episodes: null,
                title: { romaji: "ONE PIECE", english: "ONE PIECE", native: "ONE PIECE" },
                coverImage: {
                  large: null,
                  medium: "https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/21.jpg",
                },
                siteUrl: "https://anilist.co/anime/21",
                genres: [],
                nextAiringEpisode: null,
                studios: { nodes: [] },
              },
            },
          ],
        },
        // A rewatched show can be in two lists: shown once.
        { entries: [{ id: 403, status: "REPEATING", progress: 1, media: { id: 21, title: { romaji: "ONE PIECE" } } }] },
      ],
    },
  },
};

Deno.test("AniList list", () => {
  const entries = parseAniListCollection(COLLECTION, "english");
  assertEquals(entries.length, 2);
  const [d, op] = entries;
  assertEquals(d.media.title, "DAN DA DAN Season 2");
  assertEquals(d.media.titles, ["Dandadan 2nd Season", "ダンダダン 第2期"]);
  assertEquals(d.entryId, 401);
  assertEquals(d.score, 8.5);
  assertEquals(d.media.next, { episode: 6, at: at(50) * 1000 });
  assertEquals(d.media.season, "Summer 2026");
  assertEquals(d.media.studio, "Science SARU");
  assertEquals(aired(d.media), 5);
  assertEquals(behind(d), 2);
  assertEquals(op.media.cover, "https://s4.anilist.co/file/anilistcdn/media/anime/cover/small/21.jpg");
  assertEquals(op.media.episodes, undefined);
  assertEquals(behind(op), 0);
  assertEquals(parseAniListCollection({ data: { MediaListCollection: null } }, "romaji"), []);
  for (const e of entries) if (e.media.cover) assert(HOSTS.includes(new URL(e.media.cover).host));
});

Deno.test("AniList errors", () => {
  assertEquals(
    anilistError({ errors: [{ message: "Invalid token", status: 400 }], data: null }, 400),
    "AniList refused the token: get a new one and paste it in Settings → Extensions → Anime",
  );
  assertEquals(
    anilistError({ errors: [{ message: "User not found", status: 404 }] }, 404),
    "AniList: no user with that name, check it in Settings",
  );
  assertEquals(
    anilistError({ errors: [{ message: "Too Many Requests.", status: 429 }] }),
    "AniList asks to slow down: try again in a minute",
  );
  assertEquals(anilistError({ data: {} }, 200), undefined);
  assertEquals(anilistError(undefined, 502), "AniList: error 502");
});

function entry(
  o: { progress: number; next?: number; episode?: number; updated?: number; status?: string; episodes?: number },
): Entry {
  return {
    source: "anilist",
    entryId: 1,
    status: "CURRENT",
    progress: o.progress,
    updated: o.updated,
    media: {
      id: Math.random(),
      type: "ANIME",
      title: "x",
      titles: [],
      url: "",
      genres: [],
      adult: false,
      status: o.status ?? "RELEASING",
      episodes: o.episodes,
      next: o.next !== undefined ? { episode: o.episode ?? 5, at: o.next } : undefined,
    },
  };
}

Deno.test("sorting: catch up first, then the next to air, then the rest", () => {
  const caughtSoon = entry({ progress: 4, next: now + 1000, episode: 5 });
  const behind3 = entry({ progress: 1, next: now + 9000, episode: 5 });
  const behind1 = entry({ progress: 3, next: now + 500, episode: 5 });
  const idleOld = entry({ progress: 2, status: "FINISHED", updated: 1 });
  const idleNew = entry({ progress: 2, status: "HIATUS", updated: 9 });
  assertEquals(sortEntries([idleOld, caughtSoon, idleNew, behind1, behind3]), [
    behind3,
    behind1,
    caughtSoon,
    idleNew,
    idleOld,
  ]);
});

Deno.test("progress updates complete finished shows", () => {
  assertEquals(progressUpdate(entry({ progress: 11, episodes: 12, status: "FINISHED" }), 12), {
    progress: 12,
    status: "COMPLETED",
  });
  // Still airing: the last episode may not be the last one.
  assertEquals(progressUpdate(entry({ progress: 11, episodes: 12 }), 12), { progress: 12 });
  assertEquals(progressUpdate(entry({ progress: 11, episodes: 12, status: "FINISHED" }), 40), {
    progress: 12,
    status: "COMPLETED",
  });
  assertEquals(progressUpdate(entry({ progress: 0 }), -3), { progress: 0 });
  assertEquals(progressUpdate(entry({ progress: 1000 }), 1001), { progress: 1001 });
});

Deno.test("airing schedule and search", () => {
  const { airing, more } = parseSchedule({
    data: {
      Page: {
        pageInfo: { hasNextPage: true },
        airingSchedules: [
          { id: 9, episode: 6, airingAt: at(2), media: COLLECTION.data.MediaListCollection.lists[0].entries[0].media },
          { id: 10, episode: 1, airingAt: null, media: { id: 3 } },
        ],
      },
    },
  }, "romaji");
  assertEquals(more, true);
  assertEquals(airing.map((a) => [a.id, a.episode, a.media.title]), [[9, 6, "Dandadan 2nd Season"]]);
  const found = parseSearch({
    data: {
      Page: {
        media: [{
          id: 30013,
          idMal: 13,
          type: "MANGA",
          format: "MANGA",
          status: "RELEASING",
          chapters: null,
          title: { romaji: "ONE PIECE" },
          description: "Gol D. Roger was known as the <i>Pirate King</i>.<br><br>He was &quot;strong&quot;.",
          mediaListEntry: { id: 5, status: "CURRENT", progress: 1100 },
          genres: ["Adventure"],
        }],
      },
    },
  }, "romaji");
  assertEquals(found[0].type, "MANGA");
  assertEquals(found[0].url, "https://anilist.co/manga/30013");
  assertEquals(found[0].description, 'Gol D. Roger was known as the Pirate King.\n\nHe was "strong".');
  assertEquals(found[0].entry, { id: 5, status: "CURRENT", progress: 1100 });
});

Deno.test("MyAnimeList list, with AniList's airing times", () => {
  const entries = parseMalList(
    {
      data: [
        {
          node: {
            id: 57334,
            title: "Dandadan 2nd Season",
            main_picture: {
              medium: "https://cdn.myanimelist.net/images/anime/1679/150425.jpg",
              large: "https://cdn.myanimelist.net/images/anime/1679/150425l.jpg",
            },
            alternative_titles: { synonyms: [], en: "Dan Da Dan Season 2", ja: "ダンダダン" },
            num_episodes: 12,
            status: "currently_airing",
            media_type: "tv",
            mean: 8.61,
            start_season: { year: 2026, season: "summer" },
            broadcast: { day_of_the_week: "saturday", start_time: "23:30" },
            genres: [{ id: 1, name: "Action" }],
            studios: [{ id: 2, name: "Science SARU" }],
          },
          list_status: {
            status: "watching",
            score: 0,
            num_episodes_watched: 3,
            is_rewatching: false,
            updated_at: "2026-10-30T20:00:00+00:00",
          },
        },
        {
          node: { id: 21, title: "One Piece", status: "currently_airing", num_episodes: 0 },
          list_status: { num_episodes_watched: 1100 },
        },
      ],
      paging: {},
    },
    "romaji",
    now,
  );
  const [d, op] = entries;
  assertEquals(d.source, "myanimelist");
  assertEquals(d.media.cover, "https://cdn.myanimelist.net/images/anime/1679/150425l.jpg");
  assertEquals(d.media.score, 86);
  assertEquals(d.media.format, "TV");
  assertEquals(d.media.season, "Summer 2026");
  assertEquals(d.score, undefined);
  // 23:30 JST on Saturday 31 October is 14:30 UTC.
  assertEquals(d.media.next, { episode: 4, at: Date.parse("2026-10-31T14:30:00Z") });
  assertEquals(op.media.episodes, undefined);
  const real = parseByMal({
    data: {
      Page: {
        media: [{
          idMal: 57334,
          siteUrl: "https://anilist.co/anime/170942",
          nextAiringEpisode: { episode: 6, airingAt: at(50) },
        }],
      },
    },
  });
  const merged = withAiring(entries, real);
  assertEquals(merged[0].media.next, { episode: 6, at: at(50) * 1000 });
  assertEquals(behind(merged[0]), 2);
  assertEquals(merged[1], entries[1]);
});

Deno.test("next broadcast from Japan time", () => {
  // Now: Saturday 31 October, 21:00 in Japan.
  assertEquals(nextBroadcast("saturday", "23:30", now), Date.parse("2026-10-31T14:30:00Z"));
  assertEquals(nextBroadcast("saturday", "01:29", now), Date.parse("2026-11-06T16:29:00Z"));
  assertEquals(nextBroadcast("sunday", "00:00", now), Date.parse("2026-10-31T15:00:00Z"));
  assertEquals(nextBroadcast("other", "00:00", now), undefined);
  assertEquals(nextBroadcast("monday", undefined, now), undefined);
});

Deno.test("formatting", () => {
  assertEquals(countdown(now + (2 * 86_400 + 4 * 3600 + 60) * 1000, now), "in 2d 4h");
  assertEquals(countdown(now + (3 * 3600 + 12 * 60) * 1000, now), "in 3h 12m");
  assertEquals(countdown(now + 20_000, now), "in 1m");
  assertEquals(countdown(now - 1, now), "aired");
  assertEquals(formatName("TV_SHORT"), "TV Short");
  assertEquals(formatName("ONA"), "ONA");
  assertEquals(formatName("MOVIE"), "Movie");
  assertEquals(chooseTitle({ romaji: "Shingeki no Kyojin", english: null }, "english"), "Shingeki no Kyojin");
  assertEquals(chooseTitle(undefined, "romaji"), "Untitled");
  assertEquals(tintOf("#e4a15d"), "orange");
  assertEquals(tintOf("#5d86e4"), "blue");
  assertEquals(tintOf("#888888"), "gray");
  assertEquals(tintOf(undefined), "gray");
  assertEquals(plain("a<br>b"), "a\nb");
  assertEquals(dayHeader(now + 60_000, now), "Today");
});
