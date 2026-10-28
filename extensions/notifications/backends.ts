// One adapter per notification daemon or desktop. Each says what it can do; the views adapt.

import { exec } from "@backslash/api";
import {
  type BackendId,
  detectBackend,
  type Notification,
  parseBootTime,
  parseDunstHistory,
  parseGdbusBool,
  parseMakoHistory,
  parseMakoModes,
  parseServerInfo,
} from "./lib.ts";

export interface Backend {
  id: BackendId;
  title: string;
  /** Daemon version, when known. */
  version?: string;
  /** undefined: the state can't be read. */
  dnd(): Promise<boolean | undefined>;
  /** Missing when Do Not Disturb can't be changed from outside. */
  setDnd?(on: boolean): Promise<void>;
  /** Shown next to the toggle: how this desktop does it, what to configure. */
  dndNote?: string;
  history?(): Promise<Notification[]>;
  /** Why there is no history, and where to find it instead. */
  historyNote?: string;
  restore?(n: Notification): Promise<void>;
  remove?(n: Notification): Promise<void>;
  clear?(): Promise<void>;
  /** "Clear History" or "Dismiss All". */
  clearTitle?: string;
  openCenter?(): Promise<void>;
  openSettings?(): Promise<void>;
}

const bool = (out: string) => out.trim() === "true";

/** Starts a settings window that outlives the command; tries each program in turn. */
function launch(...candidates: string[][]): Promise<void> {
  for (const [program, ...args] of candidates) {
    try {
      new Deno.Command(program, { args, stdin: "null", stdout: "null", stderr: "null" }).spawn().unref();
      return Promise.resolve();
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound || err instanceof Deno.errors.NotCapable)) throw err;
    }
  }
  return Promise.reject(new Error(`${candidates.map((c) => c[0]).join(" or ")} is not installed`));
}

const gsettings = (...args: string[]) => exec("gsettings", args);

const mako: Omit<Backend, "version"> = {
  id: "mako",
  title: "mako",
  dnd: async () => parseMakoModes(await exec("makoctl", ["mode"])).includes("do-not-disturb"),
  async setDnd(on) {
    try {
      await exec("makoctl", ["mode", on ? "-a" : "-r", "do-not-disturb"]);
    } catch {
      // mako before 1.8
      await exec("makoctl", ["set-mode", on ? "do-not-disturb" : "default"]);
    }
  },
  dndNote: "mako hides notifications in this mode only if its config has a `[mode=do-not-disturb]` section with " +
    "`invisible=1`.",
  async history() {
    // mako 1.9+ prints text unless asked for JSON; older versions only know JSON.
    const out = await exec("makoctl", ["history", "-j"]).catch(() => exec("makoctl", ["history"]));
    return parseMakoHistory(out);
  },
  restore: async () => {
    await exec("makoctl", ["restore"]);
  },
  clear: async () => {
    await exec("makoctl", ["dismiss", "--all"]);
  },
  clearTitle: "Dismiss All Visible",
};

const dunst: Omit<Backend, "version"> = {
  id: "dunst",
  title: "Dunst",
  dnd: async () => bool(await exec("dunstctl", ["is-paused"])),
  setDnd: async (on) => {
    await exec("dunstctl", ["set-paused", String(on)]);
  },
  dndNote: "Dunst keeps notifications received while paused and shows them when you turn this off.",
  async history() {
    const [json, boot] = await Promise.all([
      exec("dunstctl", ["history"]),
      exec("uptime", ["-s"]).then(parseBootTime).catch(() => undefined),
    ]);
    return parseDunstHistory(json, boot);
  },
  restore: async (n) => {
    await exec("dunstctl", ["history-pop", n.id]);
  },
  remove: async (n) => {
    await exec("dunstctl", ["history-rm", n.id]);
  },
  clear: async () => {
    await exec("dunstctl", ["history-clear"]);
  },
  clearTitle: "Clear History",
};

const swaync: Omit<Backend, "version"> = {
  id: "swaync",
  title: "SwayNotificationCenter",
  dnd: async () => bool(await exec("swaync-client", ["-D", "-sw"])),
  async setDnd(on) {
    try {
      await exec("swaync-client", [on ? "--dnd-on" : "--dnd-off", "-sw"]);
    } catch {
      // Older versions only toggle.
      if (bool(await exec("swaync-client", ["-D", "-sw"])) !== on) await exec("swaync-client", ["-d", "-sw"]);
    }
  },
  historyNote:
    "SwayNotificationCenter keeps your notifications in its panel and has no command to list them. Open the panel to see them.",
  openCenter: async () => {
    await exec("swaync-client", ["-t", "-sw"]);
  },
  clear: async () => {
    await exec("swaync-client", ["-C", "-sw"]);
  },
  clearTitle: "Clear Notification Center",
};

const gnome: Omit<Backend, "version"> = {
  id: "gnome",
  title: "GNOME",
  dnd: async () => !bool(await gsettings("get", "org.gnome.desktop.notifications", "show-banners")),
  setDnd: async (on) => {
    await gsettings("set", "org.gnome.desktop.notifications", "show-banners", String(!on));
  },
  dndNote: "Same switch as in the calendar menu: banners are hidden, notifications still go to the list.",
  historyNote: "GNOME Shell keeps notifications in the calendar menu (Super+V) and doesn't share them with other apps.",
  openSettings: () => launch(["gnome-control-center", "notifications"]),
};

const kde: Omit<Backend, "version"> = {
  id: "kde",
  title: "Plasma",
  dnd: async () =>
    parseGdbusBool(
      await exec("gdbus", [
        "call",
        "--session",
        "--dest",
        "org.freedesktop.Notifications",
        "--object-path",
        "/org/freedesktop/Notifications",
        "--method",
        "org.freedesktop.DBus.Properties.Get",
        "org.freedesktop.Notifications",
        "Inhibited",
      ]),
    ),
  dndNote: "Plasma ties Do Not Disturb to the app asking for it and ends it when that app quits, so it can't be " +
    "switched from here. Use the Do Not Disturb switch of the Notifications applet in the panel.",
  historyNote: "Plasma keeps your notification history in the Notifications applet of the panel.",
  openSettings: () =>
    launch(
      ["systemsettings", "kcm_notifications"],
      ["kcmshell6", "kcm_notifications"],
      ["kcmshell5", "kcm_notifications"],
    ),
};

const xfceDnd = ["-c", "xfce4-notifyd", "-p", "/do-not-disturb"];
const xfce: Omit<Backend, "version"> = {
  id: "xfce",
  title: "Xfce",
  dnd: async () => bool(await exec("xfconf-query", xfceDnd).catch(() => "false")),
  setDnd: async (on) => {
    await exec("xfconf-query", [...xfceDnd, "-n", "-t", "bool", "-s", String(on)]);
  },
  historyNote: "The Xfce notification daemon keeps its log in the Notifications plugin of the panel.",
  openSettings: () => launch(["xfce4-notifyd-config"]),
};

const cinnamon: Omit<Backend, "version"> = {
  id: "cinnamon",
  title: "Cinnamon",
  dnd: async () => !bool(await gsettings("get", "org.cinnamon.desktop.notifications", "display-notifications")),
  setDnd: async (on) => {
    await gsettings("set", "org.cinnamon.desktop.notifications", "display-notifications", String(!on));
  },
  historyNote: "Cinnamon keeps notifications in the Notifications applet of the panel.",
  openSettings: () => launch(["cinnamon-settings", "notifications"]),
};

const BACKENDS: Record<BackendId, Omit<Backend, "version">> = { mako, dunst, swaync, gnome, kde, xfce, cinnamon };

/** The daemon in charge: asked over D-Bus, else found by trying each tool, else guessed from the desktop. */
export async function detect(): Promise<Backend | undefined> {
  const desktop = Deno.env.get("XDG_CURRENT_DESKTOP") ?? "";
  const info = await exec("gdbus", [
    "call",
    "--session",
    "--dest",
    "org.freedesktop.Notifications",
    "--object-path",
    "/org/freedesktop/Notifications",
    "--method",
    "org.freedesktop.Notifications.GetServerInformation",
  ]).then(parseServerInfo).catch(() => undefined);
  const id = detectBackend(info?.name, desktop);
  if (id) return { ...BACKENDS[id], version: info?.version };
  // No gdbus, or a daemon not running yet (they start on the first notification).
  for (
    const [backend, program, args] of [
      [mako, "makoctl", ["mode"]],
      [dunst, "dunstctl", ["is-paused"]],
      [swaync, "swaync-client", ["-D", "-sw"]],
    ] as const
  ) {
    if (await exec(program, [...args]).then(() => true, () => false)) return { ...backend };
  }
  return undefined;
}
