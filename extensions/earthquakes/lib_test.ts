import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  bearing,
  compass,
  depthClass,
  describe,
  distanceKm,
  type FeatureCollection,
  feedOf,
  feedUrl,
  formatDepth,
  formatDistance,
  fromYou,
  geocodingUrl,
  HOSTS,
  intensity,
  intensityWords,
  magnitudeClass,
  magnitudeColor,
  mapUrl,
  nearbyUrl,
  numberPref,
  parseCoordinates,
  parseQuakes,
  periodDays,
  periodOf,
  pickPlace,
  quakeItem,
  shareText,
  splitCity,
  status,
  summary,
  timeAgo,
  unitsOf,
  utcTime,
} from "./lib.ts";

const NOW = Date.UTC(2026, 9, 31, 18, 0, 0);
const nice = { name: "Nice", latitude: 43.7031, longitude: 7.2661 };

// Shaped like a real USGS summary feed (trimmed).
const FIXTURE: FeatureCollection = {
  metadata: { title: "USGS Magnitude 4.5+ Earthquakes, Past Week", count: 4, generated: NOW },
  features: [
    {
      id: "us7000abcd",
      properties: {
        mag: 6.4,
        place: "52 km SSW of Kokopo, Papua New Guinea",
        time: NOW - 3 * 3600_000,
        updated: NOW - 3600_000,
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
        felt: 12,
        cdi: 5.8,
        mmi: 6.6,
        alert: "yellow",
        status: "reviewed",
        tsunami: 1,
        sig: 650,
        net: "us",
        magType: "mww",
        type: "earthquake",
        title: "M 6.4 - 52 km SSW of Kokopo, Papua New Guinea",
      },
      geometry: { coordinates: [152.0, -4.79, 35.2] },
    },
    {
      id: "it2026xyz",
      properties: {
        mag: 4.6,
        place: "5 km NE of Sanremo, Italy",
        time: NOW - 20 * 60_000,
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/it2026xyz",
        felt: null,
        cdi: null,
        mmi: null,
        alert: null,
        status: "automatic",
        tsunami: 0,
        sig: 326,
        net: "us",
        magType: "mb",
        type: "earthquake",
      },
      geometry: { coordinates: [7.81, 43.85, 10] },
    },
    {
      id: "nomag",
      properties: { mag: null, place: "Somewhere", time: NOW },
      geometry: { coordinates: [0, 0, 0] },
    },
    {
      id: "nogeo",
      properties: { mag: 5, place: "Nowhere", time: NOW },
      geometry: null,
    },
    {
      id: "uu60blast",
      properties: {
        mag: 1.8,
        place: null,
        title: "M 1.8 - 8 km E of Bingham Canyon, Utah",
        time: NOW - 2 * 86_400_000,
        alert: "purple",
        type: "quarry blast",
      },
      geometry: { coordinates: [-112.05, 40.53, -0.4] },
    },
  ],
};

Deno.test("manifest: hosts, commands and preferences", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string; keywords: string[] }[];
    preferences: { name: string }[];
  };
  assertEquals(manifest.extension.id, "earthquakes");
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
    assertEquals(new Set(c.keywords).size, c.keywords.length, `duplicate keywords in ${c.name}`);
  }
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "radius", "minMagnitude", "units"]);
  // Every URL we build goes to an allowed host.
  for (
    const url of [feedUrl("2.5_day"), nearbyUrl(nice, { radiusKm: 100, minMagnitude: 2, days: 1 }), geocodingUrl("x")]
  ) {
    assert(HOSTS.includes(new URL(url).host), url);
  }
});

Deno.test("feeds and periods", () => {
  assertEquals(feedUrl("4.5_week"), "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson");
  assertEquals(feedOf("significant_month"), "significant_month");
  assertEquals(feedOf("nonsense"), "4.5_week");
  assertEquals(feedOf(undefined), "4.5_week");
  assertEquals(periodOf("month"), "month");
  assertEquals(periodOf(""), "week");
  assertEquals(periodDays("day"), 1);
  assertEquals(periodDays("month"), 30);
});

Deno.test("nearby query", () => {
  const url = new URL(nearbyUrl(nice, { radiusKm: 299.6, minMagnitude: 1.5, days: 7, now: NOW }));
  assertEquals(url.pathname, "/fdsnws/event/1/query");
  const q = url.searchParams;
  assertEquals(q.get("format"), "geojson");
  assertEquals(q.get("latitude"), "43.7031");
  assertEquals(q.get("longitude"), "7.2661");
  assertEquals(q.get("maxradiuskm"), "300");
  assertEquals(q.get("minmagnitude"), "1.5");
  assertEquals(q.get("starttime"), "2026-10-24T18:00:00");
  assertEquals(q.get("orderby"), "time");
  // Clamped to what the service accepts.
  const far = new URL(nearbyUrl(nice, { radiusKm: 50_000, minMagnitude: 0, days: 1 }));
  assertEquals(far.searchParams.get("maxradiuskm"), "20000");
});

Deno.test("location: coordinates or a city", () => {
  assertEquals(parseCoordinates("43.70, 7.27"), { latitude: 43.7, longitude: 7.27 });
  assertEquals(parseCoordinates(" -33.45 -70.66 "), { latitude: -33.45, longitude: -70.66 });
  assertEquals(parseCoordinates("37.77;-122.42"), { latitude: 37.77, longitude: -122.42 });
  assertEquals(parseCoordinates("95, 10"), undefined);
  assertEquals(parseCoordinates("Paris"), undefined);
  assertEquals(splitCity("San Francisco, US"), { name: "San Francisco", hint: "us" });
  assertEquals(splitCity("Nice"), { name: "Nice", hint: undefined });
  const results = [
    { name: "Nice", country: "France", country_code: "FR", latitude: 43.7, longitude: 7.27 },
    {
      name: "Nice",
      country: "United States",
      country_code: "US",
      admin1: "California",
      latitude: 39.1,
      longitude: -122.8,
    },
  ];
  assertEquals(pickPlace(results)?.country, "France");
  assertEquals(pickPlace(results, "us")?.country, "United States");
  assertEquals(pickPlace(results, "calif")?.latitude, 39.1);
  assertEquals(pickPlace(results, "japan")?.country, "France");
  assertEquals(pickPlace([]), undefined);
  const q = new URL(geocodingUrl("San Francisco")).searchParams;
  assertEquals(q.get("name"), "San Francisco");
});

Deno.test("distances and bearings", () => {
  const paris = { latitude: 48.8566, longitude: 2.3522 };
  const london = { latitude: 51.5074, longitude: -0.1278 };
  assertAlmostEquals(distanceKm(paris, london), 343.5, 1);
  assertEquals(distanceKm(paris, paris), 0);
  assertAlmostEquals(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }), 20015, 1);
  assertEquals(compass(bearing(paris, london)), "NW");
  assertEquals(compass(bearing(london, paris)), "SE");
  assertEquals(compass(0), "N");
  assertEquals(compass(359), "N");
  assertEquals(compass(-90), "W");
  assertEquals(compass(112), "E");
  assertEquals(compass(113), "SE");
  assertEquals(formatDistance(3.24, "metric"), "3.2 km");
  assertEquals(formatDistance(1240.4, "metric"), "1,240 km");
  assertEquals(formatDistance(100, "imperial"), "62 mi");
  assertEquals(unitsOf("Imperial"), "imperial");
  assertEquals(unitsOf(undefined), "metric");
});

Deno.test("number preferences", () => {
  assertEquals(numberPref(250, 300), 250);
  assertEquals(numberPref("2,5", 1.5), 2.5);
  assertEquals(numberPref("", 300), 300);
  assertEquals(numberPref(undefined, 300), 300);
  assertEquals(numberPref("abc", 300), 300);
  assertEquals(numberPref(-3, 1.5), 1.5);
  assertEquals(numberPref(0, 1.5), 0);
});

Deno.test("parsing a feed", () => {
  const quakes = parseQuakes(FIXTURE, nice);
  // No magnitude or no position: left out. Newest first.
  assertEquals(quakes.map((q) => q.id), ["it2026xyz", "us7000abcd", "uu60blast"]);
  const [sanremo, png, blast] = quakes;
  assertEquals(png.magnitude, 6.4);
  assertEquals(png.depth, 35.2);
  assertEquals(png.latitude, -4.79);
  assertEquals(png.longitude, 152);
  assertEquals(png.alert, "yellow");
  assert(png.tsunami);
  assert(png.reviewed);
  assertEquals(png.felt, 12);
  assertEquals(png.cdi, 5.8);
  assertEquals(sanremo.felt, 0);
  assertEquals(sanremo.cdi, undefined);
  assertEquals(sanremo.alert, undefined);
  assert(!sanremo.tsunami);
  assert(!sanremo.reviewed);
  assertAlmostEquals(sanremo.distance!, 48, 2);
  assertEquals(fromYou(sanremo, "metric"), "47 km E");
  // Missing place: taken from the title; unknown alert levels are ignored.
  assertEquals(blast.place, "8 km E of Bingham Canyon, Utah");
  assertEquals(blast.alert, undefined);
  assertEquals(blast.type, "quarry blast");
  assertEquals(blast.url, "https://earthquake.usgs.gov/earthquakes/eventpage/uu60blast");
  // Without a location, no distance.
  assertEquals(parseQuakes(FIXTURE)[0].distance, undefined);
  assertEquals(fromYou(parseQuakes(FIXTURE)[0], "metric"), undefined);
  assertEquals(parseQuakes({ features: [] }), []);
});

Deno.test("magnitudes, depths, intensities", () => {
  assertEquals(magnitudeClass(8.1), "Great");
  assertEquals(magnitudeClass(7), "Major");
  assertEquals(magnitudeClass(6.99), "Strong");
  assertEquals(magnitudeClass(5.0), "Moderate");
  assertEquals(magnitudeClass(4.4), "Light");
  assertEquals(magnitudeClass(3.1), "Minor");
  assertEquals(magnitudeClass(1.2), "Micro");
  assertEquals(magnitudeColor(7.5), "purple");
  assertEquals(magnitudeColor(6.1), "red");
  assertEquals(magnitudeColor(5.5), "orange");
  assertEquals(magnitudeColor(4.5), "yellow");
  assertEquals(magnitudeColor(3.5), "green");
  assertEquals(magnitudeColor(2), "gray");
  assertEquals(depthClass(10), "shallow");
  assertEquals(depthClass(150), "intermediate");
  assertEquals(depthClass(600), "deep");
  assertEquals(formatDepth(10, "metric"), "10.0 km");
  assertEquals(formatDepth(16.09344, "imperial"), "10.0 mi");
  assertEquals(intensity(5.8), "VI");
  assertEquals(intensity(0.2), "I");
  assertEquals(intensity(14), "XII");
  assertEquals(intensityWords(4.4), "light shaking");
});

Deno.test("times", () => {
  assertEquals(timeAgo(NOW - 20_000, NOW), "just now");
  assertEquals(timeAgo(NOW - 20 * 60_000, NOW), "20 min ago");
  assertEquals(timeAgo(NOW - 3 * 3600_000, NOW), "3 h ago");
  assertEquals(timeAgo(NOW - 30 * 3600_000, NOW), "yesterday");
  assertEquals(timeAgo(NOW - 5 * 86_400_000, NOW), "5 days ago");
  assertEquals(timeAgo(NOW + 60_000, NOW), "just now");
  assertEquals(utcTime(NOW), "2026-10-31 18:00:00 UTC");
});

Deno.test("texts", () => {
  const [sanremo, png] = parseQuakes(FIXTURE, nice);
  assertEquals(
    describe(sanremo, "metric", NOW),
    "A light earthquake (M 4.6 mb), shallow at 10.0 km deep, 20 min ago, 47 km E from you.",
  );
  assertEquals(
    describe(parseQuakes(FIXTURE)[2], "metric", NOW),
    "A micro quarry blast (M 1.8), shallow at -0.4 km deep, 2 days ago.",
  );
  assertEquals(
    shareText(png, "metric"),
    "M 6.4 · 52 km SSW of Kokopo, Papua New Guinea · 35.2 km deep · 2026-10-31 15:00:00 UTC · " +
      "https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd",
  );
  assertEquals(summary(png, NOW), "M 6.4 · 52 km SSW of Kokopo, Papua New Guinea · 3 h ago");
  assertEquals(status(parseQuakes(FIXTURE)), "3 earthquakes · largest M 6.4");
  assertEquals(status([sanremo]), "1 earthquake · largest M 4.6");
  assertEquals(status([]), "No earthquakes");
  assertEquals(mapUrl(png), "https://www.openstreetmap.org/?mlat=-4.7900&mlon=152.0000#map=8/-4.7900/152.0000");
});

Deno.test("items", () => {
  const [sanremo, png, blast] = parseQuakes(FIXTURE, nice);
  const item = quakeItem(png, { units: "metric", now: NOW, section: "M4.5+" });
  assertEquals(item.id, "us7000abcd");
  assertEquals(item.title, "52 km SSW of Kokopo, Papua New Guinea");
  assertEquals(item.subtitle, "3 h ago");
  assertEquals(item.section, "M4.5+");
  assertEquals(item.icon, { source: "bs-activity", tint: "red" });
  const acc = item.accessories!;
  assertEquals(acc.at(-1), { tag: "6.4", color: "red", tooltip: "Strong" });
  assert(acc.some((a) => a.tooltip === "Tsunami flag"));
  assert(acc.some((a) => a.tooltip === "PAGER alert: yellow"));
  assert(acc.some((a) => a.text === "12" && a.tooltip === "Felt reports"));
  assert(item.keywords!.includes("tsunami"));
  const md = item.detail!.markdown!;
  assertStringIncludes(md, "## M 6.4 · 52 km SSW of Kokopo");
  assertStringIncludes(md, "Tsunami flag");
  assertStringIncludes(md, "**PAGER alert:** Yellow");
  assertStringIncludes(md, "**12** people reported feeling it, up to strong shaking (VI).");
  assert(!md.includes("Automatic solution"));
  assertEquals(item.detail!.stats!.map((s) => s.label), ["Magnitude", "Depth", "From you", "Felt reports"]);
  const labels = item.detail!.metadata!.map((m) => m.label);
  for (const l of ["Time", "UTC", "Magnitude", "Depth", "Coordinates", "From you", "PAGER alert", "Tsunami"]) {
    assert(labels.includes(l), l);
  }
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles.slice(0, 2), ["Open on USGS", "Open Map"]);
  assert(titles.includes("Copy Summary") && titles.includes("Copy Coordinates") && titles.includes("Copy Link"));

  const quiet = quakeItem(sanremo, { units: "imperial", now: NOW });
  assertStringIncludes(quiet.detail!.markdown!, "Automatic solution");
  assert(!quiet.detail!.markdown!.includes("feeling it"));
  assert(quiet.accessories!.some((a) => a.text === "29 mi E"));
  assert(!quiet.accessories!.some((a) => a.tooltip === "Tsunami flag"));

  // No location: the depth instead of the distance; other event types are tagged.
  const [far] = parseQuakes({ features: [FIXTURE.features[4]] });
  const b = quakeItem(far, { units: "metric", now: NOW });
  assert(b.accessories!.some((a) => a.tag === "quarry blast"));
  assert(b.accessories!.some((a) => a.text === "0 km deep"));
  assertEquals(b.detail!.stats!.map((s) => s.label), ["Magnitude", "Depth"]);
  assert(blast.distance! > 8000 && blast.distance! < 10_000);
});
