import {
  action,
  close,
  type Color,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  submenu,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import {
  ago,
  clock,
  companions,
  type Family,
  formatBytes,
  installMarkdown,
  type Mode,
  recorderPackages,
  screenshotPackages,
  sessionName,
} from "../lib.ts";
import {
  type Capture,
  captures,
  copyImage,
  family,
  folders,
  MissingTool,
  type Recording,
  recording,
  screenshot,
  showInFolder,
  startRecording,
  stopRecording,
  tilde,
  type Tools,
  tools,
} from "../system.ts";

interface Prefs {
  delay?: number;
  copy?: boolean;
  audio?: boolean;
}

const MODES: { mode: Mode; title: string; icon: string; tint: Color; about: string; keywords: string[] }[] = [
  {
    mode: "area",
    title: "Capture Area",
    icon: Icons.scan,
    tint: "blue",
    about: "Drag a rectangle over the part of the screen to keep. Escape cancels.",
    keywords: ["region", "selection", "zone", "capture"],
  },
  {
    mode: "window",
    title: "Capture Window",
    icon: Icons.window,
    tint: "purple",
    about: "Click the window to capture.",
    keywords: ["window", "fenêtre", "app"],
  },
  {
    mode: "screen",
    title: "Capture Full Screen",
    icon: Icons.monitor,
    tint: "teal",
    about: "Everything on your screens, right away.",
    keywords: ["screen", "écran", "full", "entier", "monitor"],
  },
];

const shoot = (mode: Mode, prefs: Prefs, delay?: number) => async () => {
  try {
    await screenshot(mode, { delay: delay ?? prefs.delay, copy: prefs.copy });
  } catch (e) {
    if (e instanceof MissingTool) {
      await toast(e.message, { style: "failure" });
      return;
    }
    throw e;
  }
  return close();
};

function captureItems(t: Tools, prefs: Prefs, pictures: string, fam?: Family): Item[] {
  if (!t.shot) {
    return [{
      id: "missing-shot",
      title: "No screenshot tool found",
      subtitle: `for ${sessionName(t.session)}`,
      icon: { source: Icons.alert, tint: "orange" },
      section: "Capture",
      detail: {
        markdown: installMarkdown(
          `Backslash captures with **${screenshotPackages(t.session).filter((p) => p !== "wl-copy").join(" + ")}** on ${
            sessionName(t.session)
          }. Install it, then open this command again.`,
          screenshotPackages(t.session),
          fam,
        ),
        metadata: [
          meta.text("Session", sessionName(t.session), { icon: Icons.monitor }),
          meta.tags("Supported", ["grim + slurp", "gnome-screenshot", "spectacle", "maim", "scrot", "import"]),
        ],
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  const missing = (mode: Mode) => companions(t.shot!, mode).filter((p) => p === "slurp" && !t.slurp);
  return MODES.map((m) => ({
    id: `capture:${m.mode}`,
    title: m.title,
    subtitle: missing(m.mode).length ? `needs ${missing(m.mode).join(", ")}` : undefined,
    icon: { source: m.icon, tint: missing(m.mode).length ? "gray" : m.tint },
    section: "Capture",
    keywords: m.keywords,
    accessories: prefs.delay ? [{ icon: Icons.timer, text: `${prefs.delay} s` }] : [],
    detail: {
      markdown: missing(m.mode).length
        ? installMarkdown(`${m.about}\n\nThis needs **slurp** to select on screen.`, missing(m.mode), fam)
        : m.about,
      metadata: [
        meta.text("Tool", t.shot!, { icon: Icons.camera }),
        meta.text("Session", sessionName(t.session), { icon: Icons.monitor }),
        meta.text("Saved to", tilde(pictures), { icon: Icons.folder }),
        meta.text("Clipboard", prefs.copy === false ? "Not copied" : "Copied as PNG", { icon: Icons.copy }),
        ...(prefs.delay ? [meta.text("Delay", `${prefs.delay} s`, { icon: Icons.timer })] : []),
      ],
    },
    actions: [
      action(m.title, shoot(m.mode, prefs), { icon: m.icon }),
      submenu(
        "Capture After a Delay",
        [3, 5, 10].map((s) => action(`In ${s} Seconds`, shoot(m.mode, prefs, s), { icon: Icons.timer })),
        { icon: Icons.timer, shortcut: "<Ctrl>d" },
      ),
      open(pictures, "Open Screenshots Folder", { icon: Icons.folder, section: "Folder" }),
    ],
  }));
}

function recordItems(t: Tools, rec: Recording | undefined, prefs: Prefs, videos: string, fam?: Family): Item[] {
  if (rec) {
    const elapsed = (Date.now() - rec.started) / 1000;
    return [{
      id: "recording",
      title: "Stop Recording",
      subtitle: rec.area ? "Area" : "Screen",
      icon: { source: Icons.stop, tint: "red" },
      section: "Record",
      accessories: [{ tag: `● ${clock(elapsed)}`, color: "red" }],
      detail: {
        stats: [{ label: "recording", value: clock(elapsed), color: "red" }],
        metadata: [
          meta.text("File", tilde(rec.file), { icon: Icons.video }),
          meta.text("Recorder", rec.tool, { icon: Icons.terminal }),
          meta.text("Started", new Date(rec.started).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }), {
            icon: Icons.clock,
          }),
        ],
      },
      actions: [
        action("Stop Recording", async () => {
          const done = await stopRecording();
          await updateCommandMetadata({ subtitle: null }).catch(() => {});
          await toast(done ? `Saved ${done.file.split("/").pop()}` : "Recording stopped", { style: "success" });
          return refresh();
        }, { icon: Icons.stop, shortcut: "<Ctrl>s" }),
        open(videos, "Open Recordings Folder", { icon: Icons.folder, section: "Folder" }),
      ],
    }];
  }
  if (!t.recorder) {
    const builtIn = t.session.desktop === "gnome"
      ? "GNOME records the screen itself: press **Ctrl + Shift + Alt + R**, or use the screenshot tool (Print Screen)."
      : t.session.desktop === "kde" && t.session.wayland
      ? "On KDE Plasma, Spectacle records the screen: open it and pick **Record**."
      : undefined;
    return [{
      id: "missing-recorder",
      title: "Screen recording unavailable",
      subtitle: builtIn ? "use your desktop's recorder" : `for ${sessionName(t.session)}`,
      icon: { source: Icons.video, tint: "gray" },
      section: "Record",
      detail: {
        markdown: builtIn ??
          installMarkdown(
            `Backslash records with **${t.session.wayland ? "wf-recorder or wl-screenrec" : "ffmpeg"}**.`,
            recorderPackages(t.session),
            fam,
          ),
        metadata: [meta.text("Session", sessionName(t.session), { icon: Icons.monitor })],
      },
      actions: [action("Check Again", () => refresh(), { icon: Icons.refresh })],
    }];
  }
  const start = (area: boolean) => async () => {
    try {
      await startRecording(area, !!prefs.audio);
    } catch (e) {
      if (e instanceof MissingTool) {
        await toast(e.message, { style: "failure" });
        return;
      }
      throw e;
    }
    return close();
  };
  const canArea = t.recorder === "ffmpeg" ? t.slop : t.slurp;
  return ([false, true] as const).map((area) => ({
    id: `record:${area ? "area" : "screen"}`,
    title: area ? "Record Area" : "Record Screen",
    subtitle: area && !canArea ? `needs ${t.recorder === "ffmpeg" ? "slop" : "slurp"}` : undefined,
    icon: { source: area ? Icons.scan : Icons.video, tint: area && !canArea ? "gray" : "red" },
    section: "Record",
    keywords: ["record", "video", "enregistrer", "vidéo", "screencast"],
    accessories: prefs.audio ? [{ icon: Icons.mic, tooltip: "With audio" }] : [],
    detail: {
      markdown: area
        ? "Drag a rectangle, recording starts right away. Open this command again to stop."
        : "Records the screen you're on. Open this command again, or run **Toggle Screen Recording**, to stop.",
      metadata: [
        meta.text("Recorder", t.recorder!, { icon: Icons.video }),
        meta.text("Audio", prefs.audio ? "Default input" : "Off", { icon: prefs.audio ? Icons.mic : Icons.speakerOff }),
        meta.text("Saved to", tilde(videos), { icon: Icons.folder }),
      ],
    },
    actions: [
      action(area ? "Record Area" : "Record Screen", start(area), { icon: Icons.video }),
      open(videos, "Open Recordings Folder", { icon: Icons.folder, section: "Folder" }),
    ],
  }));
}

function captureItem(c: Capture): Item {
  const image = c.kind === "image";
  const dims = c.width ? `${c.width} × ${c.height}` : undefined;
  const date = new Date(c.modified);
  return {
    id: c.path,
    title: c.name,
    subtitle: ago(c.modified),
    icon: { source: image ? Icons.image : Icons.video, tint: image ? "blue" : "red" },
    section: "Recent",
    keywords: [image ? "screenshot" : "recording", c.folder],
    accessories: [...(dims ? [{ text: dims }] : []), { text: formatBytes(c.size) }],
    detail: {
      image: image ? c.path : undefined,
      metadata: [
        ...(dims ? [meta.text("Dimensions", dims, { icon: Icons.image })] : []),
        meta.text("Size", formatBytes(c.size), { icon: Icons.drive }),
        meta.text("Taken", date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }), { icon: Icons.clock }),
        meta.text("Folder", tilde(c.folder), { icon: Icons.folder }),
        meta.tags("Type", [image ? { text: "Screenshot", color: "blue" } : { text: "Recording", color: "red" }]),
      ],
    },
    actions: [
      open(c.path, image ? "Open" : "Play"),
      ...(image
        ? [action("Copy Image", async () => {
          if (await copyImage(c)) return close("Image copied");
          await toast("Install wl-clipboard (Wayland) or xclip (X11) to copy images", { style: "failure" });
        }, { icon: Icons.copy, shortcut: "<Ctrl><Shift>c", section: "Copy" })]
        : []),
      copy(c.path, "Copy Path", { shortcut: "<Ctrl><Alt>c", section: "Copy" }),
      action("Show in Folder", async () => {
        await showInFolder(c.path);
        return close();
      }, { icon: Icons.folder, shortcut: "<Ctrl>o", section: "File" }),
      action("Delete", async () => {
        await Deno.remove(c.path);
        await toast(`Deleted ${c.name}`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        confirm: `Delete ${c.name}?`,
        shortcut: "<Ctrl>Delete",
        section: "Danger",
      }),
    ],
  };
}

export default list({
  placeholder: "Capture, record, or search recent captures…",
  filter: {
    options: [
      { value: "all", title: "All" },
      { value: "screenshots", title: "Screenshots" },
      { value: "recordings", title: "Recordings" },
    ],
    default: "all",
  },
  empty: { title: "No captures yet", description: "Take a screenshot and it shows up here", icon: Icons.camera },
  status: (items) => {
    const rec = items.find((i) => i.id === "recording");
    if (rec) return `Recording ${rec.accessories?.[0]?.tag?.replace("● ", "") ?? ""}`;
    const shots = items.filter((i) => i.section === "Recent" && i.keywords?.[0] === "screenshot").length;
    const videos = items.filter((i) => i.section === "Recent" && i.keywords?.[0] === "recording").length;
    return [
      shots && `${shots} screenshot${shots > 1 ? "s" : ""}`,
      videos && `${videos} recording${videos > 1 ? "s" : ""}`,
    ]
      .filter(Boolean).join(" · ") || "Nothing captured yet";
  },
  // Live while a recording runs: the elapsed time ticks every second.
  async *items({ signal, filter, preferences }) {
    const prefs = preferences as Prefs;
    const view = filter ?? "all";
    const [t, dirs, fam] = await Promise.all([tools(), folders(), family()]);
    let recent = await captures();
    let last: string | undefined;
    let wasRecording = false;
    while (!signal.aborted) {
      const rec = await recording();
      if (wasRecording && !rec) recent = await captures(); // the new file
      wasRecording = !!rec;
      const subtitle = rec ? `Recording ${clock((Date.now() - rec.started) / 1000)}` : null;
      if (subtitle !== last) {
        last = subtitle ?? undefined;
        updateCommandMetadata({ subtitle }).catch(() => {});
      }
      const shown = recent.filter((c) =>
        view === "all" || (view === "screenshots" ? c.kind === "image" : c.kind === "video")
      );
      yield [
        ...(view !== "recordings" ? captureItems(t, prefs, dirs.pictures, fam) : []),
        ...(view !== "screenshots" ? recordItems(t, rec, prefs, dirs.videos, fam) : []),
        ...shown.map(captureItem),
      ];
      if (!rec) return;
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
});
