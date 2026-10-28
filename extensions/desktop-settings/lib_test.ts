import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  CATEGORIES,
  commandLine,
  type Desktop,
  detectDesktop,
  GNOME_TOGGLES,
  isDarkScheme,
  isOn,
  panelsFor,
  parseGnomeVersion,
  TOPICS,
} from "./lib.ts";

const DESKTOPS: Desktop[] = ["gnome", "kde", "xfce", "cinnamon", "other"];

Deno.test("desktop detection from XDG_CURRENT_DESKTOP", () => {
  assertEquals(
    ["ubuntu:GNOME", "GNOME-Classic:GNOME", "KDE", "XFCE", "X-Cinnamon", "Budgie:GNOME", "sway", "Hyprland", ""].map(
      detectDesktop,
    ),
    ["gnome", "gnome", "kde", "xfce", "cinnamon", "gnome", "other", "other", "other"],
  );
});

Deno.test("every desktop has its panels, ids are unique, categories known", () => {
  for (const d of DESKTOPS) {
    const panels = panelsFor(d);
    assert(panels.length >= 6, d);
    assertEquals(new Set(panels.map((p) => p.id)).size, panels.length, `duplicate panel on ${d}`);
    for (const p of panels) {
      assert(CATEGORIES.includes(p.category), p.id);
      assert(p.commands.length > 0 && p.commands.every((c) => c.length > 0), p.id);
      assert(p.icon.startsWith("bs-"), p.id);
    }
  }
  assertEquals(panelsFor("gnome").find((p) => p.id === "accessibility")?.commands, [[
    "gnome-control-center",
    "universal-access",
  ]]);
  assertEquals(panelsFor("kde").find((p) => p.id === "display")?.commands[0], ["systemsettings", "kcm_kscreen"]);
  assertEquals(panelsFor("cinnamon").find((p) => p.id === "background")?.commands[0], [
    "cinnamon-settings",
    "backgrounds",
  ]);
});

Deno.test("GNOME 46 renamed About; GNOME panels join window managers when installed", () => {
  assertEquals(panelsFor("gnome", { gnomeVersion: 45 }).find((p) => p.id === "about")?.commands[0][1], "info-overview");
  assertEquals(panelsFor("gnome", { gnomeVersion: 46 }).find((p) => p.id === "about")?.commands[0][1], "system");
  const sway = panelsFor("other", { gnomeInstalled: true });
  assertEquals(sway.find((p) => p.id === "sound")?.commands[0], ["pavucontrol"]);
  assertEquals(sway.find((p) => p.id === "wifi")?.env, { XDG_CURRENT_DESKTOP: "GNOME" });
  assertEquals(panelsFor("other").some((p) => p.id === "wifi"), false);
  assertEquals(parseGnomeVersion("gnome-control-center 46.2\n"), 46);
  assertEquals(parseGnomeVersion(""), undefined);
});

Deno.test("French and English words find the right panel", () => {
  const find = (word: string) =>
    Object.entries(TOPICS).filter(([, t]) => t.keywords.some((k) => k.includes(word))).map(([id]) => id);
  assert(find("fond d'écran").includes("background"));
  assert(find("son").includes("sound"));
  assert(find("clavier").includes("keyboard"));
  assert(find("souris").includes("mouse"));
  assert(find("imprimante").includes("printers"));
  assert(find("wallpaper").includes("background"));
  assert(find("mode sombre").includes("appearance"));
  for (const [id, t] of Object.entries(TOPICS)) assert(t.keywords.length >= 2, id);
});

Deno.test("every program the tables run is allowed by the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { run: string[] };
  };
  const allowed = new Set(manifest.permissions.run);
  for (const d of DESKTOPS) {
    for (const p of panelsFor(d, { gnomeInstalled: true })) {
      for (const [program] of p.commands) assert(allowed.has(program), `${program} (${d}/${p.id}) is not in run`);
    }
  }
});

Deno.test("toggles", () => {
  const dark = GNOME_TOGGLES.find((t) => t.id === "dark")!;
  assertEquals(isOn(dark, "'prefer-dark'\n"), true);
  assertEquals(isOn(dark, "'default'"), false);
  assertEquals(isOn(GNOME_TOGGLES.find((t) => t.id === "night-light")!, "true"), true);
  assertEquals([isDarkScheme("BreezeDark"), isDarkScheme("BreezeLight"), isDarkScheme("")], [true, false, false]);
  assertEquals(commandLine(["systemsettings", "kcm_kscreen"]), "systemsettings kcm_kscreen");
  assertEquals(commandLine(["xfce4-panel", "--preferences"]), "xfce4-panel --preferences");
});
