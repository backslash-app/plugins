import { action, type Context, Icons, type Item, list, pop, refresh, updateCommandMetadata } from "@backslash/api";
import { allEpisodes, allProgress, live, subscriptions } from "../api.ts";
import { addFeedForm } from "../feeds.ts";
import { dateSection, episodeKey, newEpisodes, speedOf, stateOf } from "../lib.ts";
import { distro, mpvInstalled, nowPlaying } from "../player.ts";
import { type Ctx, episodeItem, NO_SUBSCRIPTIONS, noMpvItem, nowPlayingItem, showItem } from "../views.ts";

let status = "";

export default (ctx: Context) => {
  const speed = speedOf(ctx.preferences.speed);
  const days = Math.max(1, Math.min(365, Number(ctx.preferences.days) || 30));
  const context = async (): Promise<Ctx> => ({
    progress: await allProgress(),
    player: await nowPlaying(),
    speed,
    subtitle: true,
  });
  const mpv = mpvInstalled();
  return list({
    placeholder: "Filter episodes and shows…",
    filter: {
      options: [
        { value: "new", title: "New Episodes" },
        { value: "progress", title: "In Progress" },
        { value: "shows", title: "Shows" },
      ],
    },
    empty: { title: "Nothing here", description: "All caught up", icon: Icons.done },
    status: () => status,
    actions: [
      action("Add Podcast by Feed URL", () => addFeedForm(() => pop()), { icon: Icons.rss, shortcut: "<Ctrl>n" }),
      action("Refresh Feeds", () => {
        force = true;
        return refresh();
      }, { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
    items: ({ signal, filter }) =>
      live(async function* () {
        const [shows, c, hasMpv] = await Promise.all([subscriptions(), context(), mpv]);
        updateCommandMetadata({ subtitle: c.player ? `Playing: ${c.player.playing.episode.title}` : null }).catch(
          () => {},
        );
        const head: Item[] = [];
        if (!hasMpv) head.push(noMpvItem(await distro()));
        if (c.player) head.push(nowPlayingItem(c.player, c));
        if (!shows.length) {
          status = "No subscriptions";
          yield [...head, NO_SUBSCRIPTIONS];
          return;
        }
        if (filter === "shows") {
          // Shows at once, then their new-episode counts once the feeds are in.
          status = `${shows.length} subscription${shows.length === 1 ? "" : "s"}`;
          yield [...head, ...shows.map((s) => showItem(s, context, { subscribed: true, section: "Subscriptions" }))];
        }
        const { episodes, failed } = await allEpisodes(shows, { signal, force });
        force = false;
        const fresh = newEpisodes(episodes, c.progress, { days });
        const errors = new Map(failed.map((f) => [f.show.feedUrl, f.error]));
        const warn = failed.length ? ` · ${failed.length} feed${failed.length === 1 ? "" : "s"} failed` : "";
        if (filter === "shows") {
          yield [
            ...head,
            ...shows.map((s) =>
              showItem(s, context, {
                subscribed: true,
                section: "Subscriptions",
                newCount: fresh.filter((e) => e.feedUrl === s.feedUrl).length,
                error: errors.get(s.feedUrl),
              })
            ),
          ];
          return;
        }
        if (filter === "progress") {
          const started = episodes
            .filter((e) => stateOf(c.progress[episodeKey(e)]) === "inProgress")
            .sort((a, b) => (c.progress[episodeKey(b)]?.updated ?? 0) - (c.progress[episodeKey(a)]?.updated ?? 0));
          status = `${started.length} in progress${warn}`;
          yield [...head, ...started.map((e) => episodeItem(e, c, { withShow: true, section: "In Progress" }))];
          return;
        }
        status = `${fresh.length} new episode${fresh.length === 1 ? "" : "s"} · ${shows.length} show${
          shows.length === 1 ? "" : "s"
        }${warn}`;
        yield [...head, ...fresh.map((e) => episodeItem(e, c, { withShow: true, section: dateSection(e.date) }))];
      }, signal),
  });
};

/** Set by "Refresh Feeds": the next load skips the feed cache. */
let force = false;
