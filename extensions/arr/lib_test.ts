import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  addBody,
  type Album,
  dayLabel,
  type Episode,
  episodeCode,
  errorMessageOf,
  fromAlbum,
  fromEpisode,
  fromLookup,
  fromMovie,
  fromQueue,
  HOSTS,
  isAllowedHost,
  mediaCoverPath,
  missingLine,
  missingMovies,
  type Movie,
  normalizeUrl,
  parseTimeLeft,
  POSTER_HOSTS,
  type QueueRecord,
  queueState,
  type Series,
  sortCalendar,
  sortQueue,
  webUrl,
} from "./lib.ts";

// `GET /api/v3/calendar?includeSeries=true`, Sonarr 4.
const EPISODE: Episode = {
  id: 5012,
  seriesId: 12,
  seasonNumber: 2,
  episodeNumber: 5,
  title: "The Fall",
  airDateUtc: "2026-10-30T02:00:00Z",
  hasFile: false,
  monitored: true,
  runtime: 52,
  finaleType: "season",
  series: {
    id: 12,
    title: "Severance",
    titleSlug: "severance",
    network: "Apple TV+",
    genres: ["Drama", "Mystery"],
    images: [
      {
        coverType: "banner",
        url: "/MediaCover/12/banner.jpg?lastWrite=638",
        remoteUrl: "https://artworks.thetvdb.com/banners/b.jpg",
      },
      {
        coverType: "poster",
        url: "/sonarr/MediaCover/12/poster.jpg?lastWrite=638",
        remoteUrl: "https://artworks.thetvdb.com/banners/v4/series/371980/posters/p.jpg",
      },
    ],
  },
};

// `GET /api/v3/calendar`, Radarr 5.
const MOVIE: Movie = {
  id: 44,
  title: "Dune: Part Three",
  titleSlug: "dune-part-three-1170608",
  year: 2026,
  tmdbId: 1170608,
  studio: "Legendary Pictures",
  inCinemas: "2026-10-01T00:00:00Z",
  digitalRelease: "2026-11-05T00:00:00Z",
  physicalRelease: "2027-01-12T00:00:00Z",
  hasFile: false,
  monitored: true,
  images: [{
    coverType: "poster",
    url: "/MediaCover/44/poster.jpg",
    remoteUrl: "https://image.tmdb.org/t/p/original/x.jpg",
  }],
};

const ALBUM: Album = {
  id: 301,
  artistId: 7,
  title: "Songs of a Lost World",
  albumType: "Album",
  releaseDate: "2026-11-01T00:00:00Z",
  artist: { id: 7, artistName: "The Cure", foreignArtistId: "69ee3720-a7cb-4402-b48d-a02c366f2bcf" },
  statistics: { trackFileCount: 0, trackCount: 8 },
};

// `GET /api/v3/queue?includeSeries=true&includeEpisode=true`, records.
const QUEUE: QueueRecord[] = [
  {
    id: 1834,
    seriesId: 12,
    title: "Severance.S02E04.1080p.WEB.h264-ETHEL",
    size: 2_000_000_000,
    sizeleft: 500_000_000,
    timeleft: "00:12:30",
    status: "downloading",
    trackedDownloadStatus: "ok",
    trackedDownloadState: "downloading",
    statusMessages: [],
    downloadClient: "qBittorrent",
    indexer: "Prowlarr",
    protocol: "torrent",
    quality: { quality: { name: "WEBDL-1080p" } },
    series: EPISODE.series,
    episode: { ...EPISODE, id: 5011, episodeNumber: 4, title: "Woe's Hollow" },
  },
  {
    id: 1835,
    seriesId: 12,
    title: "Severance.S02E03.720p",
    size: 1_000_000_000,
    sizeleft: 0,
    timeleft: "00:00:00",
    status: "completed",
    trackedDownloadStatus: "warning",
    trackedDownloadState: "importPending",
    statusMessages: [{ title: "Severance.S02E03.720p", messages: ["Not an upgrade for existing episode file(s)"] }],
    series: EPISODE.series,
  },
  {
    id: 99,
    movieId: 44,
    title: "Dune.Part.Three.2026.2160p",
    size: 30e9,
    sizeleft: 30e9,
    status: "failed",
    trackedDownloadStatus: "error",
    errorMessage: "Download failed: unpack error",
    movie: MOVIE,
  },
];

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, [...HOSTS, ...POSTER_HOSTS]);
  assert(isAllowedHost("sonarr"));
  assert(isAllowedHost("nas.local"));
  assert(isAllowedHost("172.17.0.3"));
  assert(!isAllowedHost("sonarr.example.com"));
  assert(!isAllowedHost("image.tmdb.org"));
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("nas.local", "sonarr"), "http://nas.local:8989");
  assertEquals(normalizeUrl("nas.local:7878/calendar", "radarr"), "http://nas.local:7878");
  assertEquals(normalizeUrl("https://nas.lan/sonarr/", "sonarr"), "https://nas.lan/sonarr");
  assertEquals(normalizeUrl("http://192.168.1.5:8686/artist/", "lidarr"), "http://192.168.1.5:8686");
  assertEquals(normalizeUrl(""), "");
  assertEquals(webUrl("http://nas:8989", "sonarr", "severance"), "http://nas:8989/series/severance");
  assertEquals(webUrl("http://nas:7878", "radarr", undefined), "http://nas:7878");
});

Deno.test("calendar entries", () => {
  const e = fromEpisode(EPISODE);
  assertEquals(e.what, "S02E05 · The Fall");
  assertEquals(e.finale, "Season finale");
  assertEquals(e.itemId, 5012);
  assertEquals(e.libraryId, 12);
  assertEquals(e.poster?.remote, "https://artworks.thetvdb.com/banners/v4/series/371980/posters/p.jpg");
  assertEquals(fromEpisode({ ...EPISODE, seasonNumber: 1, episodeNumber: 1, title: "TBA" }).label, "Series premiere");
  assertEquals(fromEpisode({ ...EPISODE, seasonNumber: 1, episodeNumber: 1, title: "TBA" }).what, "S01E01");

  const start = Date.parse("2026-10-28T00:00:00Z");
  const end = start + 14 * 86_400_000;
  const movie = fromMovie(MOVIE, start, end);
  assertEquals(movie.map((m) => m.what), ["Digital release"]);
  assertEquals(movie[0].title, "Dune: Part Three (2026)");

  const album = fromAlbum(ALBUM);
  assertEquals(album.title, "The Cure");
  assertEquals(album.hasFile, false);
  assertEquals(sortCalendar([...movie, album, e]).map((x) => x.kind), ["sonarr", "lidarr", "radarr"]);
});

Deno.test("posters", () => {
  assertEquals(
    mediaCoverPath("sonarr", "/sonarr/MediaCover/12/poster.jpg?lastWrite=638", 12),
    "/mediacover/12/poster-250.jpg",
  );
  assertEquals(mediaCoverPath("radarr", undefined, 44), "/mediacover/44/poster-250.jpg");
  assertEquals(mediaCoverPath("lidarr", "/MediaCover/Artist/7/poster.jpg", 7), "/mediacover/artist/7/poster-250.jpg");
  assertEquals(mediaCoverPath("sonarr", "/x", undefined), undefined);
});

Deno.test("days", () => {
  const now = new Date(2026, 9, 28, 10).getTime();
  assertEquals(dayLabel(new Date(2026, 9, 28, 22).getTime(), now), "Today");
  assertEquals(dayLabel(new Date(2026, 9, 29, 1).getTime(), now), "Tomorrow");
  assertEquals(dayLabel(new Date(2026, 9, 31, 1).getTime(), now), "Saturday");
  assertEquals(dayLabel(new Date(2026, 10, 9, 1).getTime(), now), "Monday 9 November");
  assertEquals(episodeCode(1, 12), "S01E12");
});

Deno.test("queue", () => {
  const [dl, pending, failed] = [
    fromQueue("sonarr", QUEUE[0]),
    fromQueue("sonarr", QUEUE[1]),
    fromQueue("radarr", QUEUE[2]),
  ];
  assertEquals(dl.title, "Severance");
  assertEquals(dl.what, "S02E04 · Woe's Hollow");
  assertEquals(dl.progress, 0.75);
  assertEquals(dl.eta, 750);
  assertEquals(dl.quality, "WEBDL-1080p");
  assertEquals(queueState(dl).label, "Downloading");
  assertEquals(pending.health, "warning");
  assertEquals(pending.messages, ["Not an upgrade for existing episode file(s)"]);
  assertEquals(queueState(pending).label, "Import blocked");
  assertEquals(failed.title, "Dune: Part Three (2026)");
  assertEquals(failed.health, "error");
  assertEquals(failed.messages, ["Download failed: unpack error"]);
  assertEquals(queueState(failed).label, "Failed");
  assertEquals(sortQueue([dl, pending, failed]).map((q) => q.queueId), [99, 1835, 1834]);
  assertEquals(parseTimeLeft("1.02:00:05"), 93605);
  assertEquals(parseTimeLeft(undefined), undefined);
});

Deno.test("missing counts", () => {
  assertEquals(missingLine({ sonarr: 12, radarr: 1 }), "Missing: 12 episodes, 1 movie");
  assertEquals(missingLine({ sonarr: 0 }), undefined);
  assertEquals(
    missingMovies([
      { title: "a", monitored: true, isAvailable: true, hasFile: false },
      { title: "b", monitored: true, isAvailable: false, hasFile: false },
      { title: "c", monitored: true, isAvailable: true, hasFile: true },
      { title: "d", monitored: false, isAvailable: true, hasFile: false },
    ]),
    1,
  );
});

Deno.test("lookup and add", () => {
  const series: Series = {
    title: "Andor",
    year: 2022,
    tvdbId: 393189,
    titleSlug: "andor",
    network: "Disney+",
    status: "ended",
    remotePoster: "https://artworks.thetvdb.com/banners/v4/series/393189/posters/a.jpg",
    seasons: [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }, {
      seasonNumber: 2,
      monitored: true,
    }],
  };
  const r = fromLookup("sonarr", series);
  assertEquals(r.id, "sonarr:393189");
  assertEquals(r.seasons, 2);
  assertEquals(r.libraryId, undefined);
  assertEquals(r.poster, "https://artworks.thetvdb.com/banners/v4/series/393189/posters/a.jpg");
  assertEquals(fromLookup("sonarr", { ...series, id: 3 }).libraryId, 3);
  assertEquals(
    fromLookup("radarr", { ...MOVIE, images: [{ coverType: "poster", remoteUrl: "https://evil.example/p.jpg" }] })
      .poster,
    undefined,
  );

  const body = addBody("sonarr", series, {
    qualityProfileId: 4,
    rootFolderPath: "/tv",
    monitored: true,
    search: true,
    monitor: "future",
    languageProfileId: 1,
  });
  assertEquals(body.qualityProfileId, 4);
  assertEquals(body.languageProfileId, 1);
  assertEquals(body.seasons, [{ seasonNumber: 0, monitored: false }, { seasonNumber: 1, monitored: true }, {
    seasonNumber: 2,
    monitored: true,
  }]);
  assertEquals(body.addOptions, {
    monitor: "future",
    searchForMissingEpisodes: true,
    searchForCutoffUnmetEpisodes: false,
  });
  const movie = addBody("radarr", MOVIE, {
    qualityProfileId: 1,
    rootFolderPath: "/movies",
    monitored: true,
    search: false,
  });
  assertEquals(movie.minimumAvailability, "released");
  assertEquals(movie.addOptions, { monitor: "movieOnly", searchForMovie: false });
  assertEquals(movie.tmdbId, 1170608);
});

Deno.test("error bodies", () => {
  assertEquals(
    errorMessageOf([{ propertyName: "TvdbId", errorMessage: "This series has already been added" }]),
    "This series has already been added",
  );
  assertEquals(errorMessageOf({ message: "NotFound" }), "NotFound");
  assertEquals(errorMessageOf("x"), undefined);
});
