// Lyrics as launcher items: the live view of the current track, and search results.

import {
  type Action,
  action,
  copy,
  detail,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  toast,
} from "@backslash/api";
import { forget, pin, search } from "./api.ts";
import {
  cleanArtist,
  cleanTitle,
  clock,
  currentIndex,
  type Family,
  installCommand,
  isSynced,
  type Line,
  type LrcRecord,
  lrcToPlain,
  lyricsMarkdown,
  parseLrc,
  plainMarkdown,
  splitVideoTitle,
  type Track,
  windowAround,
} from "./lib.ts";
import { current, next, playPause, previous, seekTo } from "./system.ts";

/** The lyrics of a record, ready for the views. */
export interface Lyrics {
  record: LrcRecord;
  /** Synced lines, shifted by the LRC offset; empty for plain lyrics. */
  lines: Line[];
  plain: string;
}

export function lyricsOf(record: LrcRecord): Lyrics {
  const synced = isSynced(record.syncedLyrics) ? parseLrc(record.syncedLyrics!) : undefined;
  const lines = synced?.lines.map((l) => ({ ...l, time: Math.max(0, l.time - synced.offset) })) ?? [];
  const plain = (record.plainLyrics?.trim() || (record.syncedLyrics ? lrcToPlain(record.syncedLyrics) : "")).trim();
  return { record, lines, plain };
}

const songName = (t: Pick<Track, "artist" | "title">) => [t.title, t.artist].filter(Boolean).join(" – ");

function playerActions(t: Track): Action[] {
  const act = (title: string, run: () => Promise<unknown>, o: Record<string, string>) =>
    action(title, async () => {
      await run().catch(() => {});
    }, { section: "Player", ...o });
  return [
    act(t.status === "Playing" ? "Pause" : "Play", () => playPause(t), {
      icon: t.status === "Playing" ? Icons.pause : Icons.play,
      shortcut: "<Ctrl>p",
    }),
    act("Next Track", () => next(t), { icon: Icons.next, shortcut: "<Ctrl>n" }),
    act("Previous Track", () => previous(t), { icon: Icons.previous, shortcut: "<Ctrl><Shift>n" }),
  ];
}

function copyActions(l: Lyrics): Action[] {
  return [
    ...(l.plain ? [copy(l.plain, "Copy Lyrics", { section: "Copy", shortcut: "<Ctrl><Shift>c" })] : []),
    ...(l.record.syncedLyrics
      ? [copy(l.record.syncedLyrics, "Copy Synced Lyrics (LRC)", { section: "Copy", icon: Icons.clock })]
      : []),
  ];
}

/** Actions to look the lyrics up again, by hand or afresh. */
function fixActions(t: Track, searchView: () => unknown): Action[] {
  return [
    action("Search Lyrics…", () => searchView() as never, {
      icon: Icons.search,
      shortcut: "<Ctrl>f",
      section: "Lyrics",
    }),
    action("Look Up Again", async () => {
      await forget(t);
      return refresh();
    }, { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "Lyrics" }),
  ];
}

/** The live view's items for the track and its lyrics at `position` seconds. */
export function liveItems(
  t: Track,
  lyrics: Lyrics | undefined,
  o: { position: number; offset: number; searchView: () => unknown },
): Item[] {
  const song = songName(t);
  const header = (markdown: string, extra: Action[] = []): Item => ({
    id: "track",
    title: t.title,
    subtitle: t.artist || undefined,
    icon: {
      source: t.status === "Playing" ? Icons.music : Icons.pause,
      tint: t.status === "Playing" ? "green" : "gray",
    },
    section: "Now Playing",
    accessories: [
      ...(t.length ? [{ text: `${clock(o.position)} / ${clock(t.length)}` }] : []),
      { text: t.player, icon: Icons.speaker },
    ],
    detail: {
      markdown,
      metadata: [
        ...(t.artist ? [meta.text("Artist", t.artist, { icon: Icons.person })] : []),
        ...(t.album ? [meta.text("Album", t.album, { icon: Icons.music })] : []),
        meta.text("Player", `${t.player} · ${t.status.toLowerCase()}`, { icon: Icons.speaker }),
        ...(t.length
          ? [meta.progress("Position", o.position / t.length, `${clock(o.position)} / ${clock(t.length)}`)]
          : []),
        ...(lyrics
          ? [
            meta.text("Lyrics", lyrics.lines.length ? "Synced" : lyrics.plain ? "Plain" : "Instrumental", {
              icon: Icons.text,
            }),
            meta.link("Source", "LRCLIB", `https://lrclib.net/`),
          ]
          : []),
      ],
    },
    actions: [...extra, ...(lyrics ? copyActions(lyrics) : []), ...fixActions(t, o.searchView), ...playerActions(t)],
  });

  if (!lyrics) {
    return [
      header(`## No lyrics found\n\nLRCLIB has nothing for **${song}**. Search by hand to pick another version.`),
      {
        id: "not-found",
        title: "No lyrics found for this track",
        subtitle: "Search LRCLIB by hand",
        icon: { source: Icons.search, tint: "orange" },
        actions: fixActions(t, o.searchView),
      },
    ];
  }
  if (lyrics.record.instrumental && !lyrics.plain) {
    return [header("## Instrumental\n\n♪ No lyrics to sing along to.")];
  }
  if (!lyrics.lines.length) {
    return [
      header(plainMarkdown(lyrics.plain, song)),
      ...lyrics.plain.split("\n").filter((l) => l.trim()).map((text, i): Item => ({
        id: `plain-${i}`,
        title: text.trim(),
        section: "Lyrics (not synced)",
        actions: [copy(text.trim(), "Copy Line"), ...copyActions(lyrics), ...fixActions(t, o.searchView)],
      })),
    ];
  }
  const at = o.position + o.offset;
  const now = currentIndex(lyrics.lines, at);
  const { start, end } = windowAround(lyrics.lines.length, Math.max(now, 0));
  const items: Item[] = [header(lyricsMarkdown(lyrics.lines, now, song))];
  for (let i = start; i < end; i++) {
    const line = lyrics.lines[i];
    const isNow = i === now;
    items.push({
      id: `line-${i}`,
      title: line.text || "♪",
      icon: isNow ? { source: Icons.play, tint: "green" } : { source: i < now ? Icons.check : Icons.dot, tint: "gray" },
      section: isNow ? "Now" : i < now ? "Sung" : now < 0 ? "Coming Up" : "Next",
      accessories: [{ text: clock(line.time), color: isNow ? "green" : undefined }],
      actions: [
        action("Jump Here", async () => {
          await seekTo(t, line.time - o.offset).catch(() => {});
        }, { icon: Icons.arrowRight }),
        copy(line.text, "Copy Line"),
        ...copyActions(lyrics),
        ...fixActions(t, o.searchView),
        ...playerActions(t),
      ],
    });
  }
  return items;
}

/** Shown when nothing plays. */
export function idleItem(searchView: () => unknown): Item {
  return {
    id: "idle",
    title: "Nothing is playing",
    subtitle: "Start a song in Spotify, a browser, mpv or any MPRIS player",
    icon: { source: Icons.music, tint: "gray" },
    actions: [action("Search Lyrics…", () => searchView() as never, { icon: Icons.search })],
  };
}

export function noPlayerctlItem(family: Family | undefined): Item {
  const cmd = installCommand(family, "playerctl");
  return {
    id: "no-playerctl",
    title: "Install playerctl to follow what's playing",
    subtitle: family ? cmd : "It reads the track and position of MPRIS players",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## playerctl is needed",
        "",
        "The live lyrics follow the song and position of your media player with **playerctl**. Install it:",
        "",
        "```",
        cmd,
        "```",
        "",
        "Search Lyrics works without it.",
      ].join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://github.com/altdesktop/playerctl#installing", "How to Install playerctl")],
  };
}

const duration = (s?: number | null) => (s ? clock(s) : undefined);

/** A search result; `track` is the song playing, to pin the result to it. */
export function resultItem(r: LrcRecord, track?: Track): Item {
  const l = lyricsOf(r);
  const kind = l.lines.length ? "Synced" : l.plain ? "Plain" : r.instrumental ? "Instrumental" : "Empty";
  const body = l.plain ? plainMarkdown(l.plain) : r.instrumental ? "♪ Instrumental" : "_No lyrics in this entry._";
  return {
    id: String(r.id),
    title: r.trackName,
    subtitle: [r.artistName, r.albumName].filter(Boolean).join(" · "),
    icon: { source: Icons.text, tint: l.lines.length ? "green" : "gray" },
    keywords: [r.artistName, r.albumName ?? ""],
    accessories: [
      { tag: kind, color: l.lines.length ? "green" : undefined },
      ...(duration(r.duration) ? [{ text: duration(r.duration)! }] : []),
    ],
    detail: {
      markdown: body,
      metadata: [
        meta.text("Artist", r.artistName, { icon: Icons.person }),
        ...(r.albumName ? [meta.text("Album", r.albumName, { icon: Icons.music })] : []),
        ...(r.duration ? [meta.text("Duration", clock(r.duration), { icon: Icons.clock })] : []),
        meta.text("Lyrics", kind, { icon: Icons.text }),
      ],
    },
    actions: [
      action("Read Lyrics", () =>
        detail({
          title: `${r.trackName} – ${r.artistName}`,
          markdown: l.plain ? plainMarkdown(l.plain, `${r.trackName} – ${r.artistName}`) : body,
          actions: copyActions(l),
        }), { icon: Icons.text }),
      ...(l.plain ? [copy(l.plain, "Copy Lyrics")] : []),
      ...(r.syncedLyrics ? [copy(r.syncedLyrics, "Copy Synced Lyrics (LRC)", { icon: Icons.clock })] : []),
      ...(track
        ? [action(`Use for “${track.title}”`, async () => {
          await pin(track, r);
          await toast("Lyrics saved for this track", { style: "success" });
        }, { icon: Icons.pin, shortcut: "<Ctrl>u" })]
        : []),
    ],
  };
}

/** Searching LRCLIB by hand: by default, for the track playing. */
export function searchList(preferred: string): ListSpec {
  let footer = "";
  return list({
    placeholder: "Search lyrics by title and artist…",
    empty: { title: "No lyrics found", description: "Try the title alone, or another spelling", icon: Icons.text },
    status: () => footer,
    async search(query, { signal }) {
      const q = query.trim();
      const track = await current(preferred, signal).catch(() => undefined);
      if (!q && !track) {
        footer = "lrclib.net";
        return [{
          id: "hint",
          title: "Type a song title, and the artist",
          subtitle: "Synced and plain lyrics from LRCLIB",
          icon: { source: Icons.search, tint: "blue" },
        }];
      }
      const { artist, title } = track ? splitVideoTitle(track) : { artist: "", title: "" };
      const results = q
        ? await search({ q }, signal)
        : await search({ title: cleanTitle(title), artist: cleanArtist(artist) || undefined }, signal);
      footer = `${results.length} result${results.length === 1 ? "" : "s"}${
        q ? "" : ` for ${songName(track!)}`
      } · lrclib.net`;
      // Synced lyrics first, then by how close the duration is to the track's.
      const sorted = [...results].sort((a, b) =>
        Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics) ||
        (track?.length ? Math.abs((a.duration ?? 0) - track.length) - Math.abs((b.duration ?? 0) - track.length) : 0)
      );
      return sorted.map((r) => resultItem(r, track));
    },
  });
}
