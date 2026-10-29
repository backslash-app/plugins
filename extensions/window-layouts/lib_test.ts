import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  applyCommands,
  appsLine,
  candidates,
  cleanExec,
  commandsText,
  type DesktopApp,
  findLayout,
  geometryFor,
  hyprBatch,
  hyprExecRules,
  isUrl,
  kdotoolArgs,
  launchArgs,
  needsMove,
  niriArgs,
  parseCommands,
  parseDesktopApp,
  parseExtras,
  parseHyprClients,
  parseKdotoolGeometry,
  parseKdotoolIds,
  parseNiri,
  parseSwayTree,
  parseWmctrl,
  plan,
  programName,
  resolveApp,
  restoreMessage,
  type SavedWindow,
  snapshot,
  sortWindows,
  splitWmClass,
  summary,
  swayCommand,
  titleSimilarity,
  uniqueName,
  unitPart,
  windowsMarkdown,
  wmctrlArgs,
} from "./lib.ts";

Deno.test("candidates follow the session", () => {
  assertEquals(candidates({ HYPRLAND_INSTANCE_SIGNATURE: "x", WAYLAND_DISPLAY: "wayland-1" }), ["hyprland"]);
  assertEquals(candidates({ SWAYSOCK: "/run/sway.sock", XDG_SESSION_TYPE: "wayland" }), ["sway"]);
  assertEquals(candidates({ NIRI_SOCKET: "/run/niri.sock", XDG_SESSION_TYPE: "wayland" }), ["niri"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "wayland" }), ["kde"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), ["kde", "x11"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "XFCE", DISPLAY: ":0" }), ["x11"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "GNOME", XDG_SESSION_TYPE: "wayland" }), []);
});

const HYPR = JSON.stringify([
  {
    address: "0x55a1",
    mapped: true,
    hidden: false,
    at: [10, 40],
    size: [1260, 1390],
    workspace: { id: 1, name: "1" },
    floating: false,
    monitor: 0,
    class: "firefox",
    title: "Mozilla Firefox",
  },
  {
    address: "0x55a2",
    mapped: true,
    at: [700, 300],
    size: [800, 600],
    workspace: { id: 3, name: "3" },
    floating: true,
    class: "kitty",
    title: "~",
  },
  { address: "0x55a3", mapped: false, class: "ghost", workspace: { id: 1, name: "1" } },
  { address: "0x55a4", mapped: true, class: "backslash", workspace: { id: 1, name: "1" }, at: [0, 0], size: [5, 5] },
  {
    address: "0x55a5",
    mapped: true,
    class: "",
    initialClass: "spotify",
    workspace: { id: -98, name: "special:music" },
    at: [0, 0],
    size: [100, 100],
  },
]);

Deno.test("hyprctl clients", () => {
  const w = parseHyprClients(HYPR);
  assertEquals(w.map((x) => x.appId), ["firefox", "kitty", "spotify"]);
  assertEquals(w[0], {
    id: "0x55a1",
    appId: "firefox",
    title: "Mozilla Firefox",
    workspace: "1",
    rect: { x: 10, y: 40, width: 1260, height: 1390 },
    floating: false,
  });
  assertEquals(w[1].floating, true);
  assertEquals(w[2].workspace, "special:music");
  assertEquals(parseHyprClients(""), []);
});

const SWAY = JSON.stringify({
  id: 1,
  type: "root",
  nodes: [{
    id: 2,
    type: "output",
    name: "eDP-1",
    nodes: [
      {
        id: 3,
        type: "workspace",
        name: "1",
        nodes: [{
          id: 4,
          type: "con",
          nodes: [
            {
              id: 10,
              type: "con",
              name: "Terminal",
              app_id: "foot",
              pid: 100,
              rect: { x: 0, y: 0, width: 960, height: 1080 },
              nodes: [],
            },
            {
              id: 11,
              type: "con",
              name: "Slack",
              app_id: null,
              pid: 101,
              window_properties: { class: "Slack", instance: "slack" },
              rect: { x: 960, y: 0, width: 960, height: 1080 },
              nodes: [],
            },
          ],
        }],
        floating_nodes: [
          {
            id: 12,
            type: "floating_con",
            name: "Calc",
            app_id: "qalculate-gtk",
            pid: 102,
            rect: { x: 50, y: 60, width: 400, height: 300 },
            nodes: [],
          },
        ],
      },
      {
        id: 5,
        type: "workspace",
        name: "2: web",
        nodes: [
          {
            id: 13,
            type: "con",
            name: "Firefox",
            app_id: "firefox",
            pid: 103,
            rect: { x: 0, y: 0, width: 1920, height: 1080 },
            nodes: [],
          },
        ],
      },
    ],
  }, {
    id: 6,
    type: "output",
    name: "__i3",
    nodes: [{
      id: 7,
      type: "workspace",
      name: "__i3_scratch",
      floating_nodes: [
        {
          id: 14,
          type: "floating_con",
          name: "Notes",
          app_id: "gedit",
          pid: 104,
          rect: { x: 1, y: 1, width: 10, height: 10 },
          nodes: [],
        },
      ],
    }],
  }],
});

Deno.test("sway tree", () => {
  const w = parseSwayTree(SWAY);
  assertEquals(w.map((x) => [x.id, x.appId, x.workspace, x.floating]), [
    ["10", "foot", "1", false],
    ["11", "Slack", "1", false],
    ["12", "qalculate-gtk", "1", true],
    ["13", "firefox", "2: web", false],
    ["14", "gedit", undefined, true],
  ]);
  assertEquals(w[2].rect, { x: 50, y: 60, width: 400, height: 300 });
});

Deno.test("niri windows and workspaces", () => {
  const windows = JSON.stringify([
    { id: 7, title: "Zed", app_id: "dev.zed.Zed", workspace_id: 2, is_floating: false },
    { id: 8, title: "Music", app_id: "spotify", workspace_id: 3, is_floating: true },
    { id: 9, title: null, app_id: null, workspace_id: 2 },
  ]);
  const workspaces = JSON.stringify([
    { id: 2, idx: 1, name: null, output: "DP-1" },
    { id: 3, idx: 2, name: "chat", output: "DP-1" },
  ]);
  const w = parseNiri(windows, workspaces);
  assertEquals(w.map((x) => [x.id, x.appId, x.workspace, x.floating]), [
    ["7", "dev.zed.Zed", "1", false],
    ["8", "spotify", "chat", true],
  ]);
  assertEquals(niriArgs("7", { appId: "x", title: "", workspace: "chat" }), [
    ["msg", "action", "move-window-to-workspace", "--window-id", "7", "--focus", "false", "chat"],
  ]);
});

Deno.test("kdotool output", () => {
  assertEquals(
    parseKdotoolGeometry("Window {1a2b3c4d-0000-1111-2222-333344445555}\n  Position: 120,80\n  Geometry: 1280x720"),
    { x: 120, y: 80, width: 1280, height: 720 },
  );
  assertEquals(parseKdotoolGeometry("nothing"), undefined);
  assertEquals(parseKdotoolIds("{1a2b3c4d-0000-1111-2222-333344445555}\n\nnot an id\n"), [
    "{1a2b3c4d-0000-1111-2222-333344445555}",
  ]);
  const target: SavedWindow = { appId: "kate", title: "", workspace: "2", rect: { x: 1, y: 2, width: 3, height: 4 } };
  assertEquals(kdotoolArgs("{id}", target), [
    ["set_desktop_for_window", "{id}", "2"],
    ["windowsize", "{id}", "3", "4"],
    ["windowmove", "{id}", "1", "2"],
  ]);
});

Deno.test("wmctrl -lGx", () => {
  const out = [
    "0x01e00003 -1 0    0    1920 32   xfce4-panel.Xfce4-panel  host xfce4-panel",
    "0x03a00007  0 0    32   1920 1048 Navigator.firefox  host Inbox — Mozilla Firefox",
    "0x04400004  1 100  100  800  600  org.gnome.Nautilus.Org.gnome.Nautilus  host Home",
    "0x05000001  1 10   10   640  480  N/A  host Weird",
  ].join("\n");
  const w = parseWmctrl(out);
  assertEquals(w.map((x) => [x.id, x.appId, x.workspace, x.title]), [
    ["0x03a00007", "firefox", "1", "Inbox — Mozilla Firefox"],
    ["0x04400004", "Org.gnome.Nautilus", "2", "Home"],
  ]);
  assertEquals(w[0].rect, { x: 0, y: 32, width: 1920, height: 1048 });
  assertEquals(splitWmClass("code.Code"), "Code");
  assertEquals(splitWmClass("plain"), "plain");
  assertEquals(
    wmctrlArgs("0x1", { appId: "a", title: "", workspace: "2", rect: { x: 5, y: 6, width: 7, height: 8 } }),
    [
      ["-i", "-r", "0x1", "-t", "1"],
      ["-i", "-r", "0x1", "-b", "remove,maximized_vert,maximized_horz"],
      ["-i", "-r", "0x1", "-e", "0,5,6,7,8"],
    ],
  );
});

const FIREFOX = `[Desktop Entry]
Name=Firefox
Name[fr]=Firefox
Exec=firefox %u
Type=Application
StartupWMClass=firefox

[Desktop Action new-window]
Exec=firefox --new-window %u
`;

const FLATPAK = `[Desktop Entry]
Name=Spotify
Exec=/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=spotify --file-forwarding com.spotify.Client @@u %U @@
Type=Application
`;

const apps: DesktopApp[] = [
  parseDesktopApp("firefox.desktop", FIREFOX)!,
  parseDesktopApp("com.spotify.Client.desktop", FLATPAK)!,
  parseDesktopApp("org.gnome.Nautilus.desktop", "[Desktop Entry]\nName=Files\nExec=nautilus --new-window %U\n")!,
  parseDesktopApp("kitty.desktop", "[Desktop Entry]\nName=kitty\nExec=kitty\nType=Application\n")!,
  parseDesktopApp("code.desktop", "[Desktop Entry]\nName=Visual Studio Code\nExec=/usr/share/code/code %F\n")!,
];

Deno.test(".desktop files", () => {
  assertEquals(apps[0], { id: "firefox", name: "Firefox", exec: "firefox", wmClass: "firefox", hidden: false });
  assertEquals(
    apps[1].exec,
    "/usr/bin/flatpak run --branch=stable --arch=x86_64 --command=spotify --file-forwarding com.spotify.Client",
  );
  assertEquals(parseDesktopApp("x.desktop", "[Desktop Entry]\nType=Link\nURL=https://x\n"), undefined);
  assertEquals(cleanExec("app --x %f %%done"), "app --x %done");
  assertEquals(programName("env FOO=1 /usr/bin/app --x"), "app");
});

Deno.test("windows resolve to their app", () => {
  assertEquals(resolveApp("firefox", apps)?.id, "firefox");
  assertEquals(resolveApp("org.gnome.Nautilus", apps)?.id, "org.gnome.Nautilus");
  assertEquals(resolveApp("Org.gnome.Nautilus", apps)?.id, "org.gnome.Nautilus");
  assertEquals(resolveApp("spotify", apps)?.id, "com.spotify.Client");
  assertEquals(resolveApp("Code", apps)?.id, "code");
  assertEquals(resolveApp("unknown-thing", apps), undefined);
});

Deno.test("snapshot keeps commands and sorts by workspace", () => {
  const live = parseHyprClients(HYPR);
  const saved = snapshot(live, apps, { spotify: "spotify --minimized" });
  assertEquals(saved.map((w) => [w.appId, w.workspace, w.command, w.desktopId]), [
    ["firefox", "1", "firefox", "firefox"],
    ["kitty", "3", "kitty", "kitty"],
    ["spotify", "special:music", "spotify --minimized", undefined],
  ]);
  assertEquals(
    sortWindows([{ appId: "b", workspace: "10" }, { appId: "a", workspace: "2" }, { appId: "c" }]).map((w) => w.appId),
    [
      "a",
      "b",
      "c",
    ],
  );
});

Deno.test("plan pairs windows by app and title", () => {
  const saved: SavedWindow[] = [
    { appId: "kitty", title: "vim notes.md", workspace: "2" },
    { appId: "kitty", title: "htop", workspace: "3" },
    { appId: "firefox", title: "Mail", workspace: "1" },
    { appId: "firefox", title: "Docs", workspace: "4" },
  ];
  const live = [
    { id: "a", appId: "kitty", title: "htop" },
    { id: "b", appId: "Kitty", title: "zsh" },
    { id: "c", appId: "firefox", title: "Mail — Firefox" },
  ];
  const p = plan(saved, live);
  const byTarget = Object.fromEntries(p.moves.map((m) => [m.target.title, m.window.id]));
  assertEquals(byTarget, { "vim notes.md": "b", htop: "a", Mail: "c" });
  assertEquals(p.launch.map((w) => w.title), ["Docs"]);
  assert(titleSimilarity("Mail — Firefox", "Mail") > titleSimilarity("Docs", "Mail"));
});

Deno.test("geometry only where the compositor places windows that way", () => {
  const tiled: SavedWindow = { appId: "a", title: "", workspace: "2", rect: { x: 0, y: 0, width: 9, height: 9 } };
  const floating = { ...tiled, floating: true };
  assertEquals(geometryFor("hyprland", { ...tiled, floating: false }), undefined);
  assertEquals(geometryFor("hyprland", floating), floating.rect);
  assertEquals(geometryFor("niri", floating), undefined);
  assertEquals(geometryFor("x11", tiled), tiled.rect);
  const w = { id: "1", appId: "a", title: "", workspace: "2", rect: { x: 1, y: 1, width: 9, height: 9 } };
  assertEquals(needsMove("x11", w, tiled), false);
  assertEquals(needsMove("x11", { ...w, workspace: "1" }, tiled), true);
  assertEquals(needsMove("x11", { ...w, rect: { x: 100, y: 1, width: 9, height: 9 } }, tiled), true);
});

Deno.test("hyprland and sway commands", () => {
  const t: SavedWindow = {
    appId: "kitty",
    title: "",
    workspace: "3",
    floating: true,
    rect: { x: 700, y: 300, width: 800, height: 600 },
  };
  assertEquals(
    hyprBatch("0x1", t),
    "dispatch movetoworkspacesilent 3,address:0x1 ; dispatch setfloating address:0x1 ; " +
      "dispatch resizewindowpixel exact 800 600,address:0x1 ; dispatch movewindowpixel exact 700 300,address:0x1",
  );
  assertEquals(
    hyprBatch("0x1", { ...t, floating: false }, { id: "0x1", appId: "kitty", title: "", floating: true }),
    "dispatch movetoworkspacesilent 3,address:0x1 ; dispatch settiled address:0x1",
  );
  assertEquals(hyprExecRules(t), "[workspace 3 silent; float; size 800 600; move 700 300] ");
  assertEquals(hyprExecRules({ appId: "a", title: "" }), "");
  assertEquals(
    swayCommand("12", { ...t, workspace: "2: web" }),
    `[con_id=12] move container to workspace "2: web", floating enable, resize set 800 px 600 px, move position 700 px 300 px`,
  );
  assertEquals(
    swayCommand("12", { appId: "a", title: "", workspace: "4", floating: false }),
    "[con_id=12] move container to workspace 4",
  );
  assertEquals(swayCommand("12", { appId: "a", title: "" }), "");
});

Deno.test("extras and edited commands", () => {
  assertEquals(parseExtras("https://mail.example.com\n\n# comment\n  code ~/project  \n"), [
    "https://mail.example.com",
    "code ~/project",
  ]);
  assert(isUrl("https://x.org"));
  assert(isUrl("obsidian://open?vault=x"));
  assert(!isUrl("code ~/x"));
  const windows: SavedWindow[] = [
    { appId: "firefox", title: "", command: "firefox", desktopId: "firefox" },
    { appId: "Firefox", title: "" },
    { appId: "weird", title: "" },
  ];
  assertEquals(commandsText(windows), "firefox = firefox\nweird = ");
  const edited = applyCommands(windows, parseCommands("firefox = firefox --private-window\nweird = weird-app"));
  assertEquals(edited.map((w) => [w.command, w.desktopId]), [
    ["firefox --private-window", undefined],
    ["firefox --private-window", undefined],
    ["weird-app", undefined],
  ]);
  assertEquals(applyCommands(windows, parseCommands("firefox = firefox"))[0], windows[0]);
});

Deno.test("names, summaries and messages", () => {
  assertEquals(uniqueName("Work", ["work", "Work 2"]), "Work 3");
  assertEquals(uniqueName("  ", []), "Layout");
  const layouts = [{ name: "Work" }, { name: "Writing" }] as never[];
  assertEquals((findLayout(layouts, "writing") as { name: string }).name, "Writing");
  assertEquals((findLayout(layouts, "wr") as { name: string }).name, "Writing");
  assertEquals(summary([{ workspace: "1" }, { workspace: "1" }, { workspace: "2" }]), "3 windows on 2 workspaces");
  assertEquals(summary([]), "0 windows");
  assertEquals(appsLine([{ appId: "kitty" }, { appId: "firefox" }, { appId: "kitty" }]), "kitty ×2, firefox");
  assertEquals(
    restoreMessage("Work", { moved: 2, launched: 1, placed: 1, skipped: ["x"], late: [], extras: 1, errors: [] }),
    "Work: 2 moved, 1 started, 1 extra opened · no command for x",
  );
  assertEquals(
    restoreMessage("Work", { moved: 0, launched: 0, placed: 0, skipped: [], late: [], extras: 0, errors: [] }),
    "Work: already in place",
  );
  assertStringIncludes(windowsMarkdown([{ appId: "a|b", title: "t", workspace: "1", command: "a" }]), "a\\|b");
  assertStringIncludes(windowsMarkdown([]), "No windows");
});

Deno.test("systemd-run arguments keep the app alive", () => {
  const args = launchArgs("app-backslash-firefox-1", "firefox", { WAYLAND_DISPLAY: "wayland-1", DISPLAY: undefined });
  assertEquals(args.slice(-3), ["/bin/sh", "-c", "firefox"]);
  assert(args.includes("--property=KillMode=process"));
  assert(args.includes("--setenv=WAYLAND_DISPLAY=wayland-1"));
  assert(!args.some((a) => a.startsWith("--setenv=DISPLAY")));
  assertEquals(unitPart("Visual Studio Code!"), "Visual-Studio-Code");
});
