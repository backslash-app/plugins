import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  clock,
  duration,
  type Episode,
  episodeKey,
  episodeNumber,
  installCommand,
  ipcCommand,
  ipcReply,
  isFinished,
  itunesShows,
  left,
  mpvArgs,
  newEpisodes,
  normalizeFeedUrl,
  osFamily,
  parseDuration,
  parsePodcast,
  parsePositionFile,
  positionScript,
  type Progress,
  pruneProgress,
  resumeAt,
  searchUrl,
  speedOf,
  stateOf,
  summary,
  unitArgs,
} from "./lib.ts";
import { episodeItem, noMpvItem, nowPlayingItem, showItem } from "./views.ts";

const FEED_URL = "https://feeds.example.fm/changelog";
const xml = await Deno.readTextFile(new URL("./testdata/feed.xml", import.meta.url));

Deno.test("parsePodcast: show, episodes with audio, iTunes tags, newest first", () => {
  const { show, episodes } = parsePodcast(xml, FEED_URL);
  assertEquals(show.title, "The Changelog: Software Development, Open Source");
  assertEquals(show.author, "Changelog Media");
  assertEquals(show.artwork, "https://cdn.changelog.com/uploads/covers/the-changelog-original.png?v=63725770357");
  assertEquals(show.genres, ["Technology", "News"]);
  assertEquals(show.description, "Software's best weekly news brief, deep technical interviews & talk show.");
  assertEquals(show.episodeCount, 3);
  assertEquals(episodes.map((e) => e.title), ["Kaizen! Pipely is LIVE", 'Bonus: "Behind the scenes"', "Trailer"]);
  const [kaizen, bonus, trailer] = episodes;
  assertEquals(kaizen.duration, 5741);
  assertEquals(kaizen.number, 612);
  assertEquals(kaizen.bytes, 91853241);
  assertEquals(kaizen.image, "https://cdn.changelog.com/uploads/covers/612.png");
  assertEquals(kaizen.date, Date.UTC(2026, 9, 27, 19, 30));
  assertEquals(kaizen.id, "changelog.com/1/2961");
  assertStringIncludes(kaizen.notes, "<strong>Kaizen 19</strong>");
  assertEquals(bonus.kind, "bonus");
  assertEquals(bonus.explicit, true);
  assertEquals(bonus.season, 3);
  assertEquals(bonus.notes, "A short one.");
  assertEquals(bonus.image, show.artwork);
  // Relative audio resolved against the show's link; no guid → the audio URL.
  assertEquals(trailer.audio, "https://changelog.com/uploads/trailer.mp3");
  assertEquals(trailer.id, trailer.audio);
  assertEquals(trailer.duration, 130);
  assertThrows(() => parsePodcast("<feed></feed>", FEED_URL), Error, "Not a podcast feed");
});

Deno.test("durations", () => {
  assertEquals(parseDuration("1:02:03"), 3723);
  assertEquals(parseDuration("62:10"), 3730);
  assertEquals(parseDuration("3723.6"), 3724);
  assertEquals(parseDuration(""), undefined);
  assertEquals(parseDuration("abc"), undefined);
  assertEquals(duration(5741), "1 h 36");
  assertEquals(duration(2700), "45 min");
  assertEquals(duration(0), undefined);
  assertEquals(clock(3723), "1:02:03");
  assertEquals(clock(75), "1:15");
  assertEquals(left({ position: 600, duration: 2700 }), "35 min left");
});

Deno.test("Apple Podcasts results: shows with a feed, without duplicates", () => {
  const shows = itunesShows({
    results: [
      {
        collectionId: 341623264,
        collectionName: "The Changelog",
        artistName: "Changelog Media",
        feedUrl: "https://changelog.com/podcast/feed",
        artworkUrl600: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts/600x600bb.jpg",
        artworkUrl100: "https://is1-ssl.mzstatic.com/image/thumb/Podcasts/100x100bb.jpg",
        primaryGenreName: "Technology",
        genres: ["Technology", "Podcasts", "News"],
        trackCount: 612,
        releaseDate: "2026-10-27T19:30:00Z",
        collectionViewUrl: "https://podcasts.apple.com/us/podcast/the-changelog/id341623264?uo=4",
      },
      { collectionName: "Apple only, no feed" },
      { collectionName: "Duplicate", feedUrl: "https://changelog.com/podcast/feed" },
    ],
  });
  assertEquals(shows.length, 1);
  assertEquals(shows[0].artwork, "https://is1-ssl.mzstatic.com/image/thumb/Podcasts/600x600bb.jpg");
  assertEquals(shows[0].genres, ["Technology", "News"]);
  assertEquals(shows[0].lastRelease, Date.UTC(2026, 9, 27, 19, 30));
  assertEquals(itunesShows({}), []);
  assertEquals(
    searchUrl("café & co", "FR"),
    "https://itunes.apple.com/search?media=podcast&entity=podcast&limit=30&term=caf%C3%A9%20%26%20co&country=fr",
  );
  assertEquals(searchUrl("x", "nope").includes("country"), false);
});

const ep = (o: Partial<Episode>): Episode => ({
  id: "1",
  feedUrl: FEED_URL,
  show: "Show",
  title: "Episode",
  audio: "https://example.com/a.mp3",
  notes: "",
  ...o,
});

Deno.test("progress: resume point, states, finished, pruning", () => {
  assertEquals(resumeAt(undefined), 0);
  assertEquals(resumeAt({ position: 20, updated: 0 }), 0);
  assertEquals(resumeAt({ position: 600, duration: 3000, updated: 0 }), 595);
  assertEquals(resumeAt({ position: 2990, duration: 3000, updated: 0 }), 0);
  assertEquals(resumeAt({ position: 600, played: true, updated: 0 }), 0);
  assertEquals(stateOf({ position: 600, updated: 0 }), "inProgress");
  assertEquals(stateOf({ position: 0, played: true, updated: 0 }), "played");
  assertEquals(stateOf(undefined), "new");
  assert(isFinished(2950, 3000));
  assert(!isFinished(2000, 3000));
  assert(!isFinished(100, undefined));
  const many: Record<string, Progress> = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`k${i}`, { position: i, updated: i }]),
  );
  assertEquals(Object.keys(pruneProgress(many, 3)).sort(), ["k7", "k8", "k9"]);
});

Deno.test("new episodes: unplayed, recent, no trailers, newest first", () => {
  const now = Date.UTC(2026, 9, 28);
  const day = 86_400_000;
  const list = [
    ep({ id: "old", date: now - 40 * day }),
    ep({ id: "a", date: now - 2 * day }),
    ep({ id: "b", date: now - day }),
    ep({ id: "played", date: now - day }),
    ep({ id: "trailer", date: now, kind: "trailer" }),
  ];
  const progress = { [episodeKey(ep({ id: "played" }))]: { position: 0, played: true, updated: 0 } };
  assertEquals(newEpisodes(list, progress, { now }).map((e) => e.id), ["b", "a"]);
  assertEquals(newEpisodes(list, {}, { now, days: 60 }).length, 4);
});

Deno.test("mpv: command line, script, IPC and position file", () => {
  assertEquals(mpvArgs("https://x/a.mp3", { start: 95.7, speed: 1.5, socket: "/s", script: "/p.lua", title: "S: E" }), [
    "mpv",
    "--no-video",
    "--no-terminal",
    "--idle=no",
    "--cache=yes",
    "--force-seekable=yes",
    "--start=95",
    "--speed=1.5",
    "--input-ipc-server=/s",
    "--script=/p.lua",
    "--title=S: E",
    "--force-media-title=S: E",
    "https://x/a.mp3",
  ]);
  assertEquals(mpvArgs("u").includes("--speed=1"), false);
  assertEquals(unitArgs("u", "d", ["mpv"]), ["--user", "--quiet", "--collect", "--unit=u", "--description=d", "mpv"]);
  const script = positionScript("/home/a/.cache/backslash/podcasts/position.json");
  assertStringIncludes(script, 'local out = "/home/a/.cache/backslash/podcasts/position.json"');
  assertStringIncludes(script, 'e.reason == "eof"');
  assertEquals(ipcCommand(["seek", 30, "relative"], 4), '{"command":["seek",30,"relative"],"request_id":4}\n');
  assertEquals(
    ipcReply('{"event":"pause"}\n{"data":1234.5,"request_id":4,"error":"success"}\n', 4),
    { ok: true, data: 1234.5 },
  );
  assertEquals(ipcReply('{"request_id":2,"error":"property unavailable"}', 2), { ok: false, data: undefined });
  assertEquals(ipcReply('{"data":1,"req', 1), undefined);
  assertEquals(parsePositionFile('{"position":612.4,"duration":5741.0,"ended":false,"paused":true}'), {
    position: 612.4,
    duration: 5741,
    ended: false,
    paused: true,
  });
  assertEquals(parsePositionFile('{"position":null,"duration":null,"ended":true,"paused":false}')?.ended, true);
  assertEquals(parsePositionFile("garbage"), undefined);
});

Deno.test("preferences and addresses", () => {
  assertEquals(speedOf("1,5"), 1.5);
  assertEquals(speedOf("2x"), 2);
  assertEquals(speedOf(9), 1);
  assertEquals(speedOf(undefined), 1);
  assertEquals(normalizeFeedUrl("itpc://example.com/feed"), "https://example.com/feed");
  assertEquals(normalizeFeedUrl("example.com/rss"), "https://example.com/rss");
  assertEquals(normalizeFeedUrl(" "), undefined);
  assertEquals(episodeNumber({ season: 2, number: 14 }), "S2 · E14");
  assertEquals(summary("<p>Hello <b>world</b></p>"), "Hello world");
  assertEquals(osFamily('ID=ubuntu\nID_LIKE="debian"'), "debian");
  assertEquals(installCommand("fedora"), "sudo dnf install mpv");
});

Deno.test("episode item: cover, state, resume action, notes in the detail", () => {
  const { episodes } = parsePodcast(xml, FEED_URL);
  const e = episodes[0];
  const progress = { [episodeKey(e)]: { position: 1200, duration: 5741, updated: 1 } };
  const item = episodeItem(e, { progress, speed: 1 }, { withShow: true });
  assertEquals(item.icon, e.image);
  assertEquals(item.detail?.image, e.image);
  assertEquals(item.subtitle, e.show);
  assertEquals(item.actions?.[0].title, "Resume from 19:55");
  assert(item.actions?.some((a) => a.title === "Play from the Beginning"));
  assertStringIncludes(item.detail!.markdown!, "**Kaizen 19**");
  assertStringIncludes(item.detail!.markdown!, "[now live](https://github.com/thechangelog/pipely)");
  assert(item.accessories?.some((a) => a.text === "1 h 16 left"));
  const fresh = episodeItem(e, { progress: {}, speed: 1 });
  assertEquals(fresh.actions?.[0].title, "Play");
  assertEquals(fresh.actions?.[1].title, "Mark as Played");
});

Deno.test("now playing: player actions; the playing episode offers pause and seek", () => {
  const e = ep({ title: "Live one", duration: 3600 });
  const player = {
    playing: { episode: e, started: Date.now(), speed: 1.5 },
    position: 900,
    duration: 3600,
    paused: false,
  };
  const item = nowPlayingItem(player, { progress: {}, player, speed: 1 });
  assertEquals(item.subtitle, "Playing · Show · 15:00 / 1:00:00");
  assertEquals(item.actions?.slice(0, 3).map((a) => a.title), ["Pause", "Forward 30 Seconds", "Back 30 Seconds"]);
  assert(item.accessories?.some((a) => a.tag === "1.5×"));
  const row = episodeItem(e, { progress: {}, player: { ...player, paused: true }, speed: 1 });
  assertEquals(row.actions?.[0].title, "Resume");
  assert(row.accessories?.some((a) => a.tag === "Paused"));
});

Deno.test("show item and setup", () => {
  const { show } = parsePodcast(xml, FEED_URL);
  const ctx = () => Promise.resolve({ progress: {}, speed: 1 });
  const subscribed = showItem(show, ctx, { subscribed: true, newCount: 2 });
  assert(subscribed.accessories?.some((a) => a.tag === "2 new"));
  const unsub = subscribed.actions?.find((a) => a.title === "Unsubscribe");
  assert(unsub?.confirm && unsub.destructive);
  assertEquals(showItem(show, ctx, { subscribed: false }).actions?.[1].title, "Subscribe");
  assertEquals(noMpvItem("arch").subtitle, "sudo pacman -S mpv");
});
