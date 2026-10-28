import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  countryParams,
  elapsed,
  genreColor,
  installCommand,
  mergeResults,
  osFamily,
  playerArgs,
  playerChoice,
  program,
  quality,
  songScript,
  songTitle,
  type Station,
  tags,
  unitArgs,
} from "./lib.ts";
import { noPlayerItem, nowPlayingItem, stationItem } from "./views.ts";

// Shaped like `/json/stations/search` results.
const fip: Station = {
  stationuuid: "f4ae3a6e-0601-11e8-ae97-52543be04c81",
  name: "FIP",
  url: "http://icecast.radiofrance.fr/fip-hifi.aac",
  url_resolved: "http://icecast.radiofrance.fr/fip-hifi.aac",
  homepage: "https://www.radiofrance.fr/fip",
  favicon: "https://www.radiofrance.fr/favicon.ico",
  tags: "eclectic,jazz,france, public radio,Jazz",
  country: "France",
  countrycode: "FR",
  state: "Paris",
  language: "french",
  votes: 25123,
  codec: "AAC",
  bitrate: 192,
  hls: 0,
  lastcheckok: 1,
  clickcount: 3123,
  clicktrend: 12,
};
const soma: Station = {
  ...fip,
  stationuuid: "9608b51d",
  name: "SomaFM Groove Salad",
  tags: "ambient,chillout,electronic",
  votes: 9000,
  codec: "MP3",
  bitrate: 128,
};
const fipJazz: Station = { ...fip, stationuuid: "fip-jazz", name: "FIP Jazz", votes: 3000 };

Deno.test("players", () => {
  assertEquals(playerChoice("auto"), ["mpv", "ffplay", "vlc"]);
  assertEquals(playerChoice(" MPV "), ["mpv"]);
  assertEquals(playerChoice("cvlc"), ["vlc"]);
  assertEquals(playerChoice(undefined), ["mpv", "ffplay", "vlc"]);
  assertEquals(program("vlc"), "cvlc");
  assertEquals(
    playerArgs("mpv", "http://s/x.aac", { script: "/h/.cache/backslash/radio/now-playing.lua", title: "FIP" }),
    [
      "mpv",
      "--no-video",
      "--no-terminal",
      "--idle=no",
      "--cache=yes",
      "--demuxer-max-bytes=4MiB",
      "--script=/h/.cache/backslash/radio/now-playing.lua",
      "--title=FIP",
      "http://s/x.aac",
    ],
  );
  assertEquals(playerArgs("ffplay", "http://s"), ["ffplay", "-nodisp", "-autoexit", "-loglevel", "error", "http://s"]);
  assertEquals(playerArgs("vlc", "http://s").slice(0, 3), ["cvlc", "--intf", "dummy"]);
  assertEquals(unitArgs("backslash-radio", "Backslash Radio: FIP", ["mpv", "u"]), [
    "--user",
    "--quiet",
    "--collect",
    "--unit=backslash-radio",
    "--description=Backslash Radio: FIP",
    "mpv",
    "u",
  ]);
});

Deno.test("song title script", () => {
  const lua = songScript('/home/a "b"/.cache/backslash/radio/song.txt');
  assertStringIncludes(lua, 'local out = "/home/a \\"b\\"/.cache/backslash/radio/song.txt"');
  assertStringIncludes(lua, 'mp.observe_property("metadata", "native", save)');
  assertEquals(songTitle("Bonobo - Kerala\n"), "Bonobo - Kerala");
  assertEquals(songTitle(" - "), undefined);
  assertEquals(songTitle(""), undefined);
  assertEquals(songTitle(undefined), undefined);
});

Deno.test("stations", () => {
  assertEquals(tags(fip), ["eclectic", "jazz", "france", "public radio"]);
  assertEquals(tags({ tags: "" }), []);
  assertEquals(quality(fip), "AAC · 192 kbps");
  assertEquals(quality({ codec: "UNKNOWN", bitrate: 0, hls: 1 }), "HLS");
  assertEquals(quality({ codec: "MP3" }), "MP3");
  assertEquals(genreColor(fip), "purple");
  assertEquals(genreColor(soma), "pink");
  assertEquals(genreColor({ tags: "news,talk" }), "blue");
  assertEquals(genreColor({ tags: "" }), "gray");
  assertEquals(countryParams("fr"), { countrycode: "FR" });
  assertEquals(countryParams("Japan"), { country: "Japan" });
});

Deno.test("merging name and tag results", () => {
  assertEquals(mergeResults([fipJazz, fip], [soma, fip], "fip").map((s) => s.name), [
    "FIP",
    "FIP Jazz",
    "SomaFM Groove Salad",
  ]);
  assertEquals(mergeResults([], [soma, fipJazz], "jazz").map((s) => s.name), ["FIP Jazz", "SomaFM Groove Salad"]);
});

Deno.test("install hints", () => {
  assertEquals(osFamily('NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n'), "debian");
  assertEquals(osFamily("ID=fedora\n"), "fedora");
  assertEquals(osFamily('ID="opensuse-tumbleweed"\n'), "suse");
  assertEquals(osFamily("ID=endeavouros\nID_LIKE=arch\n"), "arch");
  assertEquals(osFamily("ID=nixos\n"), undefined);
  assertEquals(installCommand("arch"), "sudo pacman -S mpv");
  assertEquals(installCommand(undefined), "Install mpv with your package manager");
  assertEquals(noPlayerItem("fedora").subtitle, "sudo dnf install mpv");
});

Deno.test("formatting", () => {
  assertEquals(elapsed(20_000), "just started");
  assertEquals(elapsed(25 * 60_000), "25 min");
  assertEquals(elapsed(65 * 60_000), "1 h 05");
});

Deno.test("station items", () => {
  const item = stationItem(fip, { favorite: true, playing: false, choices: ["mpv"] });
  assertEquals(item.title, "FIP");
  assertEquals(item.subtitle, "eclectic, jazz, france");
  assertEquals(item.icon, { source: "bs-radio", tint: "purple" });
  assertEquals(item.accessories?.map((a) => a.text ?? a.tag ?? a.tooltip), [
    "In your favorites",
    "AAC · 192 kbps",
    "FR",
  ]);
  assertEquals(item.actions?.map((a) => a.title), [
    "Play",
    "Remove from Favorites",
    "Open Website",
    "Copy Stream URL",
    "Copy Name",
  ]);
  const playing = stationItem(fip, { favorite: false, playing: true, choices: ["mpv"], section: "Top Voted" });
  assertEquals(playing.icon, { source: "bs-speaker", tint: "green" });
  assertEquals(playing.actions?.[0].title, "Stop");

  const now = nowPlayingItem({ station: fip, player: "mpv", started: Date.now() - 3 * 60_000 }, "Bonobo - Kerala");
  assertEquals([now.title, now.subtitle], ["Bonobo - Kerala", "FIP"]);
  assertEquals(now.accessories?.[0].text, "3 min");
  assertEquals(now.actions?.map((a) => a.title), [
    "Stop",
    "Copy Song Title",
    "Search on YouTube",
    "Open Station Website",
  ]);
  const quiet = nowPlayingItem({ station: fip, player: "ffplay", started: Date.now() }, undefined);
  assertEquals([quiet.title, quiet.subtitle], ["FIP", "Playing with ffplay"]);
});
