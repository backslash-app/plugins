import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  audioExtension,
  channelsName,
  codecName,
  eta,
  formatDuration,
  freePath,
  jobFraction,
  jobScript,
  lastError,
  type MediaInfo,
  outputFor,
  parseFileList,
  parseProbe,
  parseProgress,
  parseTime,
  plan,
  resolutionName,
  targetBitrate,
  trimRange,
  unavailable,
} from "./lib.ts";

const PROBE = JSON.stringify({
  streams: [
    {
      index: 0,
      codec_name: "h264",
      codec_type: "video",
      width: 1920,
      height: 1080,
      pix_fmt: "yuv420p",
      r_frame_rate: "30000/1001",
      avg_frame_rate: "30000/1001",
      bit_rate: "4800000",
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: "und" },
    },
    {
      index: 1,
      codec_name: "aac",
      codec_type: "audio",
      sample_rate: "48000",
      channels: 2,
      channel_layout: "stereo",
      bit_rate: "160000",
      disposition: { default: 1, attached_pic: 0 },
      tags: { language: "fra" },
    },
    { index: 2, codec_name: "mov_text", codec_type: "subtitle", disposition: {} },
  ],
  format: {
    filename: "clip.mp4",
    nb_streams: 3,
    format_name: "mov,mp4,m4a,3gp,3g2,mj2",
    format_long_name: "QuickTime / MOV",
    duration: "125.458000",
    size: "78123456",
    bit_rate: "4981234",
    tags: { title: "Vacances", major_brand: "isom" },
  },
});

const SONG = JSON.stringify({
  streams: [
    { codec_name: "mp3", codec_type: "audio", sample_rate: "44100", channels: 2, bit_rate: "320000" },
    { codec_name: "mjpeg", codec_type: "video", width: 600, height: 600, disposition: { attached_pic: 1 } },
  ],
  format: { duration: "201.5", format_long_name: "MP2/3 (MPEG audio layer 2/3)", tags: { ARTIST: "Daft Punk" } },
});

Deno.test("ffprobe: a video", () => {
  const i = parseProbe(PROBE);
  assertEquals(i.duration, 125.458);
  assertEquals(i.video, { codec: "h264", width: 1920, height: 1080, fps: 29.97, bitrate: 4800000, pixFmt: "yuv420p" });
  assertEquals(i.audio?.codec, "aac");
  assertEquals(i.audio?.language, "fra");
  assertEquals(i.audio?.sampleRate, 48000);
  assertEquals(i.subtitles, 1);
  assertEquals(i.title, "Vacances");
  assertEquals(i.container, "QuickTime / MOV");
  assertEquals(resolutionName(i.video!.width, i.video!.height), "1080p");
});

Deno.test("ffprobe: a song with album art", () => {
  const i = parseProbe(SONG);
  assertEquals(i.video, undefined);
  assertEquals(i.cover, true);
  assertEquals(i.artist, "Daft Punk");
  assertEquals(i.audioTracks, 1);
  assertEquals(unavailable({ kind: "mp4" }, i), "There is no video in it");
  assertEquals(unavailable({ kind: "audio", format: "opus" }, i), undefined);
  assertThrows(() => parseProbe("not json"), Error, "unexpected");
});

Deno.test("ffprobe: a portrait phone video", () => {
  const i = parseProbe(JSON.stringify({
    streams: [{
      codec_type: "video",
      codec_name: "hevc",
      width: 1920,
      height: 1080,
      side_data_list: [{ side_data_type: "Display Matrix", rotation: -90 }],
    }],
    format: { duration: "10" },
  }));
  assertEquals([i.video?.width, i.video?.height], [1080, 1920]);
  assertEquals(resolutionName(1080, 1920), "1080p");
  assertEquals(resolutionName(3840, 2160), "4K");
  assertEquals(resolutionName(640, 360), "360p");
});

Deno.test("names", () => {
  assertEquals(codecName("hevc"), "H.265 (HEVC)");
  assertEquals(codecName("pcm_s16le"), "PCM");
  assertEquals(codecName("dnxhd"), "DNXHD");
  assertEquals(channelsName(2), "stereo");
  assertEquals(channelsName(6, "5.1(side)"), "5.1");
});

Deno.test("times", () => {
  assertEquals(parseTime("83.5"), 83.5);
  assertEquals(parseTime("1:23"), 83);
  assertEquals(parseTime("01:02:03.250"), 3723.25);
  assertEquals(parseTime("1m30s"), 90);
  assertEquals(parseTime("2h"), 7200);
  assertEquals(parseTime("1,5"), 1.5);
  assertThrows(() => parseTime("1:75"), Error, "isn't a time");
  assertThrows(() => parseTime("soon"), Error, "isn't a time");
  assertThrows(() => parseTime(""), Error, "Type a time");
  assertEquals(formatDuration(83.5), "1:24");
  assertEquals(formatDuration(3725), "1:02:05");
  assertEquals(formatDuration(5), "0:05");
});

Deno.test("trim range", () => {
  assertEquals(trimRange("0:10", "0:20", 60), { start: 10, end: 20 });
  assertEquals(trimRange("", "", 60), { start: 0, end: 60 });
  assertEquals(trimRange("50", "60.3", 60), { start: 50, end: 60 });
  assertThrows(() => trimRange("0:20", "0:10", 60), Error, "after the start");
  assertThrows(() => trimRange("0", "2:00", 60), Error, "only 1:00 long");
  assertThrows(() => trimRange("0", "", undefined), Error, "Type where it ends");
});

Deno.test("target size bitrates", () => {
  // 8 MiB over 60 s: 8 × 8388.608 × 0.96 / 60 = 1073 kb/s, 96 for the audio.
  assertEquals(targetBitrate(8, 60, { audio: true, height: 1080 }), { videoKbps: 977, audioKbps: 96, height: 720 });
  // 50 MiB over 2 min: plenty, 128 kb/s audio and the full size.
  const big = targetBitrate(50, 120, { audio: true, height: 1080 });
  assertEquals(big.audioKbps, 128);
  assertEquals(big.videoKbps, 3227);
  assertEquals(big.height, undefined);
  // No audio track: everything goes to the video.
  assertEquals(targetBitrate(25, 100, { audio: false }).videoKbps, 2013);
  // Starved: down to 480p.
  assertEquals(targetBitrate(8, 180, { audio: true, height: 1080 }).height, 480);
  assertThrows(() => targetBitrate(8, 3600, { audio: true }), Error, "too small for 1:00:00");
  assertThrows(() => targetBitrate(8, 0), Error, "unknown");
});

const INFO: MediaInfo = parseProbe(PROBE);

Deno.test("outputs never reuse the input name", () => {
  assertEquals(outputFor({ kind: "mp4" }, "/v/clip.mkv"), { suffix: "", ext: "mp4" });
  assertEquals(outputFor({ kind: "mp4" }, "/v/clip.mp4"), { suffix: "-h264", ext: "mp4" });
  assertEquals(outputFor({ kind: "extract" }, "/v/clip.mp4", INFO), { suffix: "", ext: "m4a" });
  assertEquals(outputFor({ kind: "trim", start: 65, end: 90, exact: false }, "/v/clip.mp4"), {
    suffix: "-105-130",
    ext: "mp4",
  });
  assertEquals(outputFor({ kind: "target", mb: 8 }, "/v/clip.mov").suffix, "-8mb");
  assertEquals(audioExtension("opus"), "opus");
  assertEquals(audioExtension("pcm_s24le"), "wav");
  assertEquals(audioExtension("dts"), "mka");
  const taken = new Set(["/v/clip.mp4", "/v/clip-2.mp4"]);
  assertEquals(freePath("/v", "clip", "mp4", (p) => taken.has(p)), "/v/clip-3.mp4");
});

Deno.test("ffmpeg command lines", () => {
  const [mp4] = plan({ kind: "mp4" }, "/v/a.mkv", "/v/a.mp4", INFO, "/tmp/j");
  assertEquals(mp4.args.slice(0, 3), ["-n", "-i", "/v/a.mkv"]);
  assert(mp4.args.includes("libx264") && mp4.args.includes("aac") && mp4.args.includes("+faststart"));
  assertEquals(mp4.args.at(-1), "/v/a.mp4");

  const gif = plan({ kind: "gif", width: 480, fps: 12 }, "/v/a.mp4", "/v/a.gif", INFO, "/tmp/j");
  assertEquals(gif.length, 2);
  assertEquals(gif[0].args.at(-1), "/tmp/j/palette.png");
  assert(gif[0].args.join(" ").includes("palettegen"));
  assert(gif[1].args.join(" ").includes("[x][1:v]paletteuse"));
  assertEquals(gif[1].args.slice(-3), ["-loop", "0", "/v/a.gif"]);

  const target = plan({ kind: "target", mb: 25 }, "/v/a.mp4", "/v/a-25mb.mp4", INFO, "/tmp/j");
  assertEquals(target.map((s) => s.weight), [0.4, 0.6]);
  assertEquals(target[0].args.slice(-4), ["-an", "-f", "null", "/dev/null"]);
  assert(target[0].args.includes("-y"));
  assert(target[1].args.includes("-n"));
  assertEquals(target[1].args[target[1].args.indexOf("-b:v") + 1], "1476k");
  assertEquals(target[1].args[target[1].args.indexOf("-passlogfile") + 1], "/tmp/j/pass");

  const [fast] = plan({ kind: "trim", start: 10, end: 25.5, exact: false }, "/v/a.mp4", "/v/o.mp4", INFO, "/t");
  assertEquals(fast.args.slice(0, 7), ["-n", "-ss", "10", "-i", "/v/a.mp4", "-t", "15.5"]);
  assert(fast.args.includes("copy"));
  const [exact] = plan({ kind: "trim", start: 10, end: 20, exact: true }, "/v/a.mp4", "/v/o.mp4", INFO, "/t");
  assert(!exact.args.includes("copy"));

  const [resize] = plan({ kind: "resize", height: 720 }, "/v/a.mp4", "/v/a-720p.mp4", INFO, "/t");
  assert(resize.args.includes("scale=-2:720"));
  const [mute] = plan({ kind: "mute" }, "/v/a.mp4", "/v/a-muted.mp4", INFO, "/t");
  assertEquals(mute.args.slice(3), ["-map", "0", "-map", "-0:a", "-c", "copy", "/v/a-muted.mp4"]);
  const [opus] = plan({ kind: "audio", format: "opus" }, "/v/a.mp4", "/v/a.opus", INFO, "/t");
  assert(opus.args.includes("libopus") && opus.args.includes("-vn"));
  assertEquals(unavailable({ kind: "resize", height: 1080 }, INFO), "It is already 1080p or smaller");
  assertEquals(unavailable({ kind: "resize", height: 720 }, INFO), undefined);
});

Deno.test("background script", () => {
  const steps = plan({ kind: "gif", width: 320, fps: 10 }, "/v/My clip.mp4", "/v/My clip.gif", INFO, "/c/j1");
  const script = jobScript(steps, "/c/j1", "/v/My clip.gif");
  assert(script.startsWith("if [ -e '/v/My clip.gif' ]; then echo 17 > /c/j1/status; exit 0; fi; ffmpeg -hide_banner"));
  assert(script.includes("-progress /c/j1/progress-0") && script.includes("-progress /c/j1/progress-1"));
  assert(script.includes(" && ffmpeg "));
  assert(script.includes(`'fps=10,scale='\\''min(320,iw)'\\'':-1:flags=lanczos,palettegen=stats_mode=diff'`));
  assert(script.endsWith(`echo "$code" > /c/j1/status`));
});

const PROGRESS = `frame=40
fps=0.00
out_time_us=1600000
out_time_ms=1600000
out_time=00:00:01.600000
speed=3.2x
progress=continue
frame=75
total_size=41823
out_time_us=2995374
out_time_ms=2995374
speed=13.9x
progress=continue
`;

Deno.test("ffmpeg progress", () => {
  assertEquals(parseProgress(PROGRESS), { time: 2.995374, done: false, speed: 13.9, size: 41823 });
  assertEquals(parseProgress(PROGRESS + "frame=75\nout_time_us=3000000\nspeed=14x\nprogress=end\n")?.done, true);
  assertEquals(parseProgress(""), undefined);
  assertEquals(parseProgress("frame=1\nout_time_us=N/A\nprogress=continue\n")?.time, 0);
  // Two passes over 10 s: the first done, the second halfway.
  const p1 = { time: 10, done: true };
  const p2 = { time: 5, done: false };
  assertEquals(jobFraction([0.4, 0.6], [p1, p2], 10), 0.7);
  assertEquals(jobFraction([0.4, 0.6], [p1, undefined], 10), 0.4);
  assertEquals(jobFraction([1], [{ time: 50, done: false }], 10), 1);
  assertEquals(eta(0.5, 60_000), "about 1 min left");
  assertEquals(eta(0.9, 9_000), "less than a minute left");
  assertEquals(eta(0.01, 1000), undefined);
});

Deno.test("errors from the log", () => {
  assertEquals(
    lastError("[libx264 @ 0x55] frame=1\n[vost#0:0/libx264 @ 0x5] Unknown encoder 'libx264'\n"),
    "Unknown encoder 'libx264'",
  );
  assertEquals(lastError(""), undefined);
});

Deno.test("copied files", () => {
  assertEquals(parseFileList("file:///home/ada/Vid%C3%A9os/clip%201.mkv\r\n"), ["/home/ada/Vidéos/clip 1.mkv"]);
});
