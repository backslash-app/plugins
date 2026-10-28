import { assert, assertEquals } from "@std/assert";
import {
  ago,
  asUrl,
  BANGS,
  completeBang,
  engineOf,
  fill,
  findBang,
  forget,
  HISTORY_MAX,
  type HistoryEntry,
  matchHistory,
  parseQuery,
  parseSuggestions,
  remember,
  searchUrl,
  suggestUrl,
} from "./lib.ts";

Deno.test("bang table: unique triggers and aliases, every URL has %s and is https", () => {
  assert(BANGS.length >= 40);
  const seen = new Set<string>();
  for (const b of BANGS) {
    for (const t of [b.trigger, ...(b.aliases ?? [])]) {
      assert(!seen.has(t), `!${t} is defined twice`);
      seen.add(t);
    }
    assert(b.url.includes("%s"), b.trigger);
    assert(b.url.startsWith("https://") && b.home.startsWith("https://"), b.trigger);
  }
  for (const t of ["g", "ddg", "w", "yt", "gh", "so", "mdn", "aw", "npm", "crates", "maps", "img", "r", "amazon"]) {
    assert(findBang(t), `!${t} missing`);
  }
});

Deno.test("parsing bangs anywhere in the query", () => {
  assertEquals(parseQuery("!yt lofi beats").bang?.name, "YouTube");
  assertEquals(parseQuery("!yt lofi beats").terms, "lofi beats");
  assertEquals(parseQuery("lofi beats !yt").bang?.trigger, "yt");
  assertEquals(parseQuery("rust yt!").bang?.trigger, "yt");
  assertEquals(parseQuery("!tw deno").bang?.name, "X (Twitter)");
  assertEquals(parseQuery("!GH deno").bang?.trigger, "gh");
  assertEquals(parseQuery("!wfr Paris").bang?.url.includes("fr.wikipedia.org"), true);
  assertEquals(parseQuery("!aw systemd").bang?.name, "ArchWiki");
  assertEquals(parseQuery("hello world"), { terms: "hello world" });
  assertEquals(parseQuery("!zzz hello"), { terms: "hello", partialBang: "zzz" });
  assertEquals(parseQuery("!"), { terms: "", partialBang: "" });
  assertEquals(parseQuery("wow!").bang, undefined); // not a bang: plain text
  assertEquals(parseQuery("wow!").terms, "wow!");
});

Deno.test("completing bangs", () => {
  assertEquals(completeBang("y")[0].trigger, "yt");
  assertEquals(completeBang("w")[0].trigger, "w");
  assertEquals(completeBang("crat")[0].trigger, "crates");
  assertEquals(completeBang("").length, BANGS.length);
  assert(completeBang("wiki").some((b) => b.trigger === "wfr")); // by name
  assertEquals(completeBang("qqqq"), []);
});

Deno.test("URLs and encoding", () => {
  const ddg = engineOf("DuckDuckGo");
  assertEquals(searchUrl(parseQuery("c++ & rust"), ddg), "https://duckduckgo.com/?q=c%2B%2B+%26+rust");
  assertEquals(
    searchUrl(parseQuery("!w Ada Lovelace"), ddg),
    "https://en.wikipedia.org/wiki/Special:Search?search=Ada+Lovelace",
  );
  assertEquals(searchUrl(parseQuery("!maps Eiffel Tower"), ddg), "https://www.google.com/maps/search/Eiffel%20Tower");
  assertEquals(searchUrl(parseQuery("!yt"), ddg), "https://www.youtube.com");
  assertEquals(fill("https://x.com/search?q=%s", "été"), "https://x.com/search?q=%C3%A9t%C3%A9");
  assertEquals(searchUrl(parseQuery("deno"), engineOf("kagi")), "https://kagi.com/search?q=deno");
});

Deno.test("engine preference", () => {
  assertEquals(engineOf("Google").id, "google");
  assertEquals(engineOf("brave").id, "brave");
  assertEquals(engineOf("Brave Search").id, "brave");
  assertEquals(engineOf("start").id, "startpage");
  assertEquals(engineOf("").id, "duckduckgo");
  assertEquals(engineOf(undefined).id, "duckduckgo");
  assertEquals(engineOf("nope").id, "duckduckgo");
});

Deno.test("addresses are opened, not searched", () => {
  assertEquals(asUrl("deno.com"), "https://deno.com");
  assertEquals(asUrl("https://deno.com/x?y=1"), "https://deno.com/x?y=1");
  assertEquals(asUrl("localhost:8000/app"), "http://localhost:8000/app");
  assertEquals(asUrl("docs.rs/serde"), "https://docs.rs/serde");
  assertEquals(asUrl("hello world"), undefined);
  assertEquals(asUrl("3.14"), undefined);
  assertEquals(asUrl("node.js tutorial"), undefined);
});

Deno.test("suggestions from DuckDuckGo and Google", () => {
  assertEquals(
    parseSuggestions([{ phrase: "deno" }, { phrase: "deno deploy" }, { phrase: "deno fresh" }], "deno"),
    ["deno deploy", "deno fresh"],
  );
  assertEquals(parseSuggestions(["rust", ["rust", "rust lang", "Rust Lang", "rustup"]], "rust"), [
    "rust lang",
    "rustup",
  ]);
  assertEquals(parseSuggestions({ error: 1 }, "x"), []);
  assertEquals(parseSuggestions([{ phrase: "a" }, { phrase: "b" }, { phrase: "c" }], "", 2), ["a", "b"]);
  assert(suggestUrl("duckduckgo", "a b").startsWith("https://duckduckgo.com/ac/?q=a%20b"));
  assert(suggestUrl("google", "a").startsWith("https://suggestqueries.google.com/complete/search?client=firefox"));
});

Deno.test("history: recent first, counted, case-insensitive, capped", () => {
  let h: HistoryEntry[] = [];
  h = remember(h, "deno", 1);
  h = remember(h, "rust", 2);
  h = remember(h, "Deno", 3);
  assertEquals(h.map((e) => [e.query, e.count, e.at]), [["Deno", 2, 3], ["rust", 1, 2]]);
  assertEquals(remember(h, "  ", 4), h);
  assertEquals(forget(h, "rust").map((e) => e.query), ["Deno"]);
  assertEquals(matchHistory([...h, { query: "!yt rust talks", at: 0, count: 1 }], "rust").map((e) => e.query), [
    "rust",
    "!yt rust talks",
  ]);
  for (let i = 0; i < 100; i++) h = remember(h, `q${i}`, i);
  assertEquals(h.length, HISTORY_MAX);
  assertEquals(ago(0, 30_000), "now");
  assertEquals(ago(0, 5 * 60_000), "5m");
  assertEquals(ago(0, 3 * 3_600_000), "3h");
  assertEquals(ago(0, 2 * 86_400_000), "2d");
});
