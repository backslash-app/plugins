import { assert, assertEquals } from "@std/assert";
import data from "./utilities.json" with { type: "json" };
import { DOCS } from "./docs.ts";
import {
  colorHex,
  type Data,
  declarations,
  docFor,
  expand,
  index,
  normalizeQuery,
  oklchToRgb,
  palette,
  parseOklch,
  px,
  resolve,
  rule,
  search,
  selector,
  summary,
  telling,
  themeVars,
} from "./lib.ts";

const DATA = data as Data;
const THEME = new Map(DATA.theme);
const ALL = expand(DATA);
const byClass = new Map(ALL.map((u) => [u.cls, u]));
const u = (cls: string) => byClass.get(cls)!;

Deno.test("the index has the core utilities with Tailwind's own CSS", () => {
  assertEquals(u("p-4").css, "padding: calc(var(--spacing) * 4);");
  assertEquals(u("flex").css, "display: flex;");
  assertEquals(u("bg-red-500").css, "background-color: var(--color-red-500);");
  assertEquals(u("w-1/2").css, "width: calc(1 / 2 * 100%);");
  assertEquals(u("rounded-lg").css, "border-radius: var(--radius-lg);");
  assertEquals(u("grid-cols-3").css, "grid-template-columns: repeat(3, minmax(0, 1fr));");
  for (const cls of ["sr-only", "container", "truncate", "space-x-4", "shadow-md", "ring-2", "text-lg", "mx-auto"]) {
    assert(byClass.has(cls), cls);
  }
  assert(!byClass.has("font-red-500"));
  assert(ALL.length > 10000);
});

Deno.test("rules get their selector back", () => {
  assertEquals(rule(u("p-4")), ".p-4 {\n  padding: calc(var(--spacing) * 4);\n}");
  assertEquals(rule(u("w-1/2")), ".w-1\\/2 {\n  width: calc(1 / 2 * 100%);\n}");
  assert(rule(u("space-x-4")).startsWith(":where(.space-x-4 > :not(:last-child)) {"));
  assertEquals(selector("inset-1/3"), ".inset-1\\/3");
});

Deno.test("declarations skip nested blocks", () => {
  assertEquals(declarations(u("container").css), [["width", "100%"]]);
  assertEquals(declarations(u("space-x-4").css)[0], ["--tw-space-x-reverse", "0"]);
  assertEquals(telling(u("blur-sm").css), [["--tw-blur", "blur(var(--blur-sm))"]]);
  assertEquals(telling(u("shadow-md").css)[0][0], "--tw-shadow");
});

Deno.test("resolves theme variables and calc()", () => {
  assertEquals(resolve("calc(var(--spacing) * 4)", THEME), "1rem");
  assertEquals(resolve("calc(var(--spacing) * 0.5)", THEME), "0.125rem");
  assertEquals(resolve("calc(1 / 2 * 100%)", THEME), "50%");
  assertEquals(resolve("var(--text-lg--line-height)", THEME), "1.5556");
  assertEquals(resolve("var(--radius-lg)", THEME), "0.5rem");
  assertEquals(resolve("var(--tw-leading, var(--text-lg--line-height))", THEME), "var(--tw-leading, 1.5556)");
  assertEquals(px("1rem"), "16px");
  assertEquals(px("0.125rem"), "2px");
  assertEquals(px("50%"), undefined);
  assertEquals(themeVars(u("text-lg").css, THEME), [["--text-lg", "1.125rem"], [
    "--text-lg--line-height",
    "calc(1.75 / 1.125)",
  ]]);
});

Deno.test("summaries", () => {
  assertEquals(summary(u("p-4"), THEME), { text: "padding: 1rem", px: "16px" });
  assertEquals(summary(u("text-lg"), THEME).text, "font-size: 1.125rem (+1)");
  assertEquals(summary(u("blur-sm"), THEME).text, "--tw-blur: blur(8px)");
});

Deno.test("docs pages", () => {
  const slug = (cls: string) => docFor(u(cls))?.slug;
  assertEquals(slug("p-4"), "padding");
  assertEquals(slug("px-2"), "padding");
  assertEquals(slug("mt-4"), "margin");
  assertEquals(slug("space-y-2"), "margin");
  assertEquals(slug("bg-red-500"), "background-color");
  assertEquals(slug("text-red-500"), "color");
  assertEquals(slug("text-lg"), "font-size");
  assertEquals(slug("font-bold"), "font-weight");
  assertEquals(slug("rounded-t-lg"), "border-radius");
  assertEquals(slug("border-x-2"), "border-width");
  assertEquals(slug("shadow-md"), "box-shadow");
  assertEquals(slug("ring-2"), "box-shadow");
  assertEquals(slug("inset-0"), "top-right-bottom-left");
  assertEquals(slug("inset-shadow-sm"), "box-shadow");
  assertEquals(slug("blur-sm"), "filter-blur");
  assertEquals(slug("backdrop-blur-sm"), "backdrop-filter-blur");
  assertEquals(slug("translate-x-4"), "translate");
  assertEquals(slug("col-span-2"), "grid-column");
  assertEquals(slug("sr-only"), "display");
  assertEquals(slug("truncate"), "text-overflow");
  assertEquals(slug("leading-tight"), "line-height");
  assertEquals(slug("tracking-wide"), "letter-spacing");
  assertEquals(slug("from-red-500"), "background-image");
  assertEquals(slug("size-4"), "width");
  assertEquals(slug("line-clamp-2"), "line-clamp");
  assertEquals(slug("duration-300"), "transition-duration");
  assertEquals(slug("snap-mandatory"), "scroll-snap-type");
  // Every slug of the table is a page of the list.
  const slugs = new Set(DOCS.map((d) => d.slug));
  for (const x of ALL.slice(0, 3000)) {
    const d = docFor(x);
    if (d) assert(slugs.has(d.slug));
  }
});

Deno.test("search ranks exact, prefix, property and value matches", () => {
  const idx = index(ALL, THEME);
  const top = (q: string, n = 3) => search(idx, q, n).map((x) => x.cls);
  assertEquals(top("p-4")[0], "p-4");
  assertEquals(top(".p-4")[0], "p-4");
  assertEquals(top("hover:p-4")[0], "p-4");
  assertEquals(top("padding"), ["p-0", "p-1", "p-2"]);
  assert(top("16px", 10).includes("p-4"));
  assert(top("letter-spacing", 10).every((c) => c.startsWith("tracking-")));
  assertEquals(top("bg red 500")[0], "bg-red-500");
  assertEquals(search(idx, "   "), []);
  assertEquals(normalizeQuery("!.md:p-4"), "p-4");
});

Deno.test("oklch to hex matches the values on tailwindcss.com", () => {
  assertEquals(colorHex("oklch(63.7% 0.237 25.331)"), "#fb2c36"); // red-500
  assertEquals(colorHex("oklch(62.3% 0.214 259.815)"), "#2b7fff"); // blue-500
  assertEquals(colorHex("oklch(72.3% 0.219 149.579)"), "#00c950"); // green-500
  assertEquals(colorHex("#fff"), "#ffffff");
  assertEquals(oklchToRgb({ l: 0, c: 0, h: 0 }), { r: 0, g: 0, b: 0 });
  assertEquals(parseOklch("oklch(98% 0.016 73.684)"), { l: 0.98, c: 0.016, h: 73.684 });
  assertEquals(parseOklch("rgb(0 0 0)"), undefined);
});

Deno.test("palette: every family × 11 shades, plus black and white", () => {
  const p = palette(DATA);
  assertEquals(p.length, DATA.colors.length * 11 + 2);
  assert(DATA.colors.includes("slate") && DATA.colors.includes("rose"));
  const red = p.find((c) => c.name === "red-500")!;
  assertEquals(red, {
    name: "red-500",
    family: "red",
    shade: "500",
    value: "oklch(63.7% 0.237 25.331)",
    hex: "#fb2c36",
  });
  assertEquals(p.at(-1)?.hex, "#ffffff");
});
