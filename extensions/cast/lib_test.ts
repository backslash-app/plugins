import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  castArgs,
  cattError,
  describeMedia,
  type Device,
  deviceId,
  fileMedia,
  findUrl,
  formatTime,
  go2tvArgs,
  go2tvScript,
  isYoutube,
  parseClock,
  parseFileList,
  parseGo2tv,
  parseScan,
  parseStatus,
  statusText,
  subtitleFor,
  urlMedia,
} from "./lib.ts";

const SCAN = `Scanning Chromecasts...
192.168.1.20 - Living Room TV - Google Inc. Chromecast Ultra
192.168.1.31 - Kitchen speaker - Google Inc. Google Nest Mini
192.168.1.20 - Living Room TV - Google Inc. Chromecast Ultra
`;

const SCAN_JSON = JSON.stringify({
  "Living Room TV": {
    ip: "192.168.1.20",
    port: 8009,
    manufacturer: "Google Inc.",
    model_name: "Chromecast Ultra",
    uuid: "f7d6e2a4-0b5c-4d8b-9f1e-0123456789ab",
    cast_type: "cast",
  },
  Bedroom: { ip: "192.168.1.44", manufacturer: "Unknown manufacturer", model_name: "Google TV Streamer" },
});

const GO2TV = `Device 1
--------
Model: [TV] Samsung Q60 Series (55)
URL:   http://192.168.1.50:9197/dmr

Device 2
--------
Model: Kodi (kodi)
URL:   http://192.168.1.60:1515/
`;

Deno.test("catt scan: text lines, duplicates dropped", () => {
  assertEquals(parseScan(SCAN), [
    { kind: "chromecast", ip: "192.168.1.20", name: "Living Room TV", model: "Google Inc. Chromecast Ultra" },
    { kind: "chromecast", ip: "192.168.1.31", name: "Kitchen speaker", model: "Google Inc. Google Nest Mini" },
  ]);
  assertEquals(parseScan("Scanning Chromecasts...\n"), []);
  assertEquals(parseScan("Error: No devices found"), []);
});

Deno.test("catt scan -j: devices keyed by name", () => {
  assertEquals(parseScan(SCAN_JSON), [
    { kind: "chromecast", name: "Living Room TV", ip: "192.168.1.20", model: "Google Inc. Chromecast Ultra" },
    { kind: "chromecast", name: "Bedroom", ip: "192.168.1.44", model: "Unknown manufacturer Google TV Streamer" },
  ]);
});

Deno.test("go2tv -l: model and URL blocks", () => {
  assertEquals(parseGo2tv(GO2TV), [
    { kind: "dlna", name: "[TV] Samsung Q60 Series (55)", url: "http://192.168.1.50:9197/dmr", model: "DLNA" },
    { kind: "dlna", name: "Kodi (kodi)", url: "http://192.168.1.60:1515/", model: "DLNA" },
  ]);
  assertEquals(parseGo2tv("No available Media Renderers"), []);
});

Deno.test("catt status: playing, with time, volume and mute", () => {
  const st = parseStatus(`Title: Never Gonna Give You Up
Time: 0:01:23 / 0:03:33 (39%)
State: PLAYING
Volume: 50
Volume muted: False`);
  assertEquals(st, {
    idle: false,
    title: "Never Gonna Give You Up",
    position: 83,
    duration: 213,
    state: "PLAYING",
    volume: 50,
    muted: false,
    app: undefined,
  });
  assertEquals(statusText(st), "Playing · 1:23 / 3:33");
});

Deno.test("catt status: paused live stream, idle, info keys", () => {
  const paused = parseStatus("Title: Live news\nTime: 1:02:03\nState: PAUSED\nVolume: 20\nVolume muted: True");
  assertEquals(statusText(paused), "Paused · 1:02:03");
  assertEquals(paused.muted, true);
  const idle = parseStatus("State: IDLE\nVolume: 35");
  assert(idle.idle);
  assertEquals(statusText(idle), "Idle");
  const info = parseStatus(`title: Song
current_time: 12.5
duration: 200.0
player_state: BUFFERING
volume_level: 0.4
volume_muted: False
display_name: Default Media Receiver`);
  assertEquals([info.position, info.duration, info.volume, info.app], [12.5, 200, 40, "Default Media Receiver"]);
  assertEquals(statusText(info), "Loading · 0:12 / 3:20");
});

Deno.test("clock times", () => {
  assertEquals(parseClock("0:01:23"), 83);
  assertEquals(parseClock("4:05"), 245);
  assertEquals(parseClock("83.5"), 83.5);
  assertEquals(parseClock("soon"), undefined);
  assertEquals(formatTime(3723), "1:02:03");
  assertEquals(formatTime(59.9), "0:59");
});

Deno.test("catt errors as sentences", () => {
  assertEquals(cattError("catt exited with 1: Error: No devices found"), "No Chromecast found on your network");
  assertEquals(cattError("Error: Specified device not found."), "The device isn't answering: is it on?");
  assertEquals(cattError("Error: Nothing is currently playing."), "Nothing is playing on this device");
  assertStringIncludes(cattError("Error: Remote resource not found."), "can't be cast");
  assertEquals(cattError("Error: Something else."), "Something else.");
});

Deno.test("what was copied: files from the file manager, links", () => {
  assertEquals(
    parseFileList("copy\nfile:///home/me/Videos/My%20Movie.mkv\nfile://otherhost/x.mp4\n", "/home/me"),
    ["/home/me/Videos/My Movie.mkv"],
  );
  assertEquals(parseFileList("~/Music/a.mp3", "/home/me"), ["/home/me/Music/a.mp3"]);
  assertEquals(fileMedia("/x/Song.FLAC"), { kind: "file", path: "/x/Song.FLAC", type: "audio" });
  assertEquals(fileMedia("/x/notes.txt"), undefined);
  assertEquals(findUrl("look: https://youtu.be/dQw4w9WgXcQ."), "https://youtu.be/dQw4w9WgXcQ");
  assert(isYoutube("https://music.youtube.com/watch?v=1"));
  assert(!isYoutube("https://vimeo.com/1"));
  assertEquals(urlMedia("https://cdn.example.com/clip.mp4?x=1"), {
    kind: "url",
    url: "https://cdn.example.com/clip.mp4?x=1",
    youtube: false,
    direct: true,
  });
  assertEquals(describeMedia(urlMedia("https://www.youtube.com/watch?v=1")).subtitle, "YouTube video");
  assertEquals(describeMedia({ kind: "file", path: "/a/b.jpg", type: "image" }), {
    title: "b.jpg",
    subtitle: "Copied picture",
  });
});

Deno.test("subtitles next to a video", () => {
  assertEquals(subtitleFor("/v/Movie.mkv", ["Movie.mkv", "Movie.en.srt", "Movie.srt", "Other.srt"]), "/v/Movie.srt");
  assertEquals(subtitleFor("/v/Movie.mkv", ["Movie.fr.vtt"]), "/v/Movie.fr.vtt");
  assertEquals(subtitleFor("/v/Movie.mkv", ["Movie.nfo"]), undefined);
});

const tv: Device = { kind: "chromecast", name: "Living Room TV", ip: "192.168.1.20" };
const samsung: Device = { kind: "dlna", name: "Samsung", url: "http://192.168.1.50:9197/dmr" };

Deno.test("catt and go2tv command lines", () => {
  assertEquals(castArgs(tv, urlMedia("https://youtu.be/x")), ["-d", "192.168.1.20", "cast", "https://youtu.be/x"]);
  assertEquals(
    castArgs({ kind: "chromecast", name: "Den" }, { kind: "file", path: "/v/a.mkv", type: "video" }, {
      subtitles: "/v/a.srt",
    }),
    [
      "-d",
      "Den",
      "cast",
      "-s",
      "/v/a.srt",
      "/v/a.mkv",
    ],
  );
  assertEquals(castArgs(tv, urlMedia("https://example.com"), { site: true }), [
    "-d",
    "192.168.1.20",
    "cast_site",
    "https://example.com",
  ]);
  assertEquals(go2tvArgs(samsung, { kind: "file", path: "/v/a.mp4", type: "video" }, "/v/a.srt"), [
    "-t",
    "http://192.168.1.50:9197/dmr",
    "-v",
    "/v/a.mp4",
    "-s",
    "/v/a.srt",
  ]);
  assertEquals(go2tvArgs(samsung, urlMedia("https://x/y.mp4")), [
    "-t",
    "http://192.168.1.50:9197/dmr",
    "-u",
    "https://x/y.mp4",
  ]);
  const script = go2tvScript(["-v", "/v/it's.mp4"]);
  assertStringIncludes(script, "exec script -qfec ");
  assertStringIncludes(script, `exec 'go2tv' '-v' '/v/it'\\''s.mp4'`);
  assertEquals(deviceId(tv), "chromecast:Living Room TV");
  assertEquals(deviceId(samsung), "dlna:http://192.168.1.50:9197/dmr");
});
