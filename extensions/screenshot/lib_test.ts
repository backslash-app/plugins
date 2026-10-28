import { assert, assertEquals } from "@std/assert";
import {
  ago,
  captureCommand,
  captureName,
  clock,
  companions,
  detectSession,
  focusedOutput,
  formatBytes,
  hyprlandWindows,
  installCommands,
  osFamily,
  parseUserDirs,
  pick,
  pngSize,
  recorderCandidates,
  recordScript,
  screenshotCandidates,
  screenshotScript,
  sessionName,
  swayWindows,
  systemdRunArgs,
} from "./lib.ts";

Deno.test("sessions", () => {
  assertEquals(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "ubuntu:GNOME" }), {
    wayland: true,
    desktop: "gnome",
  });
  assertEquals(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "KDE" }).desktop, "kde");
  assertEquals(detectSession({ WAYLAND_DISPLAY: "wayland-1", HYPRLAND_INSTANCE_SIGNATURE: "abc" }), {
    wayland: true,
    desktop: "hyprland",
  });
  assertEquals(detectSession({ XDG_SESSION_TYPE: "wayland", SWAYSOCK: "/run/user/1000/sway.sock" }).desktop, "sway");
  assertEquals(detectSession({ XDG_SESSION_TYPE: "x11", DISPLAY: ":0", WAYLAND_DISPLAY: "w" }), {
    wayland: false,
    desktop: "other",
  });
  assertEquals(sessionName({ wayland: true, desktop: "gnome" }), "GNOME (Wayland)");
  assertEquals(sessionName({ wayland: false, desktop: "other" }), "X11");
});

Deno.test("the first installed tool that works in the session", () => {
  const gnome = { wayland: true, desktop: "gnome" as const };
  const hypr = { wayland: true, desktop: "hyprland" as const };
  const x11 = { wayland: false, desktop: "other" as const };
  assertEquals(screenshotCandidates(gnome), ["gnome-screenshot"]);
  assertEquals(pick(screenshotCandidates(hypr), new Set(["grim", "maim"])), "grim");
  assertEquals(pick(screenshotCandidates(x11), new Set(["scrot", "import"])), "scrot");
  assertEquals(pick(screenshotCandidates(gnome), new Set(["grim"])), undefined);
  assertEquals(recorderCandidates(gnome), []);
  assertEquals(pick(recorderCandidates(hypr), new Set(["wl-screenrec"])), "wl-screenrec");
  assertEquals(recorderCandidates(x11), ["ffmpeg"]);
  assertEquals(companions("grim", "area"), ["slurp"]);
  assertEquals(companions("grim", "screen"), []);
  assertEquals(companions("ffmpeg", "record-area"), ["slop"]);
});

Deno.test("capture command lines", () => {
  const f = "/home/ada/Pictures/Screenshots/Shot it's.png";
  const quoted = `'/home/ada/Pictures/Screenshots/Shot it'\\''s.png'`;
  assertEquals(captureCommand("grim", "screen", f), `grim ${quoted}`);
  assertEquals(captureCommand("grim", "area", f), `geometry=$(slurp -d) || exit 0; grim -g "$geometry" ${quoted}`);
  assertEquals(
    captureCommand("grim", "window", f, ["0,0 800x600", "800,0 1120x1080"]),
    `geometry=$(printf '%s\\n' '0,0 800x600' '800,0 1120x1080' | slurp -r) || exit 0; grim -g "$geometry" ${quoted}`,
  );
  assertEquals(captureCommand("gnome-screenshot", "window", f), `gnome-screenshot -w -f ${quoted}`);
  assertEquals(captureCommand("gnome-screenshot", "screen", f), `gnome-screenshot -f ${quoted}`);
  assertEquals(captureCommand("spectacle", "area", f), `spectacle -b -n -r -o ${quoted}`);
  assertEquals(captureCommand("maim", "window", f), `maim -s -t 9999999 ${quoted}`);
  assertEquals(captureCommand("scrot", "window", f), `scrot -u ${quoted}`);
  assertEquals(captureCommand("import", "screen", f), `import -window root ${quoted}`);
});

Deno.test("screenshot script: waits, captures, copies, notifies", () => {
  const script = screenshotScript({ tool: "grim", mode: "screen", file: "/p/S/a.png", wayland: true, delay: 2 });
  const lines = script.split("\n");
  assertEquals(lines[0], "sleep 2.4");
  assertEquals(lines[1], "mkdir -p '/p/S'");
  assertEquals(lines[2], "grim '/p/S/a.png' || exit 0");
  assert(lines[4].startsWith("if { wl-copy --type image/png < '/p/S/a.png' || xclip"));
  assert(lines[5].startsWith("notify-send -a Backslash -i '/p/S/a.png' 'Screenshot' \"a.png · $note\""));
  const x = screenshotScript({ tool: "maim", mode: "area", file: "/p/a.png", wayland: false, copy: false });
  assert(!x.includes("xclip"));
  assertEquals(x.split("\n")[0], "sleep 0.4");
});

Deno.test("recording scripts exec the recorder", () => {
  assertEquals(
    recordScript({ tool: "wf-recorder", area: false, file: "/v/r.mp4", output: "DP-1", audio: true }).split("\n").at(
      -1,
    ),
    "exec wf-recorder -o 'DP-1' -a -f '/v/r.mp4'",
  );
  assertEquals(
    recordScript({ tool: "wl-screenrec", area: true, file: "/v/r.mp4", audio: true }).split("\n").slice(2),
    ["geometry=$(slurp -d) || exit 0", `exec wl-screenrec -g "$geometry" --audio -f '/v/r.mp4'`],
  );
  const ff = recordScript({ tool: "ffmpeg", area: true, file: "/v/r.mp4" });
  assert(ff.includes(`-video_size "$1" -i "$DISPLAY+$2"`));
  assert(ff.includes("-pix_fmt yuv420p"));
});

Deno.test("systemd-run arguments", () => {
  const args = systemdRunArgs("backslash-screenshot-1", "grim x", {
    description: "Backslash: screenshot",
    keepChildren: true,
    env: { WAYLAND_DISPLAY: "wayland-1", DISPLAY: undefined },
  });
  assertEquals(args, [
    "--user",
    "--quiet",
    "--unit=backslash-screenshot-1",
    "--description=Backslash: screenshot",
    "--collect",
    "--property=KillMode=process",
    "--setenv=WAYLAND_DISPLAY=wayland-1",
    "/bin/sh",
    "-c",
    "grim x",
  ]);
  assert(systemdRunArgs("u", "s", { description: "d", killSignal: "SIGINT" }).includes("--property=KillSignal=SIGINT"));
});

Deno.test("windows from Hyprland and Sway", () => {
  const monitors = JSON.stringify([
    { name: "eDP-1", focused: false, activeWorkspace: { id: 1 }, specialWorkspace: { id: 0 } },
    { name: "DP-2", focused: true, activeWorkspace: { id: 4 }, specialWorkspace: { id: 0 } },
  ]);
  const clients = JSON.stringify([
    { at: [10, 40], size: [940, 1030], workspace: { id: 1 }, mapped: true, hidden: false, class: "kitty" },
    { at: [1930, 40], size: [1900, 1030], workspace: { id: 4 }, mapped: true, hidden: false, class: "firefox" },
    { at: [0, 0], size: [500, 500], workspace: { id: 2 }, mapped: true, hidden: false, class: "hidden-ws" },
    { at: [0, 0], size: [500, 500], workspace: { id: 1 }, mapped: true, hidden: true, class: "grouped" },
  ]);
  assertEquals(hyprlandWindows(clients, monitors), ["10,40 940x1030", "1930,40 1900x1030"]);
  assertEquals(focusedOutput(monitors), "DP-2");

  const tree = {
    type: "root",
    nodes: [{
      type: "output",
      name: "eDP-1",
      nodes: [{
        type: "workspace",
        nodes: [
          { type: "con", visible: true, pid: 100, app_id: "foot", rect: { x: 0, y: 0, width: 960, height: 1080 } },
          { type: "con", visible: false, pid: 101, app_id: "tabbed", rect: { x: 960, y: 0, width: 960, height: 1080 } },
        ],
        floating_nodes: [
          { type: "floating_con", visible: true, pid: 102, rect: { x: 600, y: 300, width: 640, height: 480 } },
        ],
      }],
    }],
  };
  assertEquals(swayWindows(JSON.stringify(tree)), ["0,0 960x1080", "600,300 640x480"]);
  assertEquals(focusedOutput(JSON.stringify([{ name: "HDMI-A-1" }])), "HDMI-A-1");
});

Deno.test("folders and names", () => {
  const dirs = `# This file is written by xdg-user-dirs-update
XDG_DESKTOP_DIR="$HOME/Bureau"
XDG_PICTURES_DIR="$HOME/Images"
XDG_VIDEOS_DIR="$HOME/"
`;
  assertEquals(parseUserDirs(dirs, "/home/ada"), { pictures: "/home/ada/Images", videos: undefined });
  assertEquals(captureName("Screenshot", new Date(2026, 9, 28, 14, 2, 11)), "Screenshot_2026-10-28_14-02-11.png");
  assertEquals(captureName("Recording", new Date(2026, 0, 5, 9, 0, 0)), "Recording_2026-01-05_09-00-00.mp4");
});

Deno.test("png size", () => {
  const head = new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    0,
    0,
    0,
    13,
    0x49,
    0x48,
    0x44,
    0x52,
    0,
    0,
    0x07,
    0x80,
    0,
    0,
    0x04,
    0x38,
  ]);
  assertEquals(pngSize(head), { width: 1920, height: 1080 });
  assertEquals(pngSize(new Uint8Array([0xff, 0xd8, 0xff])), undefined);
});

Deno.test("formatting", () => {
  assertEquals([formatBytes(512), formatBytes(2048), formatBytes(1536 * 1024), formatBytes(250 * 1024 * 1024)], [
    "512 B",
    "2.0 KB",
    "1.5 MB",
    "250 MB",
  ]);
  const now = Date.UTC(2026, 9, 28, 12);
  assertEquals(
    [ago(now - 10_000, now), ago(now - 5 * 60_000, now), ago(now - 3 * 3600_000, now), ago(now - 86400_000, now)],
    ["just now", "5 min ago", "3 h ago", "yesterday"],
  );
  assertEquals([clock(42), clock(725), clock(3723)], ["0:42", "12:05", "1:02:03"]);
});

Deno.test("what to install", () => {
  const ubuntu = `NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n`;
  const fedora = `NAME="Fedora Linux"\nID=fedora\n`;
  const tumbleweed = `ID="opensuse-tumbleweed"\nID_LIKE="opensuse suse"\n`;
  assertEquals([osFamily(ubuntu), osFamily(fedora), osFamily(tumbleweed), osFamily("ID=nixos")], [
    "debian",
    "fedora",
    "suse",
    undefined,
  ]);
  assertEquals(installCommands(["spectacle", "wl-copy"], "debian"), [
    { family: "debian", command: "sudo apt install kde-spectacle wl-clipboard" },
  ]);
  assertEquals(installCommands(["grim", "slurp"]).length, 4);
});

/** `sh -n`: the generated scripts parse. */
async function parses(script: string) {
  const { success, stderr } = await new Deno.Command("sh", { args: ["-n", "-c", script], stderr: "piped" }).output();
  assert(success, `${new TextDecoder().decode(stderr)}\n${script}`);
}

Deno.test("every generated script is valid sh", async () => {
  for (const tool of ["grim", "gnome-screenshot", "spectacle", "maim", "scrot", "import"] as const) {
    for (const mode of ["area", "window", "screen"] as const) {
      for (const copy of [true, false]) {
        await parses(
          screenshotScript({ tool, mode, file: "/h/P/it's.png", wayland: true, copy, windows: ["0,0 1x1"] }),
        );
      }
    }
  }
  for (const tool of ["wf-recorder", "wl-screenrec", "ffmpeg"] as const) {
    for (const area of [true, false]) {
      await parses(recordScript({ tool, area, file: "/v/a b.mp4", audio: true, output: "DP-1" }));
    }
  }
});
