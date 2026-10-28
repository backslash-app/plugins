import { assertEquals } from "@std/assert";
import {
  flathubUrl,
  formatBytes,
  parseList,
  parsePermissions,
  parseSize,
  sandboxScore,
  splitRuntime,
  summarize,
  uninstallArgs,
  unusedRuntimes,
} from "./lib.ts";

// `flatpak list --app --columns=application,name,description,version,branch,arch,origin,installation,ref,runtime,size` (flatpak 1.14).
export const APPS = [
  "org.mozilla.firefox\tFirefox\tFast, Private & Safe Web Browser\t131.0.3\tstable\tx86_64\tflathub\tsystem\tapp/org.mozilla.firefox/x86_64/stable\torg.freedesktop.Platform/x86_64/24.08\t258.8 MB",
  "com.github.tchx84.Flatseal\tFlatseal\tManage Flatpak permissions\t2.2.0\tstable\tx86_64\tflathub\tuser\tapp/com.github.tchx84.Flatseal/x86_64/stable\torg.gnome.Platform/x86_64/47\t1.9 MB",
  "org.gnome.Builder\tBuilder\tAn IDE for GNOME\t47.0\tbeta\tx86_64\tgnome-nightly\tsystem\tapp/org.gnome.Builder/x86_64/beta\torg.gnome.Sdk/x86_64/47\t60,1 MB",
].join("\n");

export const RUNTIMES = [
  "org.freedesktop.Platform\tFreedesktop Platform\t\t24.08.5\t24.08\tx86_64\tflathub\tsystem\truntime/org.freedesktop.Platform/x86_64/24.08\t\t607.5 MB",
  "org.freedesktop.Platform.GL.default\tMesa\t\t24.2.4\t24.08\tx86_64\tflathub\tsystem\truntime/org.freedesktop.Platform.GL.default/x86_64/24.08\t\t420.3 MB",
  "org.freedesktop.Platform.openh264\topenh264\t\t2.4.1\t2.4.1\tx86_64\tflathub\tsystem\truntime/org.freedesktop.Platform.openh264/x86_64/2.4.1\t\t1.0 MB",
  "org.gnome.Platform\tGNOME Application Platform version 47\t\t\t47\tx86_64\tflathub\tsystem\truntime/org.gnome.Platform/x86_64/47\t\t1.1 GB",
  "org.gnome.Platform\tGNOME Application Platform version 45\t\t\t45\tx86_64\tflathub\tsystem\truntime/org.gnome.Platform/x86_64/45\t\t981.2 MB",
  "org.gnome.Platform.Locale\tTranslations\t\t\t45\tx86_64\tflathub\tsystem\truntime/org.gnome.Platform.Locale/x86_64/45\t\t18.0 kB",
  "org.gnome.Sdk\tGNOME Software Development Kit version 47\t\t\t47\tx86_64\tflathub\tsystem\truntime/org.gnome.Sdk/x86_64/47\t\t1.6 GB",
  "org.mozilla.firefox.Locale\tTranslations\t\t\tstable\tx86_64\tflathub\tsystem\truntime/org.mozilla.firefox.Locale/x86_64/stable\t\t38.2 MB",
  "org.kde.Platform\tKDE Application Platform\t\t\t5.15-23.08\tx86_64\tflathub\tuser\truntime/org.kde.Platform/x86_64/5.15-23.08\t\t351.0 MB",
].join("\n");

Deno.test("sizes as flatpak prints them", () => {
  assertEquals(parseSize("258.8 MB"), 258_800_000);
  assertEquals(parseSize("1.1 GB"), 1_100_000_000);
  assertEquals(parseSize("60,1 MB"), 60_100_000);
  assertEquals(parseSize("980 bytes"), 980);
  assertEquals(parseSize("18.0 kB"), 18_000);
  assertEquals(parseSize("2.0 GiB"), 2 * 1024 ** 3);
  assertEquals(parseSize(""), 0);
  assertEquals(formatBytes(258_800_000), "259 MB");
  assertEquals(formatBytes(1_900_000), "1.9 MB");
});

Deno.test("list columns", () => {
  const apps = parseList(APPS, "app");
  assertEquals(apps.length, 3);
  assertEquals(apps[1], {
    id: "com.github.tchx84.Flatseal",
    name: "Flatseal",
    description: "Manage Flatpak permissions",
    version: "2.2.0",
    branch: "stable",
    arch: "x86_64",
    origin: "flathub",
    installation: "user",
    ref: "app/com.github.tchx84.Flatseal/x86_64/stable",
    runtime: "org.gnome.Platform/x86_64/47",
    size: 1_900_000,
    kind: "app",
  });
  assertEquals(splitRuntime(apps[0].runtime), { id: "org.freedesktop.Platform", arch: "x86_64", branch: "24.08" });
  assertEquals(parseList("\n", "app"), []);
});

Deno.test("unused runtimes", () => {
  const unused = unusedRuntimes(parseList(APPS, "app"), parseList(RUNTIMES, "runtime"));
  assertEquals([...unused].sort(), [
    "runtime/org.gnome.Platform.Locale/x86_64/45",
    "runtime/org.gnome.Platform/x86_64/45",
    "runtime/org.kde.Platform/x86_64/5.15-23.08",
  ]);
});

const FIREFOX_PERMISSIONS = `[Context]
shared=network;ipc;
sockets=x11;wayland;pulseaudio;pcsc;cups;
devices=all;
filesystems=xdg-download;/run/.heim_org.h5l.kcm-socket;xdg-run/speech-dispatcher:ro;!home;

[Session Bus Policy]
org.freedesktop.FileManager1=talk
org.freedesktop.Notifications=talk
org.mpris.MediaPlayer2.firefox.*=own
org.freedesktop.ScreenSaver=talk

[System Bus Policy]
org.freedesktop.NetworkManager=talk

[Environment]
GTK_PATH=/app/lib/gtkmodules
`;

Deno.test("permissions summary, worst first", () => {
  const p = parsePermissions(FIREFOX_PERMISSIONS);
  assertEquals(p.shared, ["network", "ipc"]);
  assertEquals(p.own, ["org.mpris.MediaPlayer2.firefox.*"]);
  assertEquals(p.system, ["org.freedesktop.NetworkManager"]);
  const grants = summarize(p);
  assertEquals(grants.map((g) => g.text), [
    "All devices",
    "Downloads",
    "/run/.heim_org.h5l.kcm-socket",
    "xdg-run/speech-dispatcher (read-only)",
    "X11 (can see other windows)",
    "Smart cards",
    "Sound",
    "Printing",
    "Network",
    "Notifications",
  ]);
  assertEquals(sandboxScore(grants), "high");
  const calc = summarize(parsePermissions("[Context]\nsockets=wayland;fallback-x11;\ndevices=dri;\n"));
  assertEquals(calc, [{ text: "Devices: dri", level: "low" }]);
  assertEquals(sandboxScore(calc), "low");
  assertEquals(sandboxScore(summarize(parsePermissions("[Context]\nfilesystems=home;\n"))), "high");
});

Deno.test("links and uninstall arguments", () => {
  const [firefox, flatseal, builder] = parseList(APPS, "app");
  assertEquals(flathubUrl(firefox), "https://flathub.org/apps/org.mozilla.firefox");
  assertEquals(flathubUrl(builder), undefined);
  assertEquals(uninstallArgs(flatseal), [
    "uninstall",
    "--user",
    "--noninteractive",
    "-y",
    "app/com.github.tchx84.Flatseal/x86_64/stable",
  ]);
  assertEquals(uninstallArgs(firefox, true).slice(1, 2), ["--system"]);
  assertEquals(uninstallArgs(firefox, true).includes("--delete-data"), true);
});
