// Episodes, shows and what's playing as launcher items and views.

import {
  type Accessory,
  type Action,
  action,
  close,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { feed, live, setProgress, subscribe, unsubscribe } from "./api.ts";
import {
  ago,
  clock,
  dateSection,
  duration,
  type Episode,
  episodeKey,
  episodeNumber,
  type Family,
  fullDate,
  htmlToMarkdown,
  installCommand,
  left,
  megabytes,
  type Progress,
  resumeAt,
  shortDate,
  type Show,
  stateOf,
  summary,
} from "./lib.ts";
import { NoPlayer, play, type PlayerState, seek, setSpeed, stop, togglePause } from "./player.ts";

export interface Ctx {
  progress: Record<string, Progress>;
  player?: PlayerState;
  speed: number;
  /** Update this command's subtitle in the root search ("Playing: …"). */
  subtitle?: boolean;
}

const playingSubtitle = (title: string) => `Playing: ${title}`;
const isPlaying = (e: Episode, c: Ctx) => !!c.player && episodeKey(c.player.playing.episode) === episodeKey(e);

// ---------------------------------------------------------------------------
// Actions

export function playAction(e: Episode, c: Ctx, o: { from?: number; title?: string } = {}): Action {
  const start = o.from ?? resumeAt(c.progress[episodeKey(e)]);
  return action(o.title ?? (start ? `Resume from ${clock(start)}` : "Play"), async () => {
    try {
      await play(e, start, c.speed);
    } catch (err) {
      if (err instanceof NoPlayer) {
        await toast(err.message, { style: "failure" });
        return refresh();
      }
      throw err;
    }
    if (c.subtitle) updateCommandMetadata({ subtitle: playingSubtitle(e.title) }).catch(() => {});
    return close(`Playing ${e.title}`);
  }, { icon: Icons.play });
}

function playerActions(s: PlayerState, c: Ctx): Action[] {
  const speeds = [0.8, 1, 1.2, 1.5, 1.75, 2];
  return [
    action(s.paused ? "Resume" : "Pause", async () => {
      const paused = await togglePause();
      if (paused === undefined) await toast("mpv didn't answer", { style: "failure" });
      return refresh();
    }, { icon: s.paused ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }),
    action("Forward 30 Seconds", async () => {
      await seek(30);
      return refresh();
    }, { icon: Icons.next, shortcut: "<Ctrl>Right" }),
    action("Back 30 Seconds", async () => {
      await seek(-30);
      return refresh();
    }, { icon: Icons.previous, shortcut: "<Ctrl>Left" }),
    submenu(
      "Playback Speed",
      speeds.map((v) =>
        action(`${v}×${v === s.playing.speed ? " (current)" : ""}`, async () => {
          await setSpeed(v);
          return refresh();
        }, { icon: Icons.timer })
      ),
      { icon: Icons.timer, section: "Player" },
    ),
    action("Stop", async () => {
      await stop();
      if (c.subtitle) updateCommandMetadata({ subtitle: null }).catch(() => {});
      await toast("Stopped, position saved", { style: "success" });
      return refresh();
    }, { icon: Icons.stop, shortcut: "<Ctrl>period", section: "Player" }),
  ];
}

function markAction(e: Episode, p: Progress | undefined): Action {
  const played = p?.played;
  return action(played ? "Mark as Unplayed" : "Mark as Played", async () => {
    await setProgress(e, played ? null : { position: e.duration ?? 0, duration: e.duration, played: true });
    await toast(played ? "Marked as unplayed" : "Marked as played", { style: "success" });
    return refresh();
  }, { icon: played ? Icons.dottedCircle : Icons.done, shortcut: "<Ctrl>Return" });
}

// ---------------------------------------------------------------------------
// Episodes

function episodeMetadata(e: Episode, p: Progress | undefined, live?: PlayerState): Metadata[] {
  const lines: Metadata[] = [meta.text("Show", e.show, { icon: Icons.mic })];
  if (e.date) lines.push(meta.text("Published", fullDate(e.date), { icon: Icons.calendar }));
  const d = duration(live?.duration ?? e.duration);
  if (d) lines.push(meta.text("Duration", d, { icon: Icons.clock }));
  const position = live?.position ?? p?.position;
  const total = live?.duration ?? p?.duration ?? e.duration;
  if (p?.played && !live) lines.push(meta.text("Status", "Played", { icon: Icons.done, color: "green" }));
  else if (position && total) {
    lines.push(meta.progress("Progress", position / total, `${clock(position)} / ${clock(total)}`));
  }
  const n = episodeNumber(e);
  if (n) lines.push(meta.text("Episode", n, { icon: Icons.hash }));
  const tags = [
    ...(e.kind === "bonus" ? [{ text: "Bonus", color: "purple" as const }] : []),
    ...(e.kind === "trailer" ? [{ text: "Trailer", color: "gray" as const }] : []),
    ...(e.explicit ? [{ text: "Explicit", color: "red" as const }] : []),
  ];
  if (tags.length) lines.push(meta.tags("Tags", tags));
  const size = megabytes(e.bytes);
  if (size) lines.push(meta.text("File", size, { icon: Icons.download }));
  if (e.link) {
    let host = e.link;
    try {
      host = new URL(e.link).hostname.replace(/^www\./, "");
    } catch {
      // As is.
    }
    lines.push(meta.separator(), meta.link("Page", host, e.link));
  }
  return lines;
}

const notesMarkdown = (e: Episode, max = 2500) => {
  const md = htmlToMarkdown(e.notes || "");
  return md.length > max ? `${md.slice(0, max).replace(/\s+\S*$/, "")}…` : md;
};

export function notesView(e: Episode, c: Ctx) {
  const p = c.progress[episodeKey(e)];
  return detail({
    title: e.title,
    markdown: `# ${e.title}\n\n${htmlToMarkdown(e.notes || "") || "*No show notes*"}`,
    metadata: episodeMetadata(e, p),
    actions: [
      playAction(e, c),
      markAction(e, p),
      ...(e.link ? [open(e.link, "Open Episode Page", { shortcut: "<Ctrl>o" })] : []),
      copy(e.audio, "Copy Audio URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  });
}

export function episodeItem(e: Episode, c: Ctx, o: { section?: string; withShow?: boolean } = {}): Item {
  const p = c.progress[episodeKey(e)];
  const state = stateOf(p);
  const now = isPlaying(e, c) ? c.player : undefined;
  const accessories: Accessory[] = [];
  if (now) accessories.push({ tag: now.paused ? "Paused" : "Playing", color: now.paused ? "orange" : "green" });
  else if (state === "inProgress" && p) {
    accessories.push({ text: left(p) ?? clock(p.position), icon: { source: Icons.inProgress, tint: "orange" } });
  } else if (state === "played") accessories.push({ icon: { source: Icons.done, tint: "green" }, tooltip: "Played" });
  else accessories.push({ icon: { source: Icons.dot, tint: "blue" }, tooltip: "New" });
  const d = duration(e.duration);
  if (d && state !== "inProgress") accessories.push({ text: d, tooltip: "Duration" });
  if (e.date) accessories.push({ text: shortDate(e.date), tooltip: fullDate(e.date) });
  const start = resumeAt(p);
  const actions: Action[] = now ? playerActions(now, c) : [playAction(e, c)];
  actions.push(
    markAction(e, p),
    action("Show Notes", () => notesView(e, c), { icon: Icons.text, shortcut: "<Ctrl>i" }),
  );
  if (!now && start) actions.push(playAction(e, c, { from: 0, title: "Play from the Beginning" }));
  if (e.link) actions.push(open(e.link, "Open Episode Page", { shortcut: "<Ctrl>o" }));
  actions.push(
    copy(e.audio, "Copy Audio URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ...(e.link ? [copy(e.link, "Copy Episode Link", { section: "Copy" })] : []),
  );
  return {
    id: episodeKey(e),
    title: e.title,
    subtitle: o.withShow ? e.show : summary(e.notes, 90),
    section: o.section,
    icon: e.image ?? { source: Icons.mic, tint: "purple" },
    keywords: [e.show, episodeNumber(e)],
    accessories,
    detail: {
      image: e.image,
      markdown: notesMarkdown(e) || "*No show notes*",
      metadata: episodeMetadata(e, p, now),
    },
    actions,
  };
}

export function nowPlayingItem(s: PlayerState, c: Ctx): Item {
  const e = s.playing.episode;
  const where = s.position !== undefined ? `${clock(s.position)}${s.duration ? ` / ${clock(s.duration)}` : ""}` : "";
  return {
    id: "now-playing",
    title: e.title,
    subtitle: [s.paused ? "Paused" : "Playing", e.show, where].filter(Boolean).join(" · "),
    section: "Now Playing",
    icon: { source: s.paused ? Icons.pause : Icons.speaker, tint: s.paused ? "orange" : "green" },
    accessories: [
      ...(s.playing.speed !== 1 ? [{ tag: `${s.playing.speed}×` }] : []),
      ...(s.duration && s.position !== undefined
        ? [{ text: left({ position: s.position, duration: s.duration }) }]
        : []),
    ],
    detail: {
      image: e.image,
      metadata: [
        ...(s.duration && s.position !== undefined
          ? [meta.progress("Progress", s.position / s.duration, `${clock(s.position)} / ${clock(s.duration)}`)]
          : []),
        meta.text("Show", e.show, { icon: Icons.mic }),
        meta.text("State", s.paused ? "Paused" : "Playing", {
          icon: s.paused ? Icons.pause : Icons.play,
          color: s.paused ? "orange" : "green",
        }),
        meta.text("Speed", `${s.playing.speed}×`, { icon: Icons.timer }),
        meta.text("Started", ago(s.playing.started), { icon: Icons.clock }),
      ],
    },
    actions: [
      ...playerActions(s, c),
      ...(e.link ? [open(e.link, "Open Episode Page", { section: "Episode" })] : []),
    ],
  };
}

// ---------------------------------------------------------------------------
// Shows

/** A show's episodes, newest first; reloads after changes. */
export function showView(show: Show, c: () => Promise<Ctx>, o: { subscribed: boolean }): ListSpec {
  let total = 0;
  return list({
    title: show.title,
    placeholder: `Filter episodes of ${show.title}…`,
    filter: {
      options: [{ value: "all", title: "All Episodes" }, { value: "unplayed", title: "Unplayed" }],
    },
    empty: { title: "No episodes", description: "This feed has no audio episodes", icon: Icons.mic },
    status: (items) => `${items.length} of ${total} episodes · ${show.title}`,
    items: ({ signal, filter }) =>
      live(async () => {
        const [{ episodes, show: fromFeed }, ctx] = await Promise.all([
          feed(show.feedUrl, { signal, force: true }),
          c(),
        ]);
        total = episodes.length;
        const head: Item[] = !o.subscribed
          ? [{
            id: "subscribe",
            title: `Subscribe to ${show.title}`,
            subtitle: "New episodes show up in Podcasts",
            icon: { source: Icons.plus, tint: "green" },
            detail: { image: show.artwork ?? fromFeed.artwork, markdown: htmlToMarkdown(fromFeed.description ?? "") },
            actions: [subscribeAction({ ...fromFeed, ...show })],
          }]
          : [];
        const shown = filter === "unplayed" ? episodes.filter((e) => !ctx.progress[episodeKey(e)]?.played) : episodes;
        return [
          ...head,
          ...shown.map((e) =>
            episodeItem({ ...e, show: show.title, image: e.image ?? show.artwork }, ctx, {
              section: dateSection(e.date),
            })
          ),
        ];
      }, signal),
  });
}

export function subscribeAction(show: Show): Action {
  return action("Subscribe", async () => {
    const added = await subscribe(show);
    await toast(added ? `Subscribed to ${show.title}` : `Already subscribed to ${show.title}`, { style: "success" });
    return refresh();
  }, { icon: Icons.plus, shortcut: "<Ctrl>s" });
}

export function showItem(
  show: Show,
  c: () => Promise<Ctx>,
  o: { subscribed: boolean; section?: string; newCount?: number; error?: string },
): Item {
  const accessories: Accessory[] = [];
  if (o.error) accessories.push({ icon: { source: Icons.alert, tint: "orange" }, tooltip: o.error });
  if (o.newCount) accessories.push({ tag: `${o.newCount} new`, color: "blue" });
  if (o.subscribed && o.section !== "Subscriptions") {
    accessories.push({ icon: { source: Icons.check, tint: "green" }, tooltip: "Subscribed" });
  }
  if (show.lastRelease) {
    accessories.push({ text: ago(show.lastRelease), tooltip: `Last episode ${fullDate(show.lastRelease)}` });
  }
  const metadata: Metadata[] = [];
  if (show.author) metadata.push(meta.text("By", show.author, { icon: Icons.person }));
  if (show.genres?.length) {
    metadata.push(meta.tags("Genres", show.genres.slice(0, 4).map((g) => ({ text: g, color: "purple" as const }))));
  }
  if (show.episodeCount) metadata.push(meta.text("Episodes", show.episodeCount, { icon: Icons.mic }));
  if (show.lastRelease) metadata.push(meta.text("Last episode", fullDate(show.lastRelease), { icon: Icons.calendar }));
  if (o.error) metadata.push(meta.text("Feed", o.error, { icon: Icons.alert, color: "orange" }));
  metadata.push(meta.separator(), meta.link("Feed", new URL(show.feedUrl).hostname, show.feedUrl));
  const apple = show.itunesId ? `https://podcasts.apple.com/podcast/id${show.itunesId}` : undefined;
  return {
    id: `show:${show.feedUrl}`,
    title: show.title,
    subtitle: show.author,
    section: o.section,
    icon: show.artwork ?? { source: Icons.mic, tint: "purple" },
    keywords: show.genres,
    accessories,
    detail: {
      image: show.artwork,
      markdown: show.description ? summary(show.description, 600) : "",
      metadata,
    },
    actions: [
      action("Show Episodes", () => showView(show, c, { subscribed: o.subscribed }), { icon: Icons.mic }),
      o.subscribed
        ? action("Unsubscribe", async () => {
          await unsubscribe(show.feedUrl);
          await toast(`Unsubscribed from ${show.title}`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.minus,
          destructive: true,
          confirm: `Unsubscribe from ${show.title}?`,
          section: "Danger",
          shortcut: "<Ctrl>Delete",
        })
        : subscribeAction(show),
      ...(apple ? [open(apple, "Open in Apple Podcasts", { shortcut: "<Ctrl>o" })] : []),
      ...(show.link && show.link !== apple ? [open(show.link, "Open Website")] : []),
      copy(show.feedUrl, "Copy Feed URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Setup

export function noMpvItem(family: Family | undefined): Item {
  const cmd = installCommand(family, "mpv");
  return {
    id: "no-player",
    title: "Install mpv to listen",
    subtitle: family ? cmd : "Episodes play in the background with mpv",
    section: "Setup",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## mpv is needed",
        "",
        "Episodes play in the background with **mpv**, which also lets Backslash pause, seek and",
        "remember where you stopped. Install it:",
        "",
        "```",
        cmd,
        "```",
      ].join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://mpv.io/installation/", "How to Install mpv")],
  };
}

export const NO_SUBSCRIPTIONS: Item = {
  id: "no-subscriptions",
  title: "No subscriptions yet",
  subtitle: "Search Podcasts to find shows and subscribe",
  icon: { source: Icons.search, tint: "blue" },
  detail: {
    markdown: [
      "## Find shows to follow",
      "",
      "Open **Search Podcasts** and type a show's name or a topic, then press **Ctrl+S** to subscribe.",
      "",
      "New episodes of your subscriptions show up here, newest first.",
    ].join("\n"),
  },
};
