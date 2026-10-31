// Rows, previews and actions shared by the two commands.

import { type Action, copy, Icons, type Item, meta, open, submenu } from "@backslash/api";
import {
  ago,
  lastfmProfile,
  lastfmTrackUrl,
  lbProfile,
  plays,
  searchLinks,
  type Service,
  SERVICES,
  type Settings,
  type Top,
  type Track,
  trackLine,
} from "./lib.ts";

export function profileUrl(service: Service, s: Settings): string {
  return service === "lastfm" ? lastfmProfile(s.lastfmUser!) : lbProfile(s.listenbrainzUser!);
}

function elsewhere(q: string): Action {
  return submenu("Search Elsewhere", searchLinks(q).map((l) => open(l.url, l.title, { icon: Icons.search })), {
    icon: Icons.search,
    shortcut: "<Ctrl>f",
  });
}

export function trackItem(
  t: Track,
  service: Service,
  s: Settings,
  section: string,
  extra: Action[],
  now = Date.now(),
): Item {
  const line = trackLine(t);
  const url = t.url ?? (service === "lastfm" ? lastfmTrackUrl(t.artist, t.title) : undefined);
  return {
    id: `${t.at ?? "now"}:${line}`,
    title: t.title,
    subtitle: [t.artist, t.album].filter(Boolean).join(" · "),
    icon: t.image ?? { source: t.playing ? Icons.play : Icons.music, tint: t.playing ? "green" : "gray" },
    section,
    keywords: [t.artist, t.album ?? ""].filter(Boolean),
    accessories: [
      ...(t.loved ? [{ icon: { source: Icons.heartFilled, tint: "red" as const }, tooltip: "Loved" }] : []),
      t.playing
        ? { tag: "Now playing", color: "green" as const }
        : { text: ago(t.at, now), tooltip: t.at ? new Date(t.at).toLocaleString("en-GB") : undefined },
    ],
    detail: {
      image: t.image,
      metadata: [
        meta.text("Title", t.title, { icon: Icons.music }),
        meta.text("Artist", t.artist, { icon: Icons.person }),
        ...(t.album ? [meta.text("Album", t.album, { icon: Icons.layers })] : []),
        meta.text(
          t.playing ? "Status" : "Played",
          t.playing ? "Playing now" : t.at ? new Date(t.at).toLocaleString("en-GB") : "—",
          { icon: Icons.clock, color: t.playing ? "green" : undefined },
        ),
        ...(t.loved ? [meta.text("Loved", "Yes", { icon: Icons.heartFilled, color: "red" })] : []),
        meta.separator(),
        meta.text("From", SERVICES[service].title),
      ],
    },
    actions: [
      ...(url
        ? [open(url, service === "lastfm" ? "Open on Last.fm" : "Open on MusicBrainz", { icon: Icons.globe })]
        : []),
      copy(line, "Copy Artist and Title"),
      elsewhere(line),
      open(profileUrl(service, s), `Open My ${SERVICES[service].title} Profile`, {
        icon: Icons.person,
        shortcut: "<Ctrl>p",
        section: SERVICES[service].title,
      }),
      ...extra,
    ],
  };
}

export function topItem(e: Top, service: Service, s: Settings, max: number, extra: Action[]): Item {
  const line = trackLine({ artist: e.artist, name: e.name });
  return {
    id: `${e.kind}:${e.rank}:${line}`,
    title: `${e.rank}. ${e.name}`,
    subtitle: e.artist,
    icon: e.image ?? {
      source: e.kind === "artists" ? Icons.person : e.kind === "albums" ? Icons.layers : Icons.music,
      tint: e.rank <= 3 ? "yellow" : "gray",
    },
    keywords: e.artist ? [e.artist] : [],
    accessories: [{ text: plays(e.plays), tooltip: `Rank ${e.rank}` }],
    detail: {
      image: e.image,
      metadata: [
        meta.text("Rank", `#${e.rank}`, { icon: Icons.starFilled, color: e.rank <= 3 ? "yellow" : undefined }),
        meta.text(e.kind === "artists" ? "Artist" : e.kind === "albums" ? "Album" : "Track", e.name),
        ...(e.artist ? [meta.text("Artist", e.artist, { icon: Icons.person })] : []),
        meta.text("Plays", e.plays.toLocaleString("en"), { icon: Icons.play }),
        meta.progress("Compared to #1", max ? e.plays / max : 0),
        meta.separator(),
        meta.text("From", SERVICES[service].title),
      ],
    },
    actions: [
      ...(e.url
        ? [open(e.url, service === "lastfm" ? "Open on Last.fm" : "Open on MusicBrainz", { icon: Icons.globe })]
        : []),
      copy(line, e.kind === "artists" ? "Copy Artist" : "Copy Artist and Title"),
      elsewhere(line),
      open(profileUrl(service, s), `Open My ${SERVICES[service].title} Profile`, {
        icon: Icons.person,
        shortcut: "<Ctrl>p",
        section: SERVICES[service].title,
      }),
      ...extra,
    ],
  };
}

export function setupItem(): Item {
  return {
    id: "setup",
    title: "Add your Last.fm or ListenBrainz account",
    subtitle: "Settings → Extensions → Scrobbles",
    icon: { source: Icons.settings, tint: "orange" },
    detail: {
      markdown: [
        "## Where do you scrobble?",
        "",
        "- **Last.fm**: your user name, and an API key from **last.fm/api/account/create** (free, instant).",
        "- **ListenBrainz**: just your user name; listens and statistics are public.",
        "",
        "Set either one, or both, in **Settings → Extensions → Scrobbles → Configure**.",
      ].join("\n"),
    },
    actions: [
      open("https://www.last.fm/api/account/create", "Get a Last.fm API Key", { icon: Icons.key }),
      open("https://listenbrainz.org/", "Open ListenBrainz", { icon: Icons.globe }),
    ],
  };
}

export function errorItem(e: unknown, service: Service): Item {
  return {
    id: "error",
    title: `Couldn't load ${SERVICES[service].title}`,
    subtitle: (e as Error).message,
    icon: { source: Icons.alert, tint: "orange" },
  };
}
