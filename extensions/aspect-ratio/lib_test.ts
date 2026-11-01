import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  complete,
  dim,
  fit,
  gcd,
  mpText,
  nearestRatio,
  parseQuery,
  ratioLabel,
  RATIOS,
  ratioText,
  reduce,
  reframe,
  RESOLUTIONS,
  sameRatio,
  scaled,
  screen,
} from "./lib.ts";
import { itemsFor } from "./ui.ts";

Deno.test("reduce and gcd", () => {
  assertEquals(gcd(1920, 1080), 120);
  assertEquals(reduce(1920, 1080), [16, 9]);
  assertEquals(reduce(1366, 768), [683, 384]);
  assertEquals(reduce(2.39, 1), [239, 100]);
  assertEquals(reduce(1, 1), [1, 1]);
});

Deno.test("ratio labels: exact, close and sold-as", () => {
  assertEquals(ratioLabel(1920, 1080), "16:9");
  assertEquals(ratioLabel(1366, 768), "≈ 16:9");
  assertEquals(ratioLabel(1080, 1920), "9:16");
  assertEquals(ratioLabel(1080, 1350), "4:5");
  assertEquals(ratioLabel(6000, 4000), "3:2");
  // 3440 × 1440 is really 2.39:1, but sold as 21:9.
  assertEquals(ratioLabel(3440, 1440), "≈ 21:9");
  assertEquals(ratioLabel(2048, 858), "≈ 2.39:1");
  assertEquals(ratioLabel(1000, 700), "10:7");
  assertEquals(ratioLabel(1234, 500), "2.47:1");
  const r = ratioText(1366, 768);
  assertEquals(r.exact, "683:384");
  assertEquals(r.common?.text, "16:9");
  assert(r.approximate);
  assertEquals(nearestRatio(5), undefined);
});

Deno.test("reference data is consistent", () => {
  const texts = RATIOS.map((r) => r.text);
  assertEquals(new Set(texts).size, texts.length);
  for (const r of RATIOS) {
    const [a, b] = r.text.split(":").map(Number);
    // 21:9 is marketing for 64:27.
    if (r.text !== "21:9") assertAlmostEquals(a / b, r.value, 1e-9, r.text);
  }
  for (const r of RESOLUTIONS) assert(r.width > 0 && r.height > 0 && r.name, r.name);
  assertEquals(sameRatio(16 / 9).map((r) => `${r.width}x${r.height}`).slice(0, 3), [
    "1280x720",
    "1366x768",
    "1600x900",
  ]);
});

Deno.test("dimensions: rounding and even", () => {
  assertEquals(dim(719.6), 720);
  assertEquals(dim(721, true), 722);
  assertEquals(dim(0.2), 1);
  assertEquals(complete(16 / 9, { width: 1280 }), { width: 1280, height: 720 });
  assertEquals(complete(16 / 9, { height: 720 }), { width: 1280, height: 720 });
  assertEquals(complete(16 / 9, { width: 1000 }), { width: 1000, height: 563 });
  assertEquals(complete(16 / 9, { width: 1000 }, true), { width: 1000, height: 562 });
  assertEquals(scaled({ width: 1920, height: 1080 }).map((s) => s.size.width), [480, 960, 1440, 2880, 3840]);
  assertEquals(mpText({ width: 1920, height: 1080 }), "2.07 MP");
  assertEquals(mpText({ width: 6000, height: 4000 }), "24.0 MP");
  assertEquals(mpText({ width: 100, height: 100 }), "10 K pixels");
});

Deno.test("reframe: crop and letterbox or pillarbox", () => {
  const wide = reframe({ width: 1920, height: 1080 }, 4 / 3);
  assertEquals(wide.crop, { width: 1440, height: 1080, cutX: 240, cutY: 0 });
  assertEquals(wide.pad, { width: 1920, height: 1440, barX: 0, barY: 180, kind: "letterbox" });
  const tall = reframe({ width: 1440, height: 1080 }, 16 / 9);
  assertEquals(tall.crop, { width: 1440, height: 810, cutX: 0, cutY: 135 });
  assertEquals(tall.pad, { width: 1920, height: 1080, barX: 240, barY: 0, kind: "pillarbox" });
  const vertical = reframe({ width: 1920, height: 1080 }, 9 / 16);
  assertEquals(vertical.crop.width, 608);
  assertEquals(vertical.crop.height, 1080);
  assertEquals(reframe({ width: 1920, height: 1080 }, 16 / 9).pad.kind, "none");
});

Deno.test("fit: contain and cover", () => {
  const f = fit({ width: 4000, height: 3000 }, { width: 1920, height: 1080 });
  assertEquals(f.contain, { width: 1440, height: 1080, scale: 0.36 });
  assertEquals(f.cover, { width: 1920, height: 1440, scale: 0.48, cutX: 0, cutY: 360 });
  const up = fit({ width: 640, height: 480 }, { width: 1280, height: 960 });
  assertEquals(up.contain.scale, 2);
  assertEquals(up.cover.cutX + up.cover.cutY, 0);
});

Deno.test("screen: density and physical size", () => {
  const s = screen({ width: 2560, height: 1440 }, 27);
  assertAlmostEquals(s.ppi, 108.79, 0.01);
  assertAlmostEquals(s.width, 23.53, 0.01);
  assertAlmostEquals(s.height, 13.24, 0.01);
  assertAlmostEquals(s.dotPitch, 0.2335, 0.0001);
  // One arcminute per pixel: about 3438 / PPI inches.
  assertAlmostEquals(s.retinaDistance, 3437.75 / s.ppi, 0.01);
  assertAlmostEquals(screen({ width: 3840, height: 2160 }, 27).ppi, 163.18, 0.01);
});

Deno.test("parsing: every kind of query", () => {
  assertEquals(parseQuery("").kind, "empty");
  assertEquals(parseQuery("1920x1080"), { kind: "size", size: { width: 1920, height: 1080 } });
  assertEquals(parseQuery("1920 × 1080"), { kind: "size", size: { width: 1920, height: 1080 } });
  assertEquals(parseQuery("1920 by 1080").kind, "size");
  assertEquals(parseQuery("16:9 1280"), { kind: "complete", ratio: 16 / 9, text: "16:9", given: { width: 1280 } });
  assertEquals(parseQuery("16:9 h720"), { kind: "complete", ratio: 16 / 9, text: "16:9", given: { height: 720 } });
  assertEquals(parseQuery("16/9 720p"), { kind: "complete", ratio: 16 / 9, text: "16:9", given: { height: 720 } });
  assertEquals(parseQuery("16:9 ? x 720"), { kind: "complete", ratio: 16 / 9, text: "16:9", given: { height: 720 } });
  assertEquals(parseQuery("16:9 1280x?"), { kind: "complete", ratio: 16 / 9, text: "16:9", given: { width: 1280 } });
  assertEquals(parseQuery("1920x1080 to 4:3"), {
    kind: "reframe",
    size: { width: 1920, height: 1080 },
    ratio: 4 / 3,
    text: "4:3",
  });
  assertEquals(parseQuery("1920x1080 to 2.39").kind, "reframe");
  assertEquals(parseQuery("1920x1080 to banana"), { kind: "error", message: "“banana” isn't a ratio" });
  assertEquals(parseQuery("fit 4000x3000 in 1920x1080"), {
    kind: "fit",
    size: { width: 4000, height: 3000 },
    box: { width: 1920, height: 1080 },
  });
  assertEquals(parseQuery('27" 2560x1440'), { kind: "screen", size: { width: 2560, height: 1440 }, diagonal: 27 });
  assertEquals(parseQuery("2560x1440 27in"), { kind: "screen", size: { width: 2560, height: 1440 }, diagonal: 27 });
  assertEquals(parseQuery("13,3 pouces 2560x1600").kind, "screen");
  assertEquals(parseQuery("21:9"), { kind: "ratio", ratio: 21 / 9, text: "21:9" });
  assertEquals(parseQuery("2.39"), { kind: "ratio", ratio: 2.39, text: "2.39:1" });
  const fhd = parseQuery("1080p");
  assert(fhd.kind === "named" && fhd.matches.length === 1 && fhd.matches[0].name === "Full HD");
  const k4 = parseQuery("4K");
  assert(k4.kind === "named" && k4.matches[0].width === 3840);
  assertEquals(parseQuery("0x5"), { kind: "error", message: "Width and height must be above zero" });
  assertEquals(parseQuery("hello").kind, "error");
});

Deno.test("items: each query kind gives actionable rows", () => {
  for (
    const q of [
      "",
      "1920x1080",
      "1366x768",
      "16:9 1280",
      "21:9",
      "1920x1080 to 4:3",
      "fit 4000x3000 in 1920x1080",
      '27" 2560x1440',
      "4k",
      "nope",
    ]
  ) {
    const items = itemsFor(parseQuery(q), false);
    assert(items.length > 0, q);
    const ids = items.map((i) => i.id);
    assertEquals(new Set(ids).size, ids.length, `duplicate ids for ${q}`);
  }
  const size = itemsFor(parseQuery("1920x1080"), false);
  assertEquals(size[0].title, "16:9");
  assert(size[0].subtitle?.includes("Full HD"));
  const crop = itemsFor(parseQuery("1920x1080 to 4:3"), false);
  assertEquals(crop[0].title, "1440 × 1080");
  assertEquals(crop[1].title, "1920 × 1440");
  const sc = itemsFor(parseQuery('27" 2560x1440'), false);
  assertEquals(sc[0].title, "109 PPI");
  const even = itemsFor(parseQuery("16:9 1000"), true);
  assertEquals(even[0].title, "1000 × 562");
});

Deno.test("manifest: no permission, command file exists", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions?: unknown;
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions, undefined);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
