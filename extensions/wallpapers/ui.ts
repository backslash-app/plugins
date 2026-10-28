// Grid tiles and actions shared by the commands.

import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  meta,
  open,
  refresh,
  submenu,
  toast,
} from "@backslash/api";
import {
  aspect,
  type Backend,
  BACKEND_PACKAGES,
  backendCandidates,
  compact,
  DESKTOP_NAMES,
  formatBytes,
  installMarkdown,
  type OnlineWallpaper,
  orientation,
  persistenceHint,
  prettyName,
  resolutionLabel,
  sessionName,
  type Variant,
} from "./lib.ts";
import {
  download,
  family,
  folders,
  NoBackend,
  type Prefs,
  session,
  setWallpaper,
  tilde,
  type Wallpaper,
} from "./system.ts";

const BACKEND_NAMES: Record<Backend, string> = {
  gnome: "GNOME (gsettings)",
  cinnamon: "Cinnamon (gsettings)",
  mate: "MATE (gsettings)",
  kde: "KDE Plasma",
  xfce: "Xfce (xfconf)",
  hyprpaper: "hyprpaper",
  swww: "swww",
  sway: "Sway (swaybg)",
  feh: "feh",
  nitrogen: "nitrogen",
};
export const backendName = (b: Backend) => BACKEND_NAMES[b];

/** Sets the wallpaper and reports it; a missing tool becomes a readable toast. */
async function apply(path: string, prefs: Prefs, variant: Variant = "both"): Promise<Backend | undefined> {
  try {
    const b = await setWallpaper(path, prefs, variant);
    const hint = persistenceHint(b, path);
    await toast(variant === "both" ? "Wallpaper set" : `Set for the ${variant} style`, {
      style: "success",
      message: hint ? "Until you log out: see the details to keep it" : undefined,
    });
    return b;
  } catch (e) {
    if (e instanceof NoBackend) {
      const s = session();
      const fam = await family();
      const pkgs = BACKEND_PACKAGES[backendCandidates(s)[0]];
      await toast(e.message, {
        style: "failure",
        message: fam ? installMarkdown("Install:", pkgs, fam).replace(/[*`\n]+/g, " ").trim() : pkgs.join(", "),
      });
      return undefined;
    }
    throw e;
  }
}

export function setActions(path: string, prefs: Prefs, b: Backend | undefined): Action[] {
  return [
    action("Set Wallpaper", async () => {
      if (await apply(path, prefs)) return close();
    }, { icon: Icons.image }),
    action("Set and Keep Browsing", async () => {
      if (await apply(path, prefs)) return refresh();
    }, { icon: Icons.check }),
    ...(b === "gnome"
      ? [submenu("Set for One Style", [
        action("Light Style Only", async () => {
          if (await apply(path, prefs, "light")) return refresh();
        }, { icon: Icons.sun }),
        action("Dark Style Only", async () => {
          if (await apply(path, prefs, "dark")) return refresh();
        }, { icon: Icons.moon }),
      ], { icon: Icons.palette })]
      : []),
  ];
}

function sizeTags(w: number | undefined, h: number | undefined) {
  if (!w || !h) return [];
  const label = resolutionLabel(w, h);
  return [
    ...(label ? [{ text: label, color: "blue" as const }] : []),
    aspect(w, h),
    orientation(w, h),
  ];
}

export function localItem(w: Wallpaper, current: string | undefined, prefs: Prefs, b: Backend | undefined): Item {
  const isCurrent = current === w.path;
  const dims = w.width && w.height ? `${w.width} × ${w.height}` : undefined;
  const hint = b && isCurrent ? persistenceHint(b, w.path) : undefined;
  return {
    id: w.path,
    title: prettyName(w.name),
    icon: w.thumb ?? w.path,
    section: w.system ? "System" : tilde(w.folder),
    keywords: [
      w.name,
      ...(w.width && w.height ? [orientation(w.width, w.height), resolutionLabel(w.width, w.height) ?? ""] : []),
      ...(isCurrent ? ["current", "actuel"] : []),
    ].filter(Boolean),
    accessories: isCurrent ? [{ icon: { source: Icons.check, tint: "green" }, tooltip: "Current wallpaper" }] : [],
    detail: {
      image: w.path,
      markdown: hint,
      metadata: [
        ...(isCurrent ? [meta.tags("Status", [{ text: "Current wallpaper", color: "green" }])] : []),
        ...(dims ? [meta.text("Resolution", dims, { icon: Icons.monitor })] : []),
        ...(w.width ? [meta.tags("Format", sizeTags(w.width, w.height))] : []),
        meta.text("Size", formatBytes(w.size), { icon: Icons.drive }),
        meta.text("Folder", tilde(w.folder), { icon: Icons.folder }),
        meta.text("Modified", new Date(w.modified).toLocaleDateString([], { dateStyle: "medium" }), {
          icon: Icons.calendar,
        }),
      ],
    },
    actions: [
      ...setActions(w.path, prefs, b),
      open(w.path, "Open Picture", { icon: Icons.eye, section: "File", shortcut: "<Ctrl>o" }),
      open(w.folder, "Open Folder", { icon: Icons.folder, section: "File", shortcut: "<Ctrl><Shift>o" }),
      copy(w.path, "Copy Path", { section: "File", shortcut: "<Ctrl><Shift>c" }),
      ...(w.system ? [] : [
        action("Delete Wallpaper", async () => {
          await Deno.remove(w.path);
          await toast(`Deleted ${w.name}`, { style: "success" });
          return refresh();
        }, {
          icon: Icons.trash,
          destructive: true,
          confirm: `Delete ${w.name}?`,
          shortcut: "<Ctrl>Delete",
          section: "Danger",
        }),
      ]),
    ],
  };
}

/** Shown when no tool can set wallpapers in this session. */
export async function noBackendItem(): Promise<Item> {
  const s = session();
  const candidates = backendCandidates(s);
  const fam = await family();
  return {
    id: "no-backend",
    title: `Can't set wallpapers on ${sessionName(s)}`,
    subtitle: "Install a wallpaper tool",
    icon: { source: Icons.alert, tint: "orange" },
    section: "Setup",
    detail: {
      markdown: [
        installMarkdown(
          `Backslash sets wallpapers with **${candidates.map(backendName).join("** or **")}** on ${sessionName(s)}.`,
          BACKEND_PACKAGES[candidates[0]],
          fam,
        ),
        "",
        "Or pick a tool in **Settings → Extensions → Wallpapers → Configure** (Wallpaper tool).",
      ].join("\n"),
      metadata: [
        meta.text("Desktop", s.desktop === "other" ? sessionName(s) : DESKTOP_NAMES[s.desktop], {
          icon: Icons.monitor,
        }),
        meta.tags("Supported", ["GNOME", "KDE", "Xfce", "Cinnamon", "MATE", "Hyprland", "Sway", "feh", "nitrogen"]),
      ],
    },
    actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
  };
}

export function emptyFoldersItem(prefs: Prefs): Item {
  const first = folders(prefs)[0];
  return {
    id: "empty",
    title: "No wallpapers in your folders yet",
    subtitle: tilde(first),
    icon: { source: Icons.folder, tint: "blue" },
    section: "Your Wallpapers",
    detail: {
      markdown: [
        `Put pictures in **${tilde(first)}**, or download some with **Search Wallpapers Online**.`,
        "",
        "Other folders can be added in **Settings → Extensions → Wallpapers → Configure**, separated by commas.",
      ].join("\n"),
    },
    actions: [open(first, "Open Folder", { icon: Icons.folder })],
  };
}

// ---------------------------------------------------------------------------
// Online

const SOURCE = { wallhaven: "Wallhaven", unsplash: "Unsplash" };

export function onlineItem(w: OnlineWallpaper, prefs: Prefs, downloaded: boolean): Item {
  const dims = w.width && w.height ? `${w.width} × ${w.height}` : undefined;
  const save = async () => {
    try {
      return await download(w, prefs);
    } catch (e) {
      await toast(`Couldn't download from ${SOURCE[w.source]}`, { style: "failure", message: (e as Error).message });
      return undefined;
    }
  };
  return {
    id: `${w.source}:${w.id}`,
    title: w.title,
    icon: w.thumb,
    keywords: [...w.tags, w.category ?? "", w.author ?? ""].filter(Boolean),
    accessories: downloaded ? [{ icon: { source: Icons.download, tint: "green" }, tooltip: "Downloaded" }] : [],
    detail: {
      image: w.preview,
      metadata: [
        ...(dims ? [meta.text("Resolution", dims, { icon: Icons.monitor })] : []),
        ...(w.width ? [meta.tags("Format", sizeTags(w.width, w.height))] : []),
        ...(w.size ? [meta.text("Size", formatBytes(w.size), { icon: Icons.drive })] : []),
        ...(w.author
          ? [w.authorUrl ? meta.link("Photographer", w.author, w.authorUrl) : meta.person("Uploader", w.author)]
          : []),
        ...(w.views !== undefined ? [meta.text("Views", compact(w.views) ?? "", { icon: Icons.eye })] : []),
        ...(w.likes !== undefined
          ? [meta.text(w.source === "unsplash" ? "Likes" : "Favorites", compact(w.likes) ?? "", { icon: Icons.heart })]
          : []),
        ...(w.colors.length ? [meta.tags("Colors", w.colors.slice(0, 5))] : []),
        ...(w.tags.length ? [meta.tags("Tags", w.tags.slice(0, 6))] : []),
        meta.link("Source", SOURCE[w.source], w.page),
        ...(downloaded ? [meta.tags("Status", [{ text: "Downloaded", color: "green" }])] : []),
      ],
    },
    actions: [
      action("Download and Set", async () => {
        const file = await save();
        if (file && (await apply(file, prefs))) return close();
      }, { icon: Icons.image }),
      action("Download", async () => {
        const file = await save();
        if (file) await toast(`Saved to ${tilde(file)}`, { style: "success" });
      }, { icon: Icons.download, shortcut: "<Ctrl>d" }),
      open(w.page, `Open on ${SOURCE[w.source]}`, { section: "Links", shortcut: "<Ctrl>o" }),
      ...(w.authorUrl
        ? [open(w.authorUrl, "Open Photographer's Profile", { icon: Icons.person, section: "Links" })]
        : []),
      copy(w.page, "Copy Link", { section: "Links", shortcut: "<Ctrl><Shift>c" }),
    ],
  };
}

export function unsplashSetupItem(): Item {
  return {
    id: "unsplash-setup",
    title: "Add your Unsplash access key",
    subtitle: "Free, takes a minute",
    icon: { source: Icons.key, tint: "orange" },
    detail: {
      markdown: [
        "## Connect Unsplash",
        "",
        "1. Create an app in **Unsplash Developers → Your apps** (Enter opens it). The free *Demo* level is enough.",
        "2. Copy its **Access Key**.",
        "3. Paste it in **Settings → Extensions → Wallpapers → Configure → Unsplash access key**.",
        "",
        "Wallhaven works without a key: press Tab to switch.",
      ].join("\n"),
    },
    actions: [open("https://unsplash.com/oauth/applications", "Create Unsplash App", { icon: Icons.key })],
  };
}

export function errorItem(title: string, message: string): Item {
  return {
    id: "error",
    title,
    subtitle: message,
    icon: { source: Icons.wifiOff, tint: "red" },
    detail: { markdown: `**${title}**\n\n${message}` },
    actions: [action("Try Again", () => refresh(), { icon: Icons.refresh })],
  };
}
