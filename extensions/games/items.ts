// Games as launcher items.

import { type Action, copy, Icons, type Item, meta, type Metadata, open, type Stat } from "@backslash/api";
import {
  ago,
  formatPlaytime,
  formatSize,
  type Game,
  protonDbPage,
  type ProtonSummary,
  sourceIcon,
  SOURCES,
  steamStore,
  tier,
} from "./lib.ts";

const RECENT_DAYS = 14;

export function isRecent(g: Game, now = Date.now()): boolean {
  return !!g.lastPlayed && now - g.lastPlayed < RECENT_DAYS * 86_400_000;
}

function actions(g: Game): Action[] {
  const out: Action[] = [open(g.launch, "Play", { icon: Icons.play })];
  if (g.source === "steam" && g.appid) {
    out.push(
      open(`steam://nav/games/details/${g.appid}`, "Show in Steam Library", { icon: Icons.apps }),
      open(steamStore(g.appid), "Open Store Page", { icon: Icons.globe, shortcut: "<Ctrl>o", section: "Links" }),
      open(protonDbPage(g.appid), "Open on ProtonDB", { icon: Icons.shield, shortcut: "<Ctrl>p", section: "Links" }),
      open(`steam://validate/${g.appid}`, "Verify Game Files", { icon: Icons.check, section: "Steam" }),
      open(`steam://uninstall/${g.appid}`, "Uninstall", {
        icon: Icons.trash,
        destructive: true,
        confirm: `Uninstall ${g.title}? Steam will ask to confirm`,
        section: "Steam",
      }),
    );
  }
  if (g.installDir) {
    out.push(open(g.installDir, "Open Install Folder", { icon: Icons.folder, shortcut: "<Ctrl>f", section: "Files" }));
  }
  out.push(copy(g.title, "Copy Name", { shortcut: "<Ctrl>period", section: "Copy" }));
  if (g.appid) out.push(copy(g.appid, "Copy App ID", { section: "Copy" }));
  if (g.installDir) out.push(copy(g.installDir, "Copy Install Path", { section: "Copy" }));
  return out;
}

export function gameItem(g: Game, proton: ProtonSummary | null | undefined, now = Date.now()): Item {
  const src = SOURCES[g.source];
  const t = tier(proton?.tier);
  const size = formatSize(g.sizeBytes);
  const played = formatPlaytime(g.playtimeMinutes);
  const last = ago(g.lastPlayed, now);
  const stats: Stat[] = [
    ...(size ? [{ label: "Size", value: size }] : []),
    ...(played ? [{ label: "Played", value: played }] : []),
    ...(last ? [{ label: "Last played", value: last }] : []),
    ...(t ? [{ label: "ProtonDB", value: t.label, color: t.color }] : []),
  ];
  const metadata: Metadata[] = [
    meta.text("Launcher", g.runner && g.source === "heroic" ? `Heroic · ${g.runner}` : src.title, {
      icon: Icons.gamepad,
      color: src.tint,
    }),
    ...(g.source === "lutris" && g.runner ? [meta.text("Runner", g.runner, { icon: Icons.cpu })] : []),
    ...(g.platform ? [meta.text("Platform", g.platform, { icon: Icons.monitor })] : []),
    ...(g.year ? [meta.text("Released", g.year, { icon: Icons.calendar })] : []),
    ...(g.appid ? [meta.text("App ID", g.appid, { icon: Icons.hash })] : []),
    ...(g.lastPlayed
      ? [meta.text("Last played", new Date(g.lastPlayed).toLocaleDateString("en-GB", { dateStyle: "medium" }), {
        icon: Icons.clock,
      })]
      : []),
    ...(g.lastUpdated
      ? [meta.text("Updated", new Date(g.lastUpdated).toLocaleDateString("en-GB", { dateStyle: "medium" }), {
        icon: Icons.download,
      })]
      : []),
  ];
  if (proton && t) {
    const trending = tier(proton.trendingTier);
    metadata.push(
      meta.separator(),
      meta.tags("ProtonDB", [
        { text: t.label, color: t.color },
        ...(trending && trending.label !== t.label
          ? [{ text: `trending ${trending.label}`, color: trending.color }]
          : []),
      ]),
      ...(proton.total
        ? [meta.text("Reports", `${proton.total}${proton.confidence ? ` · ${proton.confidence} confidence` : ""}`)]
        : []),
      ...(g.appid ? [meta.link("Details", "protondb.com", protonDbPage(g.appid))] : []),
    );
  }
  if (g.installDir) metadata.push(meta.separator(), meta.text("Folder", g.installDir, { icon: Icons.folder }));
  return {
    id: g.id,
    title: g.title,
    subtitle: g.source === "lutris" && g.runner
      ? `${src.title} · ${g.runner}`
      : g.runner && g.source === "heroic"
      ? g.runner
      : src.title,
    icon: g.icon ?? sourceIcon(g.source),
    keywords: [src.title, g.runner ?? "", g.platform ?? "", g.appid ?? ""].filter(Boolean),
    accessories: [
      ...(t ? [{ tag: t.label, color: t.color, tooltip: "ProtonDB rating" }] : []),
      ...(played ? [{ text: played, icon: Icons.clock, tooltip: "Time played" }] : []),
      ...(size ? [{ text: size, tooltip: "Size on disk" }] : []),
    ],
    detail: { image: g.cover, stats, metadata },
    actions: actions(g),
  };
}
