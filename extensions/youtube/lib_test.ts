import { assertEquals } from "@std/assert";
import {
  ago,
  apiError,
  type ApiVideo,
  clock,
  decode,
  excerpt,
  fromApi,
  installCommand,
  mpvArgs,
  normalizeRegion,
  parseDuration,
  searchIds,
  thumbnail,
  unitArgs,
  uploadsPlaylist,
  videoIdFrom,
  views,
} from "./lib.ts";
import { videoItem } from "./views.ts";

// Shaped like `videos.list?part=snippet,contentDetails,statistics`.
const rick: ApiVideo = {
  id: "dQw4w9WgXcQ",
  snippet: {
    publishedAt: "2009-10-25T06:57:33Z",
    channelId: "UCuAXFkgsw1L7xaCfnd5JJOw",
    title: "Rick Astley - Never Gonna Give You Up (Official Music Video)",
    description: "The official video for “Never Gonna Give You Up”\n\n#RickAstley #NeverGonnaGiveYouUp",
    channelTitle: "Rick Astley",
    tags: ["rick astley", "never gonna give you up"],
    liveBroadcastContent: "none",
  },
  contentDetails: { duration: "PT3M33S", definition: "hd", caption: "true" },
  statistics: { viewCount: "1612345678", likeCount: "18000000", commentCount: "2400000" },
};
const live: ApiVideo = {
  id: "jfKfPfyJRdk",
  snippet: { title: "lofi hip hop radio", channelTitle: "Lofi Girl", liveBroadcastContent: "live" },
  contentDetails: { duration: "P0D" },
  statistics: { viewCount: "90000000" },
};

const account = { key: "k", region: "US" };

Deno.test("durations", () => {
  assertEquals(parseDuration("PT3M33S"), 213);
  assertEquals(parseDuration("PT1H2M3S"), 3723);
  assertEquals(parseDuration("PT45S"), 45);
  assertEquals(parseDuration("P1DT2H"), 93600);
  assertEquals(parseDuration("P0D"), undefined);
  assertEquals(parseDuration("garbage"), undefined);
  assertEquals(clock(213), "3:33");
  assertEquals(clock(3723), "1:02:03");
  assertEquals(clock(19), "0:19");
  assertEquals(clock(undefined), undefined);
});

Deno.test("videos", () => {
  const v = fromApi(rick);
  assertEquals(v.seconds, 213);
  assertEquals(v.views, 1612345678);
  assertEquals(v.hd, true);
  assertEquals(v.captions, true);
  const l = fromApi(live);
  assertEquals(l.live, "live");
  assertEquals(l.seconds, undefined);
  assertEquals(l.likes, undefined);
  assertEquals(decode("Rock &amp; Roll &#39;n&#x27; &quot;Soul&quot;"), `Rock & Roll 'n' "Soul"`);
  assertEquals(
    searchIds([
      { id: { kind: "youtube#video", videoId: "a" } },
      { id: { kind: "youtube#channel" } },
      { id: { videoId: "a" } },
      { id: { videoId: "b" } },
    ]),
    ["a", "b"],
  );
  assertEquals(uploadsPlaylist("UCuAXFkgsw1L7xaCfnd5JJOw"), "UUuAXFkgsw1L7xaCfnd5JJOw");
});

Deno.test("links", () => {
  assertEquals(videoIdFrom("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s"), "dQw4w9WgXcQ");
  assertEquals(videoIdFrom("https://www.youtube.com/watch?list=PL1&v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(videoIdFrom("youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assertEquals(videoIdFrom("https://youtube.com/shorts/abcdefghijk"), "abcdefghijk");
  assertEquals(videoIdFrom("never gonna give you up"), undefined);
  assertEquals(thumbnail("dQw4w9WgXcQ", "hqdefault"), "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
});

Deno.test("formatting", () => {
  const now = Date.parse("2026-10-28T10:00:00Z");
  assertEquals(ago("2026-10-28T07:00:00Z", now), "3 hours ago");
  assertEquals(ago("2026-10-27T09:00:00Z", now), "1 day ago");
  assertEquals(ago("2026-10-10T09:00:00Z", now), "2 weeks ago");
  assertEquals(ago("2009-10-25T06:57:33Z", now), "17 years ago");
  assertEquals(ago(undefined, now), undefined);
  assertEquals(views(1), "1 view");
  assertEquals(views(1612345678), "1.6B views");
  assertEquals(excerpt("Line one\n#tag #other\n\n\n\nLine two"), "Line one\n\nLine two");
  assertEquals(excerpt("a".repeat(700))?.length, 601);
  assertEquals(normalizeRegion("fr"), "FR");
  assertEquals(normalizeRegion("France"), "US");
});

Deno.test("API errors", () => {
  assertEquals(
    apiError(400, {
      error: { message: "API key not valid. Please pass a valid API key.", errors: [{ reason: "badRequest" }] },
    }),
    { message: "Google rejected the API key", auth: true },
  );
  assertEquals(apiError(403, { error: { errors: [{ reason: "quotaExceeded" }] } }).quota, true);
  assertEquals(
    apiError(403, {
      error: {
        message: "YouTube Data API v3 has not been used in project 1",
        errors: [{ reason: "accessNotConfigured" }],
      },
    })
      .auth,
    true,
  );
  assertEquals(apiError(500, undefined), { message: "YouTube answered 500", auth: false });
});

Deno.test("mpv", () => {
  assertEquals(mpvArgs("https://www.youtube.com/watch?v=x", { audioOnly: true }), [
    "mpv",
    "--no-terminal",
    "--no-video",
    "--ytdl-format=bestaudio/best",
    "https://www.youtube.com/watch?v=x",
  ]);
  assertEquals(mpvArgs("u", { title: "T" })[2], "--force-window=immediate");
  assertEquals(
    unitArgs("backslash-youtube", "Backslash YouTube: T", { WAYLAND_DISPLAY: "wayland-1", DISPLAY: undefined }, [
      "mpv",
      "u",
    ]),
    [
      "--user",
      "--quiet",
      "--collect",
      "--unit=backslash-youtube",
      "--description=Backslash YouTube: T",
      "--setenv=WAYLAND_DISPLAY=wayland-1",
      "mpv",
      "u",
    ],
  );
  assertEquals(installCommand("debian", ["mpv", "yt-dlp"]), "sudo apt install mpv yt-dlp");
  assertEquals(installCommand(undefined, ["yt-dlp"]), "Install yt-dlp");
});

Deno.test("video item", () => {
  const item = videoItem(fromApi(rick), { account, enter: "browser" });
  assertEquals(item.icon, "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg");
  assertEquals(item.detail?.image, "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg");
  assertEquals(item.accessories?.map((a) => a.text), ["1.6B", "3:33"]);
  assertEquals(item.detail?.stats?.map((s) => s.value), ["1.6B", "3:33", "18M"]);
  assertEquals(item.actions?.slice(0, 4).map((a) => a.title), [
    "Open in Browser",
    "Play in mpv",
    "Play Audio Only in mpv",
    "Show Rick Astley Videos",
  ]);
  const mpvFirst = videoItem(fromApi(live), { account, enter: "mpv", playing: "jfKfPfyJRdk" });
  assertEquals(mpvFirst.actions?.[0].title, "Play in mpv");
  assertEquals(mpvFirst.accessories?.map((a) => a.tag ?? a.text), ["Playing", "LIVE", "90M"]);
});
