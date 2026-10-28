import { action, copy, Icons, type Item, list, meta, open, refresh, updateCommandMetadata } from "@backslash/api";
import { type Client, client, devices, liked } from "../api.ts";
import {
  artists,
  type Device,
  deviceIcon,
  duration,
  type Episode,
  pickImage,
  type PlaybackState,
  type Track,
  webUrl,
} from "../lib.ts";
import { likeAction, signOutAction, trackItem } from "../views.ts";

const REPEAT = { off: "Off", track: "Track", context: "On" } as const;

function deviceItem(d: Device): Item {
  return {
    id: `device:${d.id ?? d.name}`,
    title: d.name,
    subtitle: d.is_active ? "Playing here" : d.type,
    icon: { source: deviceIcon(d.type), tint: d.is_active ? "green" : "gray" },
    section: "Devices",
    accessories: [
      ...(d.volume_percent !== null && d.volume_percent !== undefined
        ? [{ text: `${d.volume_percent} %`, icon: Icons.speaker, tooltip: "Volume" }]
        : []),
      ...(d.is_active ? [{ tag: "Active" }] : []),
    ],
    detail: {
      metadata: [
        meta.text("Type", d.type, { icon: deviceIcon(d.type) }),
        meta.text("Status", d.is_active ? "Active" : "Available", {
          icon: d.is_active ? Icons.play : Icons.pause,
          color: d.is_active ? "green" : undefined,
        }),
        ...(d.volume_percent !== null && d.volume_percent !== undefined
          ? [meta.progress("Volume", d.volume_percent / 100)]
          : []),
        ...(d.is_restricted ? [meta.text("Control", "Restricted by the device", { icon: Icons.lock })] : []),
      ],
    },
    actions: d.id && !d.is_active
      ? [
        action("Transfer Playback Here", async (ctx) => {
          await (await client(ctx)).send("PUT", "/me/player", { device_ids: [d.id], play: true });
          return refresh();
        }, { icon: Icons.speaker }),
        signOutAction,
      ]
      : [signOutAction],
  };
}

function currentItem(state: PlaybackState, likedSet: Set<string>): Item {
  const progress = state.progress_ms ?? 0;
  const item = state.item!;
  const where = `${duration(progress)} / ${duration(item.duration_ms)}`;
  const playing = state.is_playing;
  const extra = [
    meta.separator(),
    meta.progress("Position", item.duration_ms ? progress / item.duration_ms : 0, where),
    ...(state.device ? [meta.text("Device", state.device.name, { icon: deviceIcon(state.device.type) })] : []),
    meta.text("Shuffle", state.shuffle_state ? "On" : "Off", { icon: Icons.shuffle }),
    meta.text("Repeat", REPEAT[state.repeat_state ?? "off"], { icon: Icons.repeat }),
  ];
  const status = {
    icon: { source: playing ? Icons.play : Icons.pause, tint: playing ? "green" as const : "gray" as const },
  };
  if (item.type === "episode") {
    const ep = item as Episode;
    const url = ep.external_urls?.spotify ?? webUrl("episode", ep.id);
    return {
      id: `now:${ep.id}`,
      title: ep.name,
      subtitle: ep.show?.name,
      icon: pickImage(ep.images, "small") ?? { source: Icons.mic, tint: "green" },
      section: playing ? "Now Playing" : "Paused",
      accessories: [{ text: where }, { ...status, text: state.device?.name }],
      detail: {
        image: pickImage(ep.images, "large"),
        metadata: [
          ...(ep.show ? [meta.text("Show", ep.show.name, { icon: Icons.mic })] : []),
          ...(ep.release_date ? [meta.text("Released", ep.release_date, { icon: Icons.calendar })] : []),
          ...extra,
        ],
      },
      actions: [open(ep.uri, "Open in Spotify", { icon: Icons.music }), copy(url, "Copy Link"), signOutAction],
    };
  }
  const track = item as Track;
  const base = trackItem(track, { liked: likedSet });
  const isLiked = likedSet.has(track.id);
  const actions = base.actions ?? [];
  // Playback itself is the Media extension's job: here, the library and links come first.
  const first = likeAction(track, isLiked, { section: undefined });
  return {
    ...base,
    id: `now:${track.id}`,
    section: playing ? "Now Playing" : "Paused",
    accessories: [
      ...(isLiked ? [{ icon: { source: Icons.heartFilled, tint: "green" as const }, tooltip: "In Liked Songs" }] : []),
      { text: where },
      { ...status, text: state.device?.name },
    ],
    detail: { ...base.detail, metadata: [...(base.detail?.metadata ?? []), ...extra] },
    actions: [
      first,
      ...actions.filter((a) =>
        !["Play", "Add to Queue", "Save to Liked Songs", "Remove from Liked Songs"].includes(a.title)
      ),
    ],
  };
}

async function load(api: Client, signal: AbortSignal, wantDevices: boolean) {
  const state = await api.get<PlaybackState>("/me/player?additional_types=episode", signal);
  const [queue, deviceList] = await Promise.all([
    state?.item
      ? api.get<{ queue: (Track | Episode)[] }>("/me/player/queue", signal).catch(() => undefined)
      : undefined,
    wantDevices ? devices(api).catch(() => []) : Promise.resolve(undefined),
  ]);
  return { state, queue: queue?.queue ?? [], deviceList };
}

export default list({
  placeholder: "Filter…",
  empty: {
    title: "Nothing is playing on Spotify",
    description: "Start playing on any device, or search with Search Spotify",
    icon: Icons.music,
  },
  status: (items) => {
    const now = items.find((i) => i.id?.startsWith("now:"));
    return now ? `${now.title} · ${now.subtitle ?? ""}` : "Spotify";
  },
  // Refreshed every 5 seconds while open: the position and track changes.
  async *items(ctx) {
    const api = await client(ctx);
    let last = "";
    let lastSong = "";
    let deviceList: Device[] = [];
    for (let round = 0; !ctx.signal.aborted; round++) {
      const res = await load(api, ctx.signal, round % 3 === 0);
      if (res.deviceList) deviceList = res.deviceList;
      const { state } = res;
      const items: Item[] = [];
      const tracks = [state?.item, ...res.queue].filter((t): t is Track => !!t && t.type !== "episode" && !!t.id);
      const likedSet = await liked(api, [...new Set(tracks.map((t) => t.id))].slice(0, 50));
      if (state?.item) {
        items.push(currentItem(state, likedSet));
        items.push(
          ...res.queue.slice(0, 10).filter((t): t is Track => t.type !== "episode").map((t, i) => ({
            ...trackItem(t, { liked: likedSet, position: i }),
            section: "Up Next",
          })),
        );
      } else {
        const recent = await api.get<{ items: { track: Track; played_at: string }[] }>(
          "/me/player/recently-played?limit=10",
          ctx.signal,
        ).catch(() => undefined);
        items.push(...(recent?.items ?? []).map((r, i) => ({
          ...trackItem(r.track, { position: i }),
          section: "Recently Played",
        })));
      }
      items.push(...deviceList.map(deviceItem));
      const song = state?.item && state.is_playing
        ? `${state.item.name} — ${
          state.item.type === "episode"
            ? (state.item as Episode).show?.name ?? ""
            : artists((state.item as Track).artists)
        }`
        : "";
      if (song !== lastSong) {
        lastSong = song;
        updateCommandMetadata({ subtitle: song || null }).catch(() => {});
      }
      const key = JSON.stringify(items.map((i) => [i.id, i.accessories, i.detail?.metadata]));
      if (key !== last) {
        last = key;
        yield items;
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  },
  actions: [
    open("spotify:", "Open Spotify", { icon: Icons.music }),
    signOutAction,
  ],
});
