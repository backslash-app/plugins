import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  caaThumb,
  dayLabel,
  HOSTS,
  lastfmError,
  lastfmImage,
  lastfmTrackUrl,
  lastfmUrl,
  lbStatsUrl,
  parseLastfmRecent,
  parseLastfmTop,
  parseLbListens,
  parseLbPlayingNow,
  parseLbStats,
  plays,
  services,
  settings,
  trackLine,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});

Deno.test("settings and services", () => {
  const both = settings({ lastfmUser: "rj", lastfmKey: "k", listenbrainzUser: "mr_monkey", period: "MONTH" });
  assertEquals(both.period, "month");
  assertEquals(services(both), ["lastfm", "listenbrainz"]);
  const lbFirst = settings({ lastfmUser: "rj", lastfmKey: "k", listenbrainzUser: "lb", primary: "ListenBrainz" });
  assertEquals(services(lbFirst), ["listenbrainz", "lastfm"]);
  // A Last.fm user without a key can't be used.
  const noKey = settings({ lastfmUser: "rj", listenbrainzUser: " lb ", period: "decade" });
  assertEquals(services(noKey), ["listenbrainz"]);
  assertEquals(noKey.listenbrainzUser, "lb");
  assertEquals(noKey.period, "week");
  assertEquals(services(settings({})), []);
});

Deno.test("Last.fm URLs", () => {
  const url = new URL(
    lastfmUrl("user.getrecenttracks", settings({ lastfmUser: "a b", lastfmKey: "KEY" }), { limit: 50 }),
  );
  assertEquals(url.host, "ws.audioscrobbler.com");
  assertEquals(url.searchParams.get("user"), "a b");
  assertEquals(url.searchParams.get("api_key"), "KEY");
  assertEquals(url.searchParams.get("format"), "json");
  assertEquals(url.searchParams.get("limit"), "50");
  assertEquals(lastfmTrackUrl("Daft Punk", "One More Time"), "https://www.last.fm/music/Daft+Punk/_/One+More+Time");
});

const IMG = (size: string, id = "f1b8a2c0d5e94bd3c5a8e0c1a2b3c4d5") => ({
  size,
  "#text": `https://lastfm.freetls.fastly.net/i/u/${size === "extralarge" ? "300x300" : "64s"}/${id}.jpg`,
});

// user.getrecenttracks&extended=1, trimmed.
const RECENT = {
  recenttracks: {
    track: [
      {
        artist: { url: "https://www.last.fm/music/Radiohead", name: "Radiohead", mbid: "a74b1b7f" },
        streamable: "0",
        image: [IMG("small"), IMG("medium"), IMG("large"), IMG("extralarge")],
        mbid: "",
        album: { mbid: "", "#text": "OK Computer" },
        name: "Airbag",
        "@attr": { nowplaying: "true" },
        url: "https://www.last.fm/music/Radiohead/_/Airbag",
        loved: "0",
      },
      {
        artist: { name: "Daft Punk" },
        image: [
          IMG("small", "2a96cbd8b46e442fc41c2b86b821562f"),
          IMG("extralarge", "2a96cbd8b46e442fc41c2b86b821562f"),
        ],
        album: { "#text": "" },
        name: "One More Time",
        url: "https://www.last.fm/music/Daft+Punk/_/One+More+Time",
        date: { uts: "1793460000", "#text": "31 Oct 2026, 15:20" },
        loved: "1",
      },
    ],
    "@attr": { user: "rj", totalPages: "2468", page: "1", perPage: "50", total: "123382" },
  },
};

Deno.test("Last.fm recent tracks", () => {
  const { tracks, total } = parseLastfmRecent(RECENT);
  assertEquals(total, 123382);
  assertEquals(tracks.length, 2);
  assertEquals(tracks[0].playing, true);
  assertEquals(tracks[0].at, undefined);
  assertEquals(tracks[0].album, "OK Computer");
  assertEquals(tracks[0].image, "https://lastfm.freetls.fastly.net/i/u/300x300/f1b8a2c0d5e94bd3c5a8e0c1a2b3c4d5.jpg");
  assertEquals(tracks[1].artist, "Daft Punk");
  assertEquals(tracks[1].at, 1793460000000);
  assertEquals(tracks[1].album, undefined);
  assertEquals(tracks[1].image, undefined); // the grey star placeholder
  assertEquals(tracks[1].loved, true);
});

Deno.test("Last.fm: a single track comes as an object, plain artist text without extended", () => {
  const { tracks } = parseLastfmRecent({
    recenttracks: {
      track: {
        artist: { mbid: "", "#text": "Björk" },
        name: "Jóga",
        album: { "#text": "Homogenic" },
        date: { uts: "1" },
      },
      "@attr": { total: "1" },
    },
  });
  assertEquals(tracks.map(trackLine), ["Björk – Jóga"]);
  assertEquals(parseLastfmRecent({}).tracks, []);
});

Deno.test("Last.fm errors", () => {
  assertEquals(
    lastfmError({ error: 10, message: "Invalid API key - You must be granted a valid key by last.fm" }),
    "Last.fm refused the API key: check it in Settings → Extensions → Scrobbles",
  );
  assertEquals(lastfmError({ error: 6, message: "User not found" }), "Last.fm: User not found");
  assertEquals(lastfmError({ recenttracks: {} }), undefined);
});

Deno.test("Last.fm top charts", () => {
  const artists = parseLastfmTop({
    topartists: {
      artist: [
        {
          streamable: "0",
          image: [IMG("small", "2a96cbd8b46e442fc41c2b86b821562f")],
          mbid: "a74b1b7f",
          url: "https://www.last.fm/music/Radiohead",
          playcount: "87",
          "@attr": { rank: "1" },
          name: "Radiohead",
        },
        { name: "Portishead", playcount: "40", "@attr": { rank: "2" }, url: "https://www.last.fm/music/Portishead" },
      ],
      "@attr": { user: "rj", totalPages: "10", page: "1", perPage: "50", total: "500" },
    },
  }, "artists");
  assertEquals(artists.map((a) => [a.rank, a.name, a.plays, a.artist]), [[1, "Radiohead", 87, undefined], [
    2,
    "Portishead",
    40,
    undefined,
  ]]);
  const tracks = parseLastfmTop({
    toptracks: {
      track: [{
        name: "Airbag",
        playcount: "12",
        artist: { name: "Radiohead", mbid: "", url: "https://www.last.fm/music/Radiohead" },
        "@attr": { rank: "1" },
        image: [IMG("extralarge")],
      }],
    },
  }, "tracks");
  assertEquals(tracks[0].artist, "Radiohead");
  assert(tracks[0].image?.includes("300x300"));
  const albums = parseLastfmTop({
    topalbums: {
      album: { name: "OK Computer", playcount: "30", artist: { name: "Radiohead" }, "@attr": { rank: "1" } },
    },
  }, "albums");
  assertEquals(albums.map(trackLine), ["Radiohead – OK Computer"]);
  assertEquals(lastfmImage("nope"), undefined);
});

// Real ListenBrainz shapes.
const LISTENS = {
  payload: {
    count: 2,
    latest_listen_ts: 1793367409,
    listens: [
      {
        inserted_at: 1793367509,
        listened_at: 1793367409,
        recording_msid: "58ae7804-cda4-46ce-93c4-a6b712e52fcb",
        track_metadata: {
          additional_info: { duration_ms: 196437, media_player: "Bandcamp" },
          artist_name: "Diasonics",
          track_name: "Мелодия",
        },
        user_name: "mr_monkey",
      },
      {
        inserted_at: 1793360958,
        listened_at: 1793360807,
        track_metadata: {
          artist_name: "NaraBara",
          mbid_mapping: {
            artist_mbids: ["bdff5a3e-09e8-43b7-98bd-1cb9dcf44e23"],
            caa_id: 38058206396,
            caa_release_mbid: "9786f272-08aa-4721-a486-974ec76ec6bf",
            recording_mbid: "f18e7d48-cde2-49b1-8279-61ecb632c3d4",
            recording_name: "Ayas",
            release_mbid: "9786f272-08aa-4721-a486-974ec76ec6bf",
          },
          release_name: "Hamt Zamin Hümüs",
          track_name: "Ayas",
        },
        user_name: "mr_monkey",
      },
    ],
    user_id: "mr_monkey",
  },
};

Deno.test("ListenBrainz listens and covers", () => {
  const tracks = parseLbListens(LISTENS);
  assertEquals(tracks.map(trackLine), ["Diasonics – Мелодия", "NaraBara – Ayas"]);
  assertEquals(tracks[0].image, undefined);
  assertEquals(tracks[0].at, 1793367409000);
  assertEquals(
    tracks[1].image,
    "https://archive.org/download/mbid-9786f272-08aa-4721-a486-974ec76ec6bf/mbid-9786f272-08aa-4721-a486-974ec76ec6bf-38058206396_thumb250.jpg",
  );
  assertEquals(tracks[1].url, "https://musicbrainz.org/recording/f18e7d48-cde2-49b1-8279-61ecb632c3d4");
  assertEquals(tracks[1].album, "Hamt Zamin Hümüs");
  assertEquals(caaThumb("abc"), "https://coverartarchive.org/release/abc/front-250");
  assertEquals(caaThumb(undefined), undefined);
  for (const t of tracks) if (t.image) assert(HOSTS.includes(new URL(t.image).host));
});

Deno.test("ListenBrainz playing now", () => {
  assertEquals(parseLbPlayingNow({ payload: { count: 0, listens: [], playing_now: true, user_id: "x" } }), undefined);
  const t = parseLbPlayingNow({
    payload: {
      count: 1,
      listens: [{ playing_now: true, track_metadata: { artist_name: "Morphine", track_name: "Buena" } }],
      playing_now: true,
    },
  });
  assertEquals(t?.playing, true);
  assertEquals(t?.at, undefined);
});

Deno.test("ListenBrainz statistics", () => {
  assertEquals(
    lbStatsUrl("mr monkey", "albums", "week", 50),
    "https://api.listenbrainz.org/1/stats/user/mr%20monkey/release-groups?range=week&count=50",
  );
  assertEquals(
    lbStatsUrl("u", "tracks", "all"),
    "https://api.listenbrainz.org/1/stats/user/u/recordings?range=all_time&count=25",
  );
  const albums = parseLbStats({
    payload: {
      count: 1,
      range: "week",
      release_groups: [{
        artist_mbids: ["42689657-cbec-4f66-a9ed-80f939ea23ed"],
        artist_name: "Morphine",
        caa_id: 14670890955,
        caa_release_mbid: "c6f2297e-4083-439e-b141-f947de988576",
        listen_count: 15,
        release_group_mbid: "c27c4bc3-98da-33ea-ad7a-5a765ccf9580",
        release_group_name: "Cure for Pain",
      }],
      user_id: "mr_monkey",
    },
  }, "albums");
  assertEquals(albums[0].name, "Cure for Pain");
  assertEquals(albums[0].artist, "Morphine");
  assertEquals(albums[0].plays, 15);
  assertEquals(albums[0].url, "https://musicbrainz.org/release-group/c27c4bc3-98da-33ea-ad7a-5a765ccf9580");
  assert(albums[0].image?.includes("14670890955_thumb250"));
  const artists = parseLbStats({
    payload: { artists: [{ artist_mbids: ["a1"], artist_name: "Morphine", listen_count: 40 }] },
  }, "artists");
  assertEquals(artists[0].url, "https://musicbrainz.org/artist/a1");
  const tracks = parseLbStats({
    payload: {
      recordings: [{ artist_name: "Morphine", track_name: "Buena", recording_mbid: "r1", listen_count: 3 }],
    },
  }, "tracks");
  assertEquals(trackLine(tracks[0]), "Morphine – Buena");
  assertEquals(parseLbStats(undefined, "tracks"), []);
});

Deno.test("formatting", () => {
  const now = Date.parse("2026-10-31T15:00:00Z");
  assertEquals(ago(now - 20_000, now), "just now");
  assertEquals(ago(now - 12 * 60_000, now), "12 min ago");
  assertEquals(ago(now - 3 * 3_600_000, now), "3 h ago");
  assertEquals(ago(now - 30 * 3_600_000, now), "yesterday");
  assertEquals(ago(now - 4 * 86_400_000, now), "4 days ago");
  assertEquals(ago(undefined, now), "now");
  assertEquals(dayLabel(now - 60_000, now), "Today");
  assertEquals(dayLabel(undefined, now), "Now playing");
  assertEquals(plays(1), "1 play");
  assertEquals(plays(1234), "1,234 plays");
});
