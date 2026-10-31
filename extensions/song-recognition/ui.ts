// Rows: a song with its cover, details and links, the listening state, and
// what to install.

import { type Action, action, copy, Icons, type Item, meta, type Metadata, open, refresh } from "@backslash/api";
import { dayLabel, type Family, installMarkdown, links, type Song, songMarkdown, timeOf } from "./lib.ts";
import { forget, type Tools } from "./system.ts";

export function songItem(s: Song, section: string, extra: Action[] = []): Item {
  const lines: Metadata[] = [meta.text("Artist", s.artist, { icon: Icons.person })];
  if (s.album) lines.push(meta.text("Album", s.album, { icon: Icons.music }));
  if (s.released) lines.push(meta.text("Released", s.released, { icon: Icons.calendar }));
  if (s.genre) lines.push(meta.tags("Genre", [{ text: s.genre, color: "purple" }]));
  if (s.label) lines.push(meta.text("Label", s.label));
  lines.push(meta.separator());
  lines.push(meta.text("Heard", `${dayLabel(s.at)}, ${timeOf(s.at)}`, { icon: Icons.clock }));
  if (s.source) lines.push(meta.text("From", s.source === "mic" ? "Microphone" : "This computer"));
  if (s.shazam) lines.push(meta.link("Shazam", "Open the song's page", s.shazam));
  const [spotify, ...others] = links(s);
  return {
    id: `song-${s.key}-${s.at}`,
    title: s.title,
    subtitle: s.album ? `${s.artist} · ${s.album}` : s.artist,
    icon: s.cover ?? { source: Icons.music, tint: "purple" },
    section,
    keywords: [s.artist, s.album ?? "", s.genre ?? ""],
    accessories: [{ text: section === "Just Now" ? "now" : timeOf(s.at) }],
    detail: { image: s.cover, markdown: songMarkdown(s), metadata: lines },
    actions: [
      open(spotify.url, spotify.title, { icon: Icons.music }),
      ...others.map((l, n) =>
        open(l.url, l.title, {
          icon: l.title.includes("YouTube") ? Icons.video : Icons.external,
          shortcut: n === 0 ? "<Ctrl>y" : undefined,
        })
      ),
      copy(`${s.artist} – ${s.title}`, "Copy Artist and Title", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      ...(s.lyrics ? [copy(s.lyrics.join("\n"), "Copy Lyrics", { section: "Copy" })] : []),
      ...(s.shazam ? [copy(s.shazam, "Copy Shazam Link", { section: "Copy" })] : []),
      ...extra,
      action("Remove from History", async () => {
        await forget(s);
        return refresh();
      }, { icon: Icons.trash, section: "History", shortcut: "<Ctrl>d" }),
      action("Clear History", async () => {
        await forget();
        return refresh();
      }, { icon: Icons.trash, section: "History", destructive: true, confirm: "Forget every recognized song?" }),
    ],
  };
}

/** The history grouped by day. */
export function historyItems(list: Song[], extra: Action[] = []): Item[] {
  return list.map((s) => songItem(s, dayLabel(s.at), extra));
}

export function missingItem(t: Tools, fam?: Family): Item {
  return {
    id: "missing",
    title: t.songrec ? "Nothing to record with" : "SongRec isn't installed",
    subtitle: t.songrec
      ? "Install PipeWire's pw-record or PulseAudio's parecord"
      : "It asks Shazam which song is playing",
    icon: { source: Icons.alert, tint: "red" },
    detail: { markdown: installMarkdown({ songrec: !t.songrec, recorder: !t.recorder }, fam) },
    actions: [open("https://github.com/marin-m/SongRec#installation", "Open SongRec's Page")],
  };
}
