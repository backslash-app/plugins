import { assert, assertEquals, assertRejects } from "@std/assert";
import { parse } from "@std/toml";
import { artworkOfTheDay, searchAic, searchMet } from "./api.ts";
import {
  type AicArtwork,
  aicHighlightsUrl,
  aicSearchUrl,
  citation,
  dailyPick,
  dayKey,
  fromAic,
  fromMet,
  hash,
  interleave,
  mapLimit,
  markdown,
  metHighlightsUrl,
  type MetObject,
  metSearchUrl,
  metThumb,
  showable,
  sourceOf,
  stripHtml,
} from "./lib.ts";
import { artworkItem } from "./views.ts";

const dir = new URL(".", import.meta.url).pathname;
const json = <T>(name: string) => JSON.parse(Deno.readTextFileSync(`${dir}fixtures/${name}`)) as T;

// Real answers, trimmed: /v1/objects/436524 (public domain), /v1/objects/480725 (in copyright).
const sunflowers = json<MetObject>("met-436524.json");
const largeSunflowers = json<MetObject>("met-480725.json");
const aic = json<{ data: AicArtwork[] }>("aic-search.json").data;

Deno.test("Met objects", () => {
  const a = fromMet(sunflowers);
  assertEquals(a.museum, "met");
  assertEquals(a.id, "436524");
  assertEquals(a.title, "Sunflowers");
  assertEquals(a.artist, "Vincent van Gogh");
  assertEquals(a.artistBio, "Dutch, Zundert 1853–1890 Auvers-sur-Oise");
  assertEquals(a.date, "1887");
  assertEquals(a.medium, "Oil on canvas");
  assertEquals(a.department, "European Paintings");
  assert(a.publicDomain);
  assertEquals(a.image, "https://images.metmuseum.org/CRDImages/ep/web-large/DP-41223-001.jpg");
  assertEquals(a.thumb, "https://images.metmuseum.org/CRDImages/ep/web-additional/DP-41223-001.jpg");
  assertEquals(a.url, "https://www.metmuseum.org/art/collection/search/436524");
  assert(showable(a));
  // In copyright: the Met shares no picture.
  const b = fromMet(largeSunflowers);
  assert(!b.publicDomain);
  assertEquals(b.image, undefined);
  assert(!showable(b));
  assert(markdown(b).includes("Still under copyright"));
  assertEquals(metThumb("https://x/CRDImages/ep/original/A.jpg"), "https://x/CRDImages/ep/web-additional/A.jpg");
  assertEquals(fromMet({ objectID: 5, objectName: "Vase" }).title, "Vase");
});

Deno.test("Art Institute artworks", () => {
  const quilt = fromAic(aic[0]);
  assertEquals(quilt.museum, "aic");
  assert(!quilt.publicDomain);
  // The description's HTML becomes text.
  assert(quilt.description?.startsWith("This quilt was first exhibited at the Art Institute in 1965"));
  assert(!quilt.description?.includes("<"));
  const sun = fromAic(aic[1]);
  assertEquals(sun.title, "Sunflowers");
  assert(sun.publicDomain);
  assertEquals(sun.image, "https://www.artic.edu/iiif/2/461c0069-45a9-c67e-7210-bfb512c3ea58/full/843,/0/default.jpg");
  assertEquals(sun.thumb, "https://www.artic.edu/iiif/2/461c0069-45a9-c67e-7210-bfb512c3ea58/full/200,/0/default.jpg");
  assertEquals(sun.url, "https://www.artic.edu/artworks/35720");
  // The artist's name and the rest of the display line.
  const monet = fromAic({
    id: 16568,
    title: "Water Lilies",
    artist_title: "Claude Monet",
    artist_display: "Claude Monet (French, 1840–1926)",
    image_id: null,
  });
  assertEquals(monet.artist, "Claude Monet");
  assertEquals(monet.artistBio, "French, 1840–1926");
  assertEquals(monet.image, undefined);
  assertEquals(fromAic({ id: 1, artist_display: "Japanese\nEdo period" }).artist, "Japanese");
});

Deno.test("HTML to text", () => {
  assertEquals(stripHtml("<p>One &amp; two</p><p>Three<br/>four</p>"), "One & two\n\nThree\nfour");
  assertEquals(stripHtml("<p><em>Grande Jatte</em> is&nbsp;big</p>"), "Grande Jatte is big");
});

Deno.test("URLs", () => {
  assertEquals(
    metSearchUrl("van gogh", 12),
    "https://collectionapi.metmuseum.org/public/collection/v1.1/search?q=van+gogh&hasImages=true&limit=12",
  );
  assert(metHighlightsUrl(100).endsWith("search?q=*&isHighlight=true&hasImages=true&offset=100&limit=1"));
  const s = new URL(aicSearchUrl("monet", 12, true));
  assertEquals(s.searchParams.get("q"), "monet");
  assertEquals(s.searchParams.get("query[term][is_public_domain]"), "true");
  assert(s.searchParams.get("fields")?.includes("image_id"));
  const params = JSON.parse(new URL(aicHighlightsUrl(12)).searchParams.get("params")!);
  assertEquals(params.from, 12);
  assertEquals(params.size, 1);
  assertEquals(params.query.bool.must.length, 3);
});

Deno.test("the artwork of the day is the same for everyone, the museums take turns", () => {
  assertEquals(dailyPick("2026-11-01"), dailyPick("2026-11-01"));
  assertEquals(hash("abc"), 440920331);
  const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"].map(dailyPick);
  // The museums alternate from one day to the next.
  for (let i = 1; i < days.length; i++) assert(days[i].museum !== days[i - 1].museum);
  for (const d of days) assert(d.offset >= 0 && d.offset < (d.museum === "met" ? 2000 : 200));
  assertEquals(new Set(days.map((d) => d.offset)).size, 4);
  assertEquals(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

Deno.test("helpers", async () => {
  assertEquals(interleave<number | string>([1, 2, 3], ["a"]), [1, "a", 2, 3]);
  assertEquals(sourceOf("met"), "met");
  assertEquals(sourceOf(undefined), "all");
  let running = 0, peak = 0;
  const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    if (n === 4) throw new Error("boom");
    return n * 10;
  });
  assertEquals(out, [10, 20, 30, undefined, 50, 60, 70, 80]);
  assertEquals(peak, 3);
  const a = fromMet(sunflowers);
  assertEquals(
    citation(a),
    "Vincent van Gogh, Sunflowers, 1887. Oil on canvas. The Metropolitan Museum of Art. https://www.metmuseum.org/art/collection/search/436524",
  );
  const item = artworkItem(a);
  assertEquals(item.icon, a.thumb);
  assertEquals(item.detail?.image, a.image);
  assertEquals(item.accessories?.map((x) => x.tag), ["The Met", "Public domain"]);
});

/** Replaces fetch with answers built from the fixtures, recording the requests. */
function fakeFetch(answer: (url: URL) => { status?: number; body: unknown }) {
  const seen: { url: URL; headers: Headers }[] = [];
  const original = globalThis.fetch;
  let running = 0, peak = 0;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    seen.push({ url, headers: new Headers(init?.headers) });
    running++;
    peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 2));
    running--;
    const a = answer(url);
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as typeof fetch;
  return { seen, peak: () => peak, restore: () => (globalThis.fetch = original) };
}

Deno.test("the Met: ids first, then a few objects at a time", async () => {
  const ids = Array.from({ length: 40 }, (_, i) => 1000 + i);
  const f = fakeFetch((url) =>
    url.pathname.endsWith("/search")
      ? { body: { total: 153, objectIDs: ids.slice(0, Number(url.searchParams.get("limit"))) } }
      : url.pathname.endsWith("/1003")
      ? { status: 404, body: { message: "ObjectID not found" } }
      : { body: { ...sunflowers, objectID: Number(url.pathname.split("/").pop()) } }
  );
  try {
    const res = await searchMet("sunflowers", undefined, 12);
    assertEquals(res.total, 153);
    // 12 asked, one is gone: 11 artworks, in the search's order.
    assertEquals(res.artworks.map((a) => a.id), ids.slice(0, 12).filter((i) => i !== 1003).map(String));
    assertEquals(f.seen.filter((s) => s.url.pathname.includes("/objects/")).length, 12);
    assert(f.peak() <= 6);
  } finally {
    f.restore();
  }
});

Deno.test("the Art Institute: its header, and a clear error when refused", async () => {
  const f = fakeFetch(() => ({ body: { data: aic, pagination: { total: 3 } } }));
  try {
    const res = await searchAic("sunflowers");
    assertEquals(res.artworks.length, 3);
    assert(f.seen[0].headers.get("AIC-User-Agent")?.startsWith("Backslash-Artworks"));
  } finally {
    f.restore();
  }
  const g = fakeFetch(() => ({ status: 403, body: {} }));
  try {
    await assertRejects(() => searchAic("x"), Error, "refused the request (403)");
  } finally {
    g.restore();
  }
});

Deno.test("artwork of the day skips highlights without a public picture", async () => {
  // On a Met day, the first highlight is in copyright: the next one is used.
  const day = ["2026-11-01", "2026-11-02"].find((d) => dailyPick(d).museum === "met")!;
  const f = fakeFetch((url) => {
    if (url.pathname.endsWith("/search")) {
      const offset = Number(url.searchParams.get("offset"));
      return { body: { total: 2301, objectIDs: [offset === dailyPick(day).offset ? 480725 : 436524] } };
    }
    return { body: url.pathname.endsWith("/480725") ? largeSunflowers : sunflowers };
  });
  try {
    const art = await artworkOfTheDay(day);
    assertEquals(art.id, "436524");
    const offsets = f.seen.filter((s) => s.url.pathname.endsWith("/search")).map((s) =>
      s.url.searchParams.get("offset")
    );
    const start = dailyPick(day).offset;
    assertEquals(offsets, [String(start), String((start + 1) % 2000)]);
  } finally {
    f.restore();
  }
});

Deno.test("manifest", () => {
  const manifest = parse(Deno.readTextFileSync(`${dir}backslash.toml`)) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.extension.id, "artworks");
  assertEquals(manifest.extension.categories, ["media"]);
  assertEquals(manifest.permissions.net, [
    "collectionapi.metmuseum.org",
    "images.metmuseum.org",
    "api.artic.edu",
    "www.artic.edu",
  ]);
  for (const c of manifest.commands) Deno.statSync(`${dir}commands/${c.name}.ts`);
});
