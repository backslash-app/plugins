import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  appImageType,
  describeDesktop,
  desktopEntry,
  desktopFileName,
  execProgram,
  execQuote,
  findEntry,
  moveTarget,
  parseDesktopEntry,
  parseFileName,
  runUnit,
  searchFolders,
  slug,
} from "./lib.ts";
import { TERMINALS } from "./terminal.ts";

/** The first bytes of a type 2 AppImage: an ELF header with `AI\x02` at offset 8. */
const TYPE2 = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x02, 0, 0, 0, 0, 0]);

Deno.test("magic bytes", () => {
  assertEquals(appImageType(TYPE2), 2);
  assertEquals(appImageType(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 0x01, 0])), 1);
  assertEquals(appImageType(new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0, 0, 0, 0])), undefined);
  assertEquals(appImageType(new TextEncoder().encode("#!/bin/sh\necho hi\n")), undefined);
  assertEquals(appImageType(new Uint8Array(4)), undefined);
});

Deno.test("names and versions from file names", () => {
  const cases: [string, string, string | undefined, string | undefined][] = [
    ["Obsidian-1.4.16.AppImage", "Obsidian", "1.4.16", undefined],
    ["balenaEtcher-1.18.11-x64.AppImage", "balenaEtcher", "1.18.11", "x86_64"],
    ["nvim.appimage", "nvim", undefined, undefined],
    ["LibreOffice-7.6.2.1.standard-x86_64.AppImage", "LibreOffice", "7.6.2.1.standard", "x86_64"],
    ["MuseScore-Studio-4.4.2.242570931-x86_64.AppImage", "MuseScore Studio", "4.4.2.242570931", "x86_64"],
    ["FreeCAD_0.21.2-Linux-x86_64.AppImage", "FreeCAD", "0.21.2", "x86_64"],
    ["OrcaSlicer_Linux_V2.0.0.AppImage", "OrcaSlicer", "2.0.0", undefined],
    ["PrusaSlicer-2.7.2+linux-x64-GTK3-202402291307.AppImage", "PrusaSlicer", "2.7.2", "x86_64"],
    ["appimagetool-x86_64.AppImage", "appimagetool", undefined, "x86_64"],
    ["Cursor-0.42.3-aarch64.AppImage", "Cursor", "0.42.3", "aarch64"],
    ["kdenlive-23.08.4-x86_64.appimage", "kdenlive", "23.08.4", "x86_64"],
    ["2048.AppImage", "2048", undefined, undefined],
  ];
  for (const [file, name, version, arch] of cases) {
    assertEquals(parseFileName(file), { name, version, arch }, file);
  }
});

const AIL = `[Desktop Entry]
Name=Obsidian
Exec="/home/ada/Applications/Obsidian-1.4.16.AppImage" %U
TryExec=/home/ada/Applications/Obsidian-1.4.16.AppImage
Icon=/home/ada/.local/share/icons/hicolor/256x256/apps/appimagekit_5a4f_obsidian.png
Comment=Obsidian
Type=Application
X-AppImage-Version=1.4.16
X-AppImage-Integrate=true

[Desktop Action Remove]
Name=Remove AppImage from system
Exec=/usr/bin/ail-cli unintegrate "/home/ada/Applications/Obsidian-1.4.16.AppImage"
`;

Deno.test("desktop entries: parsing, Exec and integrators", () => {
  const e = parseDesktopEntry(AIL);
  assertEquals(e.Name, "Obsidian");
  assertEquals(e.Exec, `"/home/ada/Applications/Obsidian-1.4.16.AppImage" %U`);
  assertEquals(Object.keys(e).includes("Remove"), false);
  const d = describeDesktop("/home/ada/.local/share/applications/appimagekit_5a4f-Obsidian.desktop", AIL);
  assertEquals(d.by, "appimagelauncher");
  assertEquals(d.exec, "/home/ada/Applications/Obsidian-1.4.16.AppImage");
  assertEquals(findEntry("/home/ada/Applications/Obsidian-1.4.16.AppImage", [d]), d);
  assertEquals(findEntry("/home/ada/Downloads/Other.AppImage", [d]), undefined);
  assertEquals(
    describeDesktop("/x/gearlever_krita_a1b2.desktop", "[Desktop Entry]\nExec=/home/ada/AppImages/krita.appimage\n").by,
    "gearlever",
  );
  assertEquals(
    execProgram(`env DESKTOPINTEGRATION=1 "/home/ada/My Apps/App \\\\"x\\\\".AppImage" --no-sandbox %U`),
    `/home/ada/My Apps/App "x".AppImage`,
  );
  assertEquals(execProgram("/opt/app/App.AppImage"), "/opt/app/App.AppImage");
});

Deno.test("our menu entries round-trip through the Exec parser", () => {
  for (const path of ["/home/ada/Applications/Obsidian.AppImage", "/home/ada/My Apps/$weird `name` \\ x.AppImage"]) {
    const text = desktopEntry({ name: "Obsidian", path, version: "1.4.16" });
    const d = describeDesktop(`/x/${desktopFileName("Obsidian")}`, text);
    assertEquals(d.exec, path);
    assertEquals(d.by, "backslash");
    assertEquals(d.icon, "application-x-executable");
  }
  assertEquals(execQuote("/a/b.AppImage"), "/a/b.AppImage");
  assertEquals(desktopFileName("Écrit & Co"), "backslash-appimage-ecrit-co.desktop");
  assertEquals(slug("!!!"), "app");
});

Deno.test("folders, moves and units", () => {
  const f = searchFolders("/home/ada", "~/Games, /data/apps/, ~/Applications");
  assertEquals(f.map((x) => x.path), [
    "/home/ada/Applications",
    "/home/ada/AppImages",
    "/home/ada/.local/bin",
    "/home/ada/Downloads",
    "/opt",
    "/home/ada/Games",
    "/data/apps",
  ]);
  assertEquals(moveTarget("App.AppImage", ["Other.AppImage"]), "App.AppImage");
  assertEquals(moveTarget("App.AppImage", ["App.AppImage", "App (2).AppImage"]), "App (3).AppImage");
  assertEquals(runUnit("MuseScore Studio", 17), "app-backslash-musescore-studio-17");
});

Deno.test("finds, integrates and moves real files", async () => {
  const home = await Deno.makeTempDir({ prefix: "appimages-test-" });
  try {
    await Deno.mkdir(`${home}/Downloads`, { recursive: true });
    await Deno.mkdir(`${home}/.local/bin`, { recursive: true });
    await Deno.mkdir(`${home}/.local/share/applications`, { recursive: true });
    await Deno.writeFile(`${home}/Downloads/Obsidian-1.4.16.AppImage`, TYPE2, { mode: 0o644 });
    await Deno.writeFile(`${home}/.local/bin/nvim`, TYPE2, { mode: 0o755 }); // no extension: sniffed
    await Deno.writeTextFile(`${home}/.local/bin/script`, "#!/bin/sh\n", { mode: 0o755 });
    await Deno.writeTextFile(`${home}/Downloads/notes.txt`, "hello");

    Deno.env.set("HOME", home);
    const lib = await import("./appimages.ts");
    let { apps } = await lib.findAppImages("");
    assertEquals(apps.map((a) => [a.name, a.version, a.executable, a.type]), [
      ["nvim", undefined, true, 2],
      ["Obsidian", "1.4.16", false, 2],
    ]);
    const obsidian = apps.find((a) => a.name === "Obsidian")!;

    const entry = await lib.integrate(obsidian);
    assertEquals(entry, `${home}/.local/share/applications/backslash-appimage-obsidian.desktop`);
    ({ apps } = await lib.findAppImages(""));
    const integrated = apps.find((a) => a.name === "Obsidian")!;
    assertEquals(integrated.entry?.by, "backslash");
    assertEquals(integrated.executable, true);

    const moved = await lib.moveToApplications(integrated);
    assertEquals(moved, `${home}/Applications/Obsidian-1.4.16.AppImage`);
    ({ apps } = await lib.findAppImages(""));
    const after = apps.find((a) => a.name === "Obsidian")!;
    assertEquals(after.path, moved);
    assertEquals(after.entry?.exec, moved);

    await lib.removeIntegration(after);
    ({ apps } = await lib.findAppImages(""));
    assertEquals(apps.find((a) => a.name === "Obsidian")!.entry, undefined);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("manifest: programs and commands", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string }[];
    preferences: Record<string, unknown>[];
  };
  const run = new Set(manifest.permissions.run);
  for (const p of [...TERMINALS, "systemd-run", "chmod", "mv", "gio"]) assert(run.has(p), `${p} is not in run`);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
  const allowed = new Set(["name", "title", "description", "required", "default", "type"]);
  for (const p of manifest.preferences) for (const k of Object.keys(p)) assert(allowed.has(k), `${p.name}: ${k}`);
});
