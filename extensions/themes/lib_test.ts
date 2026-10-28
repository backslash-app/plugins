import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  counterpart,
  dedupe,
  detectBackend,
  filterOptions,
  gtkTheme,
  iconThemes,
  kdeCounterpart,
  lookAndFeelName,
  matchesFilter,
  originOf,
  parseColorSchemes,
  parseIni,
  parseLookAndFeel,
  parseRange,
  previewCandidates,
  readable,
  sortThemes,
  type Theme,
  themeDirs,
  unquote,
} from "./lib.ts";

const ADWAITA_ICONS = `[Icon Theme]
Name=Adwaita
Name[fr]=Adwaita
Comment=The Only One
Example=folder
Inherits=hicolor
Directories=16x16/actions,16x16/places,scalable/places,symbolic/places,cursors

[16x16/places]
Context=Places
Size=16
Type=Fixed

[scalable/places]
Context=Places
Size=128
MinSize=8
MaxSize=512
Type=Scalable
`;

const PAPIRUS = `[Icon Theme]
Name=Papirus-Dark
Comment=Papirus icon theme
Inherits=breeze-dark,hicolor
Directories=16x16/places,22x22/places,48x48/places,64x64/places,16x16@2x/places,symbolic/places
`;

const GTK_INDEX = `[Desktop Entry]
Type=X-GNOME-Metatheme
Name=Arc-Dark
Comment=A flat theme with transparent elements
Encoding=UTF-8

[X-GNOME-Metatheme]
GtkTheme=Arc-Dark
MetacityTheme=Arc-Dark
IconTheme=Adwaita
`;

Deno.test("backend from XDG_CURRENT_DESKTOP", () => {
  assertEquals(detectBackend("ubuntu:GNOME"), "gnome");
  assertEquals(detectBackend("KDE"), "kde");
  assertEquals(detectBackend("X-Cinnamon"), "cinnamon");
  assertEquals(detectBackend("MATE"), "mate");
  assertEquals(detectBackend("XFCE"), "xfce");
  assertEquals(detectBackend("Hyprland"), "gnome");
  assertEquals(detectBackend(undefined), "gnome");
});

Deno.test("INI files and names", () => {
  const ini = parseIni(ADWAITA_ICONS);
  assertEquals(ini["Icon Theme"].Name, "Adwaita");
  assertEquals(ini["Icon Theme"]["Name[fr]"], undefined);
  assertEquals(ini["scalable/places"].Type, "Scalable");
  assertEquals(readable("Yaru-blue-dark"), "Yaru Blue Dark");
  assertEquals(readable("BreezeDark"), "Breeze Dark");
  assertEquals(readable("breeze_cursors"), "Breeze Cursors");
  assertEquals(unquote("'Adwaita-dark'\n"), "Adwaita-dark");
  assertEquals(parseRange("enum\n'blue'\n'teal'\n'slate'\n"), ["blue", "teal", "slate"]);
  assertEquals(parseRange("type s\n"), []);
});

Deno.test("GTK theme folders", () => {
  const arc = gtkTheme(
    "Arc-Dark",
    "/usr/share/themes/Arc-Dark",
    ["gtk-2.0", "gtk-3.0", "gtk-4.0", "index.theme"],
    GTK_INDEX,
  )!;
  assertEquals(arc.name, "Arc-Dark");
  assertEquals(arc.gtk, ["2", "3", "4"]);
  assertEquals(arc.comment, "A flat theme with transparent elements");
  assertEquals(arc.dark, true);
  // A window manager or GNOME Shell theme only: not a GTK theme.
  assertEquals(gtkTheme("Default", "/usr/share/themes/Default", ["xfwm4", "metacity-1"]), undefined);
  assertEquals(gtkTheme("Old", "/x", ["gtk-2.0"]), undefined);
  assertEquals(gtkTheme("Yaru-blue", "/x", ["gtk-3.0"])?.name, "Yaru Blue");
  assertEquals(gtkTheme("H", "/x", ["gtk-3.0"], "[Desktop Entry]\nHidden=true"), undefined);
});

Deno.test("icon and cursor folders", () => {
  const adwaita = iconThemes(
    "Adwaita",
    "/usr/share/icons/Adwaita",
    ["16x16", "scalable", "cursors", "index.theme"],
    ADWAITA_ICONS,
  );
  assertEquals(adwaita.map((t) => t.kind), ["icons", "cursors"]);
  assertEquals(adwaita[0].inherits, "hicolor");
  // A cursor theme only: index.theme without Directories.
  const bibata = iconThemes(
    "Bibata-Modern-Ice",
    "/x",
    ["cursors", "index.theme"],
    "[Icon Theme]\nName=Bibata Modern Ice\nComment=Bibata",
  );
  assertEquals(bibata.map((t) => [t.kind, t.name]), [["cursors", "Bibata Modern Ice"]]);
  assertEquals(iconThemes("NoIndex", "/x", ["cursors"]).map((t) => [t.kind, t.name]), [["cursors", "No Index"]]);
  assertEquals(iconThemes("hicolor", "/x", ["48x48"], ADWAITA_ICONS), []);
  assertEquals(iconThemes("default", "/x", ["index.theme"], "[Icon Theme]\nInherits=Adwaita"), []);
  assertEquals(iconThemes("broken", "/x", ["48x48"]), []);
});

Deno.test("folder icon used as the preview", () => {
  assertEquals(previewCandidates(ADWAITA_ICONS).slice(0, 2), [
    "scalable/places/folder.svg",
    "scalable/places/folder.png",
  ]);
  // 48 to 256 before tiny sizes and symbolic icons.
  assertEquals(previewCandidates(PAPIRUS)[0], "64x64/places/folder.svg");
  assertEquals(previewCandidates("[Icon Theme]\nDirectories=actions/16"), []);
});

Deno.test("folders and duplicates", () => {
  const dirs = themeDirs("/home/ada");
  assertEquals(dirs.gtk[0], "/home/ada/.local/share/themes");
  assertEquals(dirs.icons.at(-1), "/usr/share/icons");
  assertEquals(originOf("/home/ada/.icons", "/home/ada"), "Your themes");
  assertEquals(originOf("/usr/share/icons", "/home/ada"), "System");
  const mine: Theme = { kind: "icons", id: "Papirus", name: "Papirus", path: "/home/ada/.local/share/icons/Papirus" };
  const system: Theme = { kind: "icons", id: "Papirus", name: "Papirus", path: "/usr/share/icons/Papirus" };
  const cursor: Theme = { kind: "cursors", id: "Papirus", name: "Papirus" };
  assertEquals(dedupe([mine, system, cursor]), [mine, cursor]);
});

Deno.test("dark and light counterparts", () => {
  const gtk = [
    "Adwaita",
    "Adwaita-dark",
    "Yaru-blue",
    "Yaru-blue-dark",
    "Arc",
    "Arc-Dark",
    "Orchis-Light",
    "Orchis-Dark",
    "Materia",
  ];
  assertEquals(counterpart("Adwaita", gtk, true), "Adwaita-dark");
  assertEquals(counterpart("Adwaita-dark", gtk, false), "Adwaita");
  assertEquals(counterpart("Yaru-blue", gtk, true), "Yaru-blue-dark");
  assertEquals(counterpart("Arc", gtk, true), "Arc-Dark");
  assertEquals(counterpart("Arc-Dark", gtk, false), "Arc");
  assertEquals(counterpart("Orchis-Light", gtk, true), "Orchis-Dark");
  assertEquals(counterpart("Orchis-Dark", gtk, false), "Orchis-Light");
  assertEquals(counterpart("Materia", gtk, true), undefined);
  assertEquals(counterpart("Adwaita-dark", gtk, true), undefined);
  const schemes = ["Breeze", "BreezeClassic", "BreezeDark", "BreezeLight", "Nordic"];
  assertEquals(kdeCounterpart("BreezeLight", schemes, true), "BreezeDark");
  assertEquals(kdeCounterpart("BreezeDark", schemes, false), "BreezeLight");
  assertEquals(kdeCounterpart("BreezeClassic", schemes, true), "BreezeDark");
  assertEquals(kdeCounterpart("BreezeDark", schemes, true), undefined);
});

Deno.test("Plasma tools' output", () => {
  const schemes = parseColorSchemes(`You have the following color schemes on your system:
 * BreezeClassic
 * BreezeDark (current color scheme)
 * BreezeLight
 * Oxygen Cold
`);
  assertEquals(schemes, [
    { id: "BreezeClassic", current: false },
    { id: "BreezeDark", current: true },
    { id: "BreezeLight", current: false },
    { id: "Oxygen Cold", current: false },
  ]);
  assertEquals(
    parseLookAndFeel("org.kde.breeze.desktop\norg.kde.breezedark.desktop\n\norg.kde.breezetwilight.desktop\n"),
    [
      "org.kde.breeze.desktop",
      "org.kde.breezedark.desktop",
      "org.kde.breezetwilight.desktop",
    ],
  );
  const meta = JSON.stringify({
    KPlugin: { Name: "Breeze Dark", Description: "Breeze Dark by the KDE VDG", Id: "org.kde.breezedark.desktop" },
  });
  assertEquals(lookAndFeelName("org.kde.breezedark.desktop", meta), {
    name: "Breeze Dark",
    comment: "Breeze Dark by the KDE VDG",
  });
  assertEquals(
    lookAndFeelName("org.kde.breeze.desktop", "[Desktop Entry]\nName=Breeze\nComment=Breeze by KDE").name,
    "Breeze",
  );
  assertEquals(lookAndFeelName("org.kde.breezetwilight.desktop").name, "Breezetwilight");
});

Deno.test("chips and order", () => {
  assertEquals(filterOptions("kde", false).map((o) => o.value), ["all", "global", "colors", "gtk", "icons", "cursors"]);
  assertEquals(filterOptions("gnome", true)[1], { value: "style", title: "Style & Accent" });
  assert(matchesFilter("accent", "style"));
  assert(!matchesFilter("icons", "gtk"));
  assert(matchesFilter("cursors", undefined));
  const t = (kind: Theme["kind"], id: string): Theme => ({ kind, id, name: id });
  const sorted = sortThemes([t("icons", "b"), t("gtk", "z"), t("icons", "a"), t("icons", "c"), t("style", "default")], {
    icons: "c",
  });
  assertEquals(sorted.map((x) => `${x.kind}:${x.id}`), ["style:default", "gtk:z", "icons:c", "icons:a", "icons:b"]);
});

Deno.test("the scan of a real folder layout", async () => {
  const root = await Deno.makeTempDir();
  try {
    await Deno.mkdir(`${root}/Papirus/64x64/places`, { recursive: true });
    await Deno.writeTextFile(`${root}/Papirus/index.theme`, PAPIRUS);
    await Deno.writeTextFile(`${root}/Papirus/64x64/places/folder.svg`, "<svg/>");
    const entries = [...Deno.readDirSync(`${root}/Papirus`)].map((e) => e.name);
    const [theme] = iconThemes(
      "Papirus",
      `${root}/Papirus`,
      entries,
      await Deno.readTextFile(`${root}/Papirus/index.theme`),
    );
    assertEquals(theme.name, "Papirus-Dark");
    const found = previewCandidates(PAPIRUS).find((c) => {
      try {
        return Deno.statSync(`${theme.path}/${c}`).isFile;
      } catch {
        return false;
      }
    });
    assertEquals(found, "64x64/places/folder.svg");
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test("every program the code runs is allowed by the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
    commands: { name: string }[];
  };
  const code = await Deno.readTextFile(new URL("./system.ts", import.meta.url));
  const used = new Set<string>();
  for (const m of code.matchAll(/(?:exec|new Deno\.Command)\("([\w-]+)"/g)) used.add(m[1]);
  for (const m of code.matchAll(/first\(\[([^\]]+)\]/g)) for (const p of m[1].matchAll(/"([\w-]+)"/g)) used.add(p[1]);
  assert(used.size >= 10, [...used].join(" "));
  for (const p of used) assert(manifest.permissions.run.includes(p), `${p} is not in run`);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
