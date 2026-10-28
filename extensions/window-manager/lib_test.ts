import { assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import {
  candidates,
  centered,
  delayedScript,
  gdbusNumber,
  gnomeDetails,
  gnomeTarget,
  gvariantString,
  hyprActiveMonitor,
  hyprArea,
  hyprBatch,
  hyprWorkspaces,
  kwinDesktops,
  kwinShortcut,
  kwinShortcutLine,
  numbered,
  osFamily,
  preview,
  region,
  supports,
  swayArea,
  swayCommand,
  swayWorkspaces,
  systemdRunArgs,
  wmctrlDesktops,
  x11Lines,
  xrandrMonitors,
} from "./lib.ts";

Deno.test("backends tried for each desktop", () => {
  assertEquals(candidates({ HYPRLAND_INSTANCE_SIGNATURE: "abc", WAYLAND_DISPLAY: "wayland-1" }), ["hyprland"]);
  assertEquals(candidates({ SWAYSOCK: "/run/user/1000/sway.sock", XDG_CURRENT_DESKTOP: "sway" }), ["sway"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "w" }), [
    "kde",
  ]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), ["kde", "x11"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME", XDG_SESSION_TYPE: "wayland", DISPLAY: ":0" }), [
    "gnome",
  ]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), ["x11", "gnome"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "XFCE", DISPLAY: ":0" }), ["x11"]);
  assertEquals(candidates({}), []);
});

Deno.test("what each backend supports", () => {
  assertEquals(supports("hyprland", "float"), true);
  assertEquals(supports("kde", "float"), false);
  assertEquals(supports("hyprland", "minimize"), false);
  assertEquals(supports("gnome", "fullscreen"), false);
  assertEquals(supports("gnome", "switch"), false);
  assertEquals(supports("x11", "switch"), true);
});

const AREA = { x: 0, y: 32, width: 1921, height: 1048 };

Deno.test("halves and quarters cover the area with no gap", () => {
  assertEquals(region(AREA, "left"), { x: 0, y: 32, width: 960, height: 1048 });
  assertEquals(region(AREA, "right"), { x: 960, y: 32, width: 961, height: 1048 });
  assertEquals(region(AREA, "top"), { x: 0, y: 32, width: 1921, height: 524 });
  assertEquals(region(AREA, "bottom"), { x: 0, y: 556, width: 1921, height: 524 });
  assertEquals(region(AREA, "bottom-right"), { x: 960, y: 556, width: 961, height: 524 });
  assertEquals(region(AREA, "maximize"), AREA);
  assertEquals(centered(AREA, 800, 600), { x: 561, y: 256, width: 800, height: 600 });
  assertEquals(centered(AREA, 4000, 600).width, 1921);
});

Deno.test("preview draws the covered part", () => {
  const p = preview("left");
  assertStringIncludes(p, "████████████░░░░░░░░░░░░");
  assertEquals(preview("close"), "");
});

// Hyprland 0.45, a 4K laptop screen at 1.5 with a 30 px waybar, and an external monitor.
const HYPR_MONITORS = JSON.stringify([
  {
    id: 0,
    name: "eDP-1",
    width: 2880,
    height: 1800,
    x: 0,
    y: 0,
    scale: 1.5,
    transform: 0,
    focused: false,
    reserved: [0, 30, 0, 0],
    activeWorkspace: { id: 1, name: "1" },
  },
  {
    id: 1,
    name: "DP-2",
    width: 1080,
    height: 1920,
    x: 1920,
    y: 0,
    scale: 1,
    transform: 1,
    focused: true,
    reserved: [0, 0, 0, 0],
    activeWorkspace: { id: 4, name: "4" },
  },
]);

Deno.test("hyprland usable area, scaled and rotated", () => {
  assertEquals(hyprArea(HYPR_MONITORS, 0), { x: 0, y: 30, width: 1920, height: 1170 });
  assertEquals(hyprArea(HYPR_MONITORS), { x: 1920, y: 0, width: 1920, height: 1080 });
  assertEquals(hyprActiveMonitor(JSON.stringify({ address: "0x5", monitor: 0, class: "firefox" })), 0);
  assertEquals(hyprActiveMonitor(JSON.stringify({ monitor: 1, class: "app.backslash.Backslash" })), undefined);
  assertEquals(hyprActiveMonitor("{}"), undefined);
});

Deno.test("hyprland dispatches", () => {
  assertEquals(
    hyprBatch("left", { x: 0, y: 30, width: 1920, height: 1170 }),
    "dispatch setfloating ; dispatch resizeactive exact 960 1170 ; dispatch moveactive exact 0 30",
  );
  assertEquals(hyprBatch("maximize"), "dispatch fullscreen 1");
  assertEquals(hyprBatch("fullscreen"), "dispatch fullscreen 0");
  assertEquals(hyprBatch("float"), "dispatch togglefloating");
  assertEquals(hyprBatch("close"), "dispatch killactive");
  assertThrows(() => hyprBatch("minimize"));
});

Deno.test("hyprland workspaces, special ones left out", () => {
  const ws = hyprWorkspaces(
    JSON.stringify([
      { id: 3, name: "3", monitor: "DP-2", windows: 2 },
      { id: 1, name: "web", monitor: "eDP-1", windows: 4 },
      { id: -98, name: "special:scratch", monitor: "eDP-1", windows: 1 },
    ]),
    JSON.stringify({ id: 3, name: "3" }),
  );
  assertEquals(ws.map((w) => [w.num, w.name, w.active, w.windows]), [[1, "web", false, 4], [3, "3", true, 2]]);
  const all = numbered(ws, 5);
  assertEquals(all.map((w) => w.num), [1, 2, 3, 4, 5]);
  assertEquals(all[1], { num: 2, name: "2", active: false, windows: 0 });
});

const SWAY_WS = JSON.stringify([
  { num: 1, name: "1", focused: false, output: "eDP-1", rect: { x: 0, y: 0, width: 1920, height: 1050 } },
  { num: 2, name: "2: code", focused: true, output: "eDP-1", rect: { x: 0, y: 30, width: 1920, height: 1050 } },
]);

Deno.test("sway workspaces and commands", () => {
  assertEquals(swayWorkspaces(SWAY_WS).map((w) => [w.num, w.name, w.active]), [[1, "1", false], [2, "2: code", true]]);
  assertEquals(swayArea(SWAY_WS), { x: 0, y: 30, width: 1920, height: 1050 });
  assertEquals(
    swayCommand("right", swayArea(SWAY_WS)),
    "floating enable, resize set width 960 px height 1050 px, move absolute position 960 px 30 px",
  );
  assertEquals(swayCommand("center"), "floating enable, move position center");
  assertEquals(swayCommand("close"), "kill");
});

Deno.test("kwin shortcuts and desktops", () => {
  assertEquals(kwinShortcut("top-left"), "Window Quick Tile Top Left");
  assertEquals(kwinShortcut({ move: 3 }), "Window to Desktop 3");
  assertEquals(kwinShortcut({ switch: 2 }), "Switch to Desktop 2");
  assertThrows(() => kwinShortcut("float"));
  const line = kwinShortcutLine("Window Maximize");
  assertStringIncludes(line, "invokeShortcut 'Window Maximize'");
  assertStringIncludes(line, " || qdbus6 ");
  const desktops = kwinDesktops(
    "(<[('0a1b-uuid', uint32 0, 'Desktop 1'), ('2c3d-uuid', 1, 'Mail \\'n\\' chat')]>,)",
    "(<'2c3d-uuid'>,)",
  );
  assertEquals(desktops, [
    { num: 1, name: "Desktop 1", active: false },
    { num: 2, name: "Mail 'n' chat", active: true },
  ]);
  assertEquals(gdbusNumber("(<uint32 4>,)"), 4);
});

Deno.test("wmctrl desktops and xrandr monitors", () => {
  const { workspaces, workarea } = wmctrlDesktops(
    "0  - DG: 3840x1080  VP: N/A  WA: 0,27 3840x1053  Workspace 1\n1  * DG: 3840x1080  VP: 0,0  WA: 0,27 3840x1053  Mail\n",
  );
  assertEquals(workspaces.map((w) => [w.num, w.name, w.active]), [[1, "Workspace 1", false], [2, "Mail", true]]);
  assertEquals(workarea, { x: 0, y: 27, width: 3840, height: 1053 });
  const monitors = xrandrMonitors(
    "Monitors: 2\n 0: +*eDP-1 1920/344x1080/194+0+0  eDP-1\n 1: +HDMI-1 1920/527x1080/296+1920+0  HDMI-1\n",
  );
  assertEquals(monitors, [
    { width: 1920, height: 1080, x: 0, y: 0, name: "eDP-1" },
    { width: 1920, height: 1080, x: 1920, y: 0, name: "HDMI-1" },
  ]);
});

Deno.test("x11 script snaps on the window's monitor, inside the work area", async () => {
  const monitors = [
    { width: 1920, height: 1080, x: 0, y: 0, name: "eDP-1" },
    { width: 1920, height: 1080, x: 1920, y: 0, name: "HDMI-1" },
  ];
  const lines = x11Lines("right", monitors, { x: 0, y: 27, width: 3840, height: 1053 });
  assertEquals(lines.at(-1), "wmctrl -r :ACTIVE: -e 0,$(( L + W / 2 )),$T,$(( W - W / 2 )),$H");
  // Run the arithmetic with a window on the second monitor, wmctrl replaced by echo.
  const script = ["X=2000; Y=100; WIDTH=800; HEIGHT=600", ...lines.slice(1)].join("\n").replaceAll("wmctrl", "echo");
  const out = await new Deno.Command("sh", { args: ["-c", script], stdout: "piped" }).output();
  assertEquals(new TextDecoder().decode(out.stdout).trim().split("\n").at(-1), "-r :ACTIVE: -e 0,2880,27,960,1053");
  const center = x11Lines("center", monitors, { x: 0, y: 27, width: 3840, height: 1053 });
  const out2 = await new Deno.Command("sh", {
    args: ["-c", ["X=10; Y=50; WIDTH=800; HEIGHT=600", ...center.slice(1)].join("\n").replaceAll("wmctrl", "echo")],
    stdout: "piped",
  }).output();
  assertEquals(new TextDecoder().decode(out2.stdout).trim().split("\n").at(-1), "-r :ACTIVE: -e 0,560,253,-1,-1");
  assertEquals(x11Lines("close", monitors), ["wmctrl -c :ACTIVE:"]);
  assertThrows(() => x11Lines("float", monitors));
});

Deno.test("gnome: gdbus strings and the window under the launcher", () => {
  const list = gvariantString(
    `('[{"wm_class":"firefox","id":11,"focus":false,"window_type":0,"in_current_workspace":true},{"wm_class":"Code","id":12,"focus":false,"window_type":0,"in_current_workspace":false},{"wm_class":"org.gnome.Nautilus","id":13,"focus":false,"window_type":0,"in_current_workspace":true},{"wm_class":"backslash","id":14,"focus":true,"window_type":0,"in_current_workspace":true}]',)`,
  );
  assertEquals(gnomeTarget(list), 13);
  assertEquals(gnomeTarget(JSON.stringify([{ id: 2, wm_class: "kitty", focus: true }, { id: 3 }])), 2);
  assertEquals(gnomeTarget("[]"), undefined);
  assertEquals(gvariantString(`('it\\'s',)`), "it's");
  const d = gnomeDetails(
    JSON.stringify({
      x: 10,
      y: 40,
      width: 800,
      height: 600,
      maximized: 0,
      area: { x: 0, y: 32, width: 1920, height: 1048 },
    }),
  );
  assertEquals(d.area, { x: 0, y: 32, width: 1920, height: 1048 });
  assertEquals(d.frame, { x: 10, y: 40, width: 800, height: 600 });
  assertEquals(gnomeDetails(JSON.stringify({ x: 1, y: 1, width: 5, height: 5, area: {} })).area, undefined);
});

Deno.test("background job", () => {
  assertEquals(delayedScript(["a", "b"], 250), "sleep 0.25\na\nb");
  assertEquals(delayedScript(["a"], 0), "a");
  const args = systemdRunArgs("u", "echo", { DISPLAY: ":0", SWAYSOCK: undefined });
  assertEquals(args.slice(-4), ["--setenv=DISPLAY=:0", "/bin/sh", "-c", "echo"]);
});

Deno.test("os family", () => {
  assertEquals(osFamily("ID=ubuntu\nID_LIKE=debian\n"), "debian");
  assertEquals(osFamily("ID=fedora\n"), "fedora");
});
