// Stations and what's playing as launcher items.

import {
  type Accessory,
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  meta,
  type Metadata,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { toggleFavorite } from "./api.ts";
import {
  compact,
  elapsed,
  type Family,
  genreColor,
  installCommand,
  type Player,
  quality,
  type Station,
  tags,
} from "./lib.ts";
import { NoPlayer, play, type Playing, stop } from "./player.ts";

const PLAYER_NAMES: Record<Player, string> = { mpv: "mpv", ffplay: "ffplay", vlc: "VLC" };

export function playAction(s: Station, choices: Player[], title = "Play"): Action {
  return action(title, async () => {
    try {
      await play(s, choices);
    } catch (e) {
      if (e instanceof NoPlayer) {
        await toast(e.message, { style: "failure" });
        return refresh();
      }
      throw e;
    }
    updateCommandMetadata({ subtitle: `Playing ${s.name}` }).catch(() => {});
    return close(`Playing ${s.name}`);
  }, { icon: Icons.play });
}

export const stopAction = (name: string) =>
  action("Stop", async () => {
    await stop();
    updateCommandMetadata({ subtitle: null }).catch(() => {});
    await toast(`${name} stopped`, { style: "success" });
    return refresh();
  }, { icon: Icons.stop, shortcut: "<Ctrl>period" });

function stationMetadata(s: Station): Metadata[] {
  const lines: Metadata[] = [];
  const t = tags(s);
  if (t.length) lines.push(meta.tags("Genres", t.map((text) => ({ text, color: genreColor({ tags: text }) }))));
  const where = [s.state, s.country].filter(Boolean).join(", ");
  if (where) lines.push(meta.text("Country", where, { icon: Icons.globe }));
  if (s.language) lines.push(meta.text("Language", s.language.split(",").slice(0, 3).join(", ")));
  const q = quality(s);
  if (q) lines.push(meta.text("Stream", q, { icon: Icons.radio }));
  if (s.votes) lines.push(meta.text("Votes", compact(s.votes), { icon: Icons.heart }));
  if (s.clickcount) {
    lines.push(
      meta.text(
        "Listeners today",
        `${compact(s.clickcount)}${s.clicktrend ? ` (${s.clicktrend > 0 ? "+" : ""}${s.clicktrend})` : ""}`,
        {
          icon: Icons.activity,
        },
      ),
    );
  }
  if (s.lastcheckok === 0) {
    lines.push(meta.text("Status", "Offline at the last check", { color: "red", icon: Icons.alert }));
  }
  if (s.homepage) {
    let host = s.homepage;
    try {
      host = new URL(s.homepage).hostname.replace(/^www\./, "");
    } catch {
      // Shown as is.
    }
    lines.push(meta.separator(), meta.link("Website", host, s.homepage));
  }
  return lines;
}

export function stationItem(
  s: Station,
  o: { favorite: boolean; playing: boolean; choices: Player[]; section?: string },
): Item {
  const accessories: Accessory[] = [];
  if (o.playing) accessories.push({ tag: "Playing", color: "green" });
  if (o.favorite && o.section !== "Favorites") {
    accessories.push({ icon: { source: Icons.heartFilled, tint: "pink" }, tooltip: "In your favorites" });
  }
  const q = quality(s);
  if (q) accessories.push({ text: q, tooltip: "Codec and bitrate" });
  if (s.countrycode) accessories.push({ tag: s.countrycode, tooltip: s.country });
  const t = tags(s, 4);
  return {
    id: `${o.section ?? ""}:${s.stationuuid}`,
    title: s.name.trim(),
    subtitle: t.slice(0, 3).join(", "),
    section: o.section,
    icon: { source: o.playing ? Icons.speaker : Icons.radio, tint: o.playing ? "green" : genreColor(s) },
    keywords: [...t, s.country ?? "", s.countrycode ?? ""],
    accessories,
    detail: {
      stats: [
        ...(s.bitrate ? [{ label: "Bitrate", value: `${s.bitrate} kbps` }] : []),
        ...(s.votes ? [{ label: "Votes", value: compact(s.votes) }] : []),
        ...(s.countrycode ? [{ label: "Country", value: s.countrycode }] : []),
      ],
      markdown: `**${s.name.trim()}**`,
      metadata: stationMetadata(s),
    },
    actions: [
      o.playing ? stopAction(s.name) : playAction(s, o.choices),
      action(o.favorite ? "Remove from Favorites" : "Add to Favorites", async () => {
        const now = await toggleFavorite(s);
        await toast(`${s.name} ${now ? "added to" : "removed from"} favorites`, { style: "success" });
        return refresh();
      }, { icon: o.favorite ? Icons.heartFilled : Icons.heart, shortcut: "<Ctrl>s" }),
      ...(s.homepage ? [open(s.homepage, "Open Website", { shortcut: "<Ctrl>o" })] : []),
      copy(s.url_resolved || s.url, "Copy Stream URL", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      copy(s.name.trim(), "Copy Name", { section: "Copy" }),
    ],
  };
}

export function nowPlayingItem(p: Playing, song: string | undefined): Item {
  const s = p.station;
  const search = song ?? s.name;
  return {
    id: "now-playing",
    title: song ?? s.name.trim(),
    subtitle: song ? s.name.trim() : `Playing with ${PLAYER_NAMES[p.player]}`,
    section: "Now Playing",
    icon: { source: Icons.speaker, tint: "green" },
    accessories: [{ text: elapsed(Date.now() - p.started), icon: Icons.clock, tooltip: "Playing for" }],
    detail: {
      markdown: song ? `**${song}**\n\non ${s.name.trim()}` : `**${s.name.trim()}**`,
      metadata: [
        meta.text("Station", s.name.trim(), { icon: Icons.radio }),
        ...(song ? [meta.text("Song", song, { icon: Icons.music })] : []),
        meta.text("Player", PLAYER_NAMES[p.player], { icon: Icons.speaker }),
        meta.text("Started", new Date(p.started).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }), {
          icon: Icons.clock,
        }),
        ...stationMetadata(s),
      ],
    },
    actions: [
      stopAction(s.name),
      ...(song ? [copy(song, "Copy Song Title", { shortcut: "<Ctrl><Shift>c" })] : []),
      open(`https://www.youtube.com/results?search_query=${encodeURIComponent(search)}`, "Search on YouTube", {
        icon: Icons.search,
        section: "Open",
      }),
      ...(s.homepage ? [open(s.homepage, "Open Station Website", { section: "Open" })] : []),
    ],
  };
}

export function noPlayerItem(family: Family | undefined): Item {
  const cmd = installCommand(family, "mpv");
  return {
    id: "no-player",
    title: "Install mpv to listen",
    subtitle: family ? cmd : "mpv, ffplay (ffmpeg) or VLC",
    section: "Setup",
    icon: { source: Icons.alert, tint: "orange" },
    detail: {
      markdown: [
        "## No audio player found",
        "",
        "Stations play in the background with **mpv** (recommended: it also shows the song title),",
        "**ffplay** (part of FFmpeg) or **VLC**. Install one:",
        "",
        "```",
        cmd,
        "```",
        "",
        "Then pick it in **Settings → Extensions → Internet Radio → Configure**, or leave `auto`.",
      ].join("\n"),
    },
    actions: family
      ? [copy(cmd, "Copy Install Command")]
      : [open("https://mpv.io/installation/", "How to Install mpv")],
  };
}
