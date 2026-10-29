import { assert, assertEquals } from "@std/assert";
import {
  bottlesApp,
  bottlesCli,
  commandText,
  day,
  explainBottlesError,
  isWindowsProgram,
  parseBottle,
  parseWineDesktop,
  pathFromClipboard,
  prefixArch,
  prefixName,
  runExeArgs,
  runnerName,
  runProgramArgs,
  scopeArgs,
  toolArgs,
  wineStartArgs,
} from "./lib.ts";

const HOME = "/home/ada";
const DIR = `${HOME}/.var/app/com.usebottles.bottles/data/bottles/bottles/Gaming`;

const BOTTLE = `Arch: win64
Creation_Date: '2026-03-14 18:22:51.123456'
Custom_Path: false
DXVK: dxvk-2.4
Environment: Gaming
Environment_Variables:
  DXVK_HUD: fps
External_Programs:
  0b1e3c1a-5d2f-4b7a-9a9e-1d2c3b4a5f60:
    arguments: ''
    executable: Battle.net Launcher.exe
    folder: /home/ada/.var/app/com.usebottles.bottles/data/bottles/bottles/Gaming/drive_c/Program Files (x86)/Battle.net
    icon: ''
    id: 0b1e3c1a-5d2f-4b7a-9a9e-1d2c3b4a5f60
    name: Battle.net
    path: /home/ada/.var/app/com.usebottles.bottles/data/bottles/bottles/Gaming/drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe
  9f8e7d6c-0000-4b7a-9a9e-1d2c3b4a5f60:
    executable: Steam.exe
    name: Steam
    path: /home/ada/.var/app/com.usebottles.bottles/data/bottles/bottles/Gaming/drive_c/Program Files (x86)/Steam/Steam.exe
    arguments: -no-cef-sandbox
  removed-one:
    executable: Old.exe
    name: Old
    path: /x/Old.exe
    removed: true
Name: Gaming
NVAPI: dxvk-nvapi-v0.7.1
Parameters:
  dxvk: true
  dxvk_nvapi: false
  vkd3d: true
Path: Gaming
Runner: soda-7.0-9
Update_Date: '2026-10-01 10:00:00.000000'
VKD3D: vkd3d-proton-2.13
Versioning: true
`;

Deno.test("bottle.yml: name, runner, components and programs", () => {
  const b = parseBottle(BOTTLE, DIR, "flatpak")!;
  assertEquals(b.name, "Gaming");
  assertEquals(b.environment, "Gaming");
  assertEquals(b.runner, "soda-7.0-9");
  assertEquals(b.dxvk, "dxvk-2.4");
  assertEquals(b.vkd3d, "vkd3d-proton-2.13");
  assertEquals(b.nvapi, undefined);
  assertEquals(b.versioning, true);
  assertEquals(b.dir, DIR);
  assertEquals(b.variables, { DXVK_HUD: "fps" });
  assertEquals(b.programs.map((p) => [p.name, p.executable, p.arguments]), [
    ["Battle.net", "Battle.net Launcher.exe", undefined],
    ["Steam", "Steam.exe", "-no-cef-sandbox"],
  ]);
  assertEquals(day(b.created), "2026-03-14");
});

Deno.test("bottle.yml: empty, broken and custom-path bottles", () => {
  assertEquals(parseBottle("", DIR, "native"), undefined);
  assertEquals(parseBottle("Name: [unclosed", DIR, "native"), undefined);
  const minimal = parseBottle("Runner: caffe-9.7\n", `${HOME}/.local/share/bottles/bottles/Office`, "native")!;
  assertEquals(minimal.name, "Office");
  assertEquals(minimal.programs, []);
  const custom = parseBottle("Name: Big\nCustom_Path: true\nPath: /mnt/games/Big\n", DIR, "native")!;
  assertEquals(custom.dir, "/mnt/games/Big");
});

Deno.test("bottles-cli: native and Flatpak command lines", () => {
  const b = parseBottle(BOTTLE, DIR, "flatpak")!;
  const steam = b.programs[1];
  assertEquals(runProgramArgs(b, steam), ["run", "-b", "Gaming", "-p", "Steam"]);
  assertEquals(bottlesCli("flatpak", runProgramArgs(b, steam)), {
    program: "flatpak",
    args: ["run", "--command=bottles-cli", "com.usebottles.bottles", "run", "-b", "Gaming", "-p", "Steam"],
  });
  assertEquals(bottlesCli("native", ["list", "bottles"]), { program: "bottles-cli", args: ["list", "bottles"] });
  assertEquals(runExeArgs(b, "/tmp/setup.exe"), ["run", "-b", "Gaming", "-e", "/tmp/setup.exe"]);
  assertEquals(toolArgs(b, "winecfg"), ["tools", "-b", "Gaming", "winecfg"]);
  assertEquals(bottlesApp("native"), { program: "bottles", args: [] });
  assertEquals(
    commandText("flatpak", [
      "run",
      "--command=bottles-cli",
      "com.usebottles.bottles",
      "run",
      "-b",
      "My Games",
      "-p",
      "Steam",
    ]),
    "flatpak run --command=bottles-cli com.usebottles.bottles run -b 'My Games' -p Steam",
  );
});

Deno.test("runner names", () => {
  assertEquals(runnerName("soda-7.0-9"), "Soda 7.0-9");
  assertEquals(runnerName("caffe-9.7"), "Caffe 9.7");
  assertEquals(runnerName("wine-ge-proton8-26"), "wine-ge-proton8-26");
  assertEquals(runnerName("sys-wine-9.0"), "System Wine 9.0");
  assertEquals(runnerName("kron4ek-wine-9.20-amd64"), "kron4ek-wine-9.20-amd64");
  assertEquals(runnerName(undefined), "Unknown");
});

Deno.test("wine prefixes and menu entries", () => {
  assertEquals(prefixArch("WINE REGISTRY Version 2\n;; All keys relative to \\\\Machine\n\n#arch=win64\n"), "win64");
  assertEquals(prefixArch("nothing"), undefined);
  assertEquals(prefixName(`${HOME}/.wine`, HOME), "Default (~/.wine)");
  assertEquals(prefixName(`${HOME}/.local/share/wineprefixes/office2010/`, HOME), "office2010");

  const app = parseWineDesktop(
    `${HOME}/.local/share/applications/wine/Programs/Notepad++.desktop`,
    `[Desktop Entry]
Name=Notepad++
Exec=env WINEPREFIX="/home/ada/.local/share/wineprefixes/tools" wine C:\\\\\\\\ProgramData\\\\\\\\Microsoft\\\\\\\\Windows\\\\\\\\Start\\\\ Menu\\\\\\\\Programs\\\\\\\\Notepad++.lnk
Type=Application
StartupNotify=true
Path=/home/ada/.local/share/wineprefixes/tools/dosdevices/c:/Program Files/Notepad++
Icon=2CF9_notepad++.0
`,
    HOME,
  )!;
  assertEquals(app.name, "Notepad++");
  assertEquals(app.prefix, `${HOME}/.local/share/wineprefixes/tools`);
  assertEquals(app.icon, "2CF9_notepad++.0");
  const plain = parseWineDesktop("x.desktop", "[Desktop Entry]\nName=Old\nExec=wine C:\\\\x.exe\n", HOME)!;
  assertEquals(plain.prefix, `${HOME}/.wine`);
  assertEquals(parseWineDesktop("y.desktop", "[Desktop Entry]\nName=Firefox\nExec=firefox %u\n", HOME), undefined);
});

Deno.test("clipboard paths", () => {
  assertEquals(pathFromClipboard("  /home/ada/Downloads/setup.exe \n", HOME), "/home/ada/Downloads/setup.exe");
  assertEquals(pathFromClipboard("'~/Games/My Game/game.exe'", HOME), "/home/ada/Games/My Game/game.exe");
  assertEquals(
    pathFromClipboard("file:///home/ada/Downloads/My%20Setup.msi", HOME),
    "/home/ada/Downloads/My Setup.msi",
  );
  assertEquals(pathFromClipboard("hello world", HOME), undefined);
  assert(isWindowsProgram("/x/Setup.EXE"));
  assert(isWindowsProgram("/x/install.msi"));
  assert(!isWindowsProgram("/x/readme.txt"));
  assertEquals(wineStartArgs("/x/a.exe"), ["start", "/unix", "/x/a.exe"]);
});

Deno.test("systemd scope arguments", () => {
  const args = scopeArgs("Notepad++ (tools)", ["wine", "start", "/unix", "/x/a.exe"], { WINEPREFIX: "/p" }, 7, "/x");
  assertEquals(args.slice(0, 5), [
    "--user",
    "--collect",
    "--quiet",
    "--unit=app-backslash-wine-notepad-tools-7",
    "--description=Notepad++ (tools)",
  ]);
  assert(args.includes("--working-directory=/x"));
  assert(args.includes("--setenv=WINEPREFIX=/p"));
  assertEquals(args.slice(-5), ["/usr/bin/env", "wine", "start", "/unix", "/x/a.exe"]);
});

Deno.test("bottles-cli errors", () => {
  assertEquals(explainBottlesError("Bottle Gaming not found"), "Bottles doesn't know this bottle: open Bottles once");
  assertEquals(
    explainBottlesError("error: app/com.usebottles.bottles/x86_64/master not installed"),
    "The Bottles Flatpak is not installed",
  );
  assertEquals(explainBottlesError("Traceback\n  ...\nKeyError: 'x'"), "KeyError: 'x'");
});
