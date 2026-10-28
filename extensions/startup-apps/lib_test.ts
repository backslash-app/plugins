import { assert, assertEquals } from "@std/assert";
import {
  cleanExec,
  desktopFileName,
  execFromShow,
  isEnabled,
  mergeAutostart,
  newDesktopFile,
  parseDesktop,
  parseHyprland,
  parseShow,
  parseUnitFiles,
  programName,
  resolveSource,
  setDesktopKey,
  showsIn,
  toggledText,
} from "./lib.ts";

const KEYRING = `[Desktop Entry]
Type=Application
Name=SSH Key Agent
Name[fr]=Agent de clés SSH
Comment=GNOME Keyring: SSH Agent
Exec=/usr/bin/gnome-keyring-daemon --start --components=ssh
OnlyShowIn=GNOME;Unity;MATE;
X-GNOME-Autostart-Phase=PreDisplayServer
X-GNOME-AutoRestart=false
X-GNOME-Autostart-Notify=true
X-GNOME-Bugzilla-Component=general

[Desktop Action Quit]
Name=Quit
Exec=pkill gnome-keyring
`;

const NM = `[Desktop Entry]
Name=Network
Comment=Manage your network connections
Icon=nm-device-wireless
Exec=nm-applet %U
Terminal=false
Type=Application
NotShowIn=KDE;GNOME;
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=3
`;

Deno.test("parseDesktop reads the main group only, without translations", () => {
  const e = parseDesktop(KEYRING);
  assertEquals(e.Name, "SSH Key Agent");
  assertEquals(e.Exec, "/usr/bin/gnome-keyring-daemon --start --components=ssh");
  assertEquals(e["Name[fr]"], undefined);
});

Deno.test("isEnabled honours Hidden and X-GNOME-Autostart-enabled", () => {
  assert(isEnabled(parseDesktop(NM)));
  assert(!isEnabled({ Hidden: "true" }));
  assert(!isEnabled({ "X-GNOME-Autostart-enabled": "false" }));
  assert(isEnabled({ Hidden: "false" }));
});

Deno.test("showsIn applies OnlyShowIn and NotShowIn to XDG_CURRENT_DESKTOP", () => {
  const keyring = parseDesktop(KEYRING);
  assert(showsIn(keyring, "ubuntu:GNOME"));
  assert(!showsIn(keyring, "Hyprland"));
  assert(showsIn(keyring, ""));
  assert(!showsIn(parseDesktop(NM), "KDE"));
  assert(showsIn(parseDesktop(NM), "sway"));
});

Deno.test("cleanExec and programName", () => {
  assertEquals(cleanExec("nm-applet %U"), "nm-applet");
  assertEquals(programName("env GDK_BACKEND=x11 /usr/bin/discord --start-minimized %U"), "discord");
  assertEquals(programName("FOO=1 waybar -c ~/.config/waybar/config"), "waybar");
  assertEquals(programName(`"/opt/My App/app" --x`), "app");
});

Deno.test("setDesktopKey edits, adds and removes keys in the main group", () => {
  const hidden = setDesktopKey(KEYRING, "Hidden", "true");
  assertEquals(parseDesktop(hidden).Hidden, "true");
  // Added to [Desktop Entry], not to the action group that follows.
  assert(hidden.indexOf("Hidden=true") < hidden.indexOf("[Desktop Action Quit]"));
  assertEquals(hidden.split("\n").filter((l) => l === "").length, 2);
  const again = setDesktopKey(hidden, "Hidden", "false");
  assertEquals(again.match(/Hidden=/g)?.length, 1);
  assertEquals(parseDesktop(setDesktopKey(again, "Hidden", undefined)).Hidden, undefined);
  assertEquals(setDesktopKey("", "Hidden", "true"), "[Desktop Entry]\nHidden=true\n");
});

Deno.test("mergeAutostart: user files replace system ones", () => {
  const entries = mergeAutostart(
    [
      { path: "/home/ada/.config/autostart/nm-applet.desktop", text: "[Desktop Entry]\nHidden=true\n" },
      { path: "/home/ada/.config/autostart/syncthing.desktop", text: newDesktopFile("Syncthing", "syncthing serve") },
    ],
    [
      { path: "/etc/xdg/autostart/nm-applet.desktop", text: NM },
      { path: "/etc/xdg/autostart/gnome-keyring-ssh.desktop", text: KEYRING },
    ],
    "Hyprland",
  );
  assertEquals(entries.map((e) => [e.name, e.origin, e.enabled]), [
    ["Network", "override", false],
    ["SSH Key Agent", "system", true],
    ["Syncthing", "user", true],
  ]);
  const nm = entries[0];
  assertEquals(nm.exec, "nm-applet");
  assertEquals(nm.delay, 3);
  assertEquals(nm.systemPath, "/etc/xdg/autostart/nm-applet.desktop");
  assert(entries[1].otherDesktop);
  assert(!nm.otherDesktop);
});

Deno.test("toggledText writes a GNOME Tweaks style override", () => {
  const off = toggledText(undefined, NM, false);
  const e = parseDesktop(off);
  assertEquals([e.Hidden, e["X-GNOME-Autostart-enabled"], e.Exec], ["true", "false", "nm-applet %U"]);
  assert(!isEnabled(e));
  const on = parseDesktop(toggledText(off, NM, true));
  assert(isEnabled(on));
  assertEquals(on["X-GNOME-Autostart-enabled"], "true");
  // A user entry without the GNOME key doesn't get one when turned back on.
  const mine = newDesktopFile("Syncthing", "syncthing serve").replace("X-GNOME-Autostart-enabled=true\n", "");
  assertEquals(parseDesktop(toggledText(mine, undefined, true))["X-GNOME-Autostart-enabled"], undefined);
});

Deno.test("newDesktopFile and desktopFileName", () => {
  const e = parseDesktop(newDesktopFile("Élément", "element-desktop --hidden", "Matrix"));
  assertEquals([e.Type, e.Name, e.Exec, e.Comment], ["Application", "Élément", "element-desktop --hidden", "Matrix"]);
  assertEquals(desktopFileName("Élément Desktop", []), "element-desktop.desktop");
  assertEquals(desktopFileName("Syncthing", ["syncthing.desktop", "syncthing-2.desktop"]), "syncthing-3.desktop");
  assertEquals(desktopFileName("!!!", []), "startup-app.desktop");
});

Deno.test("parseUnitFiles and parseShow read systemctl output", () => {
  assertEquals(parseUnitFiles("syncthing.service enabled enabled\nmako.service enabled -\n\n"), [
    { unit: "syncthing.service", state: "enabled", preset: "enabled" },
    { unit: "mako.service", state: "enabled", preset: undefined },
  ]);
  const show = parseShow(
    "Id=syncthing.service\nDescription=Syncthing\nActiveState=active\nSubState=running\n" +
      "FragmentPath=/usr/lib/systemd/user/syncthing.service\nWantedBy=default.target\n" +
      "ExecStart={ path=/usr/bin/syncthing ; argv[]=/usr/bin/syncthing serve --no-browser ; ignore_errors=no }\n\n" +
      "Id=mako.service\nActiveState=failed\nWantedBy=\n",
  );
  assertEquals(show[0].execStart, "/usr/bin/syncthing serve --no-browser");
  assertEquals(show[0].wantedBy, ["default.target"]);
  assertEquals([show[1].id, show[1].activeState, show[1].description], ["mako.service", "failed", undefined]);
  assertEquals(execFromShow("{ path=/bin/true ; argv[]= ; }"), undefined);
});

Deno.test("parseHyprland finds exec-once lines and sources", () => {
  const conf = [
    "monitor=,preferred,auto,1",
    "exec-once = waybar",
    "  exec-once=hyprpaper # wallpaper",
    "# exec-once = disabled",
    `exec = notify-send "a ## b"`,
    "source = ~/.config/hypr/apps.conf",
  ].join("\n");
  const { execs, sources } = parseHyprland(conf, "/home/ada/.config/hypr/hyprland.conf");
  assertEquals(execs.map((e) => [e.command, e.line, e.keyword]), [
    ["waybar", 2, "exec-once"],
    ["hyprpaper", 3, "exec-once"],
    [`notify-send "a # b"`, 5, "exec"],
  ]);
  assertEquals(sources, ["~/.config/hypr/apps.conf"]);
  assertEquals(resolveSource("~/x.conf", "/h/.config/hypr/hyprland.conf", "/h"), "/h/x.conf");
  assertEquals(resolveSource("conf/a.conf", "/h/.config/hypr/hyprland.conf", "/h"), "/h/.config/hypr/conf/a.conf");
});
