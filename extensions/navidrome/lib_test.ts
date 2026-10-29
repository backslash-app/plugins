import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { Abs, Subsonic } from "./api.ts";
import {
  absSearchResult,
  albumList,
  authParams,
  bookTime,
  cacheName,
  chapterAt,
  clock,
  duration,
  htmlToText,
  installCommand,
  ipcCommand,
  ipcReply,
  isAllowedHost,
  left,
  md5,
  mpvArgs,
  normalizeUrl,
  osFamily,
  parsePositionFile,
  positionScript,
  progressBody,
  restUrl,
  resumeAt,
  searchResult,
  startPoint,
  SubsonicError,
  toAbsItem,
  toAlbum,
  trackOrder,
  unitArgs,
  unwrap,
} from "./lib.ts";
import type { PlayerState } from "./player.ts";
import { albumItem, bookItem, type Ctx, nowPlayingItem, serversFrom, songItem } from "./views.ts";

Deno.test("md5", () => {
  assertEquals(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assertEquals(md5("The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
});

Deno.test("Subsonic token authentication (the example of the API docs)", () => {
  // Password "sesame", salt "c19b2d" → token 26719a1196d2a940705a59634eb18eab.
  assertEquals(authParams("joe", "sesame", "c19b2d"), {
    u: "joe",
    t: "26719a1196d2a940705a59634eb18eab",
    s: "c19b2d",
    v: "1.16.1",
    c: "Backslash",
    f: "json",
  });
  const url = new URL(restUrl("http://music.lan", "search3", authParams("joe", "sesame", "c19b2d"), { query: "a b" }));
  assertEquals(url.pathname, "/rest/search3");
  assertEquals(url.searchParams.get("t"), "26719a1196d2a940705a59634eb18eab");
  assertEquals(url.searchParams.get("query"), "a b");
  assertEquals(url.searchParams.has("p"), false);
});

Deno.test("server addresses", () => {
  assertEquals(normalizeUrl("192.168.1.10:4533", "subsonic"), "http://192.168.1.10:4533");
  assertEquals(normalizeUrl("http://music.lan/app/#/album/x", "subsonic"), "http://music.lan");
  assertEquals(normalizeUrl("https://nas.local/navidrome/rest/ping", "subsonic"), "https://nas.local/navidrome");
  assertEquals(normalizeUrl("http://abs.lan:13378/library/abc/bookshelf", "abs"), "http://abs.lan:13378");
  assertEquals(normalizeUrl("https://nas.local/audiobookshelf/item/li_1", "abs"), "https://nas.local/audiobookshelf");
  assertEquals(normalizeUrl("", "abs"), "");
  assertEquals(isAllowedHost("192.168.1.10"), true);
  assertEquals(isAllowedHost("172.20.0.5"), true);
  assertEquals(isAllowedHost("music.home.arpa"), true);
  assertEquals(isAllowedHost("nas.tail1234.ts.net"), true);
  assertEquals(isAllowedHost("music.example.com"), false);
  assertEquals(isAllowedHost("8.8.8.8"), false);
});

Deno.test("Subsonic errors", () => {
  const fail = (code: number, message = "x") => ({
    "subsonic-response": { status: "failed", error: { code, message } },
  });
  assertThrows(() => unwrap(fail(40)), SubsonicError, "Wrong user name or password");
  assertThrows(() => unwrap(fail(41)), SubsonicError, "token authentication");
  assertThrows(() => unwrap(fail(0, "boom")), SubsonicError, "boom");
  assertThrows(() => unwrap({ hello: 1 }), SubsonicError, "Not a Subsonic server");
  assertEquals(unwrap({ "subsonic-response": { status: "ok", version: "1.16.1" } }).version, "1.16.1");
});

// Shaped like Navidrome's answers.
const ALBUM = {
  id: "al-1",
  name: "Kind of Blue",
  artist: "Miles Davis",
  artistId: "ar-1",
  coverArt: "al-1_0",
  songCount: 3,
  duration: 2760,
  year: 1959,
  genre: "Jazz",
  created: "2024-01-01T00:00:00Z",
  starred: "2024-02-01T00:00:00Z",
  song: [
    {
      id: "s3",
      title: "Blue in Green",
      track: 3,
      discNumber: 1,
      duration: 337,
      albumId: "al-1",
      artist: "Miles Davis",
    },
    { id: "s1", title: "So What", track: 1, discNumber: 1, duration: 562, albumId: "al-1", artist: "Miles Davis" },
    { id: "s9", title: "Bonus", track: 1, discNumber: 2, duration: 100, albumId: "al-1" },
    { id: "s2", title: "Freddie Freeloader", track: 2, discNumber: 1, duration: 589, suffix: "flac", bitRate: 900 },
  ],
};

Deno.test("Subsonic albums, songs and search", () => {
  const a = toAlbum(ALBUM);
  assertEquals(a.name, "Kind of Blue");
  assertEquals(a.starred, true);
  assertEquals(a.year, 1959);
  assertEquals(trackOrder(a.songs!).map((s) => s.id), ["s1", "s2", "s3", "s9"]);
  const list = albumList({ albumList2: { album: [ALBUM, { ...ALBUM, id: "al-2", starred: undefined }] } });
  assertEquals(list.map((x) => [x.id, x.starred]), [["al-1", true], ["al-2", false]]);
  assertEquals(albumList({ albumList2: {} }), []);
  const found = searchResult({
    searchResult3: {
      artist: [{ id: "ar-1", name: "Miles Davis", albumCount: 12 }],
      album: ALBUM,
      song: [ALBUM.song[0]],
    },
  });
  assertEquals(found.artists[0].albumCount, 12);
  assertEquals(found.albums.length, 1);
  assertEquals(found.songs[0].title, "Blue in Green");
});

// Shaped like Audiobookshelf's answers.
const BOOK_MIN = {
  id: "li_1",
  libraryId: "lib_1",
  mediaType: "book",
  addedAt: 1700000000000,
  media: {
    metadata: {
      title: "Project Hail Mary",
      authorName: "Andy Weir",
      narratorName: "Ray Porter",
      seriesName: "",
      publishedYear: "2021",
      description: "<p>A lone astronaut.</p><p>Must save &amp; the earth.</p>",
      genres: ["Science Fiction"],
    },
    coverPath: "/metadata/items/li_1/cover.jpg",
    duration: 58000,
    numTracks: 3,
  },
};

const BOOK_FULL = {
  ...BOOK_MIN,
  media: {
    ...BOOK_MIN.media,
    metadata: {
      ...BOOK_MIN.media.metadata,
      authors: [{ id: "a1", name: "Andy Weir" }],
      series: [{ id: "s1", name: "Standalone", sequence: "1" }],
    },
    tracks: [
      { index: 2, startOffset: 20000, duration: 20000, title: "Part 2", contentUrl: "/api/items/li_1/file/2" },
      { index: 1, startOffset: 0, duration: 20000, title: "Part 1", contentUrl: "/api/items/li_1/file/1" },
      { index: 3, startOffset: 40000, duration: 18000, title: "Part 3", contentUrl: "/api/items/li_1/file/3" },
    ],
    chapters: [{ id: 0, start: 0, end: 1200, title: "Chapter 1" }, {
      id: 1,
      start: 1200,
      end: 58000,
      title: "Chapter 2",
    }],
  },
  userMediaProgress: { currentTime: 25000, duration: 58000, progress: 0.431, isFinished: false, lastUpdate: 1 },
};

Deno.test("Audiobookshelf items", () => {
  const min = toAbsItem(BOOK_MIN);
  assertEquals(min.title, "Project Hail Mary");
  assertEquals(min.author, "Andy Weir");
  assertEquals(min.narrator, "Ray Porter");
  assertEquals(min.series, undefined);
  assertEquals(min.hasCover, true);
  assertEquals(min.numTracks, 3);
  const full = toAbsItem(BOOK_FULL);
  assertEquals(full.series, "Standalone #1");
  assertEquals(full.tracks?.map((t) => t.index), [1, 2, 3]);
  assertEquals(full.chapters?.length, 2);
  assertEquals(full.progress?.currentTime, 25000);
  const podcast = toAbsItem({
    id: "li_p",
    mediaType: "podcast",
    media: {
      metadata: { title: "A Show", author: "Host" },
      episodes: [
        { id: "e1", title: "Old", publishedAt: 1, audioTrack: { contentUrl: "/api/items/li_p/file/1", duration: 60 } },
        { id: "e2", title: "New", publishedAt: 2, duration: 120 },
      ],
    },
    recentEpisode: { id: "e2", title: "New", publishedAt: 2 },
  });
  assertEquals(podcast.mediaType, "podcast");
  assertEquals(podcast.author, "Host");
  assertEquals(podcast.episodes?.map((e) => e.id), ["e2", "e1"]);
  assertEquals(podcast.episodes?.[1].contentUrl, "/api/items/li_p/file/1");
  assertEquals(podcast.recentEpisode?.id, "e2");
  assertEquals(
    absSearchResult({ book: [{ libraryItem: BOOK_MIN, matchKey: "title" }], podcast: [], authors: [] }).map((i) =>
      i.id
    ),
    ["li_1"],
  );
});

Deno.test("resuming a book across its files", () => {
  const tracks = toAbsItem(BOOK_FULL).tracks!;
  assertEquals(startPoint(tracks, 0), { index: 0, offset: 0 });
  assertEquals(startPoint(tracks, 25000), { index: 1, offset: 5000 });
  assertEquals(startPoint(tracks, 41000), { index: 2, offset: 1000 });
  assertEquals(startPoint(tracks, 99999), { index: 2, offset: 17999 });
  assertEquals(startPoint([], 50), { index: 0, offset: 0 });
  assertEquals(bookTime([0, 20000, 40000], 1, 5000), 25000);
  assertEquals(chapterAt(toAbsItem(BOOK_FULL).chapters, 1300)?.title, "Chapter 2");
  assertEquals(chapterAt(undefined, 10), undefined);
  assertEquals(resumeAt({ currentTime: 25000, duration: 58000, progress: 0.4, isFinished: false }), 24995);
  assertEquals(resumeAt({ currentTime: 5, duration: 58000, progress: 0, isFinished: false }), 0);
  assertEquals(resumeAt({ currentTime: 58000, duration: 58000, progress: 1, isFinished: true }), 0);
  assertEquals(progressBody(29000, 58000), { currentTime: 29000, duration: 58000, progress: 0.5, isFinished: false });
  assertEquals(progressBody(57990, 58000).isFinished, true);
  assertEquals(progressBody(100, 58000, true), { currentTime: 58000, duration: 58000, progress: 1, isFinished: true });
});

Deno.test("mpv command line: a start position for one file only", () => {
  const argv = mpvArgs(
    [{ url: "http://a/1" }, { url: "http://a/2", start: 5000.7 }, { url: "http://a/3" }],
    { socket: "/s.sock", script: "/p.lua", title: "Book", startIndex: 1, speed: 1.25 },
  );
  assertEquals(argv[0], "mpv");
  assertEquals(argv.includes("--playlist-start=1"), true);
  assertEquals(argv.includes("--speed=1.25"), true);
  assertEquals(argv.includes("--input-ipc-server=/s.sock"), true);
  assertEquals(argv.slice(-6), ["http://a/1", "--{", "--start=5000", "http://a/2", "--}", "http://a/3"]);
  assertEquals(mpvArgs([{ url: "u" }], { shuffle: true }).includes("--shuffle"), true);
  assertEquals(unitArgs("u", "d", ["mpv"]), ["--user", "--quiet", "--collect", "--unit=u", "--description=d", "mpv"]);
});

Deno.test("mpv script, position file and IPC", () => {
  const script = positionScript("/tmp/x.json");
  assertStringIncludes(script, 'local out = "/tmp/x.json"');
  assertStringIncludes(script, "playlist-pos");
  assertEquals(parsePositionFile('{"position":12.5,"index":2,"finished":false,"paused":true}'), {
    position: 12.5,
    index: 2,
    finished: false,
    paused: true,
  });
  assertEquals(parsePositionFile('{"position":null,"index":null,"finished":true,"paused":false}')?.finished, true);
  assertEquals(parsePositionFile("{oops"), undefined);
  assertEquals(ipcCommand(["get_property", "pause"], 3), '{"command":["get_property","pause"],"request_id":3}\n');
  const out = '{"event":"playback-restart"}\n{"data":42.5,"request_id":3,"error":"success"}\n';
  assertEquals(ipcReply(out, 3), { ok: true, data: 42.5 });
  assertEquals(ipcReply(out, 4), undefined);
});

Deno.test("formatting", () => {
  assertEquals(clock(3723), "1:02:03");
  assertEquals(clock(75), "1:15");
  assertEquals(duration(2700), "45 min");
  assertEquals(duration(58000), "16 h 07");
  assertEquals(duration(0), undefined);
  assertEquals(left({ currentTime: 25000, duration: 58000 }), "9 h 10 left");
  assertEquals(
    htmlToText("<p>A lone astronaut.</p><p>Must save &amp; the earth.</p>"),
    "A lone astronaut.\n\nMust save & the earth.",
  );
  assertEquals(cacheName("x").length, 28);
  assertEquals(osFamily("ID=fedora"), "fedora");
  assertEquals(installCommand("debian"), "sudo apt install mpv");
});

Deno.test("preferences: missing credentials are setup problems, not crashes", () => {
  const none = serversFrom({});
  assertEquals([none.sub, none.abs, none.problems.length], [undefined, undefined, 0]);
  const half = serversFrom({ subsonicUrl: "http://music.lan", absUrl: "http://abs.lan" });
  assertEquals(half.problems.map((p) => p.id), ["problem:subsonic", "problem:abs"]);
  const outside = serversFrom({ subsonicUrl: "https://music.example.com", subsonicUser: "a", subsonicPassword: "b" });
  assertStringIncludes(outside.problems[0].title, "outside the networks");
  const ok = serversFrom({
    subsonicUrl: "music.lan:4533",
    subsonicUser: "a",
    subsonicPassword: "b",
    absUrl: "abs.lan",
    absToken: "t",
  });
  assertEquals(ok.sub?.base, "http://music.lan:4533");
  assertEquals(ok.abs?.base, "http://abs.lan");
});

Deno.test("items", () => {
  const sub = new Subsonic("http://music.lan", "joe", "sesame");
  const abs = new Abs("http://abs.lan", "tok");
  const c: Ctx = {
    sub,
    abs,
    pics: new Map([[`${sub.base}#al-1_0`, "/cache/a.jpg"], [`${abs.base}#li_1`, "/cache/b.jpg"]]),
    speed: 1,
  };
  const album = albumItem(sub, toAlbum(ALBUM), c, { section: "Recently Added" });
  assertEquals(album.icon, "/cache/a.jpg");
  assertEquals(album.actions?.map((a) => a.title).slice(0, 4), [
    "Play Album",
    "Shuffle Album",
    "Show Songs",
    "Remove Star",
  ]);
  const song = songItem(sub, toAlbum(ALBUM).songs![1], c, { queue: toAlbum(ALBUM).songs, index: 1 });
  assertEquals(song.actions?.[0].title, "Play from Here");
  const book = bookItem(abs, toAbsItem(BOOK_FULL), c);
  assertEquals(book.icon, "/cache/b.jpg");
  assertEquals(book.actions?.[0].title, "Resume from 6:56:35");
  assertEquals(book.actions?.[1].title, "Play from the Start");
  assertStringIncludes(book.detail?.markdown ?? "", "A lone astronaut.");
  assertEquals(abs.fileUrl("/api/items/li_1/file/1"), "http://abs.lan/api/items/li_1/file/1?token=tok");
  const state: PlayerState = {
    playing: {
      source: "abs",
      title: "Project Hail Mary",
      entries: [{ title: "Part 1", artist: "Andy Weir" }],
      started: 0,
      abs: { itemId: "li_1", offsets: [0], duration: 58000 },
    },
    index: 0,
    entry: { title: "Part 1", artist: "Andy Weir" },
    position: 29000,
    paused: true,
    bookTime: 29000,
    chapter: { start: 1200, end: 58000, title: "Chapter 2" },
  };
  const np = nowPlayingItem(state, c);
  assertEquals(np.title, "Project Hail Mary");
  assertEquals(np.subtitle, "Chapter 2");
  assertEquals(np.actions?.[0].title, "Resume");
  assertEquals(np.actions?.[1].title, "Next Chapter");
});
