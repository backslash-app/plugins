import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  addToHistory,
  dayLabel,
  installMarkdown,
  links,
  osFamily,
  parseSeconds,
  parseShazam,
  parseSongrec,
  parseSource,
  recordArgs,
  type Song,
  songMarkdown,
  songrecError,
} from "./lib.ts";

const SHAZAM = {
  matches: [{ id: "1", offset: 12.3 }],
  track: {
    key: "549679333",
    title: "Get Lucky",
    subtitle: "Daft Punk",
    url: "https://www.shazam.com/track/549679333/get-lucky",
    isrc: "USQX91300108",
    genres: { primary: "Electronic" },
    images: {
      coverart: "https://is1-ssl.mzstatic.com/image/thumb/a/400x400cc.jpg",
      coverarthq: "https://is1-ssl.mzstatic.com/image/thumb/a/800x800cc.jpg",
    },
    hub: {
      actions: [
        { name: "apple", type: "applemusicplay", id: "617154366" },
        { name: "apple", type: "uri", uri: "https://audio-ssl.itunes.apple.com/preview.m4a" },
      ],
      options: [{
        actions: [{ type: "applemusicopen", uri: "https://music.apple.com/fr/album/get-lucky/617154241?i=617154366" }],
      }],
      providers: [{
        type: "SPOTIFY",
        actions: [{ name: "hub:spotify:searchdeeplink", uri: "spotify:search:Get%20Lucky%20Daft%20Punk" }],
      }],
    },
    sections: [
      {
        type: "SONG",
        metadata: [
          { title: "Album", text: "Random Access Memories" },
          { title: "Label", text: "Columbia" },
          { title: "Released", text: "2013" },
        ],
      },
      { type: "LYRICS", text: ["Like the legend of the phoenix", "", "All ends with beginnings"] },
    ],
  },
};

Deno.test("Shazam's JSON: title, artist, album, cover, links and lyrics", () => {
  const song = parseShazam(SHAZAM, 1000)!;
  assertEquals(song.key, "549679333");
  assertEquals(song.title, "Get Lucky");
  assertEquals(song.artist, "Daft Punk");
  assertEquals(song.album, "Random Access Memories");
  assertEquals(song.label, "Columbia");
  assertEquals(song.released, "2013");
  assertEquals(song.genre, "Electronic");
  assertEquals(song.cover, "https://is1-ssl.mzstatic.com/image/thumb/a/800x800cc.jpg");
  assertEquals(song.appleMusic, "https://music.apple.com/fr/album/get-lucky/617154241?i=617154366");
  assertEquals(song.preview, "https://audio-ssl.itunes.apple.com/preview.m4a");
  assertEquals(song.spotify, "spotify:search:Get%20Lucky%20Daft%20Punk");
  assertEquals(song.lyrics?.length, 3);
  assertEquals(song.at, 1000);
});

Deno.test("no match: undefined", () => {
  assertEquals(parseShazam({ matches: [], tagid: "x" }), undefined);
  assertEquals(parseShazam(null), undefined);
});

Deno.test("SongRec output: JSON after log lines, or 'Artist - Title'", () => {
  const out = `[INFO] recognizing\n${JSON.stringify(SHAZAM)}`;
  assertEquals(parseSongrec(out)?.title, "Get Lucky");
  const plain = parseSongrec("Daft Punk - Get Lucky\n", 5)!;
  assertEquals([plain.artist, plain.title, plain.at], ["Daft Punk", "Get Lucky", 5]);
  assertEquals(parseSongrec("Error - something broke"), undefined);
  assertEquals(parseSongrec(""), undefined);
});

Deno.test("SongRec failures become sentences", () => {
  assertEquals(songrecError("reqwest::Error: dns error"), "Shazam can't be reached: check your connection");
  assertEquals(songrecError("No match for this song"), "No match");
  assertEquals(songrecError("Error: unsupported format"), "SongRec couldn't read the recording");
  assertEquals(songrecError("Error: something odd\n"), "something odd");
  assertEquals(songrecError(""), "SongRec failed");
});

Deno.test("recording arguments for PipeWire and PulseAudio", () => {
  assertEquals(recordArgs("pw-record", "output", "/c/a.wav"), [
    "--rate",
    "16000",
    "--channels",
    "1",
    "-P",
    "{ stream.capture.sink = true }",
    "/c/a.wav",
  ]);
  assertEquals(recordArgs("pw-record", "mic", "/c/a.wav"), ["--rate", "16000", "--channels", "1", "/c/a.wav"]);
  assertEquals(recordArgs("parecord", "output", "/c/a.wav"), [
    "--file-format=wav",
    "--rate=16000",
    "--channels=1",
    "--device=@DEFAULT_MONITOR@",
    "/c/a.wav",
  ]);
});

Deno.test("preferences: seconds and source", () => {
  assertEquals(parseSeconds(undefined), 10);
  assertEquals(parseSeconds("3"), 10);
  assertEquals(parseSeconds(7.4), 7);
  assertEquals(parseSeconds(60), 20);
  assertEquals(parseSource("Microphone"), "mic");
  assertEquals(parseSource("micro"), "mic");
  assertEquals(parseSource(""), "output");
});

Deno.test("links: searches, plus Apple Music and Shazam when known", () => {
  const song = parseShazam(SHAZAM)!;
  const titles = links(song).map((l) => l.title);
  assertEquals(titles.includes("Open in Apple Music"), true);
  assertEquals(titles.includes("Open on Shazam"), true);
  assertEquals(links(song)[0].url, "https://open.spotify.com/search/Daft%20Punk%20Get%20Lucky");
  const bare: Song = { key: "k", title: "T", artist: "A", at: 0 };
  assertEquals(links(bare).some((l) => l.title === "Open in Apple Music"), false);
});

Deno.test("history: newest first, no duplicate within 15 minutes, capped", () => {
  const a: Song = { key: "a", title: "A", artist: "X", at: 0 };
  const a2: Song = { ...a, at: 10 * 60_000 };
  const a3: Song = { ...a, at: 60 * 60_000 };
  let h = addToHistory([], a);
  h = addToHistory(h, a2);
  assertEquals(h.length, 1);
  h = addToHistory(h, a3);
  assertEquals(h.map((s) => s.at), [60 * 60_000, 10 * 60_000]);
  const many = Array.from({ length: 5 }, (_, i) => ({ ...a, key: `k${i}`, at: i }));
  assertEquals(addToHistory(many, { ...a, key: "new", at: 9 }, 3).length, 3);
});

Deno.test("day labels", () => {
  const now = new Date(2026, 9, 31, 12).getTime();
  assertEquals(dayLabel(new Date(2026, 9, 31, 8).getTime(), now), "Today");
  assertEquals(dayLabel(new Date(2026, 9, 30, 23).getTime(), now), "Yesterday");
  assertEquals(dayLabel(new Date(2026, 9, 27).getTime(), now), "Tuesday");
  assertEquals(dayLabel(new Date(2026, 5, 1).getTime(), now), "June");
  assertEquals(dayLabel(new Date(2025, 5, 1).getTime(), now), "June 2025");
});

Deno.test("song markdown keeps blank lyric lines", () => {
  const md = songMarkdown(parseShazam(SHAZAM)!);
  assertStringIncludes(md, "## Get Lucky");
  assertStringIncludes(md, "**Daft Punk** · Random Access Memories");
  assertStringIncludes(md, "Like the legend of the phoenix  \n  \nAll ends");
  assertEquals(songMarkdown({ key: "k", title: "T", artist: "A", at: 0 }), "## T\n\n**A**");
});

Deno.test("distribution family and install hints", () => {
  assertEquals(osFamily('ID=ubuntu\nID_LIKE="debian"\n'), "debian");
  assertEquals(osFamily("ID=cachyos\nID_LIKE=arch\n"), "arch");
  assertEquals(osFamily('ID="opensuse-tumbleweed"\n'), "suse");
  assertEquals(osFamily("ID=nixos\n"), undefined);
  assertStringIncludes(installMarkdown({ songrec: true, recorder: false }, "arch"), "sudo pacman -S songrec");
  assertStringIncludes(installMarkdown({ songrec: false, recorder: true }, "fedora"), "pipewire-utils");
  assertEquals(installMarkdown({ songrec: false, recorder: false }), "");
});
