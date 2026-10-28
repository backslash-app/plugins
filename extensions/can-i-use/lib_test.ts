import { assert, assertEquals } from "@std/assert";
import {
  caniuseUrl,
  cleanText,
  type Dataset,
  group,
  isFresh,
  markdown,
  mdnLink,
  parseCell,
  percent,
  shortSupport,
  summarize,
  supportTags,
  trim,
  TTL_MS,
  usageColor,
} from "./lib.ts";

// Six real features from caniuse's data-2.0.json (October 2026), with the seven browsers we show.
const RAW = JSON.parse(await Deno.readTextFile(new URL("./testdata/caniuse.json", import.meta.url)));
const DATA: Dataset = trim(RAW, 1000);
const feature = (id: string) => DATA.features.find((f) => f.id === id)!;

Deno.test("parseCell reads support cells", () => {
  assertEquals(parseCell("y"), { level: "y", prefix: false, flag: false, notes: [] });
  assertEquals(parseCell("a x #1 #3"), { level: "a", prefix: true, flag: false, notes: [1, 3] });
  assertEquals(parseCell("n d #2"), { level: "n", prefix: false, flag: true, notes: [2] });
  assertEquals(parseCell(undefined).level, "u");
  assertEquals(parseCell("zz").level, "u");
});

Deno.test("summarize finds the first version of unbroken support", () => {
  const versions = ["1", "2", "3", "4", "5", "6"].map((version, i) => ({ version, era: i - 4 }));
  // Version 6 is a future one (era 1): ignored.
  assertEquals(summarize(versions, { "1": "a #1", "2": "y x", "3": "n", "4": "y x", "5": "y", "6": "n" }), {
    current: "5",
    level: "y",
    prefix: false,
    flag: false,
    notes: [],
    since: "5",
    prefixedSince: "4",
  });
  assertEquals(summarize(versions, { "1": "n", "2": "a", "3": "a #2", "4": "a x #2", "5": "a #2" }), {
    current: "5",
    level: "a",
    prefix: false,
    flag: false,
    notes: [2],
    partialSince: "2",
  });
  assertEquals(summarize(versions, undefined), undefined);
  assertEquals(summarize([{ version: "156", era: 0 }], { "156": "y" })?.onlyCurrent, true);
});

Deno.test("trim keeps the features and their support", () => {
  assertEquals(DATA.fetched, 1000);
  assertEquals(DATA.updated, 1792647503);
  assertEquals(DATA.statuses.wd, "W3C Working Draft");
  // Sorted by title.
  assertEquals(DATA.features.map((f) => f.id), [
    "css-has",
    "css-backdrop-filter",
    "css-boxdecorationbreak",
    "flexbox",
    "css-line-clamp",
    "imagecapture",
  ]);
  const has = feature("css-has");
  assertEquals(has.title, ":has() CSS relational pseudo-class");
  assertEquals(has.status, "wd");
  assertEquals(has.categories, ["CSS"]);
  assertEquals(has.usageY, 95.91);
  assertEquals(has.support.firefox, {
    current: "158",
    level: "y",
    prefix: false,
    flag: false,
    notes: [],
    since: "121",
  });
  assertEquals(has.support.safari?.since, "15.4");
  assert(has.links.some((l) => l.url.includes("developer.mozilla.org")));
  // Small: about 2 KB a feature.
  assert(JSON.stringify(DATA).length < 6 * 2500);
});

Deno.test("supportTags color each browser", () => {
  const flex = feature("flexbox").support;
  assertEquals(supportTags(flex.chrome), [
    { text: "29+", color: "green" },
    { text: "prefixed 21", color: "orange" },
    { text: "partial 4", color: "yellow" },
  ]);
  assertEquals(supportTags(flex.and_chr), [{ text: "Yes", color: "green" }]);
  assertEquals(supportTags(feature("css-line-clamp").support.firefox), [{ text: "68+ prefixed", color: "orange" }]);
  assertEquals(supportTags(feature("css-boxdecorationbreak").support.safari), [
    { text: "Partial 6.1+", color: "yellow" },
    { text: "prefixed", color: "orange" },
    { text: "note 1", color: "gray" },
  ]);
  assertEquals(supportTags(feature("imagecapture").support.firefox), [
    { text: "No", color: "red" },
    { text: "behind a flag", color: "purple" },
    { text: "note 1", color: "gray" },
  ]);
  assertEquals(supportTags(undefined), [{ text: "No data", color: "gray" }]);
});

Deno.test("shortSupport, usage colors and percent", () => {
  const ic = feature("imagecapture").support;
  assertEquals(shortSupport(ic.chrome), { text: "59", color: "green" });
  assertEquals(shortSupport(ic.firefox), { text: "flag", color: "purple" });
  assertEquals(shortSupport(ic.safari), { text: "no", color: "red" });
  assertEquals(shortSupport(feature("css-line-clamp").support.safari), { text: "5", color: "orange" });
  assertEquals(shortSupport(feature("css-boxdecorationbreak").support.safari), { text: "6.1", color: "yellow" });
  assertEquals([usageColor(97), usageColor(90), usageColor(75), usageColor(50), usageColor(10)], [
    "green",
    "teal",
    "yellow",
    "orange",
    "red",
  ]);
  assertEquals(percent(95.91), "95.9 %");
  assertEquals(percent(0.21), "0.21 %");
  assertEquals(percent(100), "100 %");
});

Deno.test("cleanText, groups, links and markdown", () => {
  assertEquals(
    cleanText('Use <code>a:has(img)</code>, see <a href="https://x.y">this</a> &amp; <em>that</em><br>ok'),
    "Use `a:has(img)`, see [this](https://x.y) & *that*\nok",
  );
  assertEquals(group(feature("flexbox")), "css");
  assertEquals(group(feature("imagecapture")), "js");
  assertEquals(caniuseUrl("flexbox"), "https://caniuse.com/flexbox");
  assertEquals(mdnLink(feature("css-has"))?.url, "https://developer.mozilla.org/en-US/docs/Web/CSS/:has");
  const md = markdown(feature("flexbox"));
  assert(md.startsWith("Method of positioning elements"));
  assert(md.includes("**Notes**"));
  assert(md.includes("1. Only supports the [old flexbox]"));
});

Deno.test("isFresh uses a one-week TTL", () => {
  assert(isFresh(DATA, 1000 + TTL_MS - 1));
  assert(!isFresh(DATA, 1000 + TTL_MS));
  assert(!isFresh(undefined));
});
