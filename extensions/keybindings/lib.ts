// Parsing the desktops' shortcut configurations, and naming keys and actions for humans.

export type Desktop = "gnome" | "kde" | "hyprland" | "sway" | "niri" | "i3";

export const DESKTOP_NAMES: Record<Desktop, string> = {
  gnome: "GNOME",
  kde: "KDE Plasma",
  hyprland: "Hyprland",
  sway: "Sway",
  niri: "niri",
  i3: "i3",
};

/** One action and the keys that run it. */
export interface Shortcut {
  /** Stable: desktop, component and action. */
  id: string;
  /** Pretty accelerators, one per alternative: `Super + ←`. */
  keys: string[];
  /** As written in the configuration: `<Super>Left`. */
  raw: string[];
  /** What it does, for humans: "Switch to Workspace 1". */
  name: string;
  /** The configuration's own name for it: `switch-to-workspace-1`, `exec kitty`. */
  action: string;
  /** Section of the cheat sheet. */
  category: string;
  /** A program it runs, if any. */
  command?: string;
  /** gsettings schema, KDE component, Sway mode, Hyprland submap… */
  scope?: string;
  desktop: Desktop;
}

// ---------------------------------------------------------------------------
// Desktop detection

/** The desktops to read, most likely first, from the session's variables. */
export function detectDesktops(env: Record<string, string | undefined>): Desktop[] {
  const found: Desktop[] = [];
  const add = (d: Desktop) => !found.includes(d) && found.push(d);
  for (const part of (env.XDG_CURRENT_DESKTOP ?? "").toLowerCase().split(":")) {
    if (/gnome|unity|budgie|pantheon/.test(part)) add("gnome");
    else if (part === "kde" || part === "plasma") add("kde");
    else if (part === "hyprland") add("hyprland");
    else if (part === "sway") add("sway");
    else if (part === "niri") add("niri");
    else if (part === "i3") add("i3");
  }
  if (env.HYPRLAND_INSTANCE_SIGNATURE) add("hyprland");
  if (env.SWAYSOCK) add("sway");
  if (env.NIRI_SOCKET) add("niri");
  if (env.I3SOCK) add("i3");
  return found;
}

// ---------------------------------------------------------------------------
// Keys

const MODIFIERS: Record<string, string> = {
  super: "Super",
  mod4: "Super",
  win: "Super",
  logo: "Super",
  meta: "Meta",
  primary: "Ctrl",
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  mod1: "Alt",
  shift: "Shift",
  hyper: "Hyper",
  mod3: "Hyper",
  mod5: "AltGr",
  iso_level3_shift: "AltGr",
  altgr: "AltGr",
  caps: "Caps Lock",
  lock: "Caps Lock",
  mod2: "Num Lock",
};

const KEYS: Record<string, string> = {
  left: "←",
  right: "→",
  up: "↑",
  down: "↓",
  page_up: "Page Up",
  prior: "Page Up",
  pgup: "Page Up",
  page_down: "Page Down",
  next: "Page Down",
  pgdown: "Page Down",
  return: "Enter",
  enter: "Enter",
  kp_enter: "Enter",
  space: "Space",
  escape: "Esc",
  esc: "Esc",
  print: "Print Screen",
  sysreq: "SysRq",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  insert: "Insert",
  ins: "Insert",
  home: "Home",
  end: "End",
  tab: "Tab",
  backtab: "Tab",
  grave: "`",
  above_tab: "`",
  asciitilde: "~",
  minus: "-",
  equal: "=",
  plus: "+",
  comma: ",",
  period: ".",
  slash: "/",
  backslash: "\\",
  bracketleft: "[",
  bracketright: "]",
  braceleft: "{",
  braceright: "}",
  semicolon: ";",
  colon: ":",
  apostrophe: "'",
  quotedbl: '"',
  question: "?",
  exclam: "!",
  at: "@",
  numbersign: "#",
  dollar: "$",
  percent: "%",
  asciicircum: "^",
  ampersand: "&",
  asterisk: "*",
  parenleft: "(",
  parenright: ")",
  underscore: "_",
  less: "<",
  greater: ">",
  bar: "|",
  pause: "Pause",
  scroll_lock: "Scroll Lock",
  menu: "Menu",
  caps_lock: "Caps Lock",
  num_lock: "Num Lock",
  super_l: "Super",
  super_r: "Super",
  alt_l: "Alt",
  alt_r: "Alt",
  shift_l: "Shift",
  shift_r: "Shift",
  control_l: "Ctrl",
  control_r: "Ctrl",
  // Media keys, XF86 prefix removed.
  audioraisevolume: "Volume Up",
  audiolowervolume: "Volume Down",
  audiomute: "Mute",
  audiomicmute: "Mic Mute",
  audioplay: "Play",
  audiopause: "Pause",
  audiostop: "Stop",
  audionext: "Next Track",
  audioprev: "Previous Track",
  audiomedia: "Media",
  audiorewind: "Rewind",
  audioforward: "Fast Forward",
  monbrightnessup: "Brightness Up",
  monbrightnessdown: "Brightness Down",
  kbdbrightnessup: "Keyboard Light Up",
  kbdbrightnessdown: "Keyboard Light Down",
  kbdlightonoff: "Keyboard Light",
  calculator: "Calculator",
  mail: "Mail",
  www: "Browser",
  homepage: "Home Page",
  explorer: "Files",
  mycomputer: "Files",
  search: "Search",
  poweroff: "Power",
  powerdown: "Power",
  sleep: "Sleep",
  suspend: "Suspend",
  eject: "Eject",
  touchpadtoggle: "Touchpad",
  display: "Display",
  rfkill: "Airplane Mode",
  wlan: "Wi-Fi",
  tools: "Tools",
  favorites: "Favorites",
  // niri and Hyprland mouse names.
  wheelscrolldown: "Scroll Down",
  wheelscrollup: "Scroll Up",
  wheelscrollleft: "Scroll Left",
  wheelscrollright: "Scroll Right",
  mouseleft: "Left Click",
  mouseright: "Right Click",
  mousemiddle: "Middle Click",
  mouse_down: "Scroll Down",
  mouse_up: "Scroll Up",
  "mouse:272": "Left Click",
  "mouse:273": "Right Click",
  "mouse:274": "Middle Click",
  "mouse:275": "Back Button",
  "mouse:276": "Forward Button",
  button1: "Left Click",
  button2: "Middle Click",
  button3: "Right Click",
  button4: "Scroll Up",
  button5: "Scroll Down",
};

/** A key's name for humans: `Page_Up` → `Page Up`, `XF86AudioMute` → `Mute`, `a` → `A`. */
export function keyName(key: string): string {
  const k = key.trim();
  if (!k) return k;
  const lower = k.toLowerCase();
  const mod = MODIFIERS[lower];
  if (mod) return mod;
  const plain = lower.replace(/^xf86/, "");
  if (KEYS[plain]) return KEYS[plain];
  const pad = /^kp_(.+)$/i.exec(k);
  if (pad) return `Num ${keyName(pad[1])}`;
  if (/^f\d{1,2}$/.test(lower)) return lower.toUpperCase();
  if (k.length === 1) return k.toUpperCase();
  if (/^[a-z]+$/.test(k)) return k[0].toUpperCase() + k.slice(1);
  // Qt names are already words ("Volume Up", "Media Play"); XF86 ones get spaces.
  return k.replace(/^XF86/, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

/** Joins modifiers and key: `Super + Shift + ←`. */
export const joinKeys = (parts: string[]) => parts.filter(Boolean).join(" + ");

/** A GTK accelerator, as GNOME stores it: `<Super><Shift>Left` → `Super + Shift + ←`. */
export function prettyGtk(accel: string): string {
  const parts: string[] = [];
  const re = /<([^>]+)>/gy;
  let m: RegExpExecArray | null;
  let last = 0;
  while ((m = re.exec(accel))) {
    parts.push(keyName(m[1]));
    last = re.lastIndex;
  }
  parts.push(keyName(accel.slice(last)));
  return joinKeys(parts);
}

/** `Mod4+Shift+Left`, `$mod+Return` (variables already replaced), `Meta+Ctrl++` → parts. */
export function splitPlus(combo: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < combo.length; i++) {
    const c = combo[i];
    if (c === "+" && cur !== "") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

/** A `Mod+Key` combination (Sway, i3, niri, KDE): each part named for humans. */
export const prettyPlus = (combo: string) => joinKeys(splitPlus(combo.trim()).map((p) => keyName(p)));

// ---------------------------------------------------------------------------
// Names and categories

const titleCase = (s: string) =>
  s.replace(/[-_]+/g, " ").trim().replace(/\s+/g, " ").replace(/\b([a-z])/g, (c) => c.toUpperCase());

const DIRECTION: Record<string, string> = {
  l: "Left",
  r: "Right",
  u: "Up",
  d: "Down",
  left: "Left",
  right: "Right",
  up: "Up",
  down: "Down",
  ne: "Top Right",
  nw: "Top Left",
  se: "Bottom Right",
  sw: "Bottom Left",
  n: "Top",
  s: "Bottom",
  e: "Right",
  w: "Left",
  last: "Last",
};
const dir = (d: string) => DIRECTION[d.toLowerCase()] ?? titleCase(d);

const GNOME_NAMES: Record<string, string> = {
  "activate-window-menu": "Show Window Menu",
  "begin-move": "Move Window",
  "begin-resize": "Resize Window",
  close: "Close Window",
  "cycle-group": "Cycle Windows of an App",
  "cycle-group-backward": "Cycle Windows of an App Backward",
  "cycle-panels": "Cycle System Controls",
  "cycle-panels-backward": "Cycle System Controls Backward",
  "cycle-windows": "Cycle Windows",
  "cycle-windows-backward": "Cycle Windows Backward",
  lower: "Lower Window",
  maximize: "Maximize Window",
  "maximize-horizontally": "Maximize Window Horizontally",
  "maximize-vertically": "Maximize Window Vertically",
  minimize: "Hide Window",
  "move-to-center": "Center Window",
  "panel-main-menu": "Show the Activities Overview",
  "panel-run-dialog": "Run a Command",
  raise: "Raise Window",
  "raise-or-lower": "Raise or Lower Window",
  "show-desktop": "Hide All Windows",
  "switch-applications": "Switch Applications",
  "switch-applications-backward": "Switch Applications Backward",
  "switch-group": "Switch Windows of an App",
  "switch-group-backward": "Switch Windows of an App Backward",
  "switch-input-source": "Next Input Source",
  "switch-input-source-backward": "Previous Input Source",
  "switch-panels": "Switch System Controls",
  "switch-panels-backward": "Switch System Controls Backward",
  "switch-windows": "Switch Windows",
  "switch-windows-backward": "Switch Windows Backward",
  "toggle-above": "Always on Top",
  "toggle-fullscreen": "Toggle Fullscreen",
  "toggle-maximized": "Toggle Maximized",
  "toggle-on-all-workspaces": "Show Window on All Workspaces",
  "toggle-shaded": "Toggle Shaded",
  unmaximize: "Restore Window",
  "focus-active-notification": "Focus the Active Notification",
  "open-application-menu": "Open the Application Menu",
  screenshot: "Take a Screenshot",
  "screenshot-window": "Take a Screenshot of a Window",
  "show-screen-recording-ui": "Record the Screen",
  "show-screenshot-ui": "Screenshot Tool",
  "toggle-application-view": "Show All Apps",
  "toggle-message-tray": "Show Notifications",
  "toggle-overview": "Activities Overview",
  "toggle-quick-settings": "Open Quick Settings",
  "shift-overview-up": "Overview Up",
  "shift-overview-down": "Overview Down",
  "toggle-tiled-left": "Tile Window Left",
  "toggle-tiled-right": "Tile Window Right",
  "switch-monitor": "Switch Display Mode",
  "rotate-monitor": "Rotate Display",
  "cancel-input-capture": "Cancel Input Capture",
  "restore-shortcuts": "Restore Shortcuts",
  "area-screenshot": "Screenshot an Area",
  "area-screenshot-clip": "Copy a Screenshot of an Area",
  "window-screenshot": "Screenshot a Window",
  "window-screenshot-clip": "Copy a Screenshot of a Window",
  "screenshot-clip": "Copy a Screenshot",
  screencast: "Record a Screencast",
  calculator: "Calculator",
  "control-center": "Settings",
  email: "Mail",
  help: "Help",
  home: "Home Folder",
  logout: "Log Out",
  magnifier: "Toggle Zoom",
  "magnifier-zoom-in": "Zoom In",
  "magnifier-zoom-out": "Zoom Out",
  media: "Media Player",
  "mic-mute": "Mute the Microphone",
  next: "Next Track",
  pause: "Pause",
  play: "Play / Pause",
  previous: "Previous Track",
  stop: "Stop Playback",
  "playback-forward": "Fast Forward",
  "playback-rewind": "Rewind",
  repeat: "Repeat",
  random: "Shuffle",
  "screen-brightness-up": "Brightness Up",
  "screen-brightness-down": "Brightness Down",
  "screen-brightness-cycle": "Cycle Brightness",
  "keyboard-brightness-up": "Keyboard Light Up",
  "keyboard-brightness-down": "Keyboard Light Down",
  "keyboard-brightness-toggle": "Keyboard Light On or Off",
  screenreader: "Screen Reader",
  screensaver: "Lock Screen",
  search: "Search",
  "volume-down": "Volume Down",
  "volume-down-quiet": "Volume Down Without a Sound",
  "volume-down-precise": "Volume Down a Little",
  "volume-mute": "Mute",
  "volume-mute-quiet": "Mute Without a Sound",
  "volume-up": "Volume Up",
  "volume-up-quiet": "Volume Up Without a Sound",
  "volume-up-precise": "Volume Up a Little",
  www: "Web Browser",
  terminal: "Terminal",
  power: "Power Off",
  eject: "Eject",
  rfkill: "Airplane Mode",
  "rfkill-bluetooth": "Bluetooth On or Off",
  "touchpad-toggle": "Touchpad On or Off",
  "touchpad-on": "Touchpad On",
  "touchpad-off": "Touchpad Off",
  "on-screen-keyboard": "On-Screen Keyboard",
  "decrease-text-size": "Smaller Text",
  "increase-text-size": "Larger Text",
  "toggle-contrast": "High Contrast",
  "battery-status": "Battery Status",
  hibernate: "Hibernate",
  suspend: "Suspend",
  "rotate-video-lock": "Lock Screen Rotation",
};

/** A gsettings key for humans: `switch-to-workspace-3` → "Switch to Workspace 3". */
export function gnomeName(key: string): string {
  if (GNOME_NAMES[key]) return GNOME_NAMES[key];
  let m: RegExpExecArray | null;
  if ((m = /^switch-to-workspace-(\d+|left|right|up|down|last)$/.exec(key))) {
    return /\d/.test(m[1]) ? `Switch to Workspace ${m[1]}` : `Switch to Workspace ${dir(m[1])}`;
  }
  if ((m = /^move-to-workspace-(\d+|left|right|up|down|last)$/.exec(key))) {
    return /\d/.test(m[1]) ? `Move Window to Workspace ${m[1]}` : `Move Window One Workspace ${dir(m[1])}`;
  }
  if ((m = /^move-to-monitor-(left|right|up|down)$/.exec(key))) return `Move Window to Monitor ${dir(m[1])}`;
  if ((m = /^move-to-side-([nsew])$/.exec(key))) return `Move Window to the ${dir(m[1])} Edge`;
  if ((m = /^move-to-corner-(ne|nw|se|sw)$/.exec(key))) return `Move Window to the ${dir(m[1])} Corner`;
  if ((m = /^switch-to-application-(\d+)$/.exec(key))) return `Open Pinned App ${m[1]}`;
  if ((m = /^switch-to-session-(\d+)$/.exec(key))) return `Switch to Virtual Terminal ${m[1]}`;
  return titleCase(key).replace(/\bTo\b/g, "to").replace(/\bOf\b/g, "of").replace(/\bOn\b/g, "on");
}

/** The cheat sheet section of a GNOME shortcut. */
export function gnomeCategory(schema: string, key: string): string {
  if (schema.endsWith("custom-keybinding")) return "Custom Shortcuts";
  if (/workspace/.test(key)) return "Workspaces";
  if (/screenshot|screencast|recording/.test(key)) return "Screenshots";
  if (/input-source/.test(key)) return "Typing";
  if (/monitor/.test(key)) return "Displays";
  if (/^(switch|cycle)-(applications|windows|group|panels)/.test(key)) return "Switching";
  if (schema.includes("media-keys")) {
    if (/volume|mic|^play|pause|^next|previous|^stop|^media|repeat|random|playback/.test(key)) return "Sound & Media";
    if (/magnifier|screenreader|on-screen|text-size|contrast/.test(key)) return "Accessibility";
    if (/brightness|screensaver|logout|power|suspend|hibernate|rfkill|battery|touchpad|eject|rotate/.test(key)) {
      return "System";
    }
    return "Launchers";
  }
  if (/switch-to-application/.test(key)) return "Launchers";
  if (/session|restore-shortcuts/.test(key)) return "System";
  if (schema.includes("shell")) return "System";
  return "Windows";
}

const MEDIA_TOOLS =
  /\b(wpctl|pactl|pamixer|amixer|playerctl|brightnessctl|light|swayosd-client|volumectl|lightctl|pulsemixer)\b/;
const SCREENSHOT_TOOLS = /\b(grim|slurp|grimblast|hyprshot|flameshot|spectacle|maim|scrot|wf-recorder|satty|swappy)\b/;
const LOCK_TOOLS = /\b(swaylock|hyprlock|loginctl|systemctl|wlogout|i3lock|gtklock|swaynag)\b/;

/** The cheat sheet section of a tiling window manager action (Hyprland, Sway, i3, niri). */
export function wmCategory(verb: string, command?: string): string {
  if (command !== undefined) {
    if (MEDIA_TOOLS.test(command)) return "Sound & Media";
    if (SCREENSHOT_TOOLS.test(command)) return "Screenshots";
    if (LOCK_TOOLS.test(command)) return "Session";
    return "Apps";
  }
  const v = verb.toLowerCase();
  if (/screenshot|screencast/.test(v)) return "Screenshots";
  if (/workspace|scratchpad|special/.test(v)) return "Workspaces";
  if (/^(exit|quit|reload|restart|power-off|dpms|lock)/.test(v)) return "Session";
  if (/monitor|output/.test(v)) return "Displays";
  if (/^(focus|movefocus|cyclenext|alterzorder)/.test(v)) return "Focus";
  if (/^(move|swap)/.test(v)) return "Move";
  if (/resize|width|height/.test(v)) return "Resize";
  if (/^mode$|submap/.test(v)) return "Modes";
  return "Windows";
}

/** `kitty --single-instance` → "Run kitty". */
const runName = (command: string) => {
  const program = command.trim().split(/\s+/).find((w) => !/^(-|uwsm|app2unit|env$|\w+=)/.test(w)) ?? command;
  return `Run ${program.split("/").pop()}`;
};

// ---------------------------------------------------------------------------
// GNOME: gsettings

/** A GVariant text value: `'a'`, `['a', 'b']`, `@as []`, `true`, `uint32 5`. Strings come out unquoted. */
export function parseGVariant(text: string): string | string[] | undefined {
  const s = text.trim().replace(/^@\w+\s+/, "");
  const strings: string[] = [];
  let i = 0;
  const readString = (): string => {
    const q = s[i++];
    let out = "";
    while (i < s.length && s[i] !== q) {
      if (s[i] === "\\" && i + 1 < s.length) {
        i++;
        out += s[i] === "n" ? "\n" : s[i] === "t" ? "\t" : s[i];
      } else out += s[i];
      i++;
    }
    i++;
    return out;
  };
  if (s.startsWith("[")) {
    i = 1;
    while (i < s.length) {
      const c = s[i];
      if (c === "'" || c === '"') strings.push(readString());
      else if (c === "]") break;
      else i++;
    }
    return strings;
  }
  if (s.startsWith("'") || s.startsWith('"')) return readString();
  return s || undefined;
}

/** `gsettings list-recursively` lines: schema, key, value. */
export function parseGsettingsList(text: string): { schema: string; key: string; value: string }[] {
  const out: { schema: string; key: string; value: string }[] = [];
  for (const line of text.split("\n")) {
    const m = /^(\S+)\s+(\S+)\s+(.*)$/.exec(line.trim());
    if (m) out.push({ schema: m[1], key: m[2], value: m[3] });
  }
  return out;
}

export const GNOME_SCHEMAS = [
  "org.gnome.desktop.wm.keybindings",
  "org.gnome.shell.keybindings",
  "org.gnome.mutter.keybindings",
  "org.gnome.mutter.wayland.keybindings",
  "org.gnome.settings-daemon.plugins.media-keys",
];
export const CUSTOM_SCHEMA = "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding";

const accelList = (value: string): string[] => {
  const v = parseGVariant(value);
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return list.filter((a) => a && a !== "disabled");
};

/** Bound GNOME shortcuts from `gsettings list-recursively` of the built-in schemas. */
export function gnomeShortcuts(text: string): Shortcut[] {
  const out: Shortcut[] = [];
  for (const { schema, key, value } of parseGsettingsList(text)) {
    if (!GNOME_SCHEMAS.includes(schema)) continue;
    // media-keys' "-static" keys are fixed hardware keys hidden from Settings.
    if (key.endsWith("-static") || key === "custom-keybindings" || key === "max-screencast-length") continue;
    if (/^(active|priority|volume-step)$/.test(key)) continue;
    const raw = accelList(value);
    if (!raw.length) continue;
    out.push({
      id: `gnome:${schema}:${key}`,
      keys: raw.map(prettyGtk),
      raw,
      name: gnomeName(key),
      action: key,
      category: gnomeCategory(schema, key),
      scope: schema,
      desktop: "gnome",
    });
  }
  return out;
}

/** Paths of the custom shortcuts, from `gsettings get … custom-keybindings`. */
export function customPaths(value: string): string[] {
  const v = parseGVariant(value);
  return Array.isArray(v) ? v.filter((p) => p.startsWith("/")) : [];
}

/** One custom shortcut from `gsettings list-recursively <custom schema>:<path>`. */
export function gnomeCustom(path: string, text: string): Shortcut | undefined {
  const values: Record<string, string> = {};
  for (const { key, value } of parseGsettingsList(text)) {
    const v = parseGVariant(value);
    values[key] = typeof v === "string" ? v : "";
  }
  const raw = values.binding ? [values.binding] : [];
  if (!raw.length || raw[0] === "disabled") return undefined;
  const command = values.command || undefined;
  return {
    id: `gnome:custom:${path}`,
    keys: raw.map(prettyGtk),
    raw,
    name: values.name || (command ? runName(command) : "Custom Shortcut"),
    action: command ?? path,
    category: "Custom Shortcuts",
    command,
    scope: CUSTOM_SCHEMA,
    desktop: "gnome",
  };
}

// ---------------------------------------------------------------------------
// KDE Plasma: ~/.config/kglobalshortcutsrc

/** Splits a kglobalshortcutsrc value on unescaped commas, at most `max` fields. */
function splitKdeValue(value: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (c === "\\" && i + 1 < value.length) {
      cur += c + value[++i];
    } else if (c === "," && out.length < max - 1) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/** KDE's alternatives are separated by tabs, written `\t`; `\,` is a comma. */
export function kdeKeys(field: string): string[] {
  return field
    .split(/\t|\\t/)
    .map((k) => k.replace(/\\,/g, ",").replace(/\\\\/g, "\\").trim())
    .filter((k) => k && k.toLowerCase() !== "none");
}

const KDE_COMPONENTS: Record<string, string> = {
  kwin: "KWin",
  plasmashell: "Plasma",
  ksmserver: "Session",
  kmix: "Sound",
  mediacontrol: "Media",
  org_kde_powerdevil: "Power",
  kaccess: "Accessibility",
  "kcm_touchpad": "Touchpad",
  "kded5": "Keyboard",
  "KDE Keyboard Layout Switcher": "Keyboard Layouts",
  "org.kde.spectacle.desktop": "Spectacle",
  "org.kde.krunner.desktop": "KRunner",
  "org.kde.dolphin.desktop": "Dolphin",
  "org.kde.konsole.desktop": "Konsole",
  "services": "Applications",
};

/** `org.kde.dolphin.desktop` → "Dolphin", `firefox.desktop` → "Firefox". */
const desktopFileName = (id: string) => titleCase(id.replace(/\.desktop$/, "").split(".").pop() ?? id);

function kdeCategory(group: string, friendly: string, action: string): string {
  if (group === "kwin") {
    if (/desktop/i.test(action) && !/show desktop/i.test(action)) return "Virtual Desktops";
    if (/screen|output/i.test(action)) return "Displays";
    if (/quick tile|tile/i.test(action)) return "Tiling";
    if (/zoom|invert|magnif/i.test(action)) return "Accessibility";
    return "Windows";
  }
  if (group.endsWith(".desktop")) return "Applications";
  return friendly;
}

/** Bound global shortcuts from kglobalshortcutsrc, with Plasma 6's `[services]` overrides. */
export function kdeShortcuts(text: string): Shortcut[] {
  const groups = new Map<string, { friendly?: string; entries: Map<string, { keys: string[]; label?: string }> }>();
  let current: string | undefined;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      // "[services][org.kde.dolphin.desktop]" → "services/org.kde.dolphin.desktop".
      current = header[1].split("][").join("/");
      if (!groups.has(current)) groups.set(current, { entries: new Map() });
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    const g = groups.get(current)!;
    if (key === "_k_friendly_name") {
      g.friendly = value.trim();
      continue;
    }
    if (current.startsWith("services/")) {
      // Plasma 6: only the active shortcut.
      g.entries.set(key, { keys: kdeKeys(value) });
    } else {
      const [active = "", , label] = splitKdeValue(value, 3);
      g.entries.set(key, { keys: kdeKeys(active), label: label?.trim() || undefined });
    }
  }

  const out = new Map<string, Shortcut>();
  for (const [group, g] of groups) {
    const service = group.startsWith("services/");
    const component = service ? group.slice("services/".length) : group;
    const base = service ? groups.get(component) : g;
    const friendly = base?.friendly ?? KDE_COMPONENTS[component] ??
      (component.endsWith(".desktop") ? desktopFileName(component) : titleCase(component));
    for (const [action, entry] of g.entries) {
      const id = `kde:${component}:${action}`;
      if (!entry.keys.length) {
        // A Plasma 6 override that removes the shortcut.
        if (service) out.delete(id);
        continue;
      }
      const label = entry.label ?? base?.entries.get(action)?.label;
      const launch = action === "_launch";
      const name = launch ? `Launch ${friendly}` : label || action;
      out.set(id, {
        id,
        keys: entry.keys.map(prettyPlus),
        raw: entry.keys,
        name,
        action,
        category: launch ? "Applications" : kdeCategory(component, friendly, name),
        scope: friendly,
        desktop: "kde",
      });
    }
  }
  return [...out.values()];
}

// ---------------------------------------------------------------------------
// Hyprland: hyprctl binds -j

export interface HyprBind {
  locked?: boolean;
  mouse?: boolean;
  release?: boolean;
  repeat?: boolean;
  non_consuming?: boolean;
  has_description?: boolean;
  modmask: number;
  submap: string;
  key: string;
  keycode?: number;
  description?: string;
  dispatcher: string;
  arg: string;
}

const HYPR_MODS: [number, string][] = [[64, "Super"], [4, "Ctrl"], [8, "Alt"], [1, "Shift"], [128, "AltGr"], [
  32,
  "Hyper",
]];

/** Hyprland's modifier mask: 64 = Super, 4 = Ctrl, 8 = Alt, 1 = Shift. */
export const hyprMods = (mask: number) => HYPR_MODS.filter(([bit]) => mask & bit).map(([, name]) => name);

/** A dispatcher and its argument for humans. */
export function hyprName(dispatcher: string, arg: string): string {
  const a = arg.trim();
  switch (dispatcher) {
    case "exec":
    case "execr":
      return runName(a);
    case "killactive":
      return "Close Window";
    case "forcekillactive":
      return "Kill Window";
    case "workspace":
      return /^[+-]\d+$|^[em][+-]\d+$/.test(a)
        ? `${a.includes("-") ? "Previous" : "Next"} Workspace`
        : a === "previous"
        ? "Previous Workspace"
        : `Switch to Workspace ${a}`;
    case "movetoworkspace":
      return /^special/.test(a) ? "Move Window to Scratchpad" : `Move Window to Workspace ${a}`;
    case "movetoworkspacesilent":
      return /^special/.test(a) ? "Move Window to Scratchpad" : `Send Window to Workspace ${a}`;
    case "togglespecialworkspace":
      return a ? `Toggle Scratchpad ${a}` : "Toggle Scratchpad";
    case "movefocus":
      return `Focus ${dir(a)}`;
    case "movewindow":
      return a ? `Move Window ${dir(a)}` : "Move Window";
    case "swapwindow":
      return `Swap Window ${dir(a)}`;
    case "resizeactive":
      return `Resize Window ${a}`.trim();
    case "resizewindow":
      return "Resize Window";
    case "togglefloating":
      return "Toggle Floating";
    case "fullscreen":
      return a === "1" ? "Maximize Window" : "Toggle Fullscreen";
    case "pseudo":
      return "Toggle Pseudo-Tiling";
    case "togglesplit":
      return "Toggle Split";
    case "pin":
      return "Pin Window";
    case "exit":
      return "Exit Hyprland";
    case "cyclenext":
      return a === "prev" ? "Focus Previous Window" : "Focus Next Window";
    case "focusmonitor":
      return `Focus Monitor ${dir(a)}`;
    case "movecurrentworkspacetomonitor":
      return `Move Workspace to Monitor ${dir(a)}`;
    case "submap":
      return a === "reset" ? "Leave Mode" : `Enter Mode “${a}”`;
    case "togglegroup":
      return "Toggle Group";
    case "changegroupactive":
      return a === "b" ? "Previous Window in Group" : "Next Window in Group";
    case "dpms":
      return `Screens ${titleCase(a || "toggle")}`;
    default:
      return titleCase(`${dispatcher} ${a}`.replace(/([a-z])([A-Z])/g, "$1 $2"));
  }
}

export function hyprShortcuts(json: string): Shortcut[] {
  const binds = JSON.parse(json) as HyprBind[];
  const out: Shortcut[] = [];
  binds.forEach((b, i) => {
    const key = b.key || (b.keycode ? `code:${b.keycode}` : "");
    if (!key) return;
    const raw = [...hyprMods(b.modmask), key].join("+");
    const exec = b.dispatcher === "exec" || b.dispatcher === "execr";
    const command = exec ? b.arg.trim() : undefined;
    const name = b.has_description && b.description ? b.description : hyprName(b.dispatcher, b.arg);
    out.push({
      id: `hyprland:${b.submap}:${raw}:${i}`,
      keys: [joinKeys([...hyprMods(b.modmask), keyName(key)])],
      raw: [raw],
      name,
      action: `${b.dispatcher}${b.arg ? ` ${b.arg}` : ""}`,
      category: b.submap ? `Mode: ${b.submap}` : b.mouse ? "Mouse" : wmCategory(b.dispatcher, command),
      command,
      scope: b.submap || undefined,
      desktop: "hyprland",
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sway and i3: bindsym lines

/** A Sway or i3 command for humans. */
export function i3Name(command: string): string {
  const c = command.trim().replace(/\s+/g, " ");
  let m: RegExpExecArray | null;
  if ((m = /^exec(?:_always)?(?: --no-startup-id)? (.+)$/.exec(c))) return runName(m[1]);
  if (/^kill$/.test(c)) return "Close Window";
  if ((m = /^workspace (?:number )?(.+)$/.exec(c))) {
    const w = m[1];
    if (/^(next|prev|next_on_output|prev_on_output)$/.test(w)) {
      return w.startsWith("next") ? "Next Workspace" : "Previous Workspace";
    }
    if (w === "back_and_forth") return "Previous Workspace";
    return `Switch to Workspace ${w.replace(/^"|"$/g, "")}`;
  }
  if ((m = /^move (?:container |window )?(?:to )?workspace (?:number )?(.+?)(?:[;,] ?workspace.*)?$/.exec(c))) {
    return `Move Window to Workspace ${m[1].replace(/^"|"$/g, "")}`;
  }
  if (/^move (container |window )?(to )?scratchpad$/.test(c)) return "Move Window to Scratchpad";
  if (/^scratchpad show$/.test(c)) return "Show Scratchpad";
  if ((m = /^focus (left|right|up|down)$/.exec(c))) return `Focus ${dir(m[1])}`;
  if (c === "focus parent") return "Focus Parent";
  if (c === "focus child") return "Focus Child";
  if (c === "focus mode_toggle") return "Switch Focus Between Tiling and Floating";
  if ((m = /^focus output (.+)$/.exec(c))) return `Focus Monitor ${dir(m[1])}`;
  if ((m = /^move (left|right|up|down)(?: \d+.*)?$/.exec(c))) return `Move Window ${dir(m[1])}`;
  if ((m = /^move (?:workspace )?(?:container )?(?:to )?output (.+)$/.exec(c))) return `Move to Monitor ${dir(m[1])}`;
  if (/^fullscreen( toggle)?$/.test(c)) return "Toggle Fullscreen";
  if (/^floating toggle$/.test(c)) return "Toggle Floating";
  if (/^sticky toggle$/.test(c)) return "Toggle Sticky";
  if ((m = /^layout (stacking|tabbed|toggle split|splith|splitv|default|toggle.*)$/.exec(c))) {
    return `Layout: ${titleCase(m[1].replace("toggle split", "Toggle Split"))}`;
  }
  if (/^split ?h(orizontal)?$|^splith$/.test(c)) return "Split Horizontally";
  if (/^split ?v(ertical)?$|^splitv$/.test(c)) return "Split Vertically";
  if (/^split toggle$/.test(c)) return "Toggle Split";
  if ((m = /^resize (shrink|grow) (width|height)(.*)$/.exec(c))) {
    return `${m[1] === "grow" ? "Grow" : "Shrink"} Window ${titleCase(m[2])}${m[3].trim() ? ` ${m[3].trim()}` : ""}`;
  }
  if (c === "reload") return "Reload Configuration";
  if (c === "restart") return "Restart i3";
  if (/^exit$/.test(c)) return "Exit";
  if ((m = /^mode "?([^"]+)"?$/.exec(c))) return m[1] === "default" ? "Leave Mode" : `Enter Mode “${m[1]}”`;
  return c.length > 60 ? `${c.slice(0, 57)}…` : c;
}

/** `$mod` and friends replaced by their `set` values. */
const substitute = (text: string, vars: Map<string, string>) =>
  text.replace(/\$[A-Za-z0-9_]+/g, (v) => vars.get(v) ?? v);

/** Joins lines ending with a backslash and drops comments. */
function logicalLines(text: string): string[] {
  const out: string[] = [];
  let acc = "";
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (/^\s*#/.test(line) && !acc) continue;
    if (line.endsWith("\\")) {
      acc += line.slice(0, -1) + " ";
      continue;
    }
    out.push((acc + line).trim());
    acc = "";
  }
  if (acc) out.push(acc.trim());
  return out.filter(Boolean);
}

/** Bindings of a Sway or i3 configuration, `mode` blocks and `bindsym { … }` blocks included. */
export function i3Shortcuts(text: string, desktop: "sway" | "i3"): Shortcut[] {
  const vars = new Map<string, string>();
  const out: Shortcut[] = [];
  const modes: string[] = [];
  // Inside "bindsym {": the prefix and flags of the block.
  let block: { kind: string; flags: string[] } | undefined;
  const add = (kind: string, rest: string) => {
    const words = rest.trim().split(/\s+/);
    const flags: string[] = [];
    while (words[0]?.startsWith("--")) flags.push(words.shift()!);
    const combo = words.shift();
    const command = words.join(" ");
    if (!combo || !command) return;
    const mode = modes.at(-1);
    const exec = /^exec(?:_always)?(?: --no-startup-id)? (.+)$/.exec(command);
    const verb = command.split(/\s+/)[0];
    const parts = splitPlus(combo);
    const last = parts.pop() ?? "";
    const keys = joinKeys([...parts.map(keyName), kind === "bindcode" ? `Key Code ${last}` : keyName(last)]);
    out.push({
      id: `${desktop}:${mode ?? ""}:${combo}:${out.length}`,
      keys: [keys],
      raw: [combo],
      name: i3Name(command),
      action: command,
      category: mode && mode !== "default"
        ? `Mode: ${mode}`
        : /--whole-window|--border|button\d/.test(`${flags.join(" ")} ${combo}`)
        ? "Mouse"
        : wmCategory(/^move/.test(command) && /workspace/.test(command) ? "workspace" : verb, exec?.[1]),
      command: exec?.[1],
      scope: mode,
      desktop,
    });
  };
  // Only whole lines are comments: "#" elsewhere is part of the command.
  const lines = logicalLines(text);
  // i3 reads every variable before the rest; Sway in order.
  if (desktop === "i3") {
    for (const line of lines) {
      const m = /^set\s+(\$\S+)\s+(.+)$/.exec(line);
      if (m) vars.set(m[1], m[2].trim());
    }
  }
  for (const line of lines) {
    let m: RegExpExecArray | null;
    if ((m = /^set\s+(\$\S+)\s+(.+)$/.exec(line))) {
      vars.set(m[1], substitute(m[2].trim(), vars));
      continue;
    }
    const sub = substitute(line, vars);
    if (block) {
      if (sub === "}") {
        block = undefined;
        continue;
      }
      add(block.kind, `${block.flags.join(" ")} ${sub}`);
      continue;
    }
    if ((m = /^mode\s+(?:--pango_markup\s+)?("([^"]+)"|\S+)\s*\{$/.exec(sub))) {
      modes.push(m[2] ?? m[1]);
      continue;
    }
    if ((m = /^(bindsym|bindcode)((?:\s+--\S+)*)\s*\{$/.exec(sub))) {
      block = { kind: m[1], flags: m[2].trim().split(/\s+/).filter(Boolean) };
      continue;
    }
    if (sub === "}") {
      modes.pop();
      continue;
    }
    if ((m = /^(bindsym|bindcode)\s+(.+)$/.exec(sub))) add(m[1], m[2]);
  }
  return out;
}

/** `swaymsg -t get_config`: the main file, and the included ones on Sway 1.9+. */
export function swayConfigText(json: string): string {
  const o = JSON.parse(json) as { config?: string; included_configs?: { path?: string; raw_config?: string }[] };
  return [o.config ?? "", ...(o.included_configs ?? []).map((c) => c.raw_config ?? "")].join("\n");
}

// ---------------------------------------------------------------------------
// niri: the binds block of config.kdl

interface KdlNode {
  name: string;
  args: string[];
  props: Record<string, string>;
  children: KdlNode[];
}

/** A small KDL reader: enough for niri's binds (nodes, strings, numbers, properties, comments, `/-`). */
export function parseKdl(text: string): KdlNode[] {
  let i = 0;
  const skipSpace = (newlines: boolean) => {
    for (;;) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\r" || (newlines && c === "\n")) i++;
      else if (c === "\\" && /^\\[ \t]*(\/\/[^\n]*)?\r?\n/.test(text.slice(i))) {
        i = text.indexOf("\n", i) + 1;
      } else if (text.startsWith("//", i)) {
        while (i < text.length && text[i] !== "\n") i++;
      } else if (text.startsWith("/*", i)) {
        let depth = 0;
        do {
          if (text.startsWith("/*", i)) {
            depth++;
            i += 2;
          } else if (text.startsWith("*/", i)) {
            depth--;
            i += 2;
          } else i++;
        } while (depth > 0 && i < text.length);
      } else return;
    }
  };
  const readValue = (): string => {
    const c = text[i];
    if (c === '"') {
      i++;
      let out = "";
      while (i < text.length && text[i] !== '"') {
        if (text[i] === "\\") {
          i++;
          const e = text[i];
          out += e === "n" ? "\n" : e === "t" ? "\t" : e;
        } else out += text[i];
        i++;
      }
      i++;
      return out;
    }
    if (c === "r" && /^r#*"/.test(text.slice(i))) {
      const hashes = /^r(#*)"/.exec(text.slice(i))![1];
      const end = `"${hashes}`;
      const start = i + 2 + hashes.length;
      const stop = text.indexOf(end, start);
      i = stop + end.length;
      return text.slice(start, stop);
    }
    const start = i;
    while (i < text.length && !/[\s;{}=)]/.test(text[i])) i++;
    return text.slice(start, i);
  };
  const readNodes = (): KdlNode[] => {
    const nodes: KdlNode[] = [];
    for (;;) {
      skipSpace(true);
      while (text[i] === ";") {
        i++;
        skipSpace(true);
      }
      if (i >= text.length || text[i] === "}") return nodes;
      let skip = false;
      if (text.startsWith("/-", i)) {
        skip = true;
        i += 2;
        skipSpace(true);
      }
      const node: KdlNode = { name: readValue(), args: [], props: {}, children: [] };
      for (;;) {
        skipSpace(false);
        const c = text[i];
        if (i >= text.length || c === "\n" || c === ";" || c === "}") break;
        if (c === "{") {
          i++;
          node.children = readNodes();
          i++;
          continue;
        }
        let slash = false;
        if (text.startsWith("/-", i)) {
          slash = true;
          i += 2;
          skipSpace(false);
          if (text[i] === "{") {
            i++;
            readNodes();
            i++;
            continue;
          }
        }
        const v = readValue();
        if (!v && text[i] !== "=") {
          i++;
          continue;
        }
        if (text[i] === "=") {
          i++;
          const value = readValue();
          if (!slash) node.props[v] = value;
        } else if (!slash) node.args.push(v);
      }
      if (text[i] === ";") i++;
      if (!skip) nodes.push(node);
    }
  };
  return readNodes();
}

/** A niri action for humans: `focus-column-left` → "Focus Column Left", `spawn "kitty"` → "Run kitty". */
export function niriName(action: string, args: string[]): string {
  if (action === "spawn") return runName(args.join(" "));
  if (action === "spawn-sh") return runName(args.join(" "));
  if (action === "focus-workspace" && args[0]) return `Switch to Workspace ${args[0]}`;
  if (action === "move-column-to-workspace" && args[0]) return `Move Column to Workspace ${args[0]}`;
  if (action === "move-window-to-workspace" && args[0]) return `Move Window to Workspace ${args[0]}`;
  if (action === "set-column-width" || action === "set-window-height") {
    return `${action === "set-column-width" ? "Column Width" : "Window Height"} ${args.join(" ")}`;
  }
  if (action === "quit") return "Quit niri";
  if (action === "show-hotkey-overlay") return "Show Important Hotkeys";
  if (action === "close-window") return "Close Window";
  return titleCase(action) + (args.length ? ` ${args.join(" ")}` : "");
}

/** Bindings of niri's config.kdl. */
export function niriShortcuts(text: string): Shortcut[] {
  const out: Shortcut[] = [];
  for (const top of parseKdl(text)) {
    if (top.name !== "binds") continue;
    for (const bind of top.children) {
      const act = bind.children[0];
      if (!act) continue;
      const combo = bind.name;
      const command = act.name === "spawn" || act.name === "spawn-sh" ? act.args.join(" ") : undefined;
      const title = bind.props["hotkey-overlay-title"];
      out.push({
        id: `niri:${combo}`,
        keys: [prettyPlus(combo.replace(/^Mod(?=\+|$)/, "Super"))],
        raw: [combo],
        name: title && title !== "null" ? title : niriName(act.name, act.args),
        action: [act.name, ...act.args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a))].join(" "),
        category: /Wheel|Touchpad|Mouse/.test(combo) ? "Mouse" : wmCategory(act.name, command),
        command,
        desktop: "niri",
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cheat sheet

/** The order of sections; others come after, alphabetically. */
const CATEGORY_ORDER = [
  "Custom Shortcuts",
  "Apps",
  "Applications",
  "Launchers",
  "Windows",
  "Switching",
  "Focus",
  "Move",
  "Resize",
  "Tiling",
  "Workspaces",
  "Virtual Desktops",
  "Displays",
  "Screenshots",
  "Sound & Media",
  "Typing",
  "Accessibility",
  "Mouse",
  "System",
  "Session",
];

export function sortShortcuts(list: Shortcut[]): Shortcut[] {
  const rank = (c: string) => {
    const i = CATEGORY_ORDER.indexOf(c);
    return i < 0 ? (c.startsWith("Mode: ") ? 200 : 100) : i;
  };
  return list
    .map((s, i) => ({ s, i }))
    .sort((a, b) => rank(a.s.category) - rank(b.s.category) || a.s.category.localeCompare(b.s.category) || a.i - b.i)
    .map(({ s }) => s);
}

/** Words that match the shortcut when searching: keys spelled out, raw names. */
export function searchWords(s: Shortcut): string[] {
  const words = new Set<string>();
  for (const k of [...s.keys, ...s.raw]) words.add(k);
  for (const k of s.keys) {
    words.add(k.replace(/←/g, "Left").replace(/→/g, "Right").replace(/↑/g, "Up").replace(/↓/g, "Down"));
  }
  words.add(s.action);
  if (s.command) words.add(s.command);
  return [...words];
}

/** The configuration file of each desktop, under `home`. */
export function configFile(desktop: Desktop, home: string): string | undefined {
  switch (desktop) {
    case "kde":
      return `${home}/.config/kglobalshortcutsrc`;
    case "hyprland":
      return `${home}/.config/hypr/hyprland.conf`;
    case "sway":
      return `${home}/.config/sway/config`;
    case "niri":
      return `${home}/.config/niri/config.kdl`;
    case "i3":
      return `${home}/.config/i3/config`;
    default:
      return undefined;
  }
}

/** The settings panel that edits the shortcuts, where the desktop has one. */
export function settingsPanel(desktop: Desktop): string[] | undefined {
  if (desktop === "gnome") return ["gnome-control-center", "keyboard"];
  if (desktop === "kde") return ["systemsettings", "kcm_keys"];
  return undefined;
}
