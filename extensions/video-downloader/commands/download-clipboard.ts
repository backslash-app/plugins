import { run } from "@backslash/api";
import { describeChoice, parseQuality, tilde } from "../lib.ts";
import { clipboardUrl, HOME, info, prefs, start, tools } from "../system.ts";

// Downloads the copied link right away in the quality of the preferences.
export default run(async (ctx) => {
  const p = prefs(ctx);
  const t = await tools();
  if (!t.ytdlp) throw new Error("yt-dlp is not installed: open Download Video to see how to install it");
  const url = (ctx.query.trim().match(/^https?:\/\/\S+/) ?? [])[0] ?? await clipboardUrl();
  if (!url) throw new Error("Copy a video's link first");
  const choice = parseQuality(p.quality);
  const i = await info(url, p);
  await start(
    {
      url: i.url,
      title: i.playlist?.title ?? i.title,
      uploader: i.uploader,
      thumbnail: i.thumbnail,
      duration: i.duration,
      playlist: !!i.playlist,
    },
    choice,
    p,
  );
  const folder = choice.kind === "audio" ? p.audioFolder : p.folder;
  return `Downloading “${i.title}” (${describeChoice(choice)}) to ${tilde(folder, HOME)}`;
});
