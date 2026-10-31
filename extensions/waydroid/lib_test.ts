import { assert, assertEquals } from "@std/assert";
import {
  basename,
  isApk,
  isSystemApp,
  mergeApps,
  packageOfDesktopFile,
  parseAppList,
  parseDesktopEntry,
  parseFileList,
  parseStatus,
  stateText,
  unitArgs,
  waydroidError,
} from "./lib.ts";

Deno.test("waydroid status: running", () => {
  const s = parseStatus(
    "Session:\tRUNNING\nContainer:\tRUNNING\nVendor type:\tMAINLINE\nIP address:\t192.168.240.112\nSession user:\tjane(1000)\nWayland display:\twayland-0\n",
  );
  assertEquals(s, {
    session: "RUNNING",
    container: "RUNNING",
    vendor: "MAINLINE",
    ip: "192.168.240.112",
    user: "jane(1000)",
    display: "wayland-0",
    uninitialized: false,
  });
  assertEquals(stateText(s), "Running");
  assertEquals(stateText({ ...s, container: "FROZEN" }), "Running (idle)");
});

Deno.test("waydroid status: stopped, not set up, garbage", () => {
  const stopped = parseStatus("Session:\tSTOPPED\nVendor type:\tMAINLINE\n");
  assertEquals(stopped.session, "STOPPED");
  assertEquals(stopped.container, "STOPPED");
  assertEquals(stopped.ip, undefined);
  assertEquals(stateText(stopped), "Stopped");
  const fresh = parseStatus('[14:02:11] WayDroid is not initialized, run "waydroid init"\n');
  assert(fresh.uninitialized);
  assertEquals(stateText(fresh), "Not set up");
  assertEquals(parseStatus("").session, "UNKNOWN");
});

// `waydroid app list` (1.4.3).
const APP_LIST = `Name: Settings
packageName: com.android.settings
categories:
	android.intent.category.DEFAULT
	android.intent.category.LAUNCHER
Name: F-Droid
packageName: org.fdroid.fdroid
categories:
	android.intent.category.LAUNCHER

Name: Files
packageName: com.android.documentsui
categories:
	android.intent.category.LAUNCHER
Name: Broken entry
`;

Deno.test("waydroid app list", () => {
  const apps = parseAppList(APP_LIST);
  assertEquals(apps.map((a) => a.package), ["com.android.settings", "org.fdroid.fdroid", "com.android.documentsui"]);
  assertEquals(apps[0].categories, ["android.intent.category.DEFAULT", "android.intent.category.LAUNCHER"]);
  assertEquals(apps[1].name, "F-Droid");
  assertEquals(parseAppList("[12:00:00] WayDroid session is stopped"), []);
});

const DESKTOP = `[Desktop Entry]
Type=Application
Name=F-Droid
Exec=waydroid app launch org.fdroid.fdroid
Icon=/home/jane/.local/share/waydroid/data/icons/org.fdroid.fdroid.png
Categories=X-WayDroid-App;
X-Purism-FormFactor=Workstation;Mobile;
Actions=app_settings;

[Desktop Action app_settings]
Name=App Settings
Exec=waydroid app intent android.settings.APPLICATION_DETAILS_SETTINGS package:org.fdroid.fdroid
Icon=/usr/share/icons/hicolor/512x512/apps/waydroid.png
`;

Deno.test("exported launchers", () => {
  assertEquals(packageOfDesktopFile("waydroid.org.fdroid.fdroid.desktop"), "org.fdroid.fdroid");
  assertEquals(packageOfDesktopFile("Waydroid.desktop"), undefined);
  assertEquals(parseDesktopEntry(DESKTOP), {
    name: "F-Droid",
    package: "org.fdroid.fdroid",
    categories: [],
    icon: "/home/jane/.local/share/waydroid/data/icons/org.fdroid.fdroid.png",
  });
  assertEquals(parseDesktopEntry("[Desktop Entry]\nName=Waydroid\nExec=waydroid first-launch\n"), undefined);
});

Deno.test("merging the running list with exported launchers", () => {
  const listed = parseAppList(APP_LIST);
  const exported = [parseDesktopEntry(DESKTOP)!];
  const merged = mergeApps(listed, exported);
  assertEquals(merged.map((a) => a.name), ["F-Droid", "Files", "Settings"]);
  assertEquals(merged[0].icon, "/home/jane/.local/share/waydroid/data/icons/org.fdroid.fdroid.png");
  assertEquals(merged[0].categories, ["android.intent.category.LAUNCHER"]);
  // Stopped: the launchers alone.
  assertEquals(mergeApps([], exported).map((a) => a.package), ["org.fdroid.fdroid"]);
  assert(isSystemApp("com.android.settings"));
  assert(isSystemApp("org.lineageos.jelly"));
  assert(!isSystemApp("org.fdroid.fdroid"));
  assert(isSystemApp("com.android.documentsui"));
});

Deno.test("copied files", () => {
  assertEquals(
    parseFileList(
      "copy\nfile:///home/jane/Downloads/F-Droid.apk\nfile:///home/jane/Downloads/My%20App.APK\n",
      "/home/jane",
    ),
    ["/home/jane/Downloads/F-Droid.apk", "/home/jane/Downloads/My App.APK"],
  );
  assertEquals(parseFileList("'/tmp/x.apk'\n~/y.apk\nfile://other-host/z.apk\nnot a path", "/home/jane"), [
    "/tmp/x.apk",
    "/home/jane/y.apk",
  ]);
  assert(isApk("/a/My App.APK"));
  assert(!isApk("/a/app.xapk"));
  assertEquals(basename("/home/jane/Downloads/F-Droid.apk"), "F-Droid.apk");
});

Deno.test("systemd-run arguments", () => {
  assertEquals(
    unitArgs("backslash-waydroid-session", "Backslash: Waydroid session", ["waydroid", "session", "start"], {
      WAYLAND_DISPLAY: "wayland-0",
      XDG_RUNTIME_DIR: "/run/user/1000",
      XDG_SESSION_TYPE: "",
    }),
    [
      "--user",
      "--quiet",
      "--collect",
      "--unit=backslash-waydroid-session",
      "--description=Backslash: Waydroid session",
      "--setenv=WAYLAND_DISPLAY=wayland-0",
      "--setenv=XDG_RUNTIME_DIR=/run/user/1000",
      "waydroid",
      "session",
      "start",
    ],
  );
});

Deno.test("errors in words", () => {
  assertEquals(
    waydroidError("waydroid exited with 1: [10:00:00] Failed to install: INSTALL_FAILED_NO_MATCHING_ABIS: x86_64"),
    "This APK isn't built for this computer's processor",
  );
  assertEquals(waydroidError("[10:00:00] WayDroid session is stopped"), "The Waydroid session isn't running");
  assertEquals(
    waydroidError('WayDroid is not initialized, run "waydroid init"'),
    "Waydroid isn't set up yet: run sudo waydroid init",
  );
  assertEquals(waydroidError("[10:00:00] something odd\n"), "something odd");
  assertEquals(waydroidError(""), "waydroid failed");
});
