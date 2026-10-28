// Library items, server problems and setup as launcher items.

import {
  type Accessory,
  type Action,
  action,
  clipboard,
  close,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { posters, type Server, SetupError } from "./api.ts";
import {
  ago,
  clock,
  episodeCode,
  type Family,
  installCommand,
  type MediaItem,
  type MediaType,
  type Player,
  progressOf,
  runtime,
  subtitleOf,
  TYPE_NAMES,
} from "./lib.ts";
import { NoPlayer, play, PLAYER_NAMES } from "./player.ts";

export interface Ctx {
  players: Player[];
  /** Both servers configured: labels say which one. */
  multi: boolean;
}

const TYPE_ICONS: Record<MediaType, { source: string; tint: Color }> = {
  movie: { source: Icons.film, tint: "orange" },
  series: { source: Icons.monitor, tint: "blue" },
  season: { source: Icons.layers, tint: "blue" },
  episode: { source: Icons.video, tint: "blue" },
  album: { source: Icons.music, tint: "pink" },
  track: { source: Icons.music, tint: "pink" },
  artist: { source: Icons.person, tint: "pink" },
  other: { source: Icons.file, tint: "gray" },
};

const playable = (i: MediaItem) => ["movie", "episode", "album", "track"].includes(i.type);
const browsable = (i: MediaItem) => ["series", "season", "album"].includes(i.type);
const label = (i: MediaItem) =>
  i.type === "episode" && i.seriesTitle ? `${i.seriesTitle} ${episodeCode(i) ?? ""}: ${i.title}`.trim() : i.title;

function playAction(s: Server, i: MediaItem, c: Ctx, o: { from?: number; players?: Player[]; title?: string } = {}) {
  const start = o.from ?? (!i.played && i.position && i.position > 30 ? i.position - 5 : 0);
  const players = o.players ?? c.players;
  const title = o.title ??
    (i.type === "album" ? "Play Album" : start ? `Resume from ${clock(start)}` : `Play in ${PLAYER_NAMES[players[0]]}`);
  return action(title, async () => {
    try {
      const urls = await s.streamUrls(i);
      const used = await play(players, urls, { title: label(i), start });
      return close(`Playing ${i.title} in ${PLAYER_NAMES[used]}`);
    } catch (e) {
      if (e instanceof NoPlayer) {
        await toast(e.message, { style: "failure" });
        return;
      }
      throw e;
    }
  }, { icon: Icons.play });
}

function watchedAction(s: Server, i: MediaItem): Action {
  return action(i.played ? "Mark as Unwatched" : "Mark as Watched", async () => {
    await s.setPlayed(i, !i.played);
    await toast(i.played ? "Marked as unwatched" : "Marked as watched", { style: "success" });
    return refresh();
  }, { icon: i.played ? Icons.eyeOff : Icons.eye, shortcut: "<Ctrl>Return" });
}

export function childrenView(s: Server, parent: MediaItem, c: Ctx): ListSpec {
  return list({
    title: parent.title,
    placeholder: `Filter ${parent.type === "album" ? "tracks" : "episodes"} of ${parent.title}…`,
    empty: { title: "Nothing in here", icon: TYPE_ICONS[parent.type].source },
    status: (items) => `${items.length} ${parent.type === "album" ? "tracks" : "episodes"} · ${s.name}`,
    async items({ signal }) {
      const children = await s.children(parent, signal);
      const pics = await posters(children.map((item) => ({ server: s, item })), { signal });
      return children.map((ch) =>
        mediaItem(s, ch, pics.get(ch), c, {
          section: ch.type === "episode" && ch.season !== undefined ? `Season ${ch.season}` : undefined,
        })
      );
    },
  });
}

function metadataOf(s: Server, i: MediaItem, c: Ctx): Metadata[] {
  const lines: Metadata[] = [meta.text("Type", TYPE_NAMES[i.type], { icon: TYPE_ICONS[i.type] })];
  if (i.type === "episode" && i.seriesTitle) lines.push(meta.text("Series", i.seriesTitle, { icon: Icons.monitor }));
  const code = episodeCode(i);
  if (i.type === "episode" && code) lines.push(meta.text("Episode", code, { icon: Icons.hash }));
  if (i.artist) lines.push(meta.text("Artist", i.artist, { icon: Icons.person }));
  if (i.year) lines.push(meta.text("Year", i.year, { icon: Icons.calendar }));
  const rt = runtime(i.runtime);
  if (rt) lines.push(meta.text("Runtime", rt, { icon: Icons.clock }));
  if (i.rating) {
    lines.push(
      meta.text("Rating", `${i.rating.toFixed(1)} / 10`, { icon: { source: Icons.starFilled, tint: "yellow" } }),
    );
  }
  if (i.criticRating) lines.push(meta.text("Critics", `${Math.round(i.criticRating)} %`, { icon: Icons.chartUp }));
  if (i.contentRating) lines.push(meta.tags("Rated", [{ text: i.contentRating, color: "gray" }]));
  if (i.genres.length) {
    lines.push(meta.tags("Genres", i.genres.slice(0, 4).map((g) => ({ text: g, color: "purple" as Color }))));
  }
  const p = progressOf(i);
  if (p !== undefined && !i.played) {
    lines.push(meta.progress("Watched", p, `${clock(i.position!)} / ${clock(i.runtime!)}`));
  } else if (i.played) lines.push(meta.text("Watched", "Yes", { icon: { source: Icons.done, tint: "green" } }));
  if (i.unplayedCount) lines.push(meta.text("Unwatched", `${i.unplayedCount} episodes`, { icon: Icons.eye }));
  if (i.resolution) {
    lines.push(meta.text("Video", [i.resolution, i.container?.toUpperCase()].filter(Boolean).join(" · ")));
  }
  if (i.people?.length) lines.push(meta.text("Cast", i.people.join(", "), { icon: Icons.person }));
  if (i.studio) lines.push(meta.text("Studio", i.studio));
  lines.push(meta.separator());
  if (i.added) lines.push(meta.text("Added", ago(i.added), { icon: Icons.plus }));
  lines.push(meta.link("Server", c.multi ? `${s.product}: ${s.name}` : s.name, s.webUrl(i)));
  return lines;
}

export function mediaItem(
  s: Server,
  i: MediaItem,
  poster: string | undefined,
  c: Ctx,
  o: { section?: string; showType?: boolean } = {},
): Item {
  const accessories: Accessory[] = [];
  const p = progressOf(i);
  if (p !== undefined && !i.played && i.runtime && i.position) {
    accessories.push({
      text: `${runtime(i.runtime - i.position) ?? "1 min"} left`,
      icon: { source: Icons.inProgress, tint: "orange" },
    });
  } else if (i.played) accessories.push({ icon: { source: Icons.done, tint: "green" }, tooltip: "Watched" });
  if (i.unplayedCount) accessories.push({ tag: `${i.unplayedCount} new`, color: "blue" });
  if (i.rating) {
    accessories.push({
      text: i.rating.toFixed(1),
      icon: { source: Icons.starFilled, tint: "yellow" },
      tooltip: "Rating",
    });
  }
  if (o.showType) accessories.push({ tag: TYPE_NAMES[i.type] });
  if (c.multi) {
    accessories.push({
      icon: { source: Icons.server, tint: s.kind === "plex" ? "orange" : "purple" },
      tooltip: `${s.product}: ${s.name}`,
    });
  }

  const actions: Action[] = [];
  if (browsable(i) && i.type !== "album") {
    actions.push(action("Show Episodes", () => childrenView(s, i, c), { icon: Icons.layers }));
  } else if (playable(i)) actions.push(playAction(s, i, c));
  if (i.type === "album") {
    actions.push(action("Show Tracks", () => childrenView(s, i, c), { icon: Icons.music, shortcut: "<Ctrl>t" }));
  }
  actions.push(open(s.webUrl(i), `Open in ${s.product}`, { shortcut: "<Ctrl>o" }));
  if (i.type !== "artist") actions.push(watchedAction(s, i));
  if (playable(i)) {
    if (i.position && !i.played) actions.push(playAction(s, i, c, { from: 0, title: "Play from the Beginning" }));
    const other = c.players[1];
    if (other) {
      actions.push(playAction(s, i, c, { players: [other], title: `Play in ${PLAYER_NAMES[other]}`, from: 0 }));
    }
  }
  if (i.type === "episode" && i.seriesId) {
    const series: MediaItem = { ...i, id: i.seriesId, type: "series", title: i.seriesTitle ?? "Series", genres: [] };
    actions.push(
      action("Show All Episodes", () => childrenView(s, series, c), { icon: Icons.monitor, shortcut: "<Ctrl>e" }),
    );
  }
  actions.push(copy(label(i), "Copy Title", { section: "Copy", shortcut: "<Ctrl><Shift>c" }));
  if (playable(i) && i.type !== "album") {
    actions.push(action("Copy Stream URL", async () => {
      const [url] = await s.streamUrls(i);
      // The address carries the access token: kept out of clipboard histories.
      await clipboard.write(url, { concealed: true });
      return close("Stream URL copied");
    }, { icon: Icons.copy, section: "Copy" }));
  }

  return {
    id: `${s.kind}:${i.id}:${o.section ?? ""}`,
    title: i.title,
    subtitle: subtitleOf(i),
    section: o.section,
    icon: poster ?? TYPE_ICONS[i.type],
    keywords: [i.seriesTitle ?? "", i.artist ?? "", ...i.genres, String(i.year ?? "")],
    accessories,
    detail: {
      image: poster,
      markdown: [
        `### ${label(i)}`,
        "",
        i.overview ? i.overview.slice(0, 1200) : "*No overview*",
      ].join("\n"),
      metadata: metadataOf(s, i, c),
    },
    actions,
  };
}

// ---------------------------------------------------------------------------
// Setup

const SETTINGS = "**Settings → Extensions → Jellyfin & Plex → Configure**";

export function setupItems(): Item[] {
  return [{
    id: "setup",
    title: "Connect Jellyfin or Plex",
    subtitle: "Server address and API key or token",
    icon: { source: Icons.server, tint: "blue" },
    section: "Setup",
    detail: {
      markdown: [
        "## Connect your media server",
        "",
        `In ${SETTINGS}, fill one or both:`,
        "",
        "### Jellyfin",
        "- **Address**: `http://192.168.1.10:8096` or `http://jellyfin.local:8096`",
        "- **API key**: Dashboard → API Keys → **+**, or your user name and password",
        "",
        "### Plex",
        "- **Address**: `http://192.168.1.10:32400`",
        "- **X-Plex-Token**: open an item in Plex Web → ⋯ → Get Info → View XML; the token is the",
        "  `X-Plex-Token=` part of the address",
      ].join("\n"),
    },
    actions: [
      open("https://jellyfin.org/docs/general/server/configuration/#api-keys", "Jellyfin API Keys", {
        icon: Icons.key,
      }),
      open(
        "https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/",
        "Find Your Plex Token",
        { icon: Icons.key },
      ),
    ],
  }];
}

export function problemItem(e: SetupError): Item {
  const product = e.server === "plex" ? "Plex" : "Jellyfin";
  const host = e.kind === "host";
  const steps = host
    ? [
      `## ${product} address not reachable from Backslash`,
      "",
      "Extensions declare the hosts they may reach. This one covers the usual places of a media server:",
      "",
      "- local names: `*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`, `localhost`",
      "- private networks: `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, Tailscale `100.64.x.x` and `*.ts.net`",
      "- Plex's own `*.plex.direct` addresses and DuckDNS (`*.duckdns.org`)",
      "",
      `Use the server's local address (its LAN IP works at home) in ${SETTINGS}.`,
    ]
    : [`## ${e.message}`, "", `Fix it in ${SETTINGS}.`];
  return {
    id: `problem:${e.server}`,
    title: e.message,
    subtitle: product,
    section: "Setup",
    icon: { source: host ? Icons.globe : Icons.key, tint: "orange" },
    detail: { markdown: steps.join("\n") },
    actions: host ? (e.base ? [open(e.base, `Open ${product} in the Browser`)] : []) : e.server === "plex"
      ? [
        open(
          "https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/",
          "Find Your Plex Token",
        ),
      ]
      : e.base
      ? [open(`${e.base}/web/#/dashboard/keys`, "Create a Jellyfin API Key", { icon: Icons.key })]
      : [open("https://jellyfin.org/docs/general/server/configuration/#api-keys", "Jellyfin API Keys")],
  };
}

export function serverErrorItem(s: Server, error: unknown): Item {
  if (error instanceof SetupError) return problemItem(error);
  const message = error instanceof Error ? error.message : String(error);
  return {
    id: `error:${s.kind}`,
    title: `Can't load ${s.product}`,
    subtitle: message,
    section: "Setup",
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: `## Can't load ${s.product}\n\n> ${message}\n\nServer: \`${s.base}\`` },
    actions: [
      open(s.base, `Open ${s.product}`),
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
    ],
  };
}

export function noPlayerItem(family: Family | undefined): Item {
  const cmd = installCommand(family, "mpv");
  return {
    id: "no-player",
    title: "Install mpv or VLC to play here",
    subtitle: family ? cmd : "Or open items in the web app",
    section: "Setup",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## No player found",
        "",
        "Movies, episodes and albums play in **mpv** (or VLC), streamed straight from your server:",
        "",
        "```",
        cmd,
        "```",
        "",
        "Enter on an item still opens it in the web app.",
      ].join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://mpv.io/installation/", "How to Install mpv")],
  };
}
