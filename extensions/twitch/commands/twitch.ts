import { type Context, Icons, type Item, list, updateCommandMetadata } from "@backslash/api";
import {
  avatars,
  distro,
  findTools,
  followedLive,
  searchCategories,
  searchChannels,
  toolFor,
  topCategories,
} from "../api.ts";
import { AuthError, authFrom, channelStream, liveSubtitle, matches, sortStreams } from "../lib.ts";
import { categoryItem, channelItem, type Ctx, noPlayerItem, setupItems, streamItem } from "../views.ts";

type View = "following" | "browse" | "channels";

let status = "";

export default (ctx: Context) => {
  const enter = String(ctx.preferences.enter ?? "").trim().toLowerCase() === "player" ? "player" : "browser";
  const quality = String(ctx.preferences.quality ?? "").trim() || "best";
  return list({
    placeholder: "Filter live channels, or search categories and channels…",
    filter: {
      options: [
        { value: "following", title: "Following" },
        { value: "browse", title: "Categories" },
        { value: "channels", title: "Channels" },
      ],
    },
    empty: { title: "Nothing live", description: "None of the channels you follow is streaming", icon: Icons.video },
    status: () => status,
    async search(query, { signal, filter, preferences }) {
      const view = (filter ?? "following") as View;
      const q = query.trim();
      let c: Ctx;
      try {
        c = { auth: authFrom(preferences), enter, quality };
      } catch (e) {
        if (e instanceof AuthError) {
          status = "Not connected";
          return setupItems(e, preferences);
        }
        throw e;
      }
      try {
        const head: Item[] = [];
        if (enter === "player" && !toolFor(await findTools())) head.push(noPlayerItem(await distro()));

        if (view === "browse") {
          const cats = q ? await searchCategories(c.auth, q, signal) : await topCategories(c.auth, signal);
          status = q ? `${cats.length} categories` : "Top categories on Twitch";
          return [
            ...head,
            ...cats.map((cat, i) =>
              categoryItem(cat, c, { section: q ? "Categories" : "Top Categories", rank: q ? undefined : i + 1 })
            ),
          ];
        }

        if (view === "channels") {
          if (!q) {
            status = "Search channels";
            return [{
              id: "hint",
              title: "Type a channel's name",
              subtitle: "Live channels first, then offline ones",
              icon: { source: Icons.search, tint: "purple" },
            }];
          }
          const found = await searchChannels(c.auth, q, signal);
          const live = found.filter((ch) => ch.is_live);
          status = `${found.length} channels · ${live.length} live`;
          return [
            ...head,
            ...live.map((ch) =>
              streamItem(channelStream(ch)!, c, { section: "Live", avatar: ch.thumbnail_url || undefined })
            ),
            ...found.filter((ch) => !ch.is_live).map((ch) => channelItem(ch, c)),
          ];
        }

        const streams = sortStreams(await followedLive(c.auth, signal));
        updateCommandMetadata({ subtitle: liveSubtitle(streams.length) }).catch(() => {});
        const pics = await avatars(c.auth, streams.map((s) => s.user_id), signal).catch(() =>
          new Map<string, string>()
        );
        const shown = streams.filter((s) => matches(s, q));
        status = `${streams.length} live${q && shown.length !== streams.length ? ` · ${shown.length} shown` : ""}`;
        return [
          ...head,
          ...shown.map((s) => streamItem(s, c, { section: "Live Now", avatar: pics.get(s.user_id) })),
        ];
      } catch (e) {
        if (e instanceof AuthError) {
          status = "Not connected";
          return setupItems(e, preferences);
        }
        throw e;
      }
    },
  });
};
