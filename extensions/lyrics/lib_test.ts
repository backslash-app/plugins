import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  bestMatch,
  cleanArtist,
  cleanTitle,
  clock,
  currentIndex,
  escapeMd,
  getUrl,
  installCommand,
  isSynced,
  type LrcRecord,
  lrcToPlain,
  lyricsKey,
  lyricsMarkdown,
  osFamily,
  parseLrc,
  parsePlayerctl,
  pickTrack,
  plainMarkdown,
  sameSong,
  SEP,
  splitVideoTitle,
  stampSeconds,
  type Track,
} from "./lib.ts";
import { liveItems, lyricsOf, resultItem } from "./views.ts";

const LRC = `[ar:Queen]
[ti:Bohemian Rhapsody]
[length: 05:55]
[00:00.50] Is this the real life?
[00:04.20]Is this just fantasy?
[00:08.9]Caught in a <00:09.50>landslide
[00:12.345][01:30.00]No escape from reality
[00:20.00]
[00:25:500]Open your eyes`;

Deno.test("LRC timestamps", () => {
  assertEquals(stampSeconds("01", "02", "5"), 62.5);
  assertEquals(stampSeconds("1", "02", "50"), 62.5);
  assertEquals(stampSeconds("00", "12", "345"), 12.345);
  assertEquals(stampSeconds("03", "00"), 180);
});

Deno.test("LRC: tags, repeated stamps, word timings, empty lines, sorted", () => {
  const lrc = parseLrc(LRC);
  assertEquals(lrc.tags.ar, "Queen");
  assertEquals(lrc.tags.length, "05:55");
  assertEquals(lrc.offset, 0);
  assertEquals(lrc.lines, [
    { time: 0.5, text: "Is this the real life?" },
    { time: 4.2, text: "Is this just fantasy?" },
    { time: 8.9, text: "Caught in a landslide" },
    { time: 12.345, text: "No escape from reality" },
    { time: 20, text: "" },
    { time: 25.5, text: "Open your eyes" },
    { time: 90, text: "No escape from reality" },
  ]);
});

Deno.test("LRC offset, CRLF and junk lines", () => {
  const lrc = parseLrc("[offset:+500]\r\n[00:01.00]a\r\nnot a line\r\n[xx:yy]b\r\n[00:02.00]b");
  assertEquals(lrc.offset, 0.5);
  assertEquals(lrc.lines.map((l) => l.text), ["a", "b"]);
  assertEquals(parseLrc("[offset:-250]").offset, -0.25);
});

Deno.test("synced or plain", () => {
  assertEquals(isSynced(LRC), true);
  assertEquals(isSynced("Just words\nmore words"), false);
  assertEquals(isSynced(null), false);
  assertEquals(lrcToPlain("[00:01.00]a\n[00:02.00]\n[00:03.00]\n[00:04.00]\n[00:05.00]b"), "a\n\nb");
});

Deno.test("the line sung at a position", () => {
  const { lines } = parseLrc(LRC);
  assertEquals(currentIndex(lines, 0), -1);
  assertEquals(currentIndex(lines, 0.5), 0);
  assertEquals(currentIndex(lines, 5), 1);
  assertEquals(currentIndex(lines, 12.4), 3);
  assertEquals(currentIndex(lines, 60), 5);
  assertEquals(currentIndex(lines, 500), 6);
  assertEquals(currentIndex([], 10), -1);
});

const line = (...f: string[]) => f.join(SEP);

Deno.test("playerctl output", () => {
  const out = [
    line("firefox", "Paused", "", "Some Video - YouTube", "", "", "1000000"),
    line(
      "spotify",
      "Playing",
      "Queen",
      "Bohemian Rhapsody - Remastered 2011",
      "A Night at the Opera",
      "354320000",
      "12500000",
    ),
    line("vlc", "Stopped", "", "", "", "", "0"),
    "garbage",
  ].join("\n");
  const tracks = parsePlayerctl(out);
  assertEquals(tracks.length, 2);
  assertEquals(tracks[1], {
    player: "spotify",
    status: "Playing",
    artist: "Queen",
    title: "Bohemian Rhapsody - Remastered 2011",
    album: "A Night at the Opera",
    length: 354.32,
    position: 12.5,
  });
  assertEquals(pickTrack(tracks)?.player, "spotify");
  assertEquals(pickTrack(tracks, "Firefox")?.player, "firefox");
  assertEquals(pickTrack(tracks, "mpv")?.player, "spotify");
  assertEquals(pickTrack([]), undefined);
  assertEquals(sameSong(tracks[1], { ...tracks[1], position: 99 }), true);
  assertEquals(sameSong(tracks[0], tracks[1]), false);
});

Deno.test("titles and artists as LRCLIB knows them", () => {
  assertEquals(cleanTitle("Bohemian Rhapsody - Remastered 2011"), "Bohemian Rhapsody");
  assertEquals(cleanTitle("Under Pressure (feat. David Bowie)"), "Under Pressure");
  assertEquals(cleanTitle("Song [Official Music Video]"), "Song");
  assertEquals(cleanTitle("Song - Live at Wembley"), "Song");
  assertEquals(cleanTitle("Live and Let Die"), "Live and Let Die");
  assertEquals(cleanArtist("Daft Punk, Pharrell Williams"), "Daft Punk");
  assertEquals(cleanArtist("Queen - Topic"), "Queen");
  assertEquals(cleanArtist("Simon & Garfunkel"), "Simon & Garfunkel");
  assertEquals(cleanArtist("Calvin Harris feat. Rihanna"), "Calvin Harris");
  assertEquals(splitVideoTitle({ artist: "", title: "Queen – Bohemian Rhapsody (Official Video)" }), {
    artist: "Queen",
    title: "Bohemian Rhapsody (Official Video)",
  });
  assertEquals(splitVideoTitle({ artist: "Queen", title: "A - B" }), { artist: "Queen", title: "A - B" });
  assertEquals(lyricsKey("Queen - Topic", "Bohemian Rhapsody - Remastered"), "lyrics:queen|bohemian rhapsody");
});

Deno.test("LRCLIB addresses", () => {
  const url = new URL(
    getUrl({ artist: "Queen", title: "Bohemian Rhapsody", album: "A Night at the Opera", length: 354.3 }),
  );
  assertEquals(url.pathname, "/api/get");
  assertEquals(url.searchParams.get("artist_name"), "Queen");
  assertEquals(url.searchParams.get("track_name"), "Bohemian Rhapsody");
  assertEquals(url.searchParams.get("duration"), "354");
  assertEquals(new URL(getUrl({ artist: "A", title: "B" })).searchParams.has("duration"), false);
});

const record = (o: Partial<LrcRecord>): LrcRecord => ({
  id: 1,
  trackName: "Bohemian Rhapsody",
  artistName: "Queen",
  albumName: "A Night at the Opera",
  duration: 354,
  instrumental: false,
  plainLyrics: "Is this the real life?",
  syncedLyrics: null,
  ...o,
});

Deno.test("best search result", () => {
  const t = { artist: "Queen", title: "Bohemian Rhapsody - Remastered 2011", length: 355 };
  const results = [
    record({ id: 1, artistName: "Panic! at the Disco", syncedLyrics: "[00:01.00]x" }),
    record({ id: 2, duration: 420 }),
    record({ id: 3, syncedLyrics: "[00:00.50]Is this the real life?" }),
    record({ id: 4, trackName: "Another One Bites the Dust" }),
  ];
  assertEquals(bestMatch(results, t)?.id, 3);
  assertEquals(bestMatch([results[3]], t), undefined);
  assertEquals(bestMatch([], t), undefined);
});

Deno.test("Markdown", () => {
  assertEquals(escapeMd("*yeah* [x]"), "\\*yeah\\* \\[x\\]");
  const { lines } = parseLrc(LRC);
  const md = lyricsMarkdown(lines, 1, "Bohemian Rhapsody – Queen");
  assertStringIncludes(md, "## Bohemian Rhapsody – Queen");
  assertStringIncludes(md, "**▶ Is this just fantasy?**");
  assertStringIncludes(md, "♪");
  assertEquals(plainMarkdown("a\n\n\n\nb"), "a  \n\nb");
});

Deno.test("clock", () => {
  assertEquals(clock(83.4), "1:23");
  assertEquals(clock(0), "0:00");
  assertEquals(clock(-3), "0:00");
});

const track: Track = {
  player: "spotify",
  status: "Playing",
  artist: "Queen",
  title: "Bohemian Rhapsody",
  album: "A Night at the Opera",
  length: 354,
  position: 13,
};

Deno.test("live view: the current line under Now, two lines before it", () => {
  const lyrics = lyricsOf(record({ syncedLyrics: LRC }));
  assertEquals(lyrics.lines.length, 7);
  const items = liveItems(track, lyrics, { position: 13, offset: 0, searchView: () => undefined });
  assertEquals(items[0].id, "track");
  assertStringIncludes(items[0].detail?.markdown ?? "", "**▶ No escape from reality**");
  const lines = items.slice(1);
  assertEquals(lines.map((i) => i.section), ["Sung", "Sung", "Now", "Next", "Next", "Next"]);
  assertEquals(lines[2].title, "No escape from reality");
  assertEquals(lines[2].actions?.[0].title, "Jump Here");
  // With an offset, a line shows earlier.
  const early = liveItems(track, lyrics, { position: 12, offset: 0.5, searchView: () => undefined });
  assertEquals(early.find((i) => i.section === "Now")?.title, "No escape from reality");
});

Deno.test("live view: before the first line, plain lyrics, nothing found", () => {
  const lyrics = lyricsOf(record({ syncedLyrics: LRC }));
  const start = liveItems({ ...track, position: 0 }, lyrics, { position: 0, offset: 0, searchView: () => undefined });
  assertEquals(start[1].section, "Coming Up");
  const plain = liveItems(track, lyricsOf(record({ plainLyrics: "one\ntwo" })), {
    position: 0,
    offset: 0,
    searchView: () => undefined,
  });
  assertEquals(plain.slice(1).map((i) => i.title), ["one", "two"]);
  assertEquals(plain[1].section, "Lyrics (not synced)");
  const none = liveItems(track, undefined, { position: 0, offset: 0, searchView: () => undefined });
  assertEquals(none[1].id, "not-found");
});

Deno.test("search result item", () => {
  const item = resultItem(record({ id: 42, syncedLyrics: LRC }), track);
  assertEquals(item.id, "42");
  assertEquals(item.accessories?.[0].tag, "Synced");
  assertEquals(item.actions?.map((a) => a.title), [
    "Read Lyrics",
    "Copy Lyrics",
    "Copy Synced Lyrics (LRC)",
    "Use for “Bohemian Rhapsody”",
  ]);
});

Deno.test("install hint", () => {
  assertEquals(osFamily('ID=ubuntu\nID_LIKE="debian"'), "debian");
  assertEquals(installCommand("arch"), "sudo pacman -S playerctl");
  assertEquals(installCommand(undefined), "Install playerctl with your package manager");
});
