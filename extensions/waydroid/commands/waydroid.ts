import {
  type Action,
  action,
  close,
  copy,
  Icons,
  type Item,
  list,
  meta,
  open,
  refresh,
  toast,
  updateCommandMetadata,
} from "@backslash/api";
import { type App, fdroidUrl, isSystemApp, playStoreUrl, stateText, type Status } from "../lib.ts";
import {
  apps,
  installCopied,
  launch,
  NotInstalled,
  remove,
  restartContainer,
  showFullUi,
  startSession,
  status,
  stopSession,
} from "../system.ts";

let summary = "";

const showUi = action("Show Full Android UI", async () => {
  await showFullUi();
  return close("Opening Waydroid…");
}, { icon: Icons.monitor, shortcut: "<Ctrl>u", section: "Waydroid" });

const installApk = action("Install Copied APK", async () => {
  await toast("Installing in Waydroid…");
  const message = await installCopied();
  await toast(message, { style: "success" });
  return refresh();
}, { icon: Icons.download, shortcut: "<Ctrl>i", section: "Waydroid" });

const start = action("Start Session", async () => {
  await toast("Starting Waydroid…");
  await startSession();
  await toast("Waydroid is running", { style: "success" });
  return refresh();
}, { icon: Icons.play, section: "Waydroid", shortcut: "<Ctrl>s" });

const stop = action("Stop Session", async () => {
  await stopSession();
  await toast("Waydroid stopped", { style: "success" });
  return refresh();
}, {
  icon: Icons.stop,
  section: "Waydroid",
  shortcut: "<Ctrl><Shift>s",
  confirm: "Stop Waydroid? Android apps close.",
});

const restart = action("Restart Container", async () => {
  await toast("Restarting the Waydroid container…");
  await restartContainer();
  await toast("Container restarted: start the session again", { style: "success" });
  return refresh();
}, {
  icon: Icons.refresh,
  section: "Danger",
  destructive: true,
  confirm: "Restart the Waydroid container as root? Android apps close.",
});

const reload = action("Refresh", () => refresh(), { icon: Icons.refresh, shortcut: "<Ctrl>r", section: "View" });

function sessionActions(s: Status): Action[] {
  return s.session === "RUNNING"
    ? [showUi, installApk, stop, restart, reload]
    : [start, showUi, installApk, restart, reload];
}

function statusItem(s: Status, count: number): Item {
  const running = s.session === "RUNNING";
  return {
    id: "session",
    title: "Waydroid",
    subtitle: running ? [stateText(s), s.ip].filter(Boolean).join(" · ") : "Session stopped: Enter starts it",
    icon: { source: Icons.box, tint: running ? (s.container === "FROZEN" ? "yellow" : "green") : "gray" },
    section: "Session",
    keywords: ["session", "start", "stop", "démarrer", "arrêter", "full ui", "android"],
    accessories: [{ tag: stateText(s), color: running ? "green" : "gray" }],
    detail: {
      stats: [
        { label: "Session", value: running ? "Running" : "Stopped", color: running ? "green" : "gray" },
        { label: "Apps", value: count },
      ],
      metadata: [
        meta.text("Container", s.container === "UNKNOWN" ? "—" : s.container.toLowerCase(), {
          icon: Icons.box,
          color: s.container === "RUNNING" ? "green" : s.container === "FROZEN" ? "yellow" : "gray",
        }),
        ...(s.vendor ? [meta.text("Vendor image", s.vendor, { icon: Icons.layers })] : []),
        ...(s.ip ? [meta.text("IP address", s.ip, { icon: Icons.globe })] : []),
        ...(s.user ? [meta.text("Session user", s.user, { icon: Icons.person })] : []),
        ...(s.display ? [meta.text("Wayland display", s.display, { icon: Icons.monitor })] : []),
      ],
      markdown: s.container === "FROZEN"
        ? "Android is idle (frozen) while no app is shown; it wakes up when you open one."
        : undefined,
    },
    actions: [
      ...sessionActions(s),
      ...(s.ip ? [copy(`adb connect ${s.ip}:5555`, "Copy adb connect Command", { section: "Copy" })] : []),
    ],
  };
}

function appItem(a: App, s: Status): Item {
  const system = isSystemApp(a.package);
  return {
    id: a.package,
    title: a.name,
    subtitle: a.package,
    icon: a.icon ?? { source: Icons.apps, tint: system ? "gray" : "green" },
    section: system ? "System Apps" : "Apps",
    keywords: [a.package, "android", "app", "appli"],
    detail: {
      ...(a.icon ? { image: a.icon } : {}),
      metadata: [
        meta.text("Package", a.package, { icon: Icons.hash }),
        ...(a.categories.length
          ? [meta.tags("Categories", a.categories.map((c) => c.replace(/^android\.intent\.category\./, "")))]
          : []),
        meta.text("Kind", system ? "Comes with Android" : "Installed by you", { icon: Icons.package }),
      ],
    },
    actions: [
      action(`Open ${a.name}`, async () => {
        if (s.session !== "RUNNING") await toast("Starting Waydroid…");
        await launch(a.package);
        return close();
      }, { icon: Icons.play }),
      showUi,
      copy(a.package, "Copy Package Name", { section: "Copy", shortcut: "<Ctrl><Shift>c" }),
      ...(system ? [] : [
        open(playStoreUrl(a.package), "Open in Google Play", { icon: Icons.globe, section: "Links" }),
        open(fdroidUrl(a.package), "Look Up on F-Droid", { icon: Icons.globe, section: "Links" }),
      ]),
      installApk,
      ...(system ? [] : [action("Uninstall", async () => {
        await toast(`Uninstalling ${a.name}…`);
        await remove(a.package);
        await toast(`${a.name} uninstalled`, { style: "success" });
        return refresh();
      }, {
        icon: Icons.trash,
        destructive: true,
        section: "Danger",
        shortcut: "<Ctrl>Delete",
        confirm: `Uninstall ${a.name} from Waydroid, with its data?`,
      })]),
      ...(s.session === "RUNNING" ? [stop] : [start]),
      reload,
    ],
  };
}

function setupItem(installed: boolean): Item {
  return {
    id: "setup",
    title: installed ? "Set Up Waydroid" : "Install Waydroid",
    subtitle: installed ? "Download Android with sudo waydroid init" : "Android apps in a container, on Wayland",
    icon: { source: Icons.download, tint: "orange" },
    detail: {
      markdown: installed
        ? "Waydroid is installed but has no Android image yet. Run this once in a terminal, then start the session:\n\n```sh\nsudo waydroid init\n```\n\nAdd `-s GAPPS` for Google Play."
        : "Waydroid wasn't found. Install it from your distribution (it needs a Wayland session and a kernel with binder), then run `sudo waydroid init`.",
    },
    actions: [
      ...(installed ? [copy("sudo waydroid init", "Copy Setup Command", { icon: Icons.terminal })] : []),
      open("https://docs.waydro.id/usage/install-on-desktops", "Open the Installation Guide", { icon: Icons.globe }),
      action("Check Again", () => refresh(), { icon: Icons.refresh }),
    ],
  };
}

export default list({
  placeholder: "Open an Android app…",
  empty: { title: "No Android app", description: "Install one with Ctrl+I after copying its APK", icon: Icons.apps },
  status: () => summary,
  actions: [installApk, showUi, reload],
  async *items() {
    let s: Status;
    try {
      s = await status();
    } catch (e) {
      if (!(e instanceof NotInstalled)) throw e;
      summary = "Waydroid isn't installed";
      yield [setupItem(false)];
      return;
    }
    if (s.uninitialized) {
      summary = "Waydroid isn't set up";
      yield [setupItem(true)];
      return;
    }
    const running = s.session === "RUNNING";
    // The exported launchers show at once; the running session's own list follows.
    const quick = await apps(false);
    const render = (list: App[]) => {
      const mine = list.filter((a) => !isSystemApp(a.package)).length;
      summary = `${stateText(s)} · ${list.length} apps${mine ? ` (${mine} yours)` : ""}`;
      return [statusItem(s, list.length), ...list.map((a) => appItem(a, s))];
    };
    yield render(quick);
    updateCommandMetadata({ subtitle: stateText(s) }).catch(() => {});
    if (running) {
      const full = await apps(true);
      if (full.length !== quick.length || full.some((a, i) => a.package !== quick[i]?.package)) yield render(full);
    }
  },
});
