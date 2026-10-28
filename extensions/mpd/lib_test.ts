import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  albumLine,
  audioFormat,
  clock,
  coverKey,
  imageExtension,
  installMarkdown,
  modeName,
  nextMode,
  osFamily,
  parseAck,
  parsePairs,
  parsePlaylists,
  parseSongs,
  parseStats,
  parseStatus,
  quote,
  songLine,
  totalTime,
} from "./lib.ts";

// Real MPD 0.23 answers.
const STATUS = `volume: 70
repeat: 1
random: 0
single: oneshot
consume: 0
partition: default
playlist: 42
playlistlength: 3
mixrampdb: 0.000000
state: play
song: 1
songid: 2
time: 61:274
elapsed: 61.204
bitrate: 945
duration: 274.000
audio: 44100:16:2
nextsong: 2
nextsongid: 3`;

const QUEUE = `file: Daft Punk/Random Access Memories/08 Get Lucky.flac
Last-Modified: 2023-01-01T10:00:00Z
Format: 44100:16:2
Artist: Daft Punk
Artist: Pharrell Williams
AlbumArtist: Daft Punk
Title: Get Lucky
Album: Random Access Memories
Track: 8/13
Date: 2013-05-17
Genre: Disco
Time: 370
duration: 369.629
Pos: 0
Id: 1
file: Air/Moon Safari/01 La femme d'argent.mp3
Title: La femme d'argent
Artist: Air
Album: Moon Safari
Date: 1998
duration: 429.500
Pos: 1
Id: 2
file: http://ice.example.org/fip.mp3
Name: FIP
Pos: 2
Id: 3
file: Unsorted/My%20Song.ogg
Pos: 3
Id: 4`;

Deno.test("status", () => {
  const s = parseStatus(STATUS);
  assertEquals([s.state, s.volume, s.repeat, s.random, s.single, s.consume], ["play", 70, true, false, "oneshot", "0"]);
  assertEquals([s.playlistLength, s.playlistVersion, s.song, s.songId, s.nextSong], [3, 42, 1, 2, 2]);
  assertEquals([s.elapsed, s.duration, s.bitrate, s.updating], [61.204, 274, 945, false]);
  const old = parseStatus("volume: -1\nstate: pause\ntime: 12:300\nupdating_db: 3\n");
  assertEquals([old.volume, old.state, old.elapsed, old.duration, old.updating], [undefined, "pause", 12, 300, true]);
  assertEquals(parseStatus("").state, "stop");
});

Deno.test("songs", () => {
  const songs = parseSongs(QUEUE);
  assertEquals(songs.length, 4);
  const [lucky, air, fip, bare] = songs;
  assertEquals([lucky.title, lucky.artist, lucky.album, lucky.track, lucky.date, lucky.duration, lucky.id], [
    "Get Lucky",
    "Daft Punk",
    "Random Access Memories",
    "8",
    "2013",
    369.629,
    1,
  ]);
  assertEquals(songLine(lucky), "Daft Punk — Get Lucky");
  assertEquals(albumLine(lucky), "Random Access Memories (2013)");
  assertEquals([air.pos, air.artist], [1, "Air"]);
  assertEquals([fip.title, fip.stream, fip.duration], ["FIP", true, undefined]);
  assertEquals([bare.title, bare.artist], ["My Song", undefined]);
  assertEquals(parsePairs("a: b: c\nnot a pair\n"), [["a", "b: c"]]);
});

Deno.test("playlists, stats and errors", () => {
  const pls = parsePlaylists(
    "playlist: Workout\nLast-Modified: 2026-10-01T10:00:00Z\nplaylist: Chill\nLast-Modified: 2026-09-01T10:00:00Z\n",
  );
  assertEquals(pls.map((p) => p.name), ["Chill", "Workout"]);
  assertEquals(pls[1].modified, "2026-10-01T10:00:00Z");
  assertEquals(parseStats("artists: 120\nalbums: 300\nsongs: 4211\nuptime: 5\ndb_playtime: 1000000\n"), {
    artists: 120,
    albums: 300,
    songs: 4211,
    dbPlaytime: 1000000,
  });
  assertEquals(parseAck("ACK [50@0] {albumart} No file exists"), {
    code: 50,
    command: "albumart",
    message: "No file exists",
  });
  assertEquals(parseAck("ACK [3@0] {} incorrect password"), { code: 3, command: "", message: "incorrect password" });
  assertEquals(parseAck("OK"), undefined);
});

Deno.test("quoting and formatting", () => {
  assertEquals(quote('AC/DC "Live" \\ 1991'), '"AC/DC \\"Live\\" \\\\ 1991"');
  assertEquals(quote(3), '"3"');
  assertEquals(clock(61.9), "1:01");
  assertEquals(clock(3725), "1:02:05");
  assertEquals(clock(undefined), "–:––");
  assertEquals(totalTime(5400), "1 h 30 min");
  assertEquals(totalTime(200000), "2 d 7 h");
  assertEquals(audioFormat("44100:16:2"), "44.1 kHz · 16 bit · stereo");
  assertEquals(audioFormat("96000:24:2"), "96 kHz · 24 bit · stereo");
  assertEquals(audioFormat("48000:f:1"), "48 kHz · float · mono");
  assertEquals([nextMode("0"), nextMode("1"), nextMode("oneshot")], ["1", "oneshot", "0"]);
  assertEquals(modeName("oneshot"), "Once");
});

Deno.test("covers", () => {
  assertEquals(coverKey("Air/Moon Safari/01.mp3"), coverKey("Air/Moon Safari/02.mp3"), "one cover per folder");
  assertEquals(coverKey("Air/Moon Safari/01.mp3") === coverKey("Air/Talkie Walkie/01.mp3"), false);
  assertEquals(imageExtension(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])), "jpg");
  assertEquals(imageExtension(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), "png");
  assertEquals(imageExtension(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45])), "webp");
});

Deno.test("install hints", () => {
  assertEquals(osFamily('ID=linuxmint\nID_LIKE="ubuntu debian"\n'), "debian");
  assertStringIncludes(installMarkdown("arch"), "sudo pacman -S mpd");
  assertStringIncludes(installMarkdown(undefined), "systemctl --user enable --now mpd");
});
