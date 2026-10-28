import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import {
  BLACK,
  contrast,
  describeName,
  detectSession,
  exactName,
  formats,
  hslToRgb,
  luminance,
  mergeHistory,
  NAMED,
  nearestName,
  oklchToRgb,
  parseColor,
  parsePicks,
  pickCommand,
  pickerCandidates,
  pickerInstall,
  pickScript,
  prettyName,
  type RGB,
  rgbToHsl,
  rgbToHsv,
  rgbToOklch,
  swatch,
  systemdRunArgs,
  toFloats,
  toHex,
  toHsl,
  toHsv,
  toHwb,
  toOklch,
  toRgb,
  wcag,
  WHITE,
} from "./lib.ts";

const rgb = (r: number, g: number, b: number, a = 1): RGB => ({ r, g, b, a });
const hexOf = (s: string) => {
  const c = parseColor(s);
  return c && toHex(c);
};

Deno.test("hex", () => {
  assertEquals(parseColor("#ff6347"), rgb(255, 99, 71));
  assertEquals(parseColor("FF6347"), rgb(255, 99, 71));
  assertEquals(parseColor("0xff6347"), rgb(255, 99, 71));
  assertEquals(parseColor("#f63"), rgb(255, 102, 51));
  assertEquals(parseColor("#f638")?.a, 0.533);
  assertEquals(parseColor("#ff634780")?.a, 0.502);
  assertEquals(parseColor(" #FF6347; "), rgb(255, 99, 71));
  assertEquals(parseColor("fff"), undefined); // bare 3 digits: ambiguous
  assertEquals(parseColor("#ff634"), undefined);
  assertEquals(parseColor("#gggggg"), undefined);
});

Deno.test("rgb()", () => {
  assertEquals(hexOf("rgb(255, 99, 71)"), "#ff6347");
  assertEquals(hexOf("rgb(255 99 71)"), "#ff6347");
  assertEquals(hexOf("RGB(100%, 0%, 0%)"), "#ff0000");
  assertEquals(hexOf("255, 99, 71"), "#ff6347");
  assertEquals(hexOf("255 99 71"), "#ff6347");
  assertEquals(parseColor("rgba(255, 99, 71, 0.5)")?.a, 0.5);
  assertEquals(parseColor("rgb(255 99 71 / 25%)")?.a, 0.25);
  assertEquals(hexOf("rgb(300, -5, 71)"), "#ff0047"); // clamped
  assertEquals(parseColor("rgb(1, 2)"), undefined);
  assertEquals(parseColor("rgb(a, b, c)"), undefined);
});

Deno.test("hsl(), hsv(), hwb()", () => {
  assertEquals(hexOf("hsl(9, 100%, 64%)"), "#ff6347");
  assertEquals(hexOf("hsl(0 100% 50%)"), "#ff0000");
  assertEquals(hexOf("hsl(120deg 100% 25%)"), "#008000");
  assertEquals(hexOf("hsl(0.5turn, 100%, 50%)"), "#00ffff");
  assertEquals(hexOf("hsl(3.14159rad 100% 50%)"), "#00ffff");
  assertEquals(hexOf("hsl(-120, 100%, 50%)"), "#0000ff");
  assertEquals(hexOf("hsl(270 50 40)"), "#663399"); // bare numbers as percentages
  assertEquals(parseColor("hsla(0, 0%, 0%, .3)")?.a, 0.3);
  assertEquals(hexOf("hsv(9, 72%, 100%)"), "#ff6347");
  assertEquals(hexOf("hsb(0 0% 100%)"), "#ffffff");
  assertEquals(hexOf("hwb(9 28% 0%)"), "#ff6347");
  assertEquals(hexOf("hwb(0 60% 60%)"), "#808080"); // w + b > 1: gray
});

Deno.test("oklch() and oklab()", () => {
  assertEquals(hexOf("oklch(62.8% 0.2577 29.23)"), "#ff0000");
  assertEquals(hexOf("oklch(0.628 0.2577 29.23)"), "#ff0000");
  assertEquals(hexOf("oklch(100% 0 0)"), "#ffffff");
  assertEquals(hexOf("oklch(0% 0 none)"), "#000000");
  assertEquals(hexOf("oklch(69.6% 0.196 32.3)"), "#ff6347");
  assertEquals(hexOf("oklch(70% 49% 32)"), hexOf("oklch(70% 0.196 32)"));
  assertEquals(hexOf("oklab(62.8% 0.2249 0.1258)"), "#ff0000");
  assertEquals(hexOf("oklch(90% 0.4 140)")?.length, 7); // out of gamut: clipped
});

Deno.test("names", () => {
  assertEquals(Object.keys(NAMED).length, 148);
  assertEquals(hexOf("tomato"), "#ff6347");
  assertEquals(hexOf("RebeccaPurple"), "#663399");
  assertEquals(hexOf("light blue"), "#add8e6");
  assertEquals(hexOf("rouge"), "#ff0000");
  assertEquals(hexOf("bleu marine"), "#000080");
  assertEquals(parseColor("transparent")?.a, 0);
  assertEquals(parseColor("notacolor"), undefined);
  assertEquals(exactName(rgb(255, 99, 71)), "tomato");
  assertEquals(exactName(rgb(128, 128, 128)), "gray");
  assertEquals(exactName(rgb(0, 255, 255)), "aqua");
  assertEquals(exactName(rgb(255, 99, 72)), undefined);
  assertEquals(nearestName(rgb(254, 100, 70)).name, "tomato");
  assertEquals(describeName(rgb(255, 99, 71)), "Tomato");
  assertEquals(describeName(rgb(250, 100, 72)), "≈ Tomato");
  assertEquals(
    ["lightgoldenrodyellow", "cornflowerblue", "darkslategray", "rebeccapurple", "palevioletred", "whitesmoke"].map(
      prettyName,
    ),
    [
      "Light Goldenrod Yellow",
      "Cornflower Blue",
      "Dark Slate Gray",
      "Rebecca Purple",
      "Pale Violet Red",
      "White Smoke",
    ],
  );
});

Deno.test("conversions round-trip", () => {
  const samples = ["#ff6347", "#663399", "#000000", "#ffffff", "#1e90ff", "#7fff00", "#808080", "#c71585", "#0a0b0c"];
  for (const hex of samples) {
    const c = parseColor(hex)!;
    for (const written of [toRgb(c), toHsl(c), toHsv(c), toHwb(c), toOklch(c)]) {
      const back = parseColor(written);
      assert(back, `${written} should parse`);
      const err = Math.max(Math.abs(back.r - c.r), Math.abs(back.g - c.g), Math.abs(back.b - c.b));
      // HSL/HSV are rounded to whole percents: up to ~1.3 % of 255.
      assert(err <= 3.5, `${hex} → ${written} → ${toHex(back)} (off by ${err.toFixed(2)})`);
    }
  }
  const red = rgbToOklch(rgb(255, 0, 0));
  assertAlmostEquals(red.l, 0.628, 0.001);
  assertAlmostEquals(red.c, 0.2577, 0.001);
  assertAlmostEquals(red.h, 29.23, 0.05);
  assertEquals(rgbToOklch(rgb(128, 128, 128)).h, 0);
  assertAlmostEquals(rgbToOklch(WHITE).l, 1, 1e-4);
  assertEquals(rgbToHsl(rgb(255, 255, 255)), { h: 0, s: 0, l: 1 });
  assertEquals(rgbToHsv(rgb(0, 0, 0)), { h: 0, s: 0, v: 0 });
  assertEquals(toHex(hslToRgb(210, 1, 0.56)), "#1f8fff");
  assertEquals(toHex(oklchToRgb({ l: 0.5, c: 0, h: 0 })), "#636363");
});

Deno.test("formats", () => {
  const tomato = rgb(255, 99, 71);
  assertEquals(formats(tomato).map((f) => [f.title, f.value]), [
    ["HEX", "#ff6347"],
    ["RGB", "rgb(255, 99, 71)"],
    ["HSL", "hsl(9, 100%, 64%)"],
    ["OKLCH", "oklch(69.6% 0.196 32.3)"],
    ["HSV", "hsv(9, 72%, 100%)"],
    ["HWB", "hwb(9 28% 0%)"],
    ["RGB 0–1", "1.000, 0.388, 0.278"],
    ["CSS Name", "tomato"],
  ]);
  assertEquals(formats(tomato, { upper: true })[0].value, "#FF6347");
  const half = rgb(255, 99, 71, 0.5);
  assertEquals(toHex(half), "#ff634780");
  assertEquals(toRgb(half), "rgba(255, 99, 71, 0.5)");
  assertEquals(toHsl(half), "hsla(9, 100%, 64%, 0.5)");
  assertEquals(toOklch(half), "oklch(69.6% 0.196 32.3 / 0.5)");
  assertEquals(toOklch(rgb(128, 128, 128)), "oklch(60% 0 0)");
  assertEquals(toHsl(rgb(255, 0, 1)), "hsl(0, 100%, 50%)"); // 359.8° rounds to 0, not 360
  assertEquals(toFloats(BLACK), "0.000, 0.000, 0.000");
  assertEquals(formats(half).some((f) => f.id === "name"), false);
  assertEquals(swatch(half), "color:#ff6347");
});

Deno.test("contrast", () => {
  assertAlmostEquals(luminance(WHITE), 1, 1e-9);
  assertEquals(luminance(BLACK), 0);
  assertAlmostEquals(contrast(WHITE, BLACK), 21, 1e-9);
  assertAlmostEquals(contrast(rgb(118, 118, 118), WHITE), 4.54, 0.01);
  assertEquals([wcag(21), wcag(4.54), wcag(3.2), wcag(1.5)], ["AAA", "AA", "AA Large", "Fail"]);
});

Deno.test("history", () => {
  const picks = parsePicks("#FF6347 1761645600\ngarbage\n#663399 1761645700\n\n");
  assertEquals(picks, [{ hex: "#ff6347", at: 1761645600000 }, { hex: "#663399", at: 1761645700000 }]);
  const merged = mergeHistory([{ hex: "#ff6347", at: 1000 }, { hex: "#000000", at: 500 }], picks);
  assertEquals(merged.map((p) => p.hex), ["#663399", "#ff6347", "#000000"]);
  assertEquals(merged[1].at, 1761645600000);
  assertEquals(mergeHistory([], picks, 1).length, 1);
});

Deno.test("pickers and scripts", () => {
  assertEquals(pickerCandidates(detectSession({ XDG_SESSION_TYPE: "wayland", XDG_CURRENT_DESKTOP: "GNOME" })), [
    "portal",
  ]);
  assertEquals(pickerCandidates(detectSession({ WAYLAND_DISPLAY: "w", HYPRLAND_INSTANCE_SIGNATURE: "x" })), [
    "hyprpicker",
    "grim",
    "portal",
  ]);
  assertEquals(pickerCandidates(detectSession({ XDG_SESSION_TYPE: "x11" })), ["xcolor", "gpick", "portal"]);
  assert(pickCommand("grim").includes(`grim -g "$point" -t ppm - | tail -c 3 | od -An -tx1`));
  assert(pickCommand("portal").includes("org.freedesktop.portal.Screenshot.PickColor"));
  const script = pickScript({
    tool: "hyprpicker",
    log: "/home/ada/.cache/backslash/color-picker/picks",
    wayland: true,
    upper: true,
  });
  assert(script.startsWith("sleep 0.3\ncolor=$(hyprpicker -f hex"));
  assert(script.includes(`>> '/home/ada/.cache/backslash/color-picker/picks'`));
  assert(script.includes(`text=$(printf '%s' "$color" | tr 'a-f' 'A-F')`));
  assertEquals(systemdRunArgs("u", "s", { DISPLAY: ":0" }).slice(-4), ["--setenv=DISPLAY=:0", "/bin/sh", "-c", "s"]);
  assertEquals(
    pickerInstall({ wayland: true, desktop: "gnome" }, "fedora"),
    "sudo dnf install xdg-desktop-portal-gnome",
  );
  assertEquals(pickerInstall({ wayland: false, desktop: "other" }, "debian"), "sudo apt install gpick");
});

Deno.test("every generated script is valid sh", async () => {
  for (const tool of ["hyprpicker", "grim", "gpick", "xcolor", "portal"] as const) {
    for (const upper of [true, false]) {
      const script = pickScript({ tool, log: "/h/it's/picks", wayland: !upper, upper });
      const { success, stderr } = await new Deno.Command("sh", { args: ["-n", "-c", script], stderr: "piped" })
        .output();
      assert(success, new TextDecoder().decode(stderr));
    }
  }
});
