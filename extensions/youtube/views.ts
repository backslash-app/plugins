// Videos as launcher items, a channel's uploads and what's playing.

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
} from "@backslash/api";
import { type Account, channelVideos, guarded } from "./api.ts";
import {
  ago,
  channelUrl,
  clock,
  compact,
  excerpt,
  installCommand,
  longDate,
  shortUrl,
  thumbnail,
  type Video,
  views,
  watchUrl,
} from "./lib.ts";
import { distro, MissingTool, play, type Playing, stop } from "./player.ts";

export interface Options {
  account: Account;
  enter: "browser" | "mpv";
  section?: string;
  playing?: string;
}

function playAction(v: Video, audioOnly: boolean): Action {
  return action(audioOnly ? "Play Audio Only in mpv" : "Play in mpv", async () => {
    try {
      await play(v, audioOnly);
    } catch (e) {
      if (e instanceof MissingTool) {
        const cmd = installCommand(await distro(), e.message.replace("Playing needs ", "").split(" and "));
        await toast(e.message, { style: "failure", message: cmd });
        return;
      }
      throw e;
    }
    return close(audioOnly ? `Playing the audio of ${v.title}` : `Playing ${v.title}`);
  }, { icon: audioOnly ? Icons.headphones : Icons.play, ...(audioOnly ? { shortcut: "<Ctrl><Shift>p" } : {}) });
}

function videoMetadata(v: Video): Metadata[] {
  const lines: Metadata[] = [meta.person("Channel", v.channel)];
  if (v.published) {
    lines.push(meta.text("Published", `${longDate(v.published)} · ${ago(v.published)}`, { icon: Icons.calendar }));
  }
  if (v.seconds) lines.push(meta.text("Duration", clock(v.seconds)!, { icon: Icons.clock }));
  if (v.live) {
    lines.push(meta.tags("Status", [{ text: v.live === "live" ? "Live now" : "Upcoming", color: "red" }]));
  }
  if (v.views !== undefined) {
    lines.push(meta.text("Views", new Intl.NumberFormat("en-US").format(v.views), { icon: Icons.eye }));
  }
  if (v.likes !== undefined) lines.push(meta.text("Likes", compact(v.likes), { icon: Icons.heart }));
  if (v.comments !== undefined) lines.push(meta.text("Comments", compact(v.comments), { icon: Icons.comment }));
  const badges = [...(v.hd ? ["HD"] : []), ...(v.captions ? ["CC"] : [])];
  if (badges.length) lines.push(meta.tags("Quality", badges));
  if (v.tags.length) lines.push(meta.tags("Tags", v.tags.slice(0, 6)));
  lines.push(meta.separator(), meta.link("Link", `youtu.be/${v.id}`, watchUrl(v.id)));
  return lines;
}

export function videoItem(v: Video, o: Options): Item {
  const openIt = open(watchUrl(v.id), "Open in Browser");
  const playing = o.playing === v.id;
  const accessories: Accessory[] = [];
  if (playing) accessories.push({ tag: "Playing", color: "green" });
  if (v.live) accessories.push({ tag: v.live === "live" ? "LIVE" : "Upcoming", color: "red" });
  if (v.views !== undefined) accessories.push({ text: compact(v.views), icon: Icons.eye, tooltip: views(v.views) });
  if (v.seconds) accessories.push({ text: clock(v.seconds), tooltip: "Duration" });
  const actions: Action[] = o.enter === "mpv" ? [playAction(v, false), openIt] : [openIt, playAction(v, false)];
  actions.push(
    playAction(v, true),
    ...(v.channelId
      ? [
        action(`Show ${v.channel || "Channel"} Videos`, () => channelList(o.account, v.channelId!, v.channel, o), {
          icon: Icons.person,
          shortcut: "<Ctrl>u",
        }),
        open(channelUrl(v.channelId), "Open Channel in Browser", { section: "Open" }),
      ]
      : []),
    copy(watchUrl(v.id), "Copy Link", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
    copy(shortUrl(v.id), "Copy Short Link", { section: "Copy" }),
    copy(`[${v.title}](${watchUrl(v.id)})`, "Copy as Markdown Link", { section: "Copy" }),
    copy(v.title, "Copy Title", { section: "Copy" }),
  );
  return {
    id: `${o.section ?? ""}:${v.id}`,
    title: v.title,
    subtitle: [v.channel, ago(v.published)].filter(Boolean).join(" · "),
    section: o.section,
    icon: thumbnail(v.id, "mqdefault"),
    keywords: [v.channel, ...v.tags.slice(0, 5)],
    accessories,
    detail: {
      image: thumbnail(v.id, "hqdefault"),
      stats: [
        ...(v.views !== undefined ? [{ label: "Views", value: compact(v.views) }] : []),
        ...(v.seconds ? [{ label: "Duration", value: clock(v.seconds)! }] : []),
        ...(v.likes !== undefined ? [{ label: "Likes", value: compact(v.likes) }] : []),
      ],
      markdown: [`**${v.title}**`, ...(excerpt(v.description) ? ["", excerpt(v.description)!] : [])].join("\n"),
      metadata: videoMetadata(v),
    },
    actions,
  };
}

export function channelList(account: Account, channelId: string, name: string, o: Options): ListSpec {
  return list({
    title: name || "Channel",
    placeholder: `Filter ${name || "the channel"}'s latest videos…`,
    empty: { title: "No videos", description: "This channel has no public uploads", icon: Icons.video },
    status: (items) => `${items.length} latest upload${items.length === 1 ? "" : "s"} · ${name}`,
    actions: [open(channelUrl(channelId), "Open Channel in Browser")],
    items: ({ signal }) =>
      guarded(async () =>
        (await channelVideos(account, channelId, signal)).map((v) => videoItem(v, { ...o, section: undefined }))
      ),
  });
}

export function nowPlayingItem(p: Playing): Item {
  const v = p.video;
  return {
    id: "now-playing",
    title: v.title,
    subtitle: `${p.audioOnly ? "Audio only" : "Playing"} in mpv · ${v.channel}`,
    section: "Now Playing",
    icon: { source: p.audioOnly ? Icons.headphones : Icons.play, tint: "green" },
    detail: {
      image: thumbnail(v.id, "hqdefault"),
      metadata: [
        meta.text("Started", new Date(p.started).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), {
          icon: Icons.clock,
        }),
        ...videoMetadata(v),
      ],
    },
    actions: [
      action("Stop", async () => {
        await stop();
        await toast("Stopped", { style: "success" });
        return refresh();
      }, { icon: Icons.stop, shortcut: "<Ctrl>period" }),
      open(watchUrl(v.id), "Open in Browser"),
      copy(watchUrl(v.id), "Copy Link", { section: "Copy" }),
    ],
  };
}
