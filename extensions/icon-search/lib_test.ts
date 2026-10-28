import { assert, assertEquals } from "@std/assert";
import LUCIDE from "./testdata/lucide-tags.json" with { type: "json" };
import TABLER from "./testdata/tabler-icons.json" with { type: "json" };
import SIMPLE from "./testdata/simple-icons.json" with { type: "json" };
import { HEROICONS } from "./heroicons.ts";
import {
  cleanSvg,
  dataUri,
  displayColor,
  fileUrl,
  type Icon,
  luminance,
  materialHtml,
  pageUrl,
  parseHeroicons,
  parseLucide,
  parseMaterial,
  parsePhosphor,
  parseSimple,
  parseTabler,
  pascal,
  react,
  score,
  search,
  setOf,
  svgPath,
  titleToSlug,
  variants,
  viewSvg,
} from "./lib.ts";

// Excerpts of the real index files (lucide-static 1.63, @tabler/icons 3.50, simple-icons 16.36,
// @phosphor-icons/core 2.1.1, material-symbols 0.48.2).
const dir = new URL("./testdata/", import.meta.url);
const PHOSPHOR = Deno.readTextFileSync(new URL("phosphor.mjs.txt", dir));
const MATERIAL = Deno.readTextFileSync(new URL("material.d.ts.txt", dir));

Deno.test("parses each set's index", () => {
  const lucide = parseLucide(LUCIDE);
  assertEquals(lucide[0].name, "camera");
  assertEquals(lucide[0].set, "lucide");
  assert(lucide[0].tags.includes("photo"));
  assertEquals(lucide.length, 4);
  const tabler = parseTabler(TABLER);
  const cam = tabler.find((i) => i.name === "camera")!;
  assertEquals(cam.category, "Media");
  assertEquals(cam.filled, true);
  assert(cam.tags.includes("photo"));
  assertEquals(tabler.find((i) => i.name === "a-b-2")?.filled, undefined);

  const simple = parseSimple(SIMPLE);
  const gh = simple.find((i) => i.name === "github")!;
  assertEquals(gh.title, "GitHub");
  assertEquals(gh.hex, "#181717");
  assert(simple.find((i) => i.name === "dotnet"));
  const loc = simple.find((i) => i.name === "afdian")!;
  assert(loc.tags.length > 0); // localized names become tags

  const phosphor = parsePhosphor(PHOSPHOR);
  assertEquals(phosphor.map((i) => i.name), ["acorn", "camera"]);
  assertEquals(phosphor[1], {
    set: "phosphor",
    name: "camera",
    pascal: "Camera",
    tags: ["photography", "pictures", "lens"],
    category: "media",
  });
  assertEquals(phosphor[0].category, "finances");
  assert(!phosphor[0].tags.includes("*new*"));

  const material = parseMaterial(MATERIAL);
  assert(material.some((i) => i.name === "photo_camera"));
  assertEquals(material.find((i) => i.name === "zoom_out_map")?.tags, ["zoom", "out", "map"]);
  assertEquals(material[0].name, "123");

  const hero = parseHeroicons(HEROICONS);
  assertEquals(hero.length, 324);
  assert(hero.some((i) => i.name === "academic-cap"));
});

Deno.test("simple icons slugs", () => {
  assertEquals(titleToSlug("Next.js"), "nextdotjs");
  assertEquals(titleToSlug(".NET"), "dotnet");
  assertEquals(titleToSlug("C++"), "cplusplus");
  assertEquals(titleToSlug("Ableton Live"), "abletonlive");
  assertEquals(titleToSlug("Citroën"), "citroen");
});

const icon = (set: Icon["set"], name: string, extra: Partial<Icon> = {}): Icon => ({ set, name, tags: [], ...extra });

Deno.test("files and variants", () => {
  assertEquals(svgPath(icon("lucide", "camera")), "icons/camera.svg");
  assertEquals(svgPath(icon("material", "photo_camera")), "outlined/photo_camera.svg");
  assertEquals(svgPath(icon("heroicons", "camera")), "24/outline/camera.svg");
  assertEquals(svgPath(icon("phosphor", "camera")), "assets/regular/camera.svg");
  assertEquals(
    fileUrl(setOf("tabler")!, svgPath(icon("tabler", "camera"))),
    "https://cdn.jsdelivr.net/npm/@tabler/icons@latest/icons/outline/camera.svg",
  );
  assertEquals(variants(icon("phosphor", "camera")).map(([, p]) => p), [
    "assets/thin/camera-thin.svg",
    "assets/light/camera-light.svg",
    "assets/regular/camera.svg",
    "assets/bold/camera-bold.svg",
    "assets/fill/camera-fill.svg",
    "assets/duotone/camera-duotone.svg",
  ]);
  assertEquals(variants(icon("tabler", "a-b-2")).length, 1);
  assertEquals(variants(icon("tabler", "camera", { filled: true }))[1], ["Filled", "icons/filled/camera.svg"]);
  assertEquals(variants(icon("material", "home"))[1], ["Outlined, Filled", "outlined/home-fill.svg"]);
});

Deno.test("React names", () => {
  assertEquals(pascal("arrow-down-0-1"), "ArrowDown01");
  assertEquals(pascal("photo_camera"), "PhotoCamera");
  assertEquals(react(icon("lucide", "camera-off"))?.importLine, 'import { CameraOff } from "lucide-react";');
  assertEquals(react(icon("tabler", "brand-github"))?.component, "IconBrandGithub");
  assertEquals(react(icon("heroicons", "academic-cap"))?.component, "AcademicCapIcon");
  assertEquals(react(icon("phosphor", "github-logo", { pascal: "GithubLogo" }))?.component, "GithubLogo");
  assertEquals(
    react(icon("simple", "nextdotjs"))?.importLine,
    'import { SiNextdotjs } from "@icons-pack/react-simple-icons";',
  );
  assertEquals(react(icon("material", "home")), undefined);
  assertEquals(materialHtml("home"), '<span class="material-symbols-outlined">home</span>');
});

Deno.test("pages", () => {
  assertEquals(pageUrl(icon("lucide", "camera")), "https://lucide.dev/icons/camera");
  assertEquals(pageUrl(icon("tabler", "camera")), "https://tabler.io/icons/icon/camera");
  assertEquals(
    pageUrl(icon("material", "photo_camera")),
    "https://fonts.google.com/icons?selected=Material+Symbols+Outlined:photo_camera",
  );
});

Deno.test("view SVGs are recolored and sized", () => {
  const lucide =
    `<!-- @license lucide-static v1.63.0 - ISC -->\n<svg\n  class="lucide"\n  xmlns="http://www.w3.org/2000/svg"\n  width="24"\n  height="24"\n  viewBox="0 0 24 24"\n  fill="none"\n  stroke="currentColor"\n>\n  <circle cx="12" cy="13" r="3" />\n</svg>`;
  const v = viewSvg(lucide, "#8e8e96");
  assert(!v.includes("<!--"));
  assert(v.includes('stroke="#8e8e96"'));
  assert(v.includes('fill="none"'));
  assert(v.includes('width="256" height="256"'));
  assert(!v.includes('width="24"'));
  // Material and Simple Icons have no fill: black by default, invisible on a dark theme.
  const material =
    `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 -960 960 960"><path d="M0 0"/></svg>`;
  assertEquals(
    viewSvg(material, "#123456", 96),
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="#123456" width="96" height="96"><path d="M0 0"/></svg>`,
  );
  assertEquals(cleanSvg(`<?xml version="1.0"?>\n<svg/>`), "<svg/>");
});

Deno.test("brand colors stay visible", () => {
  assert(luminance("#000000") < 0.01 && luminance("#ffffff") > 0.99);
  assertEquals(displayColor(icon("simple", "github", { hex: "#181717" })), "#8e8e96");
  assertEquals(displayColor(icon("simple", "dotnet", { hex: "#512bd4" })), "#512bd4");
  assertEquals(displayColor(icon("lucide", "camera")), "#8e8e96");
});

Deno.test("data URI", () => {
  assertEquals(dataUri("<svg>é</svg>"), "data:image/svg+xml;base64,PHN2Zz7DqTwvc3ZnPg==");
});

Deno.test("search ranks names before tags", () => {
  const icons = [
    icon("lucide", "camera-off"),
    icon("lucide", "webcam", { tags: ["camera", "video"] }),
    icon("lucide", "camera"),
    icon("material", "photo_camera"),
    icon("simple", "github", { title: "GitHub" }),
    icon("lucide", "switch-camera"),
  ];
  assertEquals(search(icons, "camera", 10).map((i) => i.name), [
    "camera",
    "camera-off",
    "photo_camera",
    "switch-camera",
    "webcam",
  ]);
  assertEquals(search(icons, "photo camera", 1)[0].name, "photo_camera");
  assertEquals(search(icons, "GitHub", 1)[0].name, "github");
  assertEquals(score(icon("lucide", "zap"), "camera"), 0);
  assertEquals(search(icons, "", 2).length, 2);
});
