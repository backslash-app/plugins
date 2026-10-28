// Tracks, albums, artists and playlists as launcher items, with their actions.

import {
  type Action,
  action,
  close,
  type Context,
  copy,
  Icons,
  type Item,
  list,
  type ListSpec,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import { type Client, client, devices, liked, play, type PlayTarget, signOut } from "./api.ts";
import {
  type Album,
  type Artist,
  artists,
  compact,
  deviceIcon,
  duration,
  pickImage,
  plainDescription,
  type Playlist,
  popularityColor,
  totalDuration,
  type Track,
  trackCount,
  webUrl,
  year,
} from "./lib.ts";

// ---------------------------------------------------------------------------
// Actions

export function playAction(title: string, target: PlayTarget, what: string, options = {}): Action {
  return action(title, async (ctx) => {
    await play(await client(ctx), target);
    return close(`Playing ${what}`);
  }, { icon: Icons.play, ...options });
}

/** "Play On ›": the user's devices, loaded when the submenu opens. */
export function playOn(target: PlayTarget, what: string): Action {
  return submenu("Play On", async (ctx) => {
    const found = await devices(await client(ctx));
    if (!found.length) {
      return [action("No Device Online", () => toast("Open Spotify on a computer, phone or speaker"), {
        icon: Icons.info,
      })];
    }
    return found.filter((d) => d.id).map((d) =>
      action(`${d.name}${d.is_active ? " (active)" : ""}`, async (c) => {
        await play(await client(c), target, d.id!);
        return close(`Playing ${what} on ${d.name}`);
      }, { icon: deviceIcon(d.type) })
    );
  }, { icon: Icons.speaker, shortcut: "<Ctrl>d", section: "Playback" });
}

export function queueAction(track: { uri: string; name: string }, options = {}): Action {
  return action("Add to Queue", async (ctx) => {
    await (await client(ctx)).send("POST", `/me/player/queue?uri=${encodeURIComponent(track.uri)}`);
    await toast(`${track.name} added to the queue`, { style: "success" });
  }, { icon: Icons.plus, shortcut: "<Ctrl>q", ...options });
}

export function likeAction(track: { id: string; name: string }, isLiked: boolean, options = {}): Action {
  return action(isLiked ? "Remove from Liked Songs" : "Save to Liked Songs", async (ctx) => {
    await (await client(ctx)).send(isLiked ? "DELETE" : "PUT", `/me/tracks?ids=${track.id}`);
    await toast(isLiked ? `Removed ${track.name} from Liked Songs` : `Saved ${track.name} to Liked Songs`, {
      style: "success",
    });
    return refresh();
  }, {
    icon: isLiked ? Icons.heart : Icons.heartFilled,
    shortcut: "<Ctrl>l",
    section: "Library",
    ...options,
  });
}

export const signOutAction = action("Sign Out of Spotify", async (ctx) => {
  await signOut(ctx);
  return close("Signed out of Spotify");
}, { icon: Icons.power, destructive: true, confirm: "Sign out of Spotify?", section: "Account" });

function openActions(kind: string, id: string, uri: string, web?: string): Action[] {
  const url = web ?? webUrl(kind, id);
  return [
    open(uri, "Open in Spotify", { icon: Icons.music, shortcut: "<Ctrl>o", section: "Open" }),
    open(url, "Open in Browser", { section: "Open" }),
    copy(url, "Copy Link", { shortcut: "<Ctrl><Shift>c", section: "Copy" }),
  ];
}

// ---------------------------------------------------------------------------
// Items

export interface TrackOptions {
  liked?: Set<string>;
  /** Album or playlist the track belongs to: playing it continues with the next ones. */
  context?: string;
  section?: string;
  /** Shown instead of the duration, e.g. a track number. */
  position?: number;
}

export function trackItem(t: Track, o: TrackOptions = {}): Item {
  const isLiked = o.liked?.has(t.id) ?? false;
  const cover = pickImage(t.album?.images, "large");
  const who = artists(t.artists);
  const target: PlayTarget = o.context && !t.is_local ? { context: o.context, offset: t.uri } : { uris: [t.uri] };
  return {
    id: `track:${t.id}:${o.position ?? ""}`,
    title: t.name,
    subtitle: who,
    icon: pickImage(t.album?.images, "small") ?? { source: Icons.music, tint: "green" },
    section: o.section,
    keywords: [who, t.album?.name ?? ""],
    accessories: [
      ...(isLiked ? [{ icon: { source: Icons.heartFilled, tint: "green" as const }, tooltip: "In Liked Songs" }] : []),
      ...(t.explicit ? [{ tag: "E", tooltip: "Explicit" }] : []),
      { text: duration(t.duration_ms) },
    ],
    detail: {
      image: cover,
      metadata: [
        meta.text("Artist", who, { icon: Icons.person }),
        ...(t.album ? [meta.text("Album", t.album.name, { icon: Icons.music })] : []),
        ...(t.album?.release_date ? [meta.text("Released", t.album.release_date, { icon: Icons.calendar })] : []),
        meta.text("Duration", duration(t.duration_ms), { icon: Icons.clock }),
        ...(t.popularity !== undefined ? [meta.progress("Popularity", t.popularity / 100)] : []),
        ...(o.liked
          ? [meta.text("Liked Songs", isLiked ? "Saved" : "Not saved", {
            icon: isLiked ? Icons.heartFilled : Icons.heart,
            color: isLiked ? "green" : undefined,
          })]
          : []),
        ...(t.explicit ? [meta.tags("Content", [{ text: "Explicit", color: "red" }])] : []),
      ],
    },
    actions: [
      playAction("Play", target, t.name),
      queueAction(t),
      playOn(target, t.name),
      ...(t.is_local ? [] : [likeAction(t, isLiked)]),
      ...(t.album
        ? [
          action("Go to Album", () => albumView(t.album!), {
            icon: Icons.music,
            shortcut: "<Ctrl>a",
            section: "Browse",
          }),
        ]
        : []),
      ...(t.artists[0]
        ? [action(`Go to ${t.artists[0].name}`, () => artistView(t.artists[0]), {
          icon: Icons.person,
          shortcut: "<Ctrl>r",
          section: "Browse",
        })]
        : []),
      ...openActions("track", t.id, t.uri, t.external_urls?.spotify),
      copy(`${who} – ${t.name}`, "Copy Artist and Title", { section: "Copy" }),
      signOutAction,
    ],
  };
}

export function albumItem(a: Album, section?: string): Item {
  const who = artists(a.artists);
  return {
    id: `album:${a.id}`,
    title: a.name,
    subtitle: who,
    icon: pickImage(a.images, "small") ?? { source: Icons.music, tint: "purple" },
    section,
    keywords: [who],
    accessories: [
      ...(a.album_type && a.album_type !== "album" ? [{ tag: a.album_type }] : []),
      ...(year(a.release_date) ? [{ text: year(a.release_date)! }] : []),
    ],
    detail: {
      image: pickImage(a.images, "large"),
      metadata: [
        meta.text("Artist", who, { icon: Icons.person }),
        ...(a.release_date ? [meta.text("Released", a.release_date, { icon: Icons.calendar })] : []),
        ...(a.total_tracks ? [meta.text("Tracks", a.total_tracks, { icon: Icons.music })] : []),
        ...(a.album_type ? [meta.tags("Type", [{ text: a.album_type, color: "purple" }])] : []),
      ],
    },
    actions: [
      playAction("Play Album", { context: a.uri }, a.name),
      action("Show Tracks", () => albumView(a), { icon: Icons.music, shortcut: "<Ctrl>t" }),
      playOn({ context: a.uri }, a.name),
      ...(a.artists[0]
        ? [action(`Go to ${a.artists[0].name}`, () => artistView(a.artists[0]), {
          icon: Icons.person,
          shortcut: "<Ctrl>r",
          section: "Browse",
        })]
        : []),
      ...openActions("album", a.id, a.uri, a.external_urls?.spotify),
      signOutAction,
    ],
  };
}

export function artistItem(a: Artist, section?: string): Item {
  return {
    id: `artist:${a.id}`,
    title: a.name,
    subtitle: a.genres?.slice(0, 2).join(", ") || undefined,
    icon: pickImage(a.images, "small") ?? { source: Icons.person, tint: "blue" },
    section,
    keywords: a.genres ?? [],
    accessories: a.followers ? [{ text: `${compact(a.followers.total)} followers` }] : [],
    detail: {
      image: pickImage(a.images, "large"),
      metadata: [
        ...(a.followers
          ? [meta.text("Followers", a.followers.total.toLocaleString("en"), { icon: Icons.person })]
          : []),
        ...(a.popularity !== undefined ? [meta.progress("Popularity", a.popularity / 100)] : []),
        ...(a.genres?.length
          ? [
            meta.tags(
              "Genres",
              a.genres.slice(0, 5).map((g) => ({ text: g, color: popularityColor(a.popularity ?? 0) })),
            ),
          ]
          : []),
      ],
    },
    actions: [
      playAction("Play Artist", { context: a.uri }, a.name),
      action("Show Top Tracks", () => artistView(a), { icon: Icons.star, shortcut: "<Ctrl>t" }),
      playOn({ context: a.uri }, a.name),
      ...openActions("artist", a.id, a.uri, a.external_urls?.spotify),
      signOutAction,
    ],
  };
}

export function playlistItem(p: Playlist, section?: string): Item {
  const description = plainDescription(p.description);
  const owner = p.owner?.display_name ?? p.owner?.id ?? "";
  const n = trackCount(p);
  return {
    id: `playlist:${p.id}`,
    title: p.name,
    subtitle: owner ? `by ${owner}` : undefined,
    icon: pickImage(p.images, "small") ?? { source: Icons.music, tint: "green" },
    section,
    keywords: [owner, description],
    accessories: [
      ...(p.collaborative ? [{ tag: "Collaborative" }] : []),
      ...(n ? [{ text: `${n} tracks` }] : []),
    ],
    detail: {
      image: pickImage(p.images, "large"),
      markdown: description || undefined,
      metadata: [
        ...(owner ? [meta.person("Owner", owner)] : []),
        meta.text("Tracks", n, { icon: Icons.music }),
        ...(p.public !== undefined && p.public !== null
          ? [meta.text("Visibility", p.public ? "Public" : "Private", { icon: p.public ? Icons.globe : Icons.lock })]
          : []),
        ...(p.collaborative ? [meta.tags("Type", [{ text: "Collaborative", color: "teal" }])] : []),
      ],
    },
    actions: [
      playAction("Play Playlist", { context: p.uri }, p.name),
      action("Shuffle Play", async (ctx) => {
        const api = await client(ctx);
        await api.send("PUT", "/me/player/shuffle?state=true").catch(() => {});
        await play(api, { context: p.uri });
        return close(`Shuffling ${p.name}`);
      }, { icon: Icons.shuffle, shortcut: "<Ctrl>s", section: "Playback" }),
      action("Show Tracks", () => playlistView(p), { icon: Icons.music, shortcut: "<Ctrl>t" }),
      playOn({ context: p.uri }, p.name),
      ...openActions("playlist", p.id, p.uri, p.external_urls?.spotify),
      signOutAction,
    ],
  };
}

// ---------------------------------------------------------------------------
// Track lists

function tracksView(
  title: string,
  load: (api: Client, ctx: Context) => Promise<Track[]>,
  options: { context?: string; numbered?: boolean } = {},
): ListSpec {
  return list({
    title,
    placeholder: `Filter ${title}…`,
    empty: { title: "No tracks", icon: Icons.music },
    status: (items) => `${title} · ${items.length} tracks`,
    async items(ctx) {
      const api = await client(ctx);
      const tracks = (await load(api, ctx)).filter((t) => t?.id || t?.is_local);
      const likedSet = await liked(api, tracks.filter((t) => t.id).map((t) => t.id));
      const total = tracks.reduce((s, t) => s + t.duration_ms, 0);
      return tracks.map((t, i) => {
        const item = trackItem(t, { liked: likedSet, context: options.context, position: i });
        return options.numbered ? { ...item, section: `${tracks.length} tracks · ${totalDuration(total)}` } : item;
      });
    },
  });
}

export function albumView(a: Album): ListSpec {
  return tracksView(a.name, async (api, ctx) => {
    const full = await api.get<Album & { tracks: { items: Track[] } }>(`/albums/${a.id}`, ctx.signal);
    const album = full ?? a;
    return (full?.tracks.items ?? []).map((t) => ({ ...t, album }));
  }, { context: a.uri, numbered: true });
}

export function artistView(a: { id: string; name: string; uri: string }): ListSpec {
  return tracksView(`${a.name}: Top Tracks`, async (api, ctx) => {
    const res = await api.get<{ tracks: Track[] }>(`/artists/${a.id}/top-tracks?market=from_token`, ctx.signal);
    return res?.tracks ?? [];
  });
}

type Entry = { track?: Track | null; item?: Track | null };

export function playlistView(p: Playlist): ListSpec {
  return tracksView(p.name, async (api, ctx) => {
    const entries: Entry[] = [];
    // Newer apps read playlist contents from /items, older ones from /tracks.
    let next: string | undefined = `/playlists/${p.id}/tracks?limit=100`;
    try {
      while (next && entries.length < 500) {
        const page: { items: Entry[]; next?: string | null } | undefined = await api.get(next, ctx.signal);
        entries.push(...(page?.items ?? []));
        next = page?.next ?? undefined;
      }
    } catch (e) {
      if (entries.length || ctx.signal.aborted) throw e;
      const page = await api.get<{ items: Entry[] }>(`/playlists/${p.id}/items?limit=100`, ctx.signal);
      entries.push(...(page?.items ?? []));
    }
    return entries.map((e) => e.track ?? e.item).filter((t): t is Track => !!t && (t.type ?? "track") === "track");
  }, { context: p.uri, numbered: true });
}

export function likedSongsView(): ListSpec {
  return tracksView("Liked Songs", async (api, ctx) => {
    const tracks: Track[] = [];
    let next: string | undefined = "/me/tracks?limit=50";
    while (next && tracks.length < 300) {
      const page: { items: { track: Track }[]; next?: string | null } | undefined = await api.get(next, ctx.signal);
      tracks.push(...(page?.items ?? []).map((i) => i.track));
      next = page?.next ?? undefined;
    }
    return tracks;
  });
}
