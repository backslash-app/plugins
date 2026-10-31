import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  cookiesBrowser,
  describeChoice,
  expandHome,
  findUrl,
  formatBytes,
  formatCount,
  formatDuration,
  fraction,
  installMarkdown,
  jobScript,
  lastError,
  options,
  osFamily,
  parseFiles,
  parseInfo,
  parseProgress,
  parseQuality,
  pickThumbnail,
  progressText,
  siteName,
  ytdlpArgs,
  ytdlpError,
} from "./lib.ts";

// Trimmed from `yt-dlp -J --flat-playlist --no-playlist https://www.youtube.com/watch?v=dQw4w9WgXcQ`.
const YOUTUBE = JSON.stringify({
  id: "dQw4w9WgXcQ",
  title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
  formats: [
    { format_id: "sb0", format_note: "storyboard", ext: "mhtml", protocol: "mhtml", vcodec: "none", acodec: "none" },
    { format_id: "139", ext: "m4a", acodec: "mp4a.40.5", vcodec: "none", abr: 48.8, filesize: 1290000 },
    { format_id: "140", ext: "m4a", acodec: "mp4a.40.2", vcodec: "none", abr: 129.5, filesize: 3433514 },
    { format_id: "251", ext: "webm", acodec: "opus", vcodec: "none", abr: 135.9, filesize: 3437753 },
    {
      format_id: "18",
      ext: "mp4",
      acodec: "mp4a.40.2",
      vcodec: "avc1.42001E",
      height: 360,
      width: 640,
      tbr: 503.6,
      filesize_approx: 13355555,
    },
    { format_id: "134", ext: "mp4", acodec: "none", vcodec: "avc1.4d401e", height: 360, tbr: 300, filesize: 6000000 },
    { format_id: "136", ext: "mp4", acodec: "none", vcodec: "avc1.4d401f", height: 720, tbr: 1200, filesize: 30000000 },
    { format_id: "247", ext: "webm", acodec: "none", vcodec: "vp9", height: 720, tbr: 1000, filesize: 25000000 },
    { format_id: "137", ext: "mp4", acodec: "none", vcodec: "avc1.640028", height: 1080, fps: 25, tbr: 2400 },
    {
      format_id: "248",
      ext: "webm",
      acodec: "none",
      vcodec: "vp9",
      height: 1080,
      fps: 25,
      tbr: 2000,
      filesize: 55000000,
    },
  ],
  thumbnails: [
    { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", height: 360, width: 480, preference: -7 },
    { url: "https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp", height: 1080, width: 1920, preference: 0 },
    { url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg", height: 720, width: 1280, preference: -1 },
  ],
  thumbnail: "https://i.ytimg.com/vi_webp/dQw4w9WgXcQ/maxresdefault.webp",
  description: "The official video for “Never Gonna Give You Up” by Rick Astley.",
  channel: "Rick Astley",
  uploader: "Rick Astley",
  duration: 213,
  view_count: 1600000000,
  upload_date: "20091025",
  webpage_url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  extractor: "youtube",
  extractor_key: "Youtube",
  is_live: false,
  live_status: "not_live",
  _type: "video",
});

const PLAYLIST = JSON.stringify({
  id: "PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  title: "Learn Python",
  _type: "playlist",
  uploader: "freeCodeCamp.org",
  playlist_count: 12,
  webpage_url: "https://www.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG",
  extractor_key: "YoutubeTab",
  entries: [
    {
      _type: "url",
      id: "rfscVS0vtbw",
      url: "https://www.youtube.com/watch?v=rfscVS0vtbw",
      title: "Learn Python - Full Course for Beginners",
      thumbnails: [{ url: "https://i.ytimg.com/vi/rfscVS0vtbw/hqdefault.jpg", width: 480, height: 270 }],
    },
  ],
});

Deno.test("links in copied text", () => {
  assertEquals(findUrl("watch this https://youtu.be/dQw4w9WgXcQ!"), "https://youtu.be/dQw4w9WgXcQ");
  assertEquals(findUrl("(https://vimeo.com/76979871)."), "https://vimeo.com/76979871");
  assertEquals(findUrl("no link here"), undefined);
  assertEquals(findUrl("http://intranet/x"), undefined);
  assertEquals(siteName("https://www.youtube.com/watch?v=1"), "youtube.com");
  assertEquals(siteName("https://music.youtube.com/watch?v=1"), "youtube.com");
});

Deno.test("yt-dlp -J of a video: title, uploader, length, JPEG thumbnail, formats", () => {
  const info = parseInfo(YOUTUBE, "https://youtu.be/dQw4w9WgXcQ");
  assertEquals(info.title, "Rick Astley - Never Gonna Give You Up (Official Music Video)");
  assertEquals(info.uploader, "Rick Astley");
  assertEquals(info.duration, 213);
  assertEquals(info.thumbnail, "https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg");
  assertEquals(info.url, "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
  assertEquals(info.site, "Youtube");
  assertEquals(info.uploadDate, "2009-10-25");
  assertEquals(info.live, false);
  assertEquals(info.playlist, undefined);
  assertEquals(info.formats.length, 9); // the storyboard is dropped
  assertEquals(info.formats.find((f) => f.id === "140")?.vcodec, undefined);
});

Deno.test("qualities with ffmpeg: best, each resolution below, MP3 and M4A with sizes", () => {
  const opts = options(parseInfo(YOUTUBE, ""), true);
  assertEquals(opts.map((o) => o.key), ["best", "720", "360", "mp3", "m4a"]);
  const best = opts[0];
  assertEquals(best.subtitle, "1080p");
  // 137 has no size: its bitrate × length, plus the best audio (251 Opus, 135.9 kbit/s).
  assertEquals(best.size, Math.round(2400 * 1000 / 8 * 213) + 3437753);
  assertEquals(opts.find((o) => o.key === "720")?.size, 30000000 + 3437753);
  assertEquals(opts.find((o) => o.key === "m4a")?.size, 1290000);
});

Deno.test("qualities without ffmpeg: only files with both video and audio, no MP3", () => {
  const opts = options(parseInfo(YOUTUBE, ""), false);
  assertEquals(opts.map((o) => o.key), ["best", "audio"]);
  assertEquals(opts[0].subtitle, "360p (without ffmpeg)");
  assertStringIncludes(opts[1].subtitle, "install ffmpeg");
});

Deno.test("a SoundCloud-like page has audio only", () => {
  const info = parseInfo(
    JSON.stringify({
      id: "1",
      title: "Song",
      uploader: "Artist",
      duration: 200,
      formats: [{ format_id: "hls_mp3_128", ext: "mp3", vcodec: "none", acodec: "mp3", abr: 128 }],
    }),
    "https://soundcloud.com/a/b",
  );
  assertEquals(options(info, true).map((o) => o.key), ["mp3", "m4a"]);
  assertEquals(options(info, true)[0].size, 3_200_000);
});

Deno.test("a site with one file and no formats list", () => {
  const info = parseInfo(
    JSON.stringify({ id: "x", title: "Clip", ext: "mp4", url: "https://cdn/x.mp4", height: 720 }),
    "u",
  );
  assertEquals(info.formats.length, 1);
  assertEquals(options(info, true)[0].key, "best");
});

Deno.test("a playlist: count, title, first entry's thumbnail, two choices", () => {
  const info = parseInfo(PLAYLIST, "");
  assertEquals(info.playlist, { count: 12, title: "Learn Python" });
  assertEquals(info.thumbnail, "https://i.ytimg.com/vi/rfscVS0vtbw/hqdefault.jpg");
  assertEquals(options(info).map((o) => o.title), ["All 12 Videos", "All 12 as MP3"]);
});

Deno.test("thumbnails: the biggest JPEG up to 1280 px, else the main one", () => {
  assertEquals(pickThumbnail({ thumbnail: "https://x/t.webp" }), "https://x/t.webp");
  assertEquals(
    pickThumbnail({ thumbnails: [{ url: "https://x/a.jpg?x=1", width: 100 }, { url: "https://x/b.jpg", width: 300 }] }),
    "https://x/b.jpg",
  );
});

Deno.test("yt-dlp errors as sentences", () => {
  assertEquals(
    ytdlpError("ERROR: Unsupported URL: https://example.com/"),
    "yt-dlp doesn't know how to download from this page",
  );
  assertStringIncludes(
    ytdlpError(
      "WARNING: x\nERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm you’re not a bot. Use --cookies-from-browser",
    ),
    "Use cookies from",
  );
  assertEquals(
    ytdlpError("ERROR: [youtube] abc: Video unavailable. This video has been removed"),
    "This video is unavailable",
  );
  assertEquals(ytdlpError("ERROR: [vimeo] 123: Something odd happened"), "Something odd happened");
  assertEquals(ytdlpError(""), "yt-dlp failed");
  assertEquals(lastError("[download] 50%\nall fine"), undefined);
  assertEquals(
    lastError("ERROR: [generic] Unable to download webpage: timed out"),
    "The site can't be reached: check your connection",
  );
});

Deno.test("preferences: quality and cookies browser", () => {
  assertEquals(parseQuality("1080"), { kind: "video", height: 1080 });
  assertEquals(parseQuality("720p"), { kind: "video", height: 720 });
  assertEquals(parseQuality("4K"), { kind: "video", height: 2160 });
  assertEquals(parseQuality("MP3"), { kind: "audio", format: "mp3" });
  assertEquals(parseQuality("best"), { kind: "video" });
  assertEquals(parseQuality("nonsense"), { kind: "video" });
  assertEquals(describeChoice({ kind: "video", height: 2160 }), "4K");
  assertEquals(describeChoice({ kind: "audio", format: "m4a" }), "M4A");
  assertEquals(cookiesBrowser(" Firefox "), "firefox");
  assertEquals(cookiesBrowser("chrome:Profile 1"), undefined);
  assertEquals(cookiesBrowser("firefox:default-release"), "firefox:default-release");
  assertEquals(cookiesBrowser("rm -rf"), undefined);
});

const plan = {
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  folder: "/home/me/Downloads",
  dir: "/home/me/.cache/backslash/video-downloader/jobs/abc",
  playlist: false,
  compatible: true,
  hasFfmpeg: true,
};

Deno.test("yt-dlp arguments: 1080p MP4 that plays everywhere", () => {
  const args = ytdlpArgs({ ...plan, choice: { kind: "video", height: 1080 } });
  const at = (flag: string) => args[args.indexOf(flag) + 1];
  assertEquals(at("-f"), "bv*+ba/b");
  assertEquals(at("-S"), "res:1080,vcodec:h264,acodec:aac");
  assertEquals(at("--merge-output-format"), "mp4");
  assertEquals(at("-P"), "/home/me/Downloads");
  assertEquals(at("-o"), "%(title).180B [%(id)s].%(ext)s");
  assertEquals(at("--print-to-file"), "after_move:filepath");
  assert(args.includes("--no-playlist"));
  assertEquals(args.slice(-2), ["--", plan.url]);
});

Deno.test("yt-dlp arguments: best without compatibility, without ffmpeg, MP3, M4A, playlist, cookies", () => {
  const best = ytdlpArgs({ ...plan, compatible: false, choice: { kind: "video" } });
  assertEquals(best[best.indexOf("-S") + 1], "res");
  const noFfmpeg = ytdlpArgs({ ...plan, hasFfmpeg: false, choice: { kind: "video", height: 720 } });
  assertEquals(noFfmpeg[noFfmpeg.indexOf("-f") + 1], "b[height<=720]/b");
  assert(!noFfmpeg.includes("--merge-output-format"));
  const mp3 = ytdlpArgs({ ...plan, choice: { kind: "audio", format: "mp3" } });
  assertEquals(mp3.slice(mp3.indexOf("-x"), mp3.indexOf("-x") + 5), [
    "-x",
    "--audio-format",
    "mp3",
    "--audio-quality",
    "0",
  ]);
  assert(mp3.includes("--embed-thumbnail"));
  const m4a = ytdlpArgs({ ...plan, choice: { kind: "audio", format: "m4a" } });
  assertEquals(m4a[m4a.indexOf("-f") + 1], "ba[ext=m4a]/ba/b");
  const list = ytdlpArgs({ ...plan, playlist: true, cookiesFrom: "firefox", choice: { kind: "video", height: 1080 } });
  assert(list.includes("--yes-playlist"));
  assertStringIncludes(list[list.indexOf("-o") + 1], "%(playlist_title|Playlist).100B/");
  assertEquals(list[list.indexOf("--cookies-from-browser") + 1], "firefox");
});

Deno.test("job script: exit code, notification, quoting", () => {
  const script = jobScript(["--", "https://x/?a=1&b='2'"], "/tmp/job", `It's "quoted" $HOME`);
  assertStringIncludes(script, `'yt-dlp' '--' 'https://x/?a=1&b='\\''2'\\'''`);
  assertStringIncludes(script, `echo "$code" > '/tmp/job/status'`);
  assertStringIncludes(
    script,
    `notify-send -a Backslash -i folder-download 'Download finished' 'It'\\''s "quoted" $HOME'`,
  );
  assertStringIncludes(script, `"It's \\"quoted\\" \\$HOME: $msg"`);
});

const LOG = `[youtube] Extracting URL: https://www.youtube.com/watch?v=dQw4w9WgXcQ
[youtube] dQw4w9WgXcQ: Downloading webpage
[info] dQw4w9WgXcQ: Downloading 1 format(s): 137+140
[download] Destination: /home/me/Downloads/Rick Astley [dQw4w9WgXcQ].f137.mp4
[bs] downloading 1048576 63900000 NA 2097152.5 30 NA NA
[bs] finished 63900000 63900000 NA NA NA NA NA
[download] Destination: /home/me/Downloads/Rick Astley [dQw4w9WgXcQ].f140.m4a
[bs] downloading 1716757 NA 3433514 1048576 2 NA NA
`;

Deno.test("progress: bytes, speed, time left, the audio part, merging", () => {
  const p = parseProgress(LOG)!;
  assertEquals(p.part, 2);
  assertEquals(p.total, 3433514);
  assertEquals(fraction(p), 0.5);
  assertEquals(progressText(p), "50 % · 1.0 MB/s · 0:02 left · audio");
  const merging = parseProgress(
    `${LOG}[Merger] Merging formats into "/home/me/Downloads/Rick Astley [dQw4w9WgXcQ].mp4"\n`,
  )!;
  assertEquals(progressText(merging), "Merging video and audio");
  assertEquals(fraction(merging), 1);
  const list = parseProgress("[download] Destination: a\n[bs] downloading 10 100 NA NA NA 3 12\n")!;
  assertEquals(progressText(list), "3/12 · 10 %");
  assertEquals(parseProgress("[youtube] Extracting URL"), undefined);
  assertEquals(progressText(undefined), "Starting…");
});

Deno.test("written files, formatting, folders, install hints", () => {
  assertEquals(parseFiles("/a/b.mp4\n/a/b.mp4\n\n/a/c.mp3\n"), ["/a/b.mp4", "/a/c.mp3"]);
  assertEquals(formatBytes(3433514), "3.3 MB");
  assertEquals(formatDuration(213), "3:33");
  assertEquals(formatDuration(3729), "1:02:09");
  assertEquals(formatCount(1_600_000_000), "1.6B");
  assertEquals(formatCount(12_300), "12.3K");
  assertEquals(expandHome("~/Videos/", "/home/me"), "/home/me/Videos");
  assertEquals(osFamily("ID=fedora\nVERSION_ID=41"), "fedora");
  assertEquals(osFamily('ID=pop\nID_LIKE="ubuntu debian"'), "debian");
  assertStringIncludes(installMarkdown({ ytdlp: true, ffmpeg: false }, "arch"), "sudo pacman -S yt-dlp");
  assertStringIncludes(installMarkdown({ ytdlp: false, ffmpeg: true }, "fedora"), "RPM Fusion");
});
