import { type Context, Icons, type Item, list } from "@backslash/api";
import { type Account, apiKey, guarded, search, trending, videos } from "../api.ts";
import { normalizeRegion, videoIdFrom } from "../lib.ts";
import { nowPlaying } from "../player.ts";
import { nowPlayingItem, type Options, videoItem } from "../views.ts";

export default (ctx: Context) => {
  const region = normalizeRegion(ctx.preferences.region);
  const enter = String(ctx.preferences.enter ?? "").trim().toLowerCase() === "mpv" ? "mpv" : "browser";
  return list({
    placeholder: "Search YouTube, or paste a video link…",
    empty: { title: "No video found", description: "Try other words", icon: Icons.video },
    status: (items) => {
      if (items[0]?.id === "setup") return "Not connected";
      if (items[0]?.id === "quota") return "Quota used up";
      const n = items.filter((i) => i.id !== "now-playing").length;
      return `${n} video${n === 1 ? "" : "s"} · ${region} · YouTube Data API`;
    },
    search: (query, { signal }) =>
      guarded(async (): Promise<Item[]> => {
        const account: Account = { key: apiKey(ctx.preferences), region };
        const current = await nowPlaying();
        const o: Options = { account, enter, playing: current?.video.id };
        const pasted = videoIdFrom(query);
        if (pasted) return (await videos(account, [pasted], signal)).map((v) => videoItem(v, o));
        if (query.trim()) return (await search(account, query, signal)).map((v) => videoItem(v, o));
        return [
          ...(current ? [nowPlayingItem(current)] : []),
          ...(await trending(account, signal)).map((v) => videoItem(v, { ...o, section: `Trending in ${region}` })),
        ];
      }),
  });
};
