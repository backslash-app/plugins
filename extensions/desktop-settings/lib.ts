// The settings panels of each desktop, with what to run to open them. Pure, tested in lib_test.ts.

import { type Color, Icons } from "@backslash/api";

export type Desktop = "gnome" | "kde" | "xfce" | "cinnamon" | "other";

export const DESKTOP_NAMES: Record<Desktop, string> = {
  gnome: "GNOME",
  kde: "KDE Plasma",
  xfce: "Xfce",
  cinnamon: "Cinnamon",
  other: "Your desktop",
};

/** `XDG_CURRENT_DESKTOP` is a colon-separated list: `ubuntu:GNOME`, `KDE`, `X-Cinnamon`, `XFCE`. */
export function detectDesktop(xdg: string): Desktop {
  const names = xdg.toLowerCase().split(":");
  if (names.some((n) => n === "kde" || n === "plasma")) return "kde";
  if (names.some((n) => n.includes("cinnamon"))) return "cinnamon";
  if (names.some((n) => n === "xfce")) return "xfce";
  if (names.some((n) => ["gnome", "gnome-classic", "unity", "budgie", "pantheon", "zorin"].includes(n))) return "gnome";
  return "other";
}

export type Category =
  | "Connectivity"
  | "Appearance"
  | "Display & Sound"
  | "Devices"
  | "Apps & Windows"
  | "Privacy & Security"
  | "System";

export const CATEGORIES: Category[] = [
  "Connectivity",
  "Appearance",
  "Display & Sound",
  "Devices",
  "Apps & Windows",
  "Privacy & Security",
  "System",
];

interface Topic {
  title: string;
  category: Category;
  icon: string;
  tint: Color;
  description: string;
  keywords: string[];
}

const t = (
  title: string,
  category: Category,
  icon: string,
  tint: Color,
  description: string,
  keywords: string[],
): Topic => ({ title, category, icon, tint, description, keywords });

/** What each panel is about, whatever the desktop, with English and French words to find it. */
export const TOPICS = {
  all: t("All Settings", "System", Icons.settings, "gray", "The settings app's main window", [
    "settings",
    "preferences",
    "control center",
    "réglages",
    "paramètres",
    "préférences",
    "centre de contrôle",
  ]),
  wifi: t("Wi-Fi", "Connectivity", Icons.wifi, "blue", "Wireless networks, hotspot", [
    "wifi",
    "wireless",
    "wlan",
    "hotspot",
    "sans fil",
    "réseau",
    "point d'accès",
  ]),
  network: t("Network", "Connectivity", Icons.globe, "blue", "Wired connections, VPN and proxy", [
    "network",
    "ethernet",
    "wired",
    "vpn",
    "proxy",
    "ip",
    "dns",
    "réseau",
    "filaire",
    "connexion",
  ]),
  mobile: t("Mobile Network", "Connectivity", Icons.globe, "blue", "Mobile broadband modems", [
    "mobile",
    "wwan",
    "4g",
    "5g",
    "lte",
    "modem",
    "sim",
    "réseau mobile",
  ]),
  bluetooth: t("Bluetooth", "Connectivity", Icons.bluetooth, "blue", "Pair headphones, mice and keyboards", [
    "bluetooth",
    "pair",
    "headphones",
    "casque",
    "appairer",
    "écouteurs",
  ]),
  sharing: t("Sharing", "Connectivity", Icons.link, "teal", "Screen sharing, remote desktop, file and media sharing", [
    "sharing",
    "remote desktop",
    "rdp",
    "vnc",
    "ssh",
    "partage",
    "bureau à distance",
  ]),
  onlineAccounts: t(
    "Online Accounts",
    "Connectivity",
    Icons.cloud,
    "teal",
    "Google, Microsoft, Nextcloud and other accounts",
    [
      "accounts",
      "online",
      "google",
      "microsoft",
      "nextcloud",
      "comptes en ligne",
    ],
  ),
  kdeconnect: t("KDE Connect", "Connectivity", Icons.link, "teal", "Your phone on your desktop", [
    "phone",
    "android",
    "kdeconnect",
    "téléphone",
    "smartphone",
  ]),
  firewall: t("Firewall", "Privacy & Security", Icons.shield, "red", "Incoming connections rules", [
    "firewall",
    "ufw",
    "pare-feu",
    "sécurité",
  ]),
  background: t("Background", "Appearance", Icons.image, "pink", "Wallpaper of the desktop", [
    "background",
    "wallpaper",
    "desktop",
    "fond d'écran",
    "fond",
    "arrière-plan",
    "image",
  ]),
  appearance: t("Appearance", "Appearance", Icons.palette, "purple", "Light or dark style, accent color, theme", [
    "appearance",
    "theme",
    "dark",
    "light",
    "accent",
    "style",
    "apparence",
    "thème",
    "sombre",
    "clair",
    "mode sombre",
  ]),
  colors: t("Colors", "Appearance", Icons.droplet, "purple", "Color scheme of windows and apps", [
    "colors",
    "color scheme",
    "accent",
    "couleurs",
    "jeu de couleurs",
  ]),
  fonts: t("Fonts", "Appearance", Icons.text, "purple", "Interface and document fonts, size, antialiasing", [
    "fonts",
    "text size",
    "polices",
    "police",
    "taille du texte",
    "lissage",
  ]),
  icons: t("Icons", "Appearance", Icons.apps, "purple", "Icon theme", [
    "icons",
    "icon theme",
    "icônes",
    "thème d'icônes",
  ]),
  cursor: t("Cursors", "Appearance", Icons.dottedCircle, "purple", "Pointer theme and size", [
    "cursor",
    "pointer",
    "curseur",
    "pointeur",
  ]),
  appStyle: t("Application Style", "Appearance", Icons.layers, "purple", "Widget style of apps", [
    "style",
    "widgets",
    "gtk",
    "qt",
    "breeze",
    "style des applications",
  ]),
  windowDecorations: t("Window Decorations", "Appearance", Icons.window, "purple", "Title bars and their buttons", [
    "title bar",
    "window buttons",
    "borders",
    "barre de titre",
    "décorations des fenêtres",
    "bordures",
  ]),
  splash: t("Splash Screen", "Appearance", Icons.sparkle, "purple", "What shows while the session starts", [
    "splash",
    "boot",
    "écran de démarrage",
  ]),
  effects: t("Desktop Effects", "Appearance", Icons.sparkle, "purple", "Animations and window effects", [
    "effects",
    "animations",
    "wobbly",
    "blur",
    "effets",
    "flou",
  ]),
  desktopIcons: t("Desktop", "Appearance", Icons.home, "pink", "Desktop icons and their behavior", [
    "desktop",
    "icons",
    "bureau",
  ]),
  panel: t("Panel", "Appearance", Icons.layers, "gray", "Taskbar, applets and their layout", [
    "panel",
    "taskbar",
    "dock",
    "applets",
    "panneau",
    "barre des tâches",
  ]),
  display: t("Displays", "Display & Sound", Icons.monitor, "teal", "Resolution, scaling, arrangement, refresh rate", [
    "display",
    "monitor",
    "screen",
    "resolution",
    "scaling",
    "hidpi",
    "refresh rate",
    "écran",
    "moniteur",
    "affichage",
    "résolution",
    "mise à l'échelle",
  ]),
  nightLight: t("Night Light", "Display & Sound", Icons.moon, "orange", "Warmer colors at night", [
    "night light",
    "blue light",
    "redshift",
    "veilleuse",
    "éclairage nocturne",
    "lumière bleue",
    "mode nuit",
  ]),
  color: t("Color Profiles", "Display & Sound", Icons.pipette, "teal", "Calibration of screens and printers", [
    "color profile",
    "icc",
    "calibration",
    "profil de couleur",
    "étalonnage",
  ]),
  sound: t("Sound", "Display & Sound", Icons.speaker, "orange", "Output and input devices, volume, alert sound", [
    "sound",
    "audio",
    "volume",
    "speakers",
    "microphone",
    "output",
    "input",
    "son",
    "haut-parleurs",
    "sortie",
    "entrée",
  ]),
  power: t("Power", "Devices", Icons.power, "green", "Battery, power mode, screen blank and suspend", [
    "power",
    "battery",
    "energy",
    "suspend",
    "sleep",
    "lid",
    "énergie",
    "batterie",
    "alimentation",
    "veille",
    "mise en veille",
  ]),
  keyboard: t("Keyboard", "Devices", Icons.keyboard, "gray", "Layouts, input sources, repeat rate", [
    "keyboard",
    "layout",
    "input source",
    "azerty",
    "qwerty",
    "clavier",
    "disposition",
    "langue de saisie",
  ]),
  shortcuts: t("Keyboard Shortcuts", "Devices", Icons.keyboard, "gray", "Global and custom shortcuts", [
    "shortcuts",
    "hotkeys",
    "keybindings",
    "raccourcis",
    "raccourcis clavier",
  ]),
  mouse: t(
    "Mouse & Touchpad",
    "Devices",
    Icons.dottedCircle,
    "gray",
    "Pointer speed, natural scrolling, tap to click",
    [
      "mouse",
      "touchpad",
      "trackpad",
      "pointer",
      "scroll",
      "souris",
      "pavé tactile",
      "défilement",
    ],
  ),
  touchpad: t("Touchpad", "Devices", Icons.square, "gray", "Tap to click, gestures, scrolling", [
    "touchpad",
    "trackpad",
    "gestures",
    "pavé tactile",
    "gestes",
  ]),
  printers: t("Printers", "Devices", Icons.file, "gray", "Add printers and manage print jobs", [
    "printer",
    "print",
    "scanner",
    "cups",
    "imprimante",
    "imprimer",
    "impression",
  ]),
  wacom: t("Drawing Tablet", "Devices", Icons.pipette, "gray", "Wacom and other pen tablets", [
    "wacom",
    "tablet",
    "stylus",
    "pen",
    "tablette graphique",
    "stylet",
  ]),
  removable: t("Removable Media", "Devices", Icons.drive, "gray", "What happens when you plug in a drive or a phone", [
    "removable",
    "usb",
    "autorun",
    "automount",
    "médias amovibles",
    "clé usb",
  ]),
  thunderbolt: t("Thunderbolt", "Devices", Icons.bolt, "yellow", "Authorize Thunderbolt devices", [
    "thunderbolt",
    "usb4",
    "dock",
  ]),
  gameControllers: t("Game Controllers", "Devices", Icons.gamepad, "gray", "Joysticks and gamepads", [
    "gamepad",
    "joystick",
    "controller",
    "manette",
  ]),
  notifications: t("Notifications", "Apps & Windows", Icons.bell, "red", "Do Not Disturb, banners and per-app rules", [
    "notifications",
    "do not disturb",
    "dnd",
    "ne pas déranger",
    "alertes",
  ]),
  apps: t("Apps", "Apps & Windows", Icons.apps, "blue", "Permissions, storage and defaults of each app", [
    "apps",
    "applications",
    "permissions",
    "flatpak",
    "logiciels",
  ]),
  defaultApps: t("Default Apps", "Apps & Windows", Icons.star, "yellow", "Browser, mail, music, video and photos", [
    "default apps",
    "default browser",
    "applications par défaut",
    "navigateur par défaut",
  ]),
  fileTypes: t("File Associations", "Apps & Windows", Icons.file, "blue", "Which app opens which kind of file", [
    "file types",
    "mime",
    "open with",
    "associations",
    "types de fichiers",
    "ouvrir avec",
  ]),
  startup: t("Autostart", "Apps & Windows", Icons.rocket, "green", "Apps and scripts started when you log in", [
    "autostart",
    "startup",
    "login",
    "démarrage",
    "lancement automatique",
  ]),
  search: t("Search", "Apps & Windows", Icons.search, "blue", "What the desktop search looks into", [
    "search",
    "indexing",
    "recherche",
    "indexation",
  ]),
  multitasking: t("Multitasking", "Apps & Windows", Icons.layers, "blue", "Hot corner, workspaces, app switching", [
    "multitasking",
    "hot corner",
    "workspaces",
    "alt tab",
    "multitâche",
    "coin actif",
    "espaces de travail",
  ]),
  workspaces: t("Workspaces", "Apps & Windows", Icons.layers, "blue", "Virtual desktops", [
    "workspaces",
    "virtual desktops",
    "espaces de travail",
    "bureaux virtuels",
  ]),
  windows: t("Window Behavior", "Apps & Windows", Icons.window, "blue", "Focus, title bar actions, snapping", [
    "windows",
    "focus",
    "snapping",
    "tiling",
    "fenêtres",
    "comportement des fenêtres",
  ]),
  privacy: t("Privacy", "Privacy & Security", Icons.shield, "red", "Location, camera, microphone, file history", [
    "privacy",
    "confidentialité",
    "vie privée",
  ]),
  location: t("Location Services", "Privacy & Security", Icons.pin, "red", "Which apps may know where you are", [
    "location",
    "gps",
    "localisation",
    "position",
  ]),
  camera: t("Camera", "Privacy & Security", Icons.camera, "red", "Which apps may use the camera", [
    "camera",
    "webcam",
    "caméra",
  ]),
  microphone: t("Microphone", "Privacy & Security", Icons.mic, "red", "Which apps may use the microphone", [
    "microphone",
    "mic",
    "micro",
  ]),
  screenLock: t("Screen Lock", "Privacy & Security", Icons.lock, "red", "Automatic lock, blank screen delay", [
    "lock screen",
    "screen lock",
    "screensaver",
    "verrouillage",
    "écran de verrouillage",
    "économiseur d'écran",
  ]),
  usage: t("File History & Trash", "Privacy & Security", Icons.history, "red", "Recent files, emptying the trash", [
    "history",
    "recent files",
    "trash",
    "historique",
    "fichiers récents",
    "corbeille",
  ]),
  diagnostics: t("Diagnostics", "Privacy & Security", Icons.bug, "gray", "Problem reporting", [
    "diagnostics",
    "crash reports",
    "rapports",
    "problèmes",
  ]),
  users: t("Users", "System", Icons.person, "blue", "Accounts, passwords, fingerprint, auto login", [
    "users",
    "accounts",
    "password",
    "fingerprint",
    "utilisateurs",
    "comptes",
    "mot de passe",
    "empreinte",
  ]),
  datetime: t("Date & Time", "System", Icons.clock, "blue", "Time zone, automatic time, clock format", [
    "date",
    "time",
    "timezone",
    "clock",
    "heure",
    "fuseau horaire",
    "horloge",
  ]),
  region: t("Region & Language", "System", Icons.globe, "blue", "Language, formats of dates, numbers and money", [
    "language",
    "region",
    "locale",
    "formats",
    "langue",
    "région",
    "français",
  ]),
  accessibility: t("Accessibility", "System", Icons.eye, "blue", "Larger text, contrast, screen reader, zoom", [
    "accessibility",
    "a11y",
    "screen reader",
    "zoom",
    "contrast",
    "accessibilité",
    "lecteur d'écran",
    "contraste",
    "loupe",
  ]),
  about: t("About This Computer", "System", Icons.info, "gray", "Device name, hardware, system version", [
    "about",
    "system info",
    "hardware",
    "version",
    "device name",
    "à propos",
    "informations système",
    "matériel",
    "nom de l'appareil",
  ]),
  loginScreen: t("Login Screen", "System", Icons.key, "gray", "Theme and behavior of the login screen", [
    "login screen",
    "sddm",
    "lightdm",
    "écran de connexion",
  ]),
  session: t("Session & Startup", "System", Icons.power, "gray", "What happens when you log in and out", [
    "session",
    "logout",
    "déconnexion",
  ]),
  settingsEditor: t("Settings Editor", "System", Icons.braces, "gray", "Every raw setting, for advanced changes", [
    "editor",
    "xfconf",
    "advanced",
    "éditeur",
    "avancé",
  ]),
} as const;

export type TopicId = keyof typeof TOPICS;

export interface Panel extends Topic {
  id: TopicId;
  /** Ways to open it, tried in order until one is installed. */
  commands: string[][];
  /** Environment for the program (gnome-control-center outside GNOME). */
  env?: Record<string, string>;
}

type Entry = [TopicId, ...string[][]];

const gnomePanel = (id: TopicId, panel?: string): Entry => [id, ["gnome-control-center", ...(panel ? [panel] : [])]];

const GNOME: Entry[] = [
  gnomePanel("all"),
  gnomePanel("wifi", "wifi"),
  gnomePanel("network", "network"),
  gnomePanel("mobile", "wwan"),
  gnomePanel("bluetooth", "bluetooth"),
  gnomePanel("sharing", "sharing"),
  gnomePanel("onlineAccounts", "online-accounts"),
  gnomePanel("appearance", "background"),
  gnomePanel("background", "background"),
  gnomePanel("display", "display"),
  gnomePanel("nightLight", "display"),
  gnomePanel("color", "color"),
  gnomePanel("sound", "sound"),
  gnomePanel("power", "power"),
  gnomePanel("keyboard", "keyboard"),
  gnomePanel("shortcuts", "keyboard"),
  gnomePanel("mouse", "mouse"),
  gnomePanel("printers", "printers"),
  gnomePanel("wacom", "wacom"),
  gnomePanel("removable", "removable-media"),
  gnomePanel("thunderbolt", "thunderbolt"),
  gnomePanel("notifications", "notifications"),
  gnomePanel("apps", "applications"),
  gnomePanel("defaultApps", "default-apps"),
  gnomePanel("search", "search"),
  gnomePanel("multitasking", "multitasking"),
  gnomePanel("privacy", "privacy"),
  gnomePanel("location", "location"),
  gnomePanel("camera", "camera"),
  gnomePanel("microphone", "microphone"),
  gnomePanel("screenLock", "screen"),
  gnomePanel("usage", "usage"),
  gnomePanel("diagnostics", "diagnostics"),
  gnomePanel("users", "users"),
  gnomePanel("datetime", "datetime"),
  gnomePanel("region", "region"),
  gnomePanel("accessibility", "universal-access"),
  gnomePanel("about", "info-overview"),
];

/** Plasma 6 and 5: System Settings on the page, else the page alone. */
const kcm = (id: TopicId, name?: string): Entry =>
  name
    ? [id, ["systemsettings", name], ["systemsettings5", name], ["kcmshell6", name], ["kcmshell5", name]]
    : [id, ["systemsettings"], ["systemsettings5"]];

const KDE: Entry[] = [
  kcm("all"),
  kcm("wifi", "kcm_networkmanagement"),
  kcm("network", "kcm_networkmanagement"),
  kcm("bluetooth", "kcm_bluetooth"),
  kcm("onlineAccounts", "kcm_kaccounts"),
  kcm("kdeconnect", "kcm_kdeconnect"),
  kcm("firewall", "kcm_firewall"),
  kcm("background", "kcm_wallpaper"),
  kcm("appearance", "kcm_lookandfeel"),
  kcm("colors", "kcm_colors"),
  kcm("fonts", "kcm_fonts"),
  kcm("icons", "kcm_icons"),
  kcm("cursor", "kcm_cursortheme"),
  kcm("appStyle", "kcm_style"),
  kcm("windowDecorations", "kcm_kwindecoration"),
  kcm("splash", "kcm_splashscreen"),
  kcm("effects", "kcm_kwin_effects"),
  kcm("display", "kcm_kscreen"),
  kcm("nightLight", "kcm_nightcolor"),
  kcm("sound", "kcm_pulseaudio"),
  kcm("power", "kcm_powerdevilprofilesconfig"),
  kcm("keyboard", "kcm_keyboard"),
  kcm("shortcuts", "kcm_keys"),
  kcm("mouse", "kcm_mouse"),
  kcm("touchpad", "kcm_touchpad"),
  kcm("printers", "kcm_printer_manager"),
  kcm("removable", "kcm_device_automounter"),
  kcm("thunderbolt", "kcm_bolt"),
  kcm("gameControllers", "kcm_gamecontroller"),
  kcm("notifications", "kcm_notifications"),
  kcm("defaultApps", "kcm_componentchooser"),
  kcm("fileTypes", "kcm_filetypes"),
  kcm("startup", "kcm_autostart"),
  kcm("search", "kcm_plasmasearch"),
  kcm("workspaces", "kcm_kwin_virtualdesktops"),
  kcm("windows", "kcm_kwinoptions"),
  kcm("screenLock", "kcm_screenlocker"),
  kcm("usage", "kcm_recentFiles"),
  kcm("users", "kcm_users"),
  kcm("datetime", "kcm_clock"),
  kcm("region", "kcm_regionandlang"),
  kcm("accessibility", "kcm_access"),
  kcm("about", "kcm_about-distro"),
  kcm("loginScreen", "kcm_sddm"),
  kcm("session", "kcm_smserver"),
];

const XFCE: Entry[] = [
  ["all", ["xfce4-settings-manager"]],
  ["network", ["nm-connection-editor"]],
  ["bluetooth", ["blueman-manager"]],
  ["background", ["xfdesktop-settings"]],
  ["desktopIcons", ["xfdesktop-settings"]],
  ["appearance", ["xfce4-appearance-settings"]],
  ["windowDecorations", ["xfwm4-settings"]],
  ["effects", ["xfwm4-tweaks-settings"]],
  ["panel", ["xfce4-panel", "--preferences"]],
  ["display", ["xfce4-display-settings"]],
  ["color", ["xfce4-color-settings"]],
  ["sound", ["pavucontrol"], ["pwvucontrol"]],
  ["power", ["xfce4-power-manager-settings"]],
  ["keyboard", ["xfce4-keyboard-settings"]],
  ["shortcuts", ["xfce4-keyboard-settings"]],
  ["mouse", ["xfce4-mouse-settings"]],
  ["printers", ["system-config-printer"]],
  ["removable", ["thunar-volman-settings"]],
  ["notifications", ["xfce4-notifyd-config"]],
  ["defaultApps", ["xfce4-mime-settings"], ["exo-preferred-applications"]],
  ["workspaces", ["xfwm4-workspace-settings"]],
  ["session", ["xfce4-session-settings"]],
  ["startup", ["xfce4-session-settings"]],
  ["screenLock", ["xfce4-screensaver-preferences"], ["light-locker-settings"]],
  ["accessibility", ["xfce4-accessibility-settings"]],
  ["about", ["xfce4-about"]],
  ["settingsEditor", ["xfce4-settings-editor"]],
];

const cs = (id: TopicId, module?: string): Entry => [id, ["cinnamon-settings", ...(module ? [module] : [])]];

const CINNAMON: Entry[] = [
  cs("all"),
  cs("network", "network"),
  ["bluetooth", ["blueman-manager"], ["blueberry"]],
  cs("background", "backgrounds"),
  cs("appearance", "themes"),
  cs("fonts", "fonts"),
  cs("effects", "effects"),
  cs("desktopIcons", "desktop"),
  cs("panel", "panel"),
  cs("display", "display"),
  cs("nightLight", "nightlight"),
  cs("color", "color"),
  cs("sound", "sound"),
  cs("power", "power"),
  cs("keyboard", "keyboard"),
  cs("shortcuts", "keyboard"),
  cs("mouse", "mouse"),
  ["printers", ["system-config-printer"]],
  cs("wacom", "wacom"),
  cs("notifications", "notifications"),
  cs("defaultApps", "default"),
  cs("startup", "startup"),
  cs("workspaces", "workspaces"),
  cs("windows", "windows"),
  cs("privacy", "privacy"),
  cs("screenLock", "screensaver"),
  cs("users", "user"),
  cs("datetime", "calendar"),
  cs("accessibility", "accessibility"),
  cs("about", "info"),
];

/** Standalone tools for window managers and desktops without a settings app. */
const OTHER: Entry[] = [
  ["network", ["nm-connection-editor"]],
  ["bluetooth", ["blueman-manager"], ["blueberry"], ["overskride"]],
  ["sound", ["pavucontrol"], ["pwvucontrol"], ["pavucontrol-qt"]],
  ["display", ["nwg-displays"], ["wdisplays"], ["arandr"]],
  ["appearance", ["nwg-look"], ["lxappearance"], ["qt6ct"], ["qt5ct"]],
  ["printers", ["system-config-printer"]],
];

const TABLES: Record<Desktop, Entry[]> = { gnome: GNOME, kde: KDE, xfce: XFCE, cinnamon: CINNAMON, other: OTHER };

/** GNOME renamed a few panels in version 46. */
function gnomeVersioned(entries: Entry[], version?: number): Entry[] {
  if (!version || version < 46) return entries;
  return entries.map(([id, ...cmds]) =>
    id === "about" ? [id, ["gnome-control-center", "system"]] : [id, ...cmds] as Entry
  );
}

/** Every panel of the desktop. Outside a full desktop, GNOME's panels come along when its settings app is installed. */
export function panelsFor(
  desktop: Desktop,
  options: { gnomeVersion?: number; gnomeInstalled?: boolean } = {},
): Panel[] {
  const entries = desktop === "gnome" ? gnomeVersioned(GNOME, options.gnomeVersion) : TABLES[desktop];
  const panels: Panel[] = entries.map(([id, ...commands]) => ({ ...TOPICS[id], id, commands }));
  if (desktop === "other" && options.gnomeInstalled) {
    const own = new Set(panels.map((p) => p.id));
    for (const [id, ...commands] of gnomeVersioned(GNOME, options.gnomeVersion)) {
      // gnome-control-center refuses to start outside GNOME unless told it is in GNOME.
      if (!own.has(id)) panels.push({ ...TOPICS[id], id, commands, env: { XDG_CURRENT_DESKTOP: "GNOME" } });
    }
  }
  return panels;
}

/** `gnome-control-center --version`: `gnome-control-center 46.2`. */
export function parseGnomeVersion(out: string): number | undefined {
  const m = out.match(/(\d+)(?:\.\d+)*/);
  return m ? Number(m[1]) : undefined;
}

export const commandLine = (argv: string[]) => argv.map((a) => (/^[\w./:=-]+$/.test(a) ? a : `'${a}'`)).join(" ");

/** A quick switch backed by one gsettings key. */
export interface Toggle {
  id: string;
  title: string;
  description: string;
  schema: string;
  key: string;
  on: string;
  off: string;
  icon: [on: string, off: string];
  tint: Color;
  keywords: string[];
}

export const GNOME_TOGGLES: Toggle[] = [
  {
    id: "dark",
    title: "Dark Style",
    description: "Dark windows and apps (GNOME 42 and later)",
    schema: "org.gnome.desktop.interface",
    key: "color-scheme",
    on: "'prefer-dark'",
    off: "'default'",
    icon: [Icons.moon, Icons.sun],
    tint: "purple",
    keywords: ["dark mode", "dark theme", "mode sombre", "thème sombre", "clair", "light"],
  },
  {
    id: "night-light",
    title: "Night Light",
    description: "Warmer colors from sunset to sunrise",
    schema: "org.gnome.settings-daemon.plugins.color",
    key: "night-light-enabled",
    on: "true",
    off: "false",
    icon: [Icons.moon, Icons.moon],
    tint: "orange",
    keywords: ["night light", "blue light", "veilleuse", "éclairage nocturne", "mode nuit"],
  },
  {
    id: "animations",
    title: "Animations",
    description: "Animate windows and the overview",
    schema: "org.gnome.desktop.interface",
    key: "enable-animations",
    on: "true",
    off: "false",
    icon: [Icons.sparkle, Icons.sparkle],
    tint: "blue",
    keywords: ["animations", "effects", "effets", "reduce motion"],
  },
  {
    id: "hot-corner",
    title: "Hot Corner",
    description: "Open the overview by pushing the pointer in the top-left corner",
    schema: "org.gnome.desktop.interface",
    key: "enable-hot-corners",
    on: "true",
    off: "false",
    icon: [Icons.layers, Icons.layers],
    tint: "blue",
    keywords: ["hot corner", "coin actif", "overview", "activités"],
  },
  {
    id: "battery-percentage",
    title: "Battery Percentage",
    description: "Show the battery level next to its icon in the top bar",
    schema: "org.gnome.desktop.interface",
    key: "show-battery-percentage",
    on: "true",
    off: "false",
    icon: [Icons.battery, Icons.battery],
    tint: "green",
    keywords: ["battery", "percentage", "batterie", "pourcentage"],
  },
];

export const CINNAMON_TOGGLES: Toggle[] = [
  {
    id: "night-light",
    title: "Night Light",
    description: "Warmer colors from sunset to sunrise",
    schema: "org.cinnamon.settings-daemon.plugins.color",
    key: "night-light-enabled",
    on: "true",
    off: "false",
    icon: [Icons.moon, Icons.moon],
    tint: "orange",
    keywords: ["night light", "veilleuse", "éclairage nocturne", "mode nuit"],
  },
];

/** Whether a `gsettings get` value means on. */
export const isOn = (toggle: Toggle, value: string) => value.trim() === toggle.on;

/** `kreadconfig6 --group General --key ColorScheme`: is the Plasma color scheme a dark one? */
export const isDarkScheme = (scheme: string) => /dark|night|black/i.test(scheme);
