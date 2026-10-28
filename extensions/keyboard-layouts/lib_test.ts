import { assertEquals } from "@std/assert";
import {
  candidates,
  codeOfName,
  displayTag,
  engineName,
  fcitxLayouts,
  gnomeLayouts,
  gnomeSourcesValue,
  hyprLayouts,
  kdeLayouts,
  layoutName,
  nextLayout,
  parseFcitxProfile,
  parseGnomeSources,
  parseIbusEngines,
  parseSetxkbmap,
  parseStringList,
  parseXkbList,
  setxkbmapArgs,
  splitLayout,
  swayLayouts,
  tag,
  x11Layouts,
  xkbSwitchName,
} from "./lib.ts";

// An excerpt of /usr/share/X11/xkb/rules/evdev.lst (xkeyboard-config 2.41).
const LST = `! model
  pc105           Generic 105-key PC

! layout
  us              English (US)
  fr              French
  de              German
  ru              Russian

! variant
  intl            us: English (US, intl., with dead keys)
  azerty          fr: French (AZERTY)
  bepo            fr: French (BEPO)
  neo             de: German (Neo 2)

! option
  grp                  Switching to another layout
`;
const NAMES = parseXkbList(LST);

Deno.test("xkb names", () => {
  assertEquals(layoutName(NAMES, "fr"), "French");
  assertEquals(layoutName(NAMES, "fr", "azerty"), "French (AZERTY)");
  assertEquals(layoutName(NAMES, "xx", "yy"), "XX (yy)");
  assertEquals(codeOfName(NAMES, "French (BEPO)"), { code: "fr", variant: "bepo" });
  assertEquals(codeOfName(NAMES, "Russian"), { code: "ru" });
  assertEquals(NAMES.layouts.has("pc105"), false);
});

Deno.test("layout specs and tags", () => {
  assertEquals(splitLayout("fr+azerty"), { code: "fr", variant: "azerty" });
  assertEquals(splitLayout("fr(bepo)"), { code: "fr", variant: "bepo" });
  assertEquals(splitLayout("us"), { code: "us" });
  assertEquals(tag({ kind: "xkb", code: "fr" }), "FR");
  assertEquals(tag({ kind: "xkb", code: "us", variant: "intl" }), "US·INTL");
  assertEquals(tag({ kind: "xkb", code: "us", variant: "alt-intl" }), "US·ALT");
  assertEquals(tag({ kind: "ibus", code: "anthy" }), "IBus");
  assertEquals(
    xkbSwitchName({ key: "1", kind: "xkb", code: "fr", variant: "azerty", name: "", active: false }),
    "fr(azerty)",
  );
});

Deno.test("backends tried", () => {
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "ubuntu:GNOME", WAYLAND_DISPLAY: "wayland-0" }), ["gnome"]);
  assertEquals(candidates({ XDG_CURRENT_DESKTOP: "KDE", XDG_SESSION_TYPE: "x11", DISPLAY: ":0" }), ["kde", "x11"]);
  assertEquals(candidates({ HYPRLAND_INSTANCE_SIGNATURE: "x", WAYLAND_DISPLAY: "w" }), ["hyprland"]);
  assertEquals(candidates({ DISPLAY: ":0" }), ["x11"]);
});

Deno.test("gnome input sources, current from mru-sources", () => {
  const sources = "[('xkb', 'us'), ('xkb', 'fr+azerty'), ('ibus', 'mozc-jp')]";
  const mru = "[('xkb', 'de'), ('xkb', 'fr+azerty'), ('xkb', 'us')]";
  const ls = gnomeLayouts(sources, mru, NAMES, new Map([["mozc-jp", "Mozc"]]));
  assertEquals(ls.map((l) => [l.key, l.kind, l.code, l.variant, l.name, l.active]), [
    ["0", "xkb", "us", undefined, "English (US)", false],
    ["1", "xkb", "fr", "azerty", "French (AZERTY)", true],
    ["2", "ibus", "mozc-jp", undefined, "Mozc", false],
  ]);
  assertEquals(gnomeLayouts(sources, "@a(ss) []", NAMES)[0].active, true);
  assertEquals(parseGnomeSources("@a(ss) []"), []);
  assertEquals(gnomeSourcesValue([["xkb", "us"], ["ibus", "anthy"]]), "[('xkb', 'us'), ('ibus', 'anthy')]");
  assertEquals(gnomeSourcesValue([]), "@a(ss) []");
});

Deno.test("kde layouts over gdbus", () => {
  const ls = kdeLayouts("([('us', '', 'English (US)'), ('fr', 'azerty', 'French (AZERTY)')],)", "(uint32 1,)");
  assertEquals(ls.map((l) => [l.code, l.variant, l.name, l.active]), [
    ["us", undefined, "English (US)", false],
    ["fr", "azerty", "French (AZERTY)", true],
  ]);
});

Deno.test("hyprland main keyboard", () => {
  const json = JSON.stringify({
    mice: [],
    keyboards: [
      { name: "power-button", layout: "us", variant: "", active_keymap: "English (US)", main: false },
      {
        name: "at-translated-set-2-keyboard",
        layout: "us,fr",
        variant: ",azerty",
        active_keymap: "French (AZERTY)",
        main: true,
      },
      { name: "keychron-k2", layout: "us,fr", variant: ",azerty", active_keymap: "French (AZERTY)", main: false },
    ],
  });
  const { layouts, keyboards } = hyprLayouts(json, NAMES);
  assertEquals(layouts.map((l) => [l.code, l.variant, l.active]), [["us", undefined, false], ["fr", "azerty", true]]);
  assertEquals(keyboards, ["at-translated-set-2-keyboard", "keychron-k2"]);
  const indexed = hyprLayouts(
    JSON.stringify({
      keyboards: [{ name: "kb", layout: "us,de", variant: "", active_keymap: "x", main: true, active_layout_index: 1 }],
    }),
    NAMES,
  );
  assertEquals(indexed.layouts.map((l) => l.active), [false, true]);
});

Deno.test("sway inputs", () => {
  const json = JSON.stringify([
    { identifier: "1:1:mouse", type: "pointer" },
    { identifier: "power", type: "keyboard", xkb_layout_names: ["English (US)"], xkb_active_layout_index: 0 },
    {
      identifier: "1:1:AT_Translated_Set_2_keyboard",
      type: "keyboard",
      xkb_layout_names: ["English (US)", "French (BEPO)"],
      xkb_active_layout_index: 1,
    },
  ]);
  assertEquals(swayLayouts(json, NAMES).map((l) => [l.key, l.code, l.variant, l.active]), [
    ["0", "us", undefined, false],
    ["1", "fr", "bepo", true],
  ]);
});

Deno.test("x11 setxkbmap and xkb-switch", () => {
  const q = parseSetxkbmap(
    "rules:      evdev\nmodel:      pc105\nlayout:     us,fr,de\nvariant:    ,azerty,\noptions:    grp:alt_shift_toggle\n",
  );
  assertEquals(q, { layouts: ["us", "fr", "de"], variants: ["", "azerty", ""], options: "grp:alt_shift_toggle" });
  assertEquals(x11Layouts(q, "fr(azerty)", NAMES).map((l) => l.active), [false, true, false]);
  assertEquals(x11Layouts(q, undefined, NAMES).map((l) => l.active), [true, false, false]);
  assertEquals(setxkbmapArgs(q, 1), ["-layout", "fr,us,de", "-variant", "azerty,,"]);
  assertEquals(setxkbmapArgs(parseSetxkbmap("layout: us,ru\n"), 1), ["-layout", "ru,us"]);
});

Deno.test("input methods", () => {
  const profile = `[Groups/0]
Name=Default
Default Layout=us
DefaultIM=mozc

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=keyboard-fr-azerty
Layout=

[Groups/0/Items/2]
Name=mozc
Layout=

[GroupOrder]
0=Default
`;
  const items = parseFcitxProfile(profile);
  assertEquals(items.map((i) => i.name), ["keyboard-us", "keyboard-fr-azerty", "mozc"]);
  const ls = fcitxLayouts(items, "mozc", NAMES);
  assertEquals(ls.map((l) => [l.code, l.variant, l.name, l.active]), [
    ["us", undefined, "English (US)", false],
    ["fr", "azerty", "French (AZERTY)", false],
    ["mozc", undefined, "Mozc", true],
  ]);
  assertEquals(displayTag(ls[1]), "FR·AZERTY");
  assertEquals(displayTag(ls[2]), "Fcitx");
  assertEquals(parseStringList("['xkb:us::eng', 'anthy']"), ["xkb:us::eng", "anthy"]);
  assertEquals(parseIbusEngines("language: Japanese\n  anthy - Anthy\n  mozc-jp - Mozc\n").get("mozc-jp"), "Mozc");
  assertEquals(engineName("libpinyin"), "Intelligent Pinyin");
});

Deno.test("next layout cycles", () => {
  const ls = [{ active: false, n: 1 }, { active: true, n: 2 }, { active: false, n: 3 }];
  assertEquals(nextLayout(ls)?.n, 3);
  assertEquals(nextLayout([{ active: false, n: 1 }, { active: true, n: 2 }])?.n, 1);
  assertEquals(nextLayout([{ active: true }]), undefined);
});
