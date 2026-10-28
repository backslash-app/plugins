import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  customPaths,
  detectDesktops,
  gnomeCustom,
  gnomeName,
  gnomeShortcuts,
  hyprMods,
  hyprShortcuts,
  i3Shortcuts,
  kdeShortcuts,
  keyName,
  niriShortcuts,
  parseGVariant,
  parseKdl,
  prettyGtk,
  prettyPlus,
  type Shortcut,
  sortShortcuts,
  swayConfigText,
} from "./lib.ts";
import { SESSION_ENV } from "./system.ts";

const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));
const byName = (list: Shortcut[], name: string) => {
  const s = list.find((s) => s.name === name);
  assert(s, `no shortcut named ${name}: ${list.map((s) => s.name).join(", ")}`);
  return s;
};

Deno.test("desktop detection", () => {
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }), ["gnome"]);
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "KDE" }), ["kde"]);
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "Hyprland" }), ["hyprland"]);
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "sway:wlroots" }), ["sway"]);
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "niri" }), ["niri"]);
  assertEquals(detectDesktops({ XDG_CURRENT_DESKTOP: "i3" }), ["i3"]);
  assertEquals(detectDesktops({ SWAYSOCK: "/run/user/1000/sway-ipc.sock" }), ["sway"]);
  assertEquals(detectDesktops({}), []);
});

Deno.test("keys for humans", () => {
  assertEquals(prettyGtk("<Super>Left"), "Super + ←");
  assertEquals(prettyGtk("<Primary><Alt>t"), "Ctrl + Alt + T");
  assertEquals(prettyGtk("<Super><Shift>Page_Up"), "Super + Shift + Page Up");
  assertEquals(prettyGtk("AudioRaiseVolume"), "Volume Up");
  assertEquals(prettyGtk("XF86AudioMicMute"), "Mic Mute");
  assertEquals(prettyGtk("<Alt>space"), "Alt + Space");
  assertEquals(prettyGtk("Print"), "Print Screen");
  assertEquals(prettyPlus("Mod4+Shift+Return"), "Super + Shift + Enter");
  assertEquals(prettyPlus("Meta+Ctrl+Left"), "Meta + Ctrl + ←");
  assertEquals(prettyPlus("Meta++"), "Meta + +");
  assertEquals(prettyPlus("Mod1+grave"), "Alt + `");
  assertEquals(keyName("KP_Add"), "Num Add");
  assertEquals(keyName("F11"), "F11");
  assertEquals(keyName("XF86MonBrightnessUp"), "Brightness Up");
  assertEquals(keyName("Volume Up"), "Volume Up");
  assertEquals(hyprMods(65), ["Super", "Shift"]);
  assertEquals(hyprMods(72), ["Super", "Alt"]);
});

Deno.test("GVariant values", () => {
  assertEquals(parseGVariant("['<Super>q', '<Alt>F4']"), ["<Super>q", "<Alt>F4"]);
  assertEquals(parseGVariant("@as []"), []);
  assertEquals(parseGVariant("'it\\'s'"), "it's");
  assertEquals(parseGVariant(`["a'b"]`), ["a'b"]);
  assertEquals(customPaths("['/org/a/custom0/', '/org/a/custom1/']"), ["/org/a/custom0/", "/org/a/custom1/"]);
  assertEquals(customPaths("@as []"), []);
});

Deno.test("GNOME shortcuts from gsettings", async () => {
  const list = gnomeShortcuts(await fixture("gsettings.txt"));
  // Empty ones, "-static" keys, the custom list and the step are skipped.
  assert(!list.some((s) => s.action === "always-on-top" || s.action.endsWith("-static") || s.action === "volume-step"));
  assert(!list.some((s) => s.action === "custom-keybindings"));
  const close = byName(list, "Close Window");
  assertEquals(close.keys, ["Super + Q", "Alt + F4"]);
  assertEquals(close.category, "Windows");
  const left = byName(list, "Switch to Workspace Left");
  assertEquals(left.keys[0], "Super + Page Up");
  assertEquals(left.category, "Workspaces");
  assertEquals(byName(list, "Move Window to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Move Window to Monitor Left").category, "Displays");
  assertEquals(byName(list, "Screenshot Tool").keys, ["Print Screen"]);
  assertEquals(byName(list, "Screenshot Tool").category, "Screenshots");
  assertEquals(byName(list, "Volume Up").category, "Sound & Media");
  assertEquals(byName(list, "Mute the Microphone").keys, ["Mic Mute"]);
  assertEquals(byName(list, "Lock Screen").category, "System");
  assertEquals(byName(list, "Toggle Zoom").category, "Accessibility");
  assertEquals(byName(list, "Home Folder").category, "Launchers");
  assertEquals(byName(list, "Next Input Source").category, "Typing");
  assertEquals(byName(list, "Open Pinned App 1").category, "Launchers");
  assertEquals(byName(list, "Tile Window Left").keys, ["Super + ←"]);
  assertEquals(byName(list, "Switch to Virtual Terminal 1").keys, ["Ctrl + Alt + F1"]);
  assertEquals(gnomeName("some-new-key"), "Some New Key");
});

Deno.test("GNOME custom shortcut", async () => {
  const s = gnomeCustom(
    "/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings/custom0/",
    await fixture("custom0.txt"),
  )!;
  assertEquals(s.name, "Open Console");
  assertEquals(s.keys, ["Ctrl + Alt + T"]);
  assertEquals(s.command, "kgx --tab");
  assertEquals(s.category, "Custom Shortcuts");
  assertEquals(gnomeCustom("/x/", "x binding ''\nx command 'a'\nx name 'b'"), undefined);
});

Deno.test("KDE Plasma kglobalshortcutsrc", async () => {
  const list = kdeShortcuts(await fixture("kglobalshortcutsrc"));
  // "none" is unbound.
  assert(!list.some((s) => s.action === "NewTab" || s.action.startsWith("switch-to-activity")));
  const walk = byName(list, "Walk Through Windows");
  assertEquals(walk.keys, ["Alt + Tab", "Meta + Tab"]);
  assertEquals(walk.category, "Windows");
  assertEquals(walk.scope, "KWin");
  assertEquals(byName(list, "Switch to Desktop 1").category, "Virtual Desktops");
  assertEquals(byName(list, "Quick Tile Window to the Left").category, "Tiling");
  assertEquals(byName(list, "Move Window to Next Screen").category, "Displays");
  assertEquals(byName(list, "Zoom In").keys, ["Meta + +", "Meta + ="]);
  assertEquals(byName(list, "Mute Microphone").keys, ["Microphone Mute", "Meta + Volume Mute"]);
  assertEquals(byName(list, "Mute Microphone").category, "Audio Volume");
  assertEquals(byName(list, "Lock Session").keys, ["Meta + L", "Screensaver"]);
  assertEquals(byName(list, "Activate Application Launcher").keys, ["Meta", "Alt + F1"]);
  // Plasma 6 overrides: Konsole moved to Meta+Return, Spectacle's launcher removed, Dolphin added.
  assertEquals(byName(list, "Launch Konsole").keys, ["Meta + Enter"]);
  assert(!list.some((s) => s.name === "Launch Spectacle"));
  assertEquals(byName(list, "Launch Dolphin").keys, ["Meta + E"]);
  assertEquals(byName(list, "Launch Dolphin").category, "Applications");
  assertEquals(byName(list, "Capture Rectangular Region").keys, ["Meta + Shift + Print Screen"]);
});

Deno.test("Hyprland hyprctl binds -j", async () => {
  const list = hyprShortcuts(await fixture("hyprctl-binds.json"));
  assertEquals(list.length, 12);
  const kitty = byName(list, "Run kitty");
  assertEquals(kitty.keys, ["Super + Q"]);
  assertEquals(kitty.category, "Apps");
  assertEquals(kitty.command, "kitty");
  assertEquals(byName(list, "App launcher").command, "wofi --show drun");
  assertEquals(byName(list, "Close Window").action, "killactive");
  assertEquals(byName(list, "Focus Left").category, "Focus");
  assertEquals(byName(list, "Move Window to Workspace 1").keys, ["Super + Shift + 1"]);
  assertEquals(byName(list, "Switch to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Toggle Scratchpad magic").category, "Workspaces");
  const vol = byName(list, "Run wpctl");
  assertEquals(vol.keys, ["Volume Up"]);
  assertEquals(vol.category, "Sound & Media");
  assertEquals(byName(list, "Move Window").keys, ["Super + Left Click"]);
  assertEquals(byName(list, "Move Window").category, "Mouse");
  assertEquals(byName(list, "Enter Mode “resize”").keys, ["Super + Alt + R"]);
  assertEquals(byName(list, "Resize Window 10 0").category, "Mode: resize");
  assertEquals(byName(list, "Leave Mode").keys, ["Esc"]);
});

Deno.test("Sway configuration", async () => {
  const text = await fixture("sway-config");
  const list = i3Shortcuts(text, "sway");
  const term = byName(list, "Run foot");
  assertEquals(term.keys, ["Super + Enter"]);
  assertEquals(term.command, "foot");
  assertEquals(byName(list, "Close Window").keys, ["Super + Shift + Q"]);
  assertEquals(byName(list, "Run wmenu-run").category, "Apps");
  assertEquals(byName(list, "Reload Configuration").category, "Session");
  // A line continued with a backslash.
  const exit = byName(list, "Run swaynag");
  assert(exit.action.includes("'Yes, exit sway' 'swaymsg exit'"));
  assertEquals(exit.category, "Session");
  assertEquals(list.filter((s) => s.name === "Focus Left").map((s) => s.keys[0]), ["Super + H", "Super + ←"]);
  assertEquals(byName(list, "Move Window Left").category, "Move");
  assertEquals(byName(list, "Switch to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Move Window to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Split Horizontally").keys, ["Super + B"]);
  assertEquals(byName(list, "Layout: Tabbed").keys, ["Super + W"]);
  assertEquals(byName(list, "Show Scratchpad").keys, ["Super + -"]);
  assertEquals(byName(list, "Run pactl").keys, ["Mute"]);
  assertEquals(byName(list, "Run pactl").category, "Sound & Media");
  assertEquals(byName(list, "Run grim").category, "Screenshots");
  assertEquals(byName(list, "Run makoctl").keys, ["Super + Key Code 49"]);
  // bindsym { … } block.
  assertEquals(byName(list, "Run swaylock").keys, ["Super + Ctrl + L"]);
  // mode "resize" { … }
  const shrink = byName(list, "Shrink Window Width 10px");
  assertEquals(shrink.keys, ["H"]);
  assertEquals(shrink.category, "Mode: resize");
  assertEquals(list.filter((s) => s.name === "Leave Mode").length, 2);
  assertEquals(byName(list, "Enter Mode “resize”").category, "Modes");
  // Sway 1.9 sends the included files too.
  const json = JSON.stringify({
    config: "bindsym Mod4+a kill",
    included_configs: [{ path: "/x", raw_config: "bindsym Mod4+b exec firefox" }],
  });
  assertEquals(i3Shortcuts(swayConfigText(json), "sway").map((s) => s.name), ["Close Window", "Run firefox"]);
});

Deno.test("i3 configuration", async () => {
  const list = i3Shortcuts(await fixture("i3-config"), "i3");
  assertEquals(byName(list, "Run i3-sensible-terminal").keys, ["Alt + Enter"]);
  // i3 reads variables first.
  assertEquals(byName(list, "Switch to Workspace 2").keys, ["Alt + 2"]);
  assertEquals(byName(list, "Restart i3").category, "Session");
  assertEquals(byName(list, "Close Window").keys, ["Alt + Shift + Q"]);
  assertEquals(list.find((s) => s.raw[0] === "button2")?.category, "Mouse");
  assertEquals(list.find((s) => s.raw[0] === "button2")?.keys, ["Middle Click"]);
});

Deno.test("niri config.kdl", async () => {
  const list = niriShortcuts(await fixture("niri-config.kdl"));
  const term = byName(list, "Open a Terminal: alacritty");
  assertEquals(term.keys, ["Super + T"]);
  assertEquals(term.command, "alacritty");
  assertEquals(term.category, "Apps");
  assertEquals(byName(list, "Show Important Hotkeys").keys, ["Super + Shift + /"]);
  assertEquals(byName(list, "Lock the Screen: swaylock").keys, ["Super + Alt + L"]);
  const vol = list.find((s) => s.raw[0] === "XF86AudioRaiseVolume")!;
  assertEquals(vol.command, "wpctl set-volume @DEFAULT_AUDIO_SINK@ 0.1+");
  assertEquals(vol.category, "Sound & Media");
  assertEquals(list.find((s) => s.raw[0] === "XF86AudioMute")?.category, "Sound & Media");
  assertEquals(byName(list, "Focus Column Left").keys, ["Super + ←"]);
  assertEquals(byName(list, "Focus Column Left").category, "Focus");
  // The slashdash-commented Mod+H is gone.
  assert(!list.some((s) => s.raw[0] === "Mod+H"));
  assertEquals(byName(list, "Move Column Left").category, "Move");
  assertEquals(byName(list, "Focus Workspace Down").category, "Mouse");
  assertEquals(byName(list, "Focus Workspace Down").keys, ["Super + Scroll Down"]);
  assertEquals(byName(list, "Switch to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Move Column to Workspace 1").category, "Workspaces");
  assertEquals(byName(list, "Column Width -10%").category, "Resize");
  assertEquals(byName(list, "Screenshot").category, "Screenshots");
  assertEquals(byName(list, "Quit niri").category, "Session");
  assertEquals(byName(list, "Power Off Monitors").category, "Session");
  assertEquals(byName(list, "Close Window").keys, ["Super + Q"]);
});

Deno.test("KDL reader", () => {
  const nodes = parseKdl(`a 1 "two" key=r#"raw "x""# { b; c "d" }\n/- skipped { x; }\ne`);
  assertEquals(nodes.map((n) => n.name), ["a", "e"]);
  assertEquals(nodes[0].args, ["1", "two"]);
  assertEquals(nodes[0].props, { key: 'raw "x"' });
  assertEquals(nodes[0].children.map((n) => [n.name, n.args]), [["b", []], ["c", ["d"]]]);
});

Deno.test("sections in a stable order", () => {
  const s = (name: string, category: string): Shortcut => ({
    id: name,
    keys: [],
    raw: [],
    name,
    action: name,
    category,
    desktop: "sway",
  });
  const sorted = sortShortcuts([
    s("x", "Session"),
    s("y", "Mode: resize"),
    s("z", "Apps"),
    s("w", "Windows"),
    s("v", "Apps"),
  ]);
  assertEquals(sorted.map((x) => x.name), ["z", "v", "w", "x", "y"]);
});

Deno.test("the manifest allows what the code uses", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { env: string[]; run: string[] };
    commands: { name: string }[];
  };
  for (const k of [...SESSION_ENV, "HOME"]) assert(manifest.permissions.env.includes(k), k);
  for (const p of ["gsettings", "hyprctl", "swaymsg", "gnome-control-center", "systemsettings"]) {
    assert(manifest.permissions.run.includes(p), p);
  }
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
