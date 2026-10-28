import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import { type Server, serversFrom, SetupError } from "./api.ts";
import {
  cacheName,
  episodeCode,
  fromJellyfin,
  fromPlex,
  HOSTS,
  installCommand,
  isAllowedHost,
  jellyfinAuth,
  jellyfinStreamUrl,
  jellyfinWebUrl,
  type MediaItem,
  normalizeUrl,
  osFamily,
  playerArgs,
  playerChoice,
  plexImagePath,
  plexSearchItems,
  plexStreamUrl,
  plexWebUrl,
  progressOf,
  runtime,
  subtitleOf,
  unitArgs,
} from "./lib.ts";
import { mediaItem, problemItem, setupItems } from "./views.ts";

const T = 10_000_000;

// A Jellyfin 10.10 BaseItemDto, trimmed to the fields asked for.
const JF_MOVIE = {
  Name: "Dune: Part Two",
  ServerId: "f1e2d3",
  Id: "a1b2c3d4e5f6",
  DateCreated: "2026-10-20T10:12:00.0000000Z",
  PremiereDate: "2024-02-27T00:00:00.0000000Z",
  OfficialRating: "PG-13",
  CommunityRating: 8.3,
  CriticRating: 92,
  RunTimeTicks: 9960 * T,
  ProductionYear: 2024,
  Genres: ["Science Fiction", "Adventure"],
  Overview: "Paul Atreides unites with Chani and the Fremen.",
  Container: "mkv",
  MediaStreams: [{ Type: "Video", Height: 2160, Codec: "hevc" }, { Type: "Audio" }],
  Studios: [{ Name: "Legendary Pictures", Id: "x" }],
  People: [
    { Name: "Timothée Chalamet", Type: "Actor" },
    { Name: "Denis Villeneuve", Type: "Director" },
    { Name: "Zendaya", Type: "Actor" },
  ],
  Type: "Movie",
  UserData: { PlaybackPositionTicks: 3120 * T, PlayCount: 0, IsFavorite: false, Played: false },
  ImageTags: { Primary: "8f7e6d" },
};

const JF_EPISODE = {
  Name: "The Dark Forest",
  Id: "e55",
  Type: "Episode",
  SeriesName: "3 Body Problem",
  SeriesId: "s9",
  SeriesPrimaryImageTag: "tag9",
  ParentIndexNumber: 1,
  IndexNumber: 4,
  RunTimeTicks: 3300 * T,
  UserData: { Played: true, PlaybackPositionTicks: 0 },
  ImageTags: { Primary: "still" },
};

// Plex Media Server JSON (Accept: application/json).
const PLEX_EPISODE = {
  ratingKey: "101",
  key: "/library/metadata/101",
  type: "episode",
  title: "Pilot",
  grandparentTitle: "The Bear",
  grandparentRatingKey: "100",
  parentIndex: 1,
  index: 1,
  duration: 1_800_000,
  viewOffset: 600_000,
  addedAt: 1_792_900_000,
  thumb: "/library/metadata/101/thumb/1700000001",
  grandparentThumb: "/library/metadata/100/thumb/1700000000",
  summary: "Carmy returns to Chicago.",
  contentRating: "TV-MA",
  Media: [{
    videoResolution: "1080",
    container: "mkv",
    Part: [{ key: "/library/parts/5001/1700000000/file.mkv", container: "mkv" }],
  }],
};

const PLEX_SHOW = {
  ratingKey: "100",
  type: "show",
  title: "The Bear",
  year: 2022,
  leafCount: 28,
  viewedLeafCount: 28,
  childCount: 3,
  thumb: "/library/metadata/100/thumb/1",
  Genre: [{ tag: "Comedy" }, { tag: "Drama" }],
};

Deno.test("hosts match the manifest and Deno's rules", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
  const yes = [
    "jellyfin.local",
    "localhost",
    "192.168.1.20",
    "10.0.0.7",
    "172.20.3.4",
    "100.101.102.103",
    "nas.tail1234.ts.net",
    "192-168-1-20.0123456789abcdef.plex.direct",
    "media.home.arpa",
    "nas.lan",
  ];
  const no = ["jellyfin.example.com", "172.32.0.1", "8.8.8.8", "plex.tv", "evil.com"];
  assertEquals(yes.filter((h) => !isAllowedHost(h)), []);
  assertEquals(no.filter((h) => isAllowedHost(h)), []);
});

Deno.test("addresses", () => {
  assertEquals(normalizeUrl("192.168.1.5:8096/web/#/home.html", "jellyfin"), "http://192.168.1.5:8096");
  assertEquals(normalizeUrl("https://jf.tail1.ts.net/", "jellyfin"), "https://jf.tail1.ts.net");
  assertEquals(normalizeUrl("192.168.1.5", "plex"), "http://192.168.1.5:32400");
  assertEquals(normalizeUrl("http://192.168.1.5:32400/web/index.html#!/", "plex"), "http://192.168.1.5:32400");
  assertEquals(normalizeUrl("", "plex"), "");
});

Deno.test("servers from preferences: configured only, with clear problems", () => {
  assertEquals(serversFrom({}, "d").servers, []);
  const both = serversFrom({
    jellyfinUrl: "jellyfin.local:8096",
    jellyfinApiKey: "k",
    plexUrl: "10.0.0.2",
    plexToken: "t",
  }, "d");
  assertEquals(both.servers.map((s) => [s.kind, s.base]), [
    ["jellyfin", "http://jellyfin.local:8096"],
    ["plex", "http://10.0.0.2:32400"],
  ]);
  const bad = serversFrom({ jellyfinUrl: "https://jellyfin.example.com", jellyfinApiKey: "k", plexToken: "t" }, "d");
  assertEquals(bad.servers, []);
  assertEquals(bad.problems.map((p) => [p.server, p.kind]), [["jellyfin", "host"], ["plex", "url"]]);
  const noKey = serversFrom({ jellyfinUrl: "192.168.1.2:8096", jellyfinPassword: "x" }, "d").problems[0];
  assertStringIncludes(noKey.message, "API key");
});

Deno.test("Jellyfin items: poster, progress, metadata", () => {
  const m = fromJellyfin(JF_MOVIE);
  assertEquals(m.type, "movie");
  assertEquals(m.runtime, 9960);
  assertEquals(m.position, 3120);
  assertEquals(m.rating, 8.3);
  assertEquals(m.resolution, "4K");
  assertEquals(m.people, ["Timothée Chalamet", "Zendaya"]);
  assertEquals(m.studio, "Legendary Pictures");
  assertEquals(m.image, "/Items/a1b2c3d4e5f6/Images/Primary?fillHeight=480&quality=85&tag=8f7e6d");
  assertEquals(m.added, Date.UTC(2026, 9, 20, 10, 12));
  const e = fromJellyfin(JF_EPISODE);
  assertEquals(e.image, "/Items/s9/Images/Primary?fillHeight=480&quality=85&tag=tag9");
  assertEquals(episodeCode(e), "S01E04");
  assertEquals(subtitleOf(e), "3 Body Problem · S01E04");
  assert(e.played);
  assertEquals(e.position, undefined);
  assertEquals(fromJellyfin({ Id: "x", Type: "BoxSet", Name: "Set" }).type, "other");
});

Deno.test("Plex items: on deck episode, watched show, search hubs", () => {
  const e = fromPlex(PLEX_EPISODE);
  assertEquals(e.type, "episode");
  assertEquals(e.seriesTitle, "The Bear");
  assertEquals(e.seriesId, "100");
  assertEquals(e.image, "/library/metadata/100/thumb/1700000000");
  assertEquals(e.position, 600);
  assertEquals(e.runtime, 1800);
  assertEquals(e.partKey, "/library/parts/5001/1700000000/file.mkv");
  assertEquals(e.resolution, "1080p");
  assertEquals(e.added, 1_792_900_000_000);
  assert(!e.played);
  assertEquals(progressOf(e), 1 / 3);
  const show = fromPlex(PLEX_SHOW);
  assertEquals(show.type, "series");
  assert(show.played);
  assertEquals(show.unplayedCount, 0);
  assertEquals(show.genres, ["Comedy", "Drama"]);
  const found = plexSearchItems({
    MediaContainer: {
      Hub: [
        { type: "movie", Metadata: [{ ratingKey: "1", type: "movie", title: "Heat" }] },
        { type: "actor", Metadata: [{ ratingKey: "2", type: "person", title: "Al Pacino" }] },
        { type: "album", Metadata: [{ ratingKey: "3", type: "album", title: "Heat Wave", parentTitle: "Martha" }] },
        { type: "show" },
      ],
    },
  });
  assertEquals(found.map((i) => [i.title, i.type]), [["Heat", "movie"], ["Heat Wave", "album"]]);
  assertEquals(found[1].artist, "Martha");
});

Deno.test("stream and web addresses carry the token only where needed", () => {
  assertEquals(
    jellyfinStreamUrl("http://nas:8096", { id: "abc", type: "movie" }, "t/k"),
    "http://nas:8096/Videos/abc/stream?static=true&api_key=t%2Fk",
  );
  assertEquals(
    jellyfinStreamUrl("http://nas:8096", { id: "t1", type: "track" }, "k"),
    "http://nas:8096/Audio/t1/stream?static=true&api_key=k",
  );
  assertEquals(jellyfinWebUrl("http://nas:8096", "abc", "srv"), "http://nas:8096/web/#/details?id=abc&serverId=srv");
  assertEquals(
    plexStreamUrl("http://nas:32400", "/library/parts/1/2/file.mkv", "tok"),
    "http://nas:32400/library/parts/1/2/file.mkv?X-Plex-Token=tok",
  );
  assertEquals(
    plexWebUrl("http://nas:32400", "mid", "101"),
    "http://nas:32400/web/index.html#!/server/mid/details?key=%2Flibrary%2Fmetadata%2F101",
  );
  assertStringIncludes(plexImagePath("/library/metadata/1/thumb/2"), "url=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F2");
  assertEquals(
    jellyfinAuth("dev"),
    'MediaBrowser Client="Backslash", Device="Backslash Launcher", DeviceId="dev", Version="1.0.0"',
  );
  assertStringIncludes(jellyfinAuth("dev", "tok"), 'Token="tok"');
});

Deno.test("players and units", () => {
  assertEquals(playerChoice("VLC"), ["vlc", "mpv"]);
  assertEquals(playerChoice(""), ["mpv", "vlc"]);
  assertEquals(playerArgs("mpv", ["u"], { title: "Dune", start: 3115.4 }), [
    "mpv",
    "--force-window=immediate",
    "--no-terminal",
    "--start=3115",
    "--force-media-title=Dune",
    "--title=Dune",
    "u",
  ]);
  assertEquals(playerArgs("vlc", ["a", "b"], { title: "Album" }), [
    "vlc",
    "--no-video-title-show",
    "--play-and-exit",
    "a",
    "b",
  ]);
  const args = unitArgs("u", "Backslash: Dune", { DISPLAY: ":0", WAYLAND_DISPLAY: undefined }, ["mpv", "x"]);
  assertEquals(args, [
    "--user",
    "--quiet",
    "--collect",
    "--unit=u",
    "--description=Backslash: Dune",
    "--setenv=DISPLAY=:0",
    "mpv",
    "x",
  ]);
  assertEquals(runtime(9960), "2 h 46");
  assertEquals(runtime(2700), "45 min");
  assertEquals(osFamily("ID=arch"), "arch");
  assertEquals(installCommand("debian", "vlc"), "sudo apt install vlc");
});

Deno.test("cache names are stable", async () => {
  assertEquals(await cacheName("a"), await cacheName("a"));
  assert((await cacheName("a")) !== (await cacheName("b")));
  assert((await cacheName("a")).endsWith(".jpg"));
});

const fakeServer = (kind: "jellyfin" | "plex"): Server => ({
  kind,
  product: kind === "plex" ? "Plex" : "Jellyfin",
  base: "http://nas:8096",
  name: "Living Room",
  connect: () => Promise.resolve(),
  continueWatching: () => Promise.resolve([]),
  nextUp: () => Promise.resolve([]),
  recentlyAdded: () => Promise.resolve([]),
  search: () => Promise.resolve([]),
  children: () => Promise.resolve([]),
  setPlayed: () => Promise.resolve(),
  streamUrls: () => Promise.resolve(["http://nas:8096/Videos/x/stream?api_key=secret"]),
  webUrl: (i: MediaItem) => `http://nas:8096/web/#/details?id=${i.id}`,
  imageRequest: () => undefined,
});

Deno.test("media items: poster as icon and picture, resume first, the stream URL is never a plain copy", () => {
  const m = fromJellyfin(JF_MOVIE);
  const item = mediaItem(fakeServer("jellyfin"), m, "/home/a/.cache/backslash/jellyfin/x.jpg", {
    players: ["mpv", "vlc"],
    multi: false,
  });
  assertEquals(item.icon, "/home/a/.cache/backslash/jellyfin/x.jpg");
  assertEquals(item.detail?.image, "/home/a/.cache/backslash/jellyfin/x.jpg");
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles.slice(0, 3), ["Resume from 51:55", "Open in Jellyfin", "Mark as Watched"]);
  assert(titles.includes("Play in VLC"));
  // Copying the stream address goes through code (concealed), not a plain copy action.
  const stream = item.actions!.find((a) => a.title === "Copy Stream URL")!;
  assertEquals((stream as unknown as { text?: string }).text, undefined);
  assert(item.accessories?.some((a) => a.text === "1 h 54 left"));
  const meta = item.detail!.metadata!.map((l) => l.label);
  for (const label of ["Type", "Year", "Runtime", "Rating", "Genres", "Watched", "Cast", "Server"]) {
    assert(meta.includes(label), label);
  }

  const series = mediaItem(fakeServer("plex"), fromPlex(PLEX_SHOW), undefined, { players: ["mpv"], multi: true });
  assertEquals(series.actions![0].title, "Show Episodes");
  assertEquals(series.actions![2].title, "Mark as Unwatched");
  assert(series.accessories?.some((a) => a.tooltip === "Plex: Living Room"));
});

Deno.test("setup and problems point to the token pages", () => {
  assertEquals(setupItems()[0].actions!.length, 2);
  const host = problemItem(new SetupError("x is outside", "jellyfin", "host", "https://jf.example.com"));
  assertStringIncludes(host.detail!.markdown!, "plex.direct");
  const token = problemItem(new SetupError("Plex rejected the token", "plex", "token", "http://nas:32400"));
  assertEquals(token.actions![0].title, "Find Your Plex Token");
});
