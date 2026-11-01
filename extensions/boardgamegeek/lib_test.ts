import { assert, assertEquals, assertRejects, assertStringIncludes, assertThrows } from "@std/assert";
import { parse } from "@std/toml";
import { all, child, decodeEntities, find, num, parseXml, value } from "./xml.ts";
import {
  cleanDescription,
  collectionUrl,
  dateText,
  errorMessage,
  excerpt,
  iWon,
  overallRank,
  parseCollection,
  parsePlays,
  parseSearch,
  parseThings,
  playersLine,
  playersText,
  playStats,
  rankHits,
  ratingColor,
  searchUrl,
  sortGames,
  thingUrl,
  timeText,
  weightText,
} from "./lib.ts";
import { collection, request, search, things, TokenMissing, tokenOf, TokenRefused, usernameOf } from "./api.ts";
import { collectionItem, gameItem, playItem, tokenRow } from "./items.ts";

const fixture = (name: string) => Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url));

Deno.test("xml: elements, attributes, entities, CDATA and comments", () => {
  const root = parseXml(
    `<?xml version="1.0"?><!-- c --><a x="1 &amp; 2" y='q"uote'><b v="&lt;b&gt;"/><c>text &#233;&#x2014; <![CDATA[<raw> & stuff]]></c><d a=">"/></a>`,
  );
  assertEquals(root.name, "a");
  assertEquals(root.attrs, { x: "1 & 2", y: 'q"uote' });
  assertEquals(child(root, "b")?.attrs.v, "<b>");
  assertEquals(child(root, "c")?.text, "text é— <raw> & stuff");
  assertEquals(child(root, "d")?.attrs.a, ">");
  assertEquals(value(root, "b"), undefined);
  assertEquals(decodeEntities("&amp;#10;"), "&#10;");
  assertEquals(decodeEntities(decodeEntities("&amp;#10;&amp;mdash;")), "\n—");
  assertEquals(decodeEntities("&unknown; &#0;"), "&unknown; &#0;");
  assertThrows(() => parseXml("just text"), Error, "Not XML");
  assertThrows(() => parseXml("<a <"), Error, "Not XML");
  const nested = parseXml("<r><s><t v='1'/></s><t v='2'/></r>");
  assertEquals(find(nested, "t").map((t) => t.attrs.v), ["1", "2"]);
  assertEquals(all(nested, "t").length, 1);
  assertEquals(num(parseXml("<r><n value='0'/></r>"), "n"), undefined);
  assertEquals(num(parseXml("<r><n value='0'/></r>"), "n", false), 0);
  assertEquals(num(parseXml("<r><n value='N/A'/></r>"), "n"), undefined);
});

Deno.test("search: hits without duplicates, best matches first", async () => {
  const hits = parseSearch(await fixture("search.xml"));
  assertEquals(hits.map((h) => [h.id, h.type, h.name, h.year]), [
    [13, "boardgame", "CATAN", 1995],
    [325, "boardgameexpansion", "CATAN: Seafarers", 1997],
    [278, "boardgame", "Catan Card Game", 1996],
  ]);
  assertEquals(rankHits(hits, "catan").map((h) => h.id), [13, 278, 325]);
  assertEquals(rankHits(hits, "seafarers").map((h) => h.id), [325, 13, 278]);
  assertEquals(rankHits(hits, "catan", 1).length, 1);
  assertEquals(
    searchUrl(" catan "),
    "https://boardgamegeek.com/xmlapi2/search?query=catan&type=boardgame%2Cboardgameexpansion",
  );
  assertEquals(thingUrl([13, 325]), "https://boardgamegeek.com/xmlapi2/thing?id=13%2C325&stats=1");
});

Deno.test("thing: details, poll, ranks and a twice-escaped description", async () => {
  const [catan, seafarers] = parseThings(await fixture("thing.xml"));
  assertEquals(catan.id, 13);
  assertEquals(catan.name, "CATAN");
  assertEquals(catan.alternateNames, ["Die Siedler von Catan", "Les Colons de Catane"]);
  assertEquals([catan.minPlayers, catan.maxPlayers, catan.minTime, catan.maxTime, catan.minAge], [3, 4, 60, 120, 10]);
  assertEquals(catan.bestWith, "Best with 4 players");
  assertEquals(catan.recommendedWith, "Recommended with 3–4 players");
  assertEquals(catan.designers, ["Klaus Teuber"]);
  assertEquals(catan.artists, []);
  assertEquals(catan.mechanics, ["Dice Rolling", "Trading"]);
  assertEquals(catan.rating, 7.09451);
  assertEquals(catan.ratings, 125431);
  assertEquals(catan.weight, 2.2866);
  assertEquals(overallRank(catan), 567);
  assertEquals(catan.ranks[1], { name: "familygames", title: "Family Game", rank: 132 });
  assertStringIncludes(catan.description, "roads.\n\nOn each turn");
  assertStringIncludes(catan.description, 'ore) — it’s "trading" that wins.');
  assert(catan.image?.startsWith("https://cf.geekdo-images.com/"));
  // No poll summary: computed from the votes.
  assertEquals(seafarers.bestWith, "Best with 4 players");
  assertEquals(seafarers.recommendedWith, "Recommended with 3, 4 players");
  assertEquals(seafarers.weight, undefined);
  assertEquals(seafarers.bayesRating, undefined);
  assertEquals(overallRank(seafarers), undefined);
  assertEquals(sortGames([seafarers, catan], "catan").map((g) => g.id), [13, 325]);
  assertEquals(sortGames([catan, seafarers], "les colons de catane")[0].id, 13);
});

Deno.test("collection: statuses, my rating, plays, ranks", async () => {
  const items = parseCollection(await fixture("collection.xml"));
  assertEquals(items.length, 3);
  const [azul, catan, seafarers] = items;
  assertEquals(azul.name, "Azul");
  assertEquals(azul.myRating, 9);
  assertEquals(azul.plays, 14);
  assertEquals(azul.rank, 77);
  assertEquals(azul.comment, "Family favorite & quick to teach");
  assertEquals(azul.status.own, true);
  assertEquals([azul.minPlayers, azul.maxPlayers, azul.minTime, azul.maxTime], [2, 4, 30, 45]);
  assertEquals(catan.myRating, undefined);
  assertEquals(catan.status.fortrade, true);
  assertEquals(seafarers.subtype, "boardgameexpansion");
  assertEquals(seafarers.wishlistPriority, 2);
  assertEquals(seafarers.rank, undefined);
  assertEquals(
    collectionUrl("meeple", "wishlist"),
    "https://boardgamegeek.com/xmlapi2/collection?username=meeple&wishlist=1&stats=1",
  );
  assertEquals(
    collectionUrl("meeple", "owned"),
    "https://boardgamegeek.com/xmlapi2/collection?username=meeple&own=1&stats=1",
  );
});

Deno.test("errors and the queued message", async () => {
  assertThrows(
    () => parseCollection("<errors><error><message>Invalid username specified</message></error></errors>"),
    Error,
    "Invalid username",
  );
  assertEquals(errorMessage(parseXml(await fixture("invalid-user.xml"))), "Invalid username specified");
  assertStringIncludes(errorMessage(parseXml(await fixture("queued.xml")))!, "will be processed");
  assertEquals(errorMessage(parseXml("<items/>")), undefined);
});

Deno.test("plays: players, winners, scores and stats", async () => {
  const result = parsePlays(await fixture("plays.xml"));
  assertEquals(result.total, 57);
  assertEquals(result.plays.length, 3);
  const [last, double, catan] = result.plays;
  assertEquals(last.game, "Azul");
  assertEquals(last.length, 40);
  assertEquals(last.location, "Home");
  assertEquals(last.comments, "Close game!\nRematch next week.");
  assertEquals(playersLine(last), "Sam 78 (won), Alex 71");
  assertEquals(last.players[1].isNew, true);
  assertEquals(iWon(last, "MEEPLE"), true);
  assertEquals(iWon(double, "meeple"), false);
  assertEquals(iWon(catan, "meeple"), undefined);
  assertEquals(double.quantity, 2);
  assertEquals(double.length, undefined);
  assertEquals(catan.incomplete, true);
  assertEquals(catan.players, []);
  assertEquals(playStats(result.plays, "meeple"), {
    plays: 4,
    games: 2,
    wins: 1,
    withMe: 2,
    minutes: 160,
    mostPlayed: { game: "Azul", plays: 3 },
  });
});

Deno.test("wording", () => {
  assertEquals(playersText(3, 4), "3–4 players");
  assertEquals(playersText(1, 1), "1 player");
  assertEquals(playersText(2, 2), "2 players");
  assertEquals(playersText(undefined, undefined), undefined);
  assertEquals(timeText(60, 120), "60–120 min");
  assertEquals(timeText(45, 45), "45 min");
  assertEquals(weightText(2.2866), "2.29 / 5 · Medium light");
  assertEquals(weightText(4.6), "4.60 / 5 · Heavy");
  assertEquals(weightText(undefined), undefined);
  assertEquals(ratingColor(8.1), "green");
  assertEquals(ratingColor(7.09), "teal");
  assertEquals(ratingColor(undefined), "gray");
  assertEquals(dateText("2026-11-01"), "Sun, Nov 1, 2026");
  assertEquals(dateText("bad"), "bad");
  assertEquals(excerpt("short"), "short");
  assertEquals(excerpt("One sentence here. Another one that is longer than the limit.", 30), "One sentence here.…");
  assertEquals(cleanDescription("a&#10;&#10;&#10;b  \n"), "a\n\nb");
});

Deno.test("items: games, collection and plays", async () => {
  const [catan] = parseThings(await fixture("thing.xml"));
  const g = gameItem(catan);
  assertEquals(g.title, "CATAN");
  assertEquals(g.subtitle, "1995 · 3–4 players · 60–120 min");
  assertEquals(g.section, "Board games");
  assertEquals(g.accessories?.map((a) => a.text ?? a.tag), ["#567", "7.1"]);
  assertStringIncludes(g.detail?.markdown ?? "", "**Mechanics:** Dice Rolling, Trading");
  assert(g.detail?.metadata?.some((m) => m.label === "Family Game rank" && m.value === "#132"));
  const [azul, , seafarers] = parseCollection(await fixture("collection.xml"));
  const a = collectionItem(azul);
  assertEquals(a.accessories?.map((x) => x.text ?? x.tag), ["14 plays", "★ 9"]);
  const s = collectionItem(seafarers);
  assertEquals(s.section, "Expansions");
  assertEquals(s.accessories?.map((x) => x.text ?? x.tag), ["1 play", "Love to have", "★ 7.5"]);
  const [last] = parsePlays(await fixture("plays.xml")).plays;
  const p = playItem(last, "meeple");
  assertEquals(p.section, "2026-10");
  assertEquals(p.accessories?.map((x) => x.text ?? x.tag), ["40 min", "Won"]);
  assertStringIncludes(p.detail?.markdown ?? "", "| 🏆 Sam | 78 | blue |");
});

/** Replaces fetch for the duration of `fn`. */
async function withFetch(handler: (url: string, init?: RequestInit) => Response, fn: () => Promise<void>) {
  const real = globalThis.fetch;
  globalThis.fetch =
    ((input: string | URL | Request, init?: RequestInit) =>
      Promise.resolve(handler(String(input), init))) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = real;
  }
}

Deno.test("api: the token is required, sent and refused", async () => {
  assertThrows(() => tokenOf({}), TokenMissing);
  assertEquals(tokenOf({ token: " Bearer abc " }), "abc");
  assertThrows(() => usernameOf({ username: " " }), Error, "Set your BoardGameGeek username");
  assertEquals(usernameOf({ username: "@meeple" }), "meeple");
  const row = tokenRow(new TokenMissing());
  assertEquals(row[0].id, "token");
  assertStringIncludes(row[0].detail?.markdown ?? "", "Settings → Extensions → BoardGameGeek");
  assertEquals(tokenRow(new TokenRefused())[0].title, "BoardGameGeek refused the application token");
  assertThrows(() => tokenRow(new Error("other")), Error, "other");

  let auth = "";
  const searchXml = await fixture("search.xml"), thingXml = await fixture("thing.xml");
  await withFetch((url, init) => {
    auth = new Headers(init?.headers).get("Authorization") ?? "";
    return new Response(url.includes("/search?") ? searchXml : thingXml);
  }, async () => {
    const hits = await search("catan", "secret");
    assertEquals(hits.length, 3);
    const games = await things([13, 325], "secret");
    assertEquals(games.map((g) => g.id), [13, 325]);
  });
  assertEquals(auth, "Bearer secret");

  await withFetch(
    () => new Response("Unauthorized. See https://boardgamegeek.com/using_the_xml_api", { status: 401 }),
    async () => {
      await assertRejects(() => request("https://boardgamegeek.com/xmlapi2/thing?id=1", "bad"), TokenRefused);
    },
  );
  await withFetch(() => new Response("", { status: 429 }), async () => {
    await assertRejects(() => request("https://boardgamegeek.com/xmlapi2/thing?id=1", "t"), Error, "slow down");
  });
  await withFetch(() => new Response("", { status: 503 }), async () => {
    await assertRejects(() => request("https://boardgamegeek.com/xmlapi2/thing?id=1", "t"), Error, "not answering");
  });
});

Deno.test("api: a queued collection is tried again", async () => {
  const queued = await fixture("queued.xml"), ready = await fixture("collection.xml");
  let calls = 0;
  await withFetch(() => (++calls < 3 ? new Response(queued, { status: 202 }) : new Response(ready)), async () => {
    const seen: string[] = [];
    for await (const r of collection("meeple", "owned", "t", { fresh: true, delays: [1, 1, 1] })) {
      seen.push(r === "queued" ? "queued" : `${r.length} items`);
    }
    assertEquals(seen, ["queued", "queued", "3 items"]);
  });
  assertEquals(calls, 3);
  calls = 0;
  await withFetch(() => (calls++, new Response(queued, { status: 202 })), async () => {
    await assertRejects(
      async () => {
        for await (const _ of collection("meeple", "wishlist", "t", { fresh: true, delays: [1] })) { /* wait */ }
      },
      Error,
      "still preparing",
    );
  });
  assertEquals(calls, 2);
  const invalid = await fixture("invalid-user.xml");
  await withFetch(() => new Response(invalid), async () => {
    await assertRejects(
      async () => {
        for await (const _ of collection("nobody", "rated", "t", { fresh: true })) { /* wait */ }
      },
      Error,
      "Invalid username",
    );
  });
});

Deno.test("manifest: narrow permissions, secret token, EN + FR keywords", async () => {
  const m = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as any;
  assertEquals(m.extension.id, "boardgamegeek");
  assertEquals(m.extension.version, "1.0.0");
  assertEquals(m.permissions.net, ["boardgamegeek.com", "cf.geekdo-images.com"]);
  assertEquals(m.preferences.find((p: any) => p.name === "token").type, "secret");
  for (const c of m.commands) assert(c.keywords.some((k: string) => /[éèà]/.test(k)), c.name);
});
