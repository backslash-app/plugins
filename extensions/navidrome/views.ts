// Albums, songs, playlists, audiobooks, what's playing and setup as launcher items and views.

import {
  type Accessory,
  type Action,
  action,
  close,
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
  updateCommandMetadata,
} from "@backslash/api";
import { Abs, absCover, type CoverRequest, covers, SetupError, Subsonic, subsonicCover } from "./api.ts";
import {
  type AbsItem,
  type Album,
  type Artist,
  clock,
  duration,
  type Entry,
  type Episode,
  type Family,
  htmlToText,
  installCommand,
  left,
  type Playlist,
  resumeAt,
  type Song,
  startPoint,
  trackOrder,
} from "./lib.ts";
import { next, NoPlayer, play, type PlayerState, type Playing, previous, seek, stop, togglePause } from "./player.ts";

const SETTINGS = "Settings → Extensions → Navidrome & Audiobookshelf";

export interface Ctx {
  sub?: Subsonic;
  abs?: Abs;
  /** Cached covers by request key. */
  pics: Map<string, string>;
  /** Audiobook playback speed. */
  speed: number;
}

const cover = (c: Ctx, r: CoverRequest | undefined) => (r ? c.pics.get(r.key) : undefined);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Runs `start` and closes the launcher, or says why it couldn't play. */
async function starting(start: () => Promise<Playing>) {
  try {
    const p = await start();
    updateCommandMetadata({ subtitle: `Playing ${p.title}` }).catch(() => {});
    return close(`Playing ${p.title}`);
  } catch (e) {
    if (e instanceof NoPlayer) {
      await toast(e.message, { style: "failure" });
      return refresh();
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Playing

export function playSongs(
  sub: Subsonic,
  title: string,
  songs: Song[],
  o: { shuffle?: boolean; from?: number; cover?: string; abs?: Abs } = {},
) {
  const files: Entry[] = songs.map((s) => ({ url: sub.streamUrl(s.id) }));
  return play(
    {
      source: "subsonic",
      title,
      shuffle: o.shuffle,
      cover: o.cover,
      entries: songs.map((s) => ({
        title: s.title,
        artist: s.artist,
        album: s.album,
        duration: s.duration,
        songId: s.id,
      })),
    },
    files,
    { startIndex: o.from, abs: o.abs },
  ).then((p) => {
    sub.nowPlaying(songs[o.from ?? 0]?.id ?? songs[0].id);
    return p;
  });
}

/** Plays a book from where the user stopped (or `from` seconds). */
export async function playBook(abs: Abs, item: AbsItem, o: { from?: number; cover?: string; speed?: number } = {}) {
  const full = await abs.item(item.id);
  const tracks = full.tracks ?? [];
  if (!tracks.length) throw new Error(`${item.title} has no audio files`);
  const time = o.from ?? resumeAt(full.progress);
  const at = startPoint(tracks, time);
  const files: Entry[] = tracks.map((t, i) => ({
    url: abs.fileUrl(t.contentUrl),
    start: i === at.index ? at.offset : 0,
  }));
  return play(
    {
      source: "abs",
      title: full.title,
      cover: o.cover,
      entries: tracks.map((t) => ({
        title: t.title ?? full.title,
        artist: full.author,
        album: full.title,
        duration: t.duration,
      })),
      abs: {
        itemId: full.id,
        offsets: tracks.map((t) => t.startOffset),
        duration: full.duration ?? tracks.reduce((s, t) => s + t.duration, 0),
        chapters: full.chapters,
      },
    },
    files,
    { startIndex: at.index, abs, speed: o.speed },
  );
}

export async function playEpisode(
  abs: Abs,
  item: AbsItem,
  e: Episode,
  o: { from?: number; cover?: string; speed?: number } = {},
) {
  let url = e.contentUrl;
  let length = e.duration;
  if (!url) {
    const ep = (await abs.item(item.id)).episodes?.find((x) => x.id === e.id);
    url = ep?.contentUrl;
    length = ep?.duration ?? length;
  }
  if (!url) throw new Error(`“${e.title}” has no audio file`);
  const start = o.from ?? (item.progress?.episodeId === e.id ? resumeAt(item.progress) : 0);
  return play(
    {
      source: "abs",
      title: e.title,
      cover: o.cover,
      entries: [{ title: e.title, artist: item.title, duration: length }],
      abs: { itemId: item.id, episodeId: e.id, offsets: [0], duration: length ?? 0 },
    },
    [{ url: abs.fileUrl(url), start }],
    { abs, speed: o.speed },
  );
}

function playerActions(s: PlayerState, c: Ctx): Action[] {
  const book = s.playing.source === "abs";
  return [
    action(s.paused ? "Resume" : "Pause", async () => {
      if (await togglePause() === undefined) await toast("mpv didn't answer", { style: "failure" });
      return refresh();
    }, { icon: s.paused ? Icons.play : Icons.pause, shortcut: "<Ctrl>p" }),
    action(book ? "Next Chapter" : "Next Track", async () => {
      await next(s.playing);
      await new Promise((r) => setTimeout(r, 400));
      return refresh();
    }, { icon: Icons.next, shortcut: "<Ctrl>Right" }),
    action(book ? "Previous Chapter" : "Previous Track", async () => {
      await previous(s.playing);
      await new Promise((r) => setTimeout(r, 400));
      return refresh();
    }, { icon: Icons.previous, shortcut: "<Ctrl>Left" }),
    ...(book
      ? [
        action("Forward 30 Seconds", async () => {
          await seek(30);
          return refresh();
        }, { icon: Icons.arrowRight, section: "Player" }),
        action("Back 30 Seconds", async () => {
          await seek(-30);
          return refresh();
        }, { icon: Icons.history, section: "Player" }),
      ]
      : []),
    action("Stop", async () => {
      await stop(c.abs);
      updateCommandMetadata({ subtitle: null }).catch(() => {});
      await toast(book ? "Stopped, progress saved" : "Stopped", { style: "success" });
      return refresh();
    }, { icon: Icons.stop, shortcut: "<Ctrl>period", section: "Player" }),
  ];
}

export function nowPlayingItem(s: PlayerState, c: Ctx): Item {
  const p = s.playing;
  const e = s.entry;
  const book = p.source === "abs" && p.abs;
  const title = book ? p.title : e?.title ?? p.title;
  const where = book && s.bookTime !== undefined
    ? `${clock(s.bookTime)} / ${clock(p.abs!.duration)}`
    : s.position !== undefined && s.duration
    ? `${clock(s.position)} / ${clock(s.duration)}`
    : undefined;
  const lines: Metadata[] = [];
  if (e?.artist) lines.push(meta.text(book ? "Author" : "Artist", e.artist, { icon: Icons.person }));
  if (!book && e?.album) lines.push(meta.text("Album", e.album, { icon: Icons.music }));
  if (s.chapter) lines.push(meta.text("Chapter", s.chapter.title, { icon: Icons.bookmark }));
  if (!book && p.entries.length > 1) {
    lines.push(
      meta.text("Queue", `${s.index + 1} of ${p.entries.length}${p.shuffle ? " · shuffled" : ""}`, {
        icon: Icons.layers,
      }),
    );
  }
  if (book && s.bookTime !== undefined && p.abs!.duration) {
    lines.push(meta.progress("Progress", s.bookTime / p.abs!.duration, where));
  } else if (s.position !== undefined && s.duration) {
    lines.push(meta.progress("Position", s.position / s.duration, where));
  }
  lines.push(meta.text("State", s.paused ? "Paused" : "Playing", { icon: s.paused ? Icons.pause : Icons.play }));
  return {
    id: "now-playing",
    title,
    subtitle: book
      ? (s.chapter?.title ?? e?.artist)
      : [e?.artist, p.title !== e?.title ? p.title : ""].filter(Boolean).join(" · "),
    icon: p.cover ?? { source: s.paused ? Icons.pause : Icons.play, tint: s.paused ? "gray" : "green" },
    section: "Now Playing",
    accessories: [...(where ? [{ text: where }] : []), {
      icon: { source: s.paused ? Icons.pause : Icons.play, tint: s.paused ? "gray" : "green" },
    }],
    detail: { image: p.cover, metadata: lines },
    actions: playerActions(s, c),
  };
}

// ---------------------------------------------------------------------------
// Subsonic

function starAction(
  sub: Subsonic,
  id: string,
  starred: boolean | undefined,
  kind: "song" | "album" | "artist",
): Action {
  return action(starred ? "Remove Star" : "Star", async () => {
    await sub.star(id, !starred, kind);
    await toast(starred ? "Star removed" : "Starred", { style: "success" });
    return refresh();
  }, { icon: starred ? Icons.star : Icons.starFilled, shortcut: "<Ctrl>s" });
}

export function albumItem(sub: Subsonic, a: Album, c: Ctx, o: { section?: string } = {}): Item {
  const pic = cover(c, subsonicCover(sub, a.coverArt));
  const info = [a.songCount ? plural(a.songCount, "song") : "", duration(a.duration) ?? ""].filter(Boolean).join(" · ");
  const loadSongs = async () => trackOrder((await sub.album(a.id)).songs ?? []);
  return {
    id: `album:${a.id}`,
    title: a.name,
    subtitle: a.artist,
    icon: pic ?? { source: Icons.music, tint: "pink" },
    section: o.section,
    keywords: [a.artist ?? "", a.genre ?? "", String(a.year ?? "")],
    accessories: [
      ...(a.starred ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const } }] : []),
      ...(a.year ? [{ text: String(a.year) }] : []),
      ...(info ? [{ text: info }] : []),
    ],
    detail: {
      image: pic,
      metadata: [
        ...(a.artist ? [meta.text("Artist", a.artist, { icon: Icons.person })] : []),
        ...(a.year ? [meta.text("Year", String(a.year), { icon: Icons.calendar })] : []),
        ...(a.genre ? [meta.tags("Genre", a.genre.split(/[;,]\s*/))] : []),
        ...(a.songCount ? [meta.text("Songs", String(a.songCount), { icon: Icons.music })] : []),
        ...(duration(a.duration) ? [meta.text("Length", duration(a.duration)!, { icon: Icons.clock })] : []),
        ...(a.playCount ? [meta.text("Plays", String(a.playCount))] : []),
      ],
    },
    actions: [
      action(
        "Play Album",
        () => starting(async () => playSongs(sub, a.name, await loadSongs(), { cover: pic, abs: c.abs })),
        {
          icon: Icons.play,
        },
      ),
      action(
        "Shuffle Album",
        () =>
          starting(async () => playSongs(sub, a.name, await loadSongs(), { shuffle: true, cover: pic, abs: c.abs })),
        {
          icon: Icons.shuffle,
        },
      ),
      action("Show Songs", () => songsView(sub, a.name, loadSongs, c, pic), {
        icon: Icons.layers,
        shortcut: "<Ctrl>o",
      }),
      starAction(sub, a.id, a.starred, "album"),
      ...(a.artistId
        ? [
          action(`More by ${a.artist ?? "the Artist"}`, () =>
            artistView(sub, { id: a.artistId!, name: a.artist ?? "Artist" }, c), {
            icon: Icons.person,
            shortcut: "<Ctrl>a",
          }),
        ]
        : []),
      open(sub.webUrl(a), "Open in the Web App", { shortcut: "<Ctrl>w" }),
    ],
  };
}

export function songItem(
  sub: Subsonic,
  s: Song,
  c: Ctx,
  o: { section?: string; queue?: Song[]; index?: number; queueTitle?: string; showAlbum?: boolean } = {},
): Item {
  const pic = cover(c, subsonicCover(sub, s.coverArt));
  const fromHere = o.queue && o.index !== undefined;
  return {
    id: `song:${s.id}`,
    title: s.title,
    subtitle: o.showAlbum === false ? s.artist : [s.artist, s.album].filter(Boolean).join(" · "),
    icon: pic ?? { source: Icons.music, tint: "pink" },
    section: o.section,
    keywords: [s.artist ?? "", s.album ?? ""],
    accessories: [
      ...(s.starred ? [{ icon: { source: Icons.starFilled, tint: "yellow" as const } }] : []),
      ...(s.track && o.showAlbum === false ? [{ text: `#${s.track}` }] : []),
      ...(s.duration ? [{ text: clock(s.duration) }] : []),
    ],
    detail: {
      image: pic,
      metadata: [
        ...(s.artist ? [meta.text("Artist", s.artist, { icon: Icons.person })] : []),
        ...(s.album ? [meta.text("Album", s.album, { icon: Icons.music })] : []),
        ...(s.year ? [meta.text("Year", String(s.year), { icon: Icons.calendar })] : []),
        ...(s.genre ? [meta.text("Genre", s.genre)] : []),
        ...(s.duration ? [meta.text("Length", clock(s.duration), { icon: Icons.clock })] : []),
        ...(s.suffix
          ? [
            meta.text(
              "Format",
              [s.suffix.toUpperCase(), s.bitRate ? `${s.bitRate} kbps` : ""].filter(Boolean).join(" · "),
            ),
          ]
          : []),
      ],
    },
    actions: [
      fromHere
        ? action(
          "Play from Here",
          () =>
            starting(() =>
              playSongs(sub, o.queueTitle ?? s.title, o.queue!, { from: o.index, cover: pic, abs: c.abs })
            ),
          {
            icon: Icons.play,
          },
        )
        : action("Play", () => starting(() => playSongs(sub, s.title, [s], { cover: pic, abs: c.abs })), {
          icon: Icons.play,
        }),
      ...(s.albumId
        ? [action("Play Album from This Song", async () => {
          const songs = trackOrder((await sub.album(s.albumId!)).songs ?? []);
          const at = Math.max(0, songs.findIndex((x) => x.id === s.id));
          return starting(() => playSongs(sub, s.album ?? s.title, songs, { from: at, cover: pic, abs: c.abs }));
        }, { icon: Icons.music })]
        : []),
      starAction(sub, s.id, s.starred, "song"),
      copy([s.title, s.artist].filter(Boolean).join(" – "), "Copy Title and Artist", { section: "Copy" }),
    ],
  };
}

export function artistItem(sub: Subsonic, a: Artist, c: Ctx): Item {
  return {
    id: `artist:${a.id}`,
    title: a.name,
    subtitle: a.albumCount ? plural(a.albumCount, "album") : "Artist",
    icon: { source: Icons.person, tint: "pink" },
    section: "Artists",
    accessories: a.starred ? [{ icon: { source: Icons.starFilled, tint: "yellow" } }] : [],
    actions: [
      action("Show Albums", () => artistView(sub, a, c), { icon: Icons.layers }),
      starAction(sub, a.id, a.starred, "artist"),
    ],
  };
}

export function playlistItem(sub: Subsonic, p: Playlist, c: Ctx): Item {
  const pic = cover(c, subsonicCover(sub, p.coverArt));
  const loadSongs = async () => (await sub.playlist(p.id)).songs ?? [];
  return {
    id: `playlist:${p.id}`,
    title: p.name,
    subtitle: [p.owner, p.comment].filter(Boolean).join(" · ") || undefined,
    icon: pic ?? { source: Icons.layers, tint: "purple" },
    section: "Playlists",
    accessories: [
      ...(p.songCount ? [{ text: plural(p.songCount, "song") }] : []),
      ...(duration(p.duration) ? [{ text: duration(p.duration)! }] : []),
    ],
    detail: {
      image: pic,
      metadata: [
        ...(p.owner ? [meta.text("Owner", p.owner, { icon: Icons.person })] : []),
        ...(p.songCount ? [meta.text("Songs", String(p.songCount), { icon: Icons.music })] : []),
        ...(duration(p.duration) ? [meta.text("Length", duration(p.duration)!, { icon: Icons.clock })] : []),
        meta.text("Visibility", p.public ? "Public" : "Private", { icon: p.public ? Icons.globe : Icons.lock }),
      ],
    },
    actions: [
      action(
        "Play Playlist",
        () => starting(async () => playSongs(sub, p.name, await loadSongs(), { cover: pic, abs: c.abs })),
        {
          icon: Icons.play,
        },
      ),
      action(
        "Shuffle Playlist",
        () =>
          starting(async () => playSongs(sub, p.name, await loadSongs(), { shuffle: true, cover: pic, abs: c.abs })),
        {
          icon: Icons.shuffle,
        },
      ),
      action("Show Songs", () => songsView(sub, p.name, loadSongs, c, pic), {
        icon: Icons.layers,
        shortcut: "<Ctrl>o",
      }),
    ],
  };
}

export function randomMixAction(sub: Subsonic, c: Ctx): Action {
  return action(
    "Play a Random Mix",
    () => starting(async () => playSongs(sub, "Random Mix", await sub.random(60), { abs: c.abs })),
    {
      icon: Icons.shuffle,
      shortcut: "<Ctrl>m",
    },
  );
}

function songsView(sub: Subsonic, title: string, load: () => Promise<Song[]>, c: Ctx, pic?: string): ListSpec {
  return list({
    title,
    placeholder: `Songs of ${title}…`,
    empty: { title: "No songs", icon: Icons.music },
    status: (items) => plural(items.length, "song"),
    async items({ signal }) {
      const songs = await load();
      const pics = await covers(songs.map((s) => subsonicCover(sub, s.coverArt)).filter((r) => r !== undefined), {
        signal,
      });
      const own = { ...c, pics: new Map([...c.pics, ...pics]) };
      return songs.map((s, i) => {
        const item = songItem(sub, s, own, { queue: songs, index: i, queueTitle: title, showAlbum: false });
        return pic && !own.pics.get(subsonicCover(sub, s.coverArt)?.key ?? "") ? { ...item, icon: pic } : item;
      });
    },
  });
}

function artistView(sub: Subsonic, a: Pick<Artist, "id" | "name">, c: Ctx): ListSpec {
  return list({
    title: a.name,
    placeholder: `Albums by ${a.name}…`,
    empty: { title: "No albums", icon: Icons.music },
    status: (items) => plural(items.length, "album"),
    async items({ signal }) {
      const albums = (await sub.artistAlbums(a.id, signal)).sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
      const pics = await covers(albums.map((x) => subsonicCover(sub, x.coverArt)).filter((r) => r !== undefined), {
        signal,
      });
      const own = { ...c, pics: new Map([...c.pics, ...pics]) };
      return albums.map((x) => albumItem(sub, x, own));
    },
  });
}

// ---------------------------------------------------------------------------
// Audiobookshelf

function absProgressLines(item: AbsItem): Metadata[] {
  const p = item.progress;
  if (!p) return [];
  if (p.isFinished) return [meta.text("Status", "Finished", { icon: Icons.done, color: "green" })];
  if (!p.duration || !p.currentTime) return [];
  return [
    meta.progress(
      "Progress",
      p.progress || p.currentTime / p.duration,
      `${clock(p.currentTime)} / ${clock(p.duration)}`,
    ),
  ];
}

export function bookItem(abs: Abs, item: AbsItem, c: Ctx, o: { section?: string } = {}): Item {
  const pic = cover(c, absCover(abs, item));
  if (item.mediaType === "podcast") return podcastItem(abs, item, c, pic, o);
  const p = item.progress;
  const accessories: Accessory[] = [];
  if (p?.isFinished) accessories.push({ icon: { source: Icons.done, tint: "green" }, tooltip: "Finished" });
  else if (p?.currentTime && p.duration) {
    accessories.push({ text: left(p) ?? "", tooltip: `${Math.round((p.progress || 0) * 100)} %` });
  } else if (duration(item.duration)) accessories.push({ text: duration(item.duration)! });
  const resume = resumeAt(p);
  const description = htmlToText(item.description);
  return {
    id: `abs:${item.id}`,
    title: item.title,
    subtitle: [item.author, item.series].filter(Boolean).join(" · ") || undefined,
    icon: pic ?? { source: Icons.headphones, tint: "orange" },
    section: o.section,
    keywords: [item.author ?? "", item.narrator ?? "", item.series ?? "", ...item.genres],
    accessories,
    detail: {
      image: pic,
      markdown: description ? description.slice(0, 1500) : undefined,
      metadata: [
        ...(item.author ? [meta.person("Author", item.author)] : []),
        ...(item.narrator ? [meta.text("Narrator", item.narrator, { icon: Icons.mic })] : []),
        ...(item.series ? [meta.text("Series", item.series, { icon: Icons.layers })] : []),
        ...(item.year ? [meta.text("Published", item.year, { icon: Icons.calendar })] : []),
        ...(duration(item.duration) ? [meta.text("Length", duration(item.duration)!, { icon: Icons.clock })] : []),
        ...(item.genres.length ? [meta.tags("Genres", item.genres)] : []),
        ...absProgressLines(item),
      ],
    },
    actions: [
      action(
        resume ? `Resume from ${clock(resume)}` : "Play",
        () => starting(() => playBook(abs, item, { cover: pic, speed: c.speed })),
        {
          icon: Icons.play,
        },
      ),
      ...(resume
        ? [
          action("Play from the Start", () =>
            starting(() => playBook(abs, item, { from: 0, cover: pic, speed: c.speed })), {
            icon: Icons.previous,
          }),
        ]
        : []),
      action(p?.isFinished ? "Mark as Not Finished" : "Mark as Finished", async () => {
        await abs.markFinished(item, undefined, !p?.isFinished);
        await toast(p?.isFinished ? "Marked as not finished" : "Marked as finished", { style: "success" });
        return refresh();
      }, { icon: p?.isFinished ? Icons.dottedCircle : Icons.done, shortcut: "<Ctrl>d" }),
      open(abs.webUrl(item), "Open in Audiobookshelf", { shortcut: "<Ctrl>w" }),
    ],
  };
}

function podcastItem(abs: Abs, item: AbsItem, c: Ctx, pic: string | undefined, o: { section?: string }): Item {
  const e = item.recentEpisode;
  return {
    id: `abs:${item.id}${e ? `:${e.id}` : ""}`,
    title: e ? e.title : item.title,
    subtitle: e ? item.title : item.author,
    icon: pic ?? { source: Icons.mic, tint: "purple" },
    section: o.section,
    keywords: [item.title, item.author ?? ""],
    accessories: [
      ...(e && item.progress?.currentTime && item.progress.duration ? [{ text: left(item.progress) ?? "" }] : []),
      ...(!e && item.numEpisodes ? [{ text: plural(item.numEpisodes, "episode") }] : []),
    ],
    detail: {
      image: pic,
      markdown: htmlToText(e?.description ?? item.description).slice(0, 1500) || undefined,
      metadata: [
        meta.text("Podcast", item.title, { icon: Icons.mic }),
        ...(item.author ? [meta.person("Author", item.author)] : []),
        ...(e?.published
          ? [meta.text("Published", new Date(e.published).toLocaleDateString("en-GB"), { icon: Icons.calendar })]
          : []),
        ...(e ? absProgressLines(item) : []),
      ],
    },
    actions: [
      ...(e
        ? [
          action(resumeAt(item.progress) ? `Resume from ${clock(resumeAt(item.progress))}` : "Play", () =>
            starting(() => playEpisode(abs, item, e, { cover: pic, speed: c.speed })), { icon: Icons.play }),
        ]
        : []),
      action("Show Episodes", () => episodesView(abs, item, c, pic), { icon: Icons.layers, shortcut: "<Ctrl>o" }),
      open(abs.webUrl(item), "Open in Audiobookshelf", { shortcut: "<Ctrl>w" }),
    ],
  };
}

function episodesView(abs: Abs, item: AbsItem, c: Ctx, pic?: string): ListSpec {
  return list({
    title: item.title,
    placeholder: `Episodes of ${item.title}…`,
    empty: { title: "No episodes", icon: Icons.mic },
    status: (items) => plural(items.length, "episode"),
    async items({ signal }) {
      const full = await abs.item(item.id, signal);
      return (full.episodes ?? []).map((e): Item => ({
        id: e.id,
        title: e.title,
        subtitle: e.subtitle,
        icon: pic ?? { source: Icons.mic, tint: "purple" },
        accessories: [
          ...(e.published
            ? [{
              text: new Date(e.published).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
                year: "numeric",
              }),
            }]
            : []),
          ...(duration(e.duration) ? [{ text: duration(e.duration)! }] : []),
        ],
        detail: { image: pic, markdown: htmlToText(e.description).slice(0, 2000) || undefined },
        actions: [
          action("Play", () => starting(() => playEpisode(abs, full, e, { cover: pic, speed: c.speed, from: 0 })), {
            icon: Icons.play,
          }),
          action("Mark as Finished", async () => {
            await abs.markFinished(full, e.id, true);
            await toast("Marked as finished", { style: "success" });
          }, { icon: Icons.done, shortcut: "<Ctrl>d" }),
        ],
      }));
    },
  });
}

// ---------------------------------------------------------------------------
// Setup and problems

export function setupItem(which: "subsonic" | "abs"): Item {
  const music = which === "subsonic";
  return {
    id: `setup:${which}`,
    title: music ? "Connect your Navidrome or Subsonic server" : "Connect Audiobookshelf",
    subtitle: music ? "Address, user name and password" : "Address and API token",
    icon: { source: Icons.server, tint: "blue" },
    section: "Setup",
    detail: {
      markdown: music
        ? [
          "## Connect your music server",
          "",
          `In ${SETTINGS}, set:`,
          "",
          "- **Music server address**: `http://192.168.1.10:4533` (Navidrome), Gonic, Airsonic or any Subsonic server",
          "- **User name** and **password** of your account (the password is kept in the system keyring and only",
          "  a salted token is sent)",
        ].join("\n")
        : [
          "## Connect Audiobookshelf",
          "",
          `In ${SETTINGS}, set:`,
          "",
          "- **Audiobookshelf address**: `http://192.168.1.10:13378`",
          "- **API token**: Audiobookshelf → Settings → API Keys (or Users → your user → API token)",
        ].join("\n"),
    },
    actions: [
      open(music ? "https://www.navidrome.org/docs/" : "https://www.audiobookshelf.org/guides/", "Open the Docs"),
    ],
  };
}

export function problemItem(e: SetupError | Error, which: "subsonic" | "abs", base?: string): Item {
  const host = e instanceof SetupError && e.kind === "host";
  const product = which === "subsonic" ? "Music server" : "Audiobookshelf";
  return {
    id: `problem:${which}`,
    title: e.message,
    subtitle: product,
    section: "Setup",
    icon: {
      source: host ? Icons.globe : e instanceof SetupError ? Icons.key : Icons.alert,
      tint: host || e instanceof SetupError ? "orange" : "red",
    },
    detail: {
      markdown: host
        ? [
          `## ${product} address not reachable from Backslash`,
          "",
          "Extensions declare the hosts they may reach. This one covers where a home server usually lives:",
          "",
          "- local names: `*.local`, `*.lan`, `*.home`, `*.home.arpa`, `*.internal`, `localhost`",
          "- private networks: `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`, Tailscale `100.64.x.x` and `*.ts.net`",
          "- DuckDNS (`*.duckdns.org`)",
          "",
          `Use the server's local address in ${SETTINGS}.`,
        ].join("\n")
        : `## ${e.message}\n\n${
          e instanceof SetupError ? `Fix it in ${SETTINGS}.` : base ? `Server: \`${base}\`` : ""
        }`,
    },
    actions: [
      action("Try Again", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r" }),
      ...(base ? [open(base, `Open ${product}`)] : []),
    ],
  };
}

export function noMpvItem(family: Family | undefined): Item {
  const cmd = installCommand(family, "mpv");
  return {
    id: "no-player",
    title: "Install mpv to listen",
    subtitle: family ? cmd : "Music and audiobooks play in the background with mpv",
    section: "Setup",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## mpv is needed",
        "",
        "Music and audiobooks play in the background with **mpv**. Install it:",
        "",
        "```",
        cmd,
        "```",
      ]
        .join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://mpv.io/installation/", "How to Install mpv")],
  };
}

/** The servers configured, and what is wrong with the others. */
export function serversFrom(p: Record<string, unknown>): { sub?: Subsonic; abs?: Abs; problems: Item[] } {
  const problems: Item[] = [];
  let sub: Subsonic | undefined, abs: Abs | undefined;
  try {
    sub = Subsonic.from(p);
  } catch (e) {
    problems.push(problemItem(e as Error, "subsonic"));
  }
  try {
    abs = Abs.from(p);
  } catch (e) {
    problems.push(problemItem(e as Error, "abs"));
  }
  return { sub, abs, problems };
}
