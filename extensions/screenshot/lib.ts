// Picking a capture tool, building its command line, and parsing what the
// system tells us. Pure, tested in lib_test.ts.

// ---------------------------------------------------------------------------
// Session

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "other";

export interface Session {
  wayland: boolean;
  desktop: Desktop;
}

/** The environment variables we look at; `system.ts` reads them. */
export const SESSION_ENV = [
  "XDG_SESSION_TYPE",
  "XDG_CURRENT_DESKTOP",
  "WAYLAND_DISPLAY",
  "DISPLAY",
  "XAUTHORITY",
  "HYPRLAND_INSTANCE_SIGNATURE",
  "SWAYSOCK",
] as const;

export type Env = Partial<Record<string, string>>;

export function detectSession(env: Env): Session {
  const type = (env.XDG_SESSION_TYPE ?? "").toLowerCase();
  const wayland = type === "wayland" || (!!env.WAYLAND_DISPLAY && type !== "x11");
  const current = (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":");
  const desktop: Desktop = env.HYPRLAND_INSTANCE_SIGNATURE || current.includes("hyprland")
    ? "hyprland"
    : env.SWAYSOCK || current.includes("sway")
    ? "sway"
    : current.some((d) => d === "gnome" || d === "ubuntu" || d === "unity" || d === "pop")
    ? "gnome"
    : current.includes("kde")
    ? "kde"
    : "other";
  return { wayland, desktop };
}

export const sessionName = (s: Session) =>
  `${
    { gnome: "GNOME", kde: "KDE Plasma", hyprland: "Hyprland", sway: "Sway", other: s.wayland ? "Wayland" : "X11" }[
      s.desktop
    ]
  }${s.desktop === "other" ? "" : s.wayland ? " (Wayland)" : " (X11)"}`;

// ---------------------------------------------------------------------------
// Tools

export type ShotTool = "grim" | "gnome-screenshot" | "spectacle" | "maim" | "scrot" | "import";
export type RecTool = "wf-recorder" | "wl-screenrec" | "ffmpeg";
export type Mode = "area" | "window" | "screen";

/** Which screenshot tools work in this session, best first. */
export function screenshotCandidates(s: Session): ShotTool[] {
  if (s.wayland) {
    // GNOME and KDE don't implement wlr-screencopy: only their own tools work.
    if (s.desktop === "gnome") return ["gnome-screenshot"];
    if (s.desktop === "kde") return ["spectacle"];
    return ["grim"];
  }
  const x11: ShotTool[] = ["maim", "scrot", "import"];
  if (s.desktop === "gnome") return ["gnome-screenshot", ...x11];
  if (s.desktop === "kde") return ["spectacle", ...x11];
  return [...x11, "gnome-screenshot", "spectacle"];
}

/** Which recorders work in this session, best first. */
export function recorderCandidates(s: Session): RecTool[] {
  if (s.wayland) return s.desktop === "gnome" || s.desktop === "kde" ? [] : ["wf-recorder", "wl-screenrec"];
  return ["ffmpeg"];
}

export const pick = <T extends string>(candidates: T[], available: Set<string>): T | undefined =>
  candidates.find((t) => available.has(t));

/** Programs a tool needs besides itself, for a mode. */
export function companions(tool: ShotTool | RecTool, mode: Mode | "record-area"): string[] {
  if ((tool === "grim" || tool === "wf-recorder" || tool === "wl-screenrec") && mode !== "screen") return ["slurp"];
  if (tool === "ffmpeg" && mode === "record-area") return ["slop"];
  return [];
}

// ---------------------------------------------------------------------------
// Shell

/** Single-quotes a string for sh. */
export const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** The command that captures `mode` into `file`. `windows` are "x,y wxh" rectangles to choose from. */
export function captureCommand(tool: ShotTool, mode: Mode, file: string, windows: string[] = []): string {
  const f = q(file);
  switch (tool) {
    case "grim":
      if (mode === "screen") return `grim ${f}`;
      if (mode === "window" && windows.length) {
        return `geometry=$(printf '%s\\n' ${windows.map(q).join(" ")} | slurp -r) || exit 0; grim -g "$geometry" ${f}`;
      }
      return `geometry=$(slurp -d) || exit 0; grim -g "$geometry" ${f}`;
    case "gnome-screenshot":
      return `gnome-screenshot ${mode === "area" ? "-a " : mode === "window" ? "-w " : ""}-f ${f}`;
    case "spectacle":
      return `spectacle -b -n ${mode === "area" ? "-r" : mode === "window" ? "-a" : "-f"} -o ${f}`;
    case "maim":
      // A huge tolerance turns maim's selection into "click a window".
      return mode === "screen" ? `maim ${f}` : mode === "window" ? `maim -s -t 9999999 ${f}` : `maim -s ${f}`;
    case "scrot":
      return mode === "screen" ? `scrot ${f}` : mode === "window" ? `scrot -u ${f}` : `scrot -s ${f}`;
    case "import":
      return mode === "screen" ? `import -window root ${f}` : `import ${f}`;
  }
}

/** Copies an image file to the clipboard, Wayland or X11; succeeds if either works. */
export const copyImageCommand = (file: string, wayland: boolean) => {
  const wl = `wl-copy --type image/png < ${q(file)}`;
  const x = `xclip -selection clipboard -t image/png -i ${q(file)}`;
  return `{ ${wayland ? `${wl} || ${x}` : `${x} || ${wl}`}; } 2>/dev/null`;
};

export interface ShotOptions {
  tool: ShotTool;
  mode: Mode;
  file: string;
  wayland: boolean;
  /** Seconds to wait first, on top of the time the launcher takes to hide. */
  delay?: number;
  copy?: boolean;
  windows?: string[];
}

/** The script run in the background: capture, copy, notify. */
export function screenshotScript(o: ShotOptions): string {
  const name = basename(o.file);
  const wait = Math.max(0, o.delay ?? 0) + 0.4;
  return [
    `sleep ${wait}`,
    `mkdir -p ${q(dirname(o.file))}`,
    `${captureCommand(o.tool, o.mode, o.file, o.windows)} || exit 0`,
    `[ -s ${q(o.file)} ] || exit 0`,
    o.copy === false
      ? `note='Saved to ${dirname(o.file).replace(/'/g, "")}'`
      : `if ${copyImageCommand(o.file, o.wayland)}; then note='Copied to the clipboard'; else note='Saved'; fi`,
    `notify-send -a Backslash -i ${q(o.file)} 'Screenshot' "${name.replace(/["$`\\]/g, "")} · $note" 2>/dev/null`,
    "true",
  ].join("\n");
}

export interface RecordOptions {
  tool: RecTool;
  area: boolean;
  file: string;
  audio?: boolean;
  /** Output (monitor) to record; asked otherwise when there are several. */
  output?: string;
}

/** The recorder replaces the shell (`exec`) so stopping the unit stops it cleanly. */
export function recordScript(o: RecordOptions): string {
  const f = q(o.file);
  const lines = ["sleep 0.8", `mkdir -p ${q(dirname(o.file))}`];
  if (o.tool === "ffmpeg") {
    const audio = o.audio ? "-f pulse -i default -c:a aac " : "";
    const video = `-c:v libx264 -preset veryfast -pix_fmt yuv420p -vf 'scale=trunc(iw/2)*2:trunc(ih/2)*2'`;
    if (o.area) {
      lines.push(`geometry=$(slop -f '%wx%h %x,%y') || exit 0`, `set -- $geometry`);
      lines.push(
        `exec ffmpeg -hide_banner -loglevel error -f x11grab -framerate 30 -video_size "$1" -i "$DISPLAY+$2" ${audio}${video} ${f}`,
      );
    } else {
      lines.push(
        `exec ffmpeg -hide_banner -loglevel error -f x11grab -framerate 30 -i "$DISPLAY" ${audio}${video} ${f}`,
      );
    }
    return lines.join("\n");
  }
  const audio = o.audio ? (o.tool === "wf-recorder" ? " -a" : " --audio") : "";
  if (o.area) {
    lines.push(`geometry=$(slurp -d) || exit 0`, `exec ${o.tool} -g "$geometry"${audio} -f ${f}`);
  } else {
    lines.push(`exec ${o.tool}${o.output ? ` -o ${q(o.output)}` : ""}${audio} -f ${f}`);
  }
  return lines.join("\n");
}

/** `systemd-run` arguments to run a script in the background, outside the launcher. */
export function systemdRunArgs(
  unit: string,
  script: string,
  o: { description: string; env?: Env; keepChildren?: boolean; killSignal?: string },
): string[] {
  return [
    "--user",
    "--quiet",
    `--unit=${unit}`,
    `--description=${o.description}`,
    "--collect",
    // wl-copy and xclip stay in the background to serve the clipboard.
    ...(o.keepChildren ? ["--property=KillMode=process"] : []),
    ...(o.killSignal ? [`--property=KillSignal=${o.killSignal}`] : []),
    ...Object.entries(o.env ?? {}).filter(([, v]) => v).map(([k, v]) => `--setenv=${k}=${v}`),
    "/bin/sh",
    "-c",
    script,
  ];
}

// ---------------------------------------------------------------------------
// Windows and outputs from the compositor

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const rect = (r: Rect) => `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`;

/** `hyprctl -j clients` + `hyprctl -j monitors`: windows on the visible workspaces, as slurp rectangles. */
export function hyprlandWindows(clientsJson: string, monitorsJson: string): string[] {
  const monitors = JSON.parse(monitorsJson) as {
    activeWorkspace?: { id: number };
    specialWorkspace?: { id: number };
  }[];
  const visible = new Set(monitors.flatMap((m) => [m.activeWorkspace?.id, m.specialWorkspace?.id]).filter(Boolean));
  const clients = JSON.parse(clientsJson) as {
    at: [number, number];
    size: [number, number];
    workspace: { id: number };
    mapped?: boolean;
    hidden?: boolean;
  }[];
  return clients
    .filter((c) => c.mapped !== false && !c.hidden && visible.has(c.workspace.id))
    .map((c) => rect({ x: c.at[0], y: c.at[1], width: c.size[0], height: c.size[1] }));
}

/** `swaymsg -t get_tree -r`: visible windows, as slurp rectangles. */
export function swayWindows(treeJson: string): string[] {
  const out: string[] = [];
  const walk = (n: any) => {
    if ((n.type === "con" || n.type === "floating_con") && n.visible && (n.pid || n.app_id || n.window)) {
      out.push(rect(n.rect));
    }
    for (const c of [...(n.nodes ?? []), ...(n.floating_nodes ?? [])]) walk(c);
  };
  walk(JSON.parse(treeJson));
  return out;
}

/** The focused output's name from `hyprctl -j monitors` or `swaymsg -t get_outputs -r`. */
export function focusedOutput(json: string): string | undefined {
  const outputs = JSON.parse(json) as { name: string; focused?: boolean }[];
  return outputs.find((o) => o.focused)?.name ?? (outputs.length === 1 ? outputs[0].name : undefined);
}

// ---------------------------------------------------------------------------
// Folders and files

const path = (s: string) => s.replace(/\/+$/, "");
export const basename = (p: string) => path(p).split("/").pop() ?? p;
export const dirname = (p: string) => path(p).split("/").slice(0, -1).join("/") || "/";

/** `~/.config/user-dirs.dirs` → the pictures and videos folders. */
export function parseUserDirs(text: string, home: string): { pictures?: string; videos?: string } {
  const get = (key: string) => {
    const m = text.match(new RegExp(`^\\s*${key}="([^"]*)"`, "m"));
    if (!m) return undefined;
    const p = path(m[1].replace(/^\$HOME/, home));
    return p === home ? undefined : p; // "$HOME/" means the folder is disabled
  };
  return { pictures: get("XDG_PICTURES_DIR"), videos: get("XDG_VIDEOS_DIR") };
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "Screenshot_2026-10-28_14-02-11.png" */
export function captureName(kind: "Screenshot" | "Recording", date: Date): string {
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const t = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
  return `${kind}_${d}_${t}.${kind === "Screenshot" ? "png" : "mp4"}`;
}

export const IMAGE = /\.(png|jpe?g|webp|avif|bmp)$/i;
export const VIDEO = /\.(mp4|mkv|webm|mov)$/i;

/** Width and height from the first bytes of a PNG file. */
export function pngSize(head: Uint8Array): { width: number; height: number } | undefined {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (head.length < 24 || sig.some((b, i) => head[i] !== b)) return undefined;
  const v = new DataView(head.buffer, head.byteOffset, head.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 days ago". */
export function ago(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const days = Math.round(s / 86400);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/** Elapsed time as a clock: "0:42", "12:05", "1:02:03". */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
  return `${h ? `${h}:` : ""}${mm}:${pad(s % 60)}`;
}

// ---------------------------------------------------------------------------
// What to install

export type Family = "arch" | "debian" | "fedora" | "suse";

/** `/etc/os-release` → the distribution family. */
export function osFamily(osRelease: string): Family | undefined {
  const field = (k: string) => osRelease.match(new RegExp(`^${k}="?([^"\\n]*)"?`, "m"))?.[1]?.toLowerCase() ?? "";
  const ids = `${field("ID")} ${field("ID_LIKE")}`.split(/\s+/);
  if (ids.some((i) => ["arch", "manjaro", "endeavouros", "cachyos"].includes(i))) return "arch";
  if (ids.some((i) => ["debian", "ubuntu", "linuxmint", "pop"].includes(i))) return "debian";
  if (ids.some((i) => ["fedora", "rhel", "centos"].includes(i))) return "fedora";
  if (ids.some((i) => i.startsWith("opensuse") || i === "suse")) return "suse";
  return undefined;
}

const PACKAGES: Record<string, Partial<Record<Family, string>>> = {
  spectacle: { debian: "kde-spectacle" },
  import: { debian: "imagemagick", arch: "imagemagick", fedora: "ImageMagick", suse: "ImageMagick" },
  "wl-copy": { debian: "wl-clipboard", arch: "wl-clipboard", fedora: "wl-clipboard", suse: "wl-clipboard" },
};

const MANAGERS: Record<Family, string> = {
  arch: "sudo pacman -S",
  debian: "sudo apt install",
  fedora: "sudo dnf install",
  suse: "sudo zypper install",
};

/** "sudo apt install grim slurp" for the family, every family when unknown. */
export function installCommands(programs: string[], family?: Family): { family: Family; command: string }[] {
  const families = family ? [family] : (Object.keys(MANAGERS) as Family[]);
  return families.map((f) => ({
    family: f,
    command: `${MANAGERS[f]} ${[...new Set(programs.map((p) => PACKAGES[p]?.[f] ?? p))].join(" ")}`,
  }));
}

/** What to install to take screenshots in this session. */
export function screenshotPackages(s: Session): string[] {
  if (s.wayland) {
    if (s.desktop === "gnome") return ["gnome-screenshot", "wl-copy"];
    if (s.desktop === "kde") return ["spectacle", "wl-copy"];
    return ["grim", "slurp", "wl-copy"];
  }
  return ["maim", "xclip"];
}

export function recorderPackages(s: Session): string[] {
  if (s.wayland) return ["wf-recorder", "slurp"];
  return ["ffmpeg", "slop"];
}

const FAMILY_NAMES: Record<Family, string> = {
  arch: "Arch",
  debian: "Debian, Ubuntu",
  fedora: "Fedora",
  suse: "openSUSE",
};

/** Markdown explaining what to install, for an empty state's detail panel. */
export function installMarkdown(what: string, programs: string[], family?: Family): string {
  const lines = installCommands(programs, family).map((c) => `**${FAMILY_NAMES[c.family]}**\n\n\`${c.command}\``);
  return `${what}\n\n${lines.join("\n\n")}`;
}
