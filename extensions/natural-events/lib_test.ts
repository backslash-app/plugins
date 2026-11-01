import { assert, assertAlmostEquals, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  CATEGORIES,
  category,
  center,
  cleanTitle,
  compass,
  day,
  distanceKm,
  eventItem,
  type EventsResponse,
  eventsUrl,
  formatDistance,
  formatMagnitude,
  geocodingUrl,
  HOSTS,
  mapUrl,
  numberPref,
  parseCoordinates,
  parseEvents,
  pickPlace,
  queries,
  sections,
  shareText,
  sourceName,
  splitCity,
  status,
  stormClass,
  stormColor,
  timeAgo,
  travelled,
  unitsOf,
  viewOf,
  VIEWS,
  worldviewUrl,
} from "./lib.ts";

const FIXTURE = JSON.parse(
  await Deno.readTextFile(new URL("./fixtures/events.json", import.meta.url)),
) as EventsResponse;

const NOW = Date.UTC(2026, 10, 1, 12);
const chennai = { name: "Chennai", latitude: 13.0827, longitude: 80.2707 };

Deno.test("manifest: hosts, commands and preferences", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string; keywords: string[] }[];
    preferences: { name: string }[];
  };
  assertEquals(manifest.extension.id, "natural-events");
  assertEquals(manifest.extension.categories, ["everyday"]);
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
    assertEquals(new Set(c.keywords).size, c.keywords.length, `duplicate keywords in ${c.name}`);
  }
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "radius", "days", "units"]);
  for (const v of VIEWS) {
    for (const q of queries(v.value, 30)) assert(HOSTS.includes(new URL(eventsUrl(q)).host));
  }
  assert(HOSTS.includes(new URL(geocodingUrl("x")).host));
});

Deno.test("views and queries", () => {
  assertEquals(viewOf("volcanoes"), "volcanoes");
  assertEquals(viewOf("nope"), "active");
  assertEquals(queries("active", 30).map(eventsUrl), [
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30",
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=volcanoes",
  ]);
  assertEquals(
    eventsUrl(queries("wildfires", 14)[0]),
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=wildfires&days=14",
  );
  assertEquals(
    eventsUrl(queries("severeStorms", 30)[0]),
    "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&category=severeStorms",
  );
  const other = new URL(eventsUrl(queries("other", 30)[0]));
  assertEquals(other.searchParams.get("status"), "all");
  const cats = other.searchParams.get("category")!.split(",");
  assert(cats.includes("floods") && cats.includes("landslides"));
  assert(!cats.includes("wildfires") && !cats.includes("volcanoes"));
  // Every category is known, and the four main ones have their own chip.
  assertEquals(CATEGORIES.length, 13);
  assertEquals(category("volcanoes").icon, "🌋");
  assertEquals(category("mystery").title, "mystery");
});

Deno.test("location", () => {
  assertEquals(parseCoordinates("13.08, 80.27"), { latitude: 13.08, longitude: 80.27 });
  assertEquals(parseCoordinates("Chennai"), undefined);
  assertEquals(splitCity("Portland, US"), { name: "Portland", hint: "us" });
  const results = [
    {
      name: "Portland",
      country: "United States",
      country_code: "US",
      admin1: "Oregon",
      latitude: 45.5,
      longitude: -122.7,
    },
    {
      name: "Portland",
      country: "United States",
      country_code: "US",
      admin1: "Maine",
      latitude: 43.7,
      longitude: -70.3,
    },
  ];
  assertEquals(pickPlace(results, "maine")?.latitude, 43.7);
  assertEquals(pickPlace(results)?.latitude, 45.5);
  assertAlmostEquals(distanceKm(chennai, { latitude: 16.4, longitude: 81.8 }), 403.85, 0.1);
  assertEquals(compass(10), "N");
});

Deno.test("geometries: points and polygons", () => {
  assertEquals(center({ date: "", type: "Point", coordinates: [2.35, 48.85] }), { latitude: 48.85, longitude: 2.35 });
  // A closed square: its first point is not counted twice.
  const square = center({
    date: "",
    type: "Polygon",
    coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]],
  })!;
  assertEquals(square, { latitude: 1, longitude: 1 });
  assertEquals(center({ date: "", type: "Polygon", coordinates: [[]] }), undefined);
  assertEquals(center({ date: "", type: "LineString", coordinates: [[0, 0]] }), undefined);
  assertEquals(center({ date: "", type: "Point", coordinates: ["a", "b"] }), undefined);
});

Deno.test("parsing events", () => {
  const all = parseEvents([FIXTURE]);
  assertEquals(all.length, 9);
  // Newest report first.
  for (let i = 1; i < all.length; i++) assert(all[i - 1].time >= all[i].time);
  assertEquals(all[0].title, "Flood in Bhutan");

  const storm = all.find((e) => e.id === "EONET_25729")!;
  assertEquals(storm.title, "Tropical Cyclone Arnab");
  assertEquals(storm.category.id, "severeStorms");
  assertEquals(storm.track.length, 5);
  assertEquals(storm.magnitude, 55);
  assertEquals(storm.unit, "kts");
  assertEquals(storm.peak, 65);
  assertEquals([storm.latitude, storm.longitude], [16.4, 81.8]);
  assertEquals(storm.first, Date.parse("2026-10-25T18:00:00Z"));
  assert(travelled(storm)! > 500);

  const fire = all.find((e) => e.id === "EONET_25827")!;
  assertEquals(fire.magnitude, 1000);
  assertEquals(fire.unit, "acres");
  assertEquals(fire.peak, undefined);
  assertEquals(fire.sources[0].id, "IRWIN");
  assertEquals(travelled(fire), undefined);

  const flood = all.find((e) => e.id === "EONET_25895")!;
  assertEquals(flood.closed, Date.parse("2026-10-30T00:00:00Z"));
  assert(flood.latitude > 27 && flood.latitude < 28.5, String(flood.latitude));
  assert(flood.longitude > 89 && flood.longitude < 91, String(flood.longitude));

  const gdacs = all.find((e) => e.id === "EONET_13370")!;
  assertEquals(gdacs.title, "Wildfire in Australia");
  assertEquals(gdacs.magnitude, undefined);

  // Duplicates across answers count once; events without a usable geometry are dropped.
  const twice = parseEvents([FIXTURE, FIXTURE, {
    events: [{ id: "x", title: "No place", categories: [], sources: [], geometry: [] }],
  }]);
  assertEquals(twice.length, 9);
  assertEquals(parseEvents([{ events: [] }]), []);

  // Distances from you.
  const near = parseEvents([FIXTURE], chennai);
  const arnab = near.find((e) => e.id === "EONET_25729")!;
  assertAlmostEquals(arnab.distance!, 403.85, 0.1);
  assertEquals(compass(arnab.bearing!), "NE");
});

Deno.test("titles, magnitudes and times", () => {
  assertEquals(cleanTitle("Flood in Bhutan 1104265"), "Flood in Bhutan");
  assertEquals(cleanTitle("Iceberg B52"), "Iceberg B52");
  assertEquals(cleanTitle("Tropical Cyclone 2026"), "Tropical Cyclone 2026");

  assertEquals(stormClass(30), "Tropical depression");
  assertEquals(stormClass(55), "Tropical storm");
  assertEquals(stormClass(64), "Category 1");
  assertEquals(stormClass(90), "Category 2");
  assertEquals(stormClass(100), "Category 3");
  assertEquals(stormClass(120), "Category 4");
  assertEquals(stormClass(140), "Category 5");
  assertEquals(stormColor(140), "purple");
  assertEquals(stormColor(20), "gray");

  assertEquals(formatMagnitude(55, "kts", "metric"), "55 kt (102 km/h)");
  assertEquals(formatMagnitude(55, "kts", "imperial"), "55 kt (63 mph)");
  assertEquals(formatMagnitude(1000, "acres", "metric"), "405 ha (1,000 acres)");
  assertEquals(formatMagnitude(1000, "acres", "imperial"), "1,000 acres");
  assertEquals(formatMagnitude(48.88, "NM^2", "metric"), "168 km²");
  assertEquals(formatMagnitude(48.88, "NM^2", "imperial"), "65 mi²");
  assertEquals(formatMagnitude(4.25, "Mw", "metric"), "4.25 Mw");
  assertEquals(formatMagnitude(3, undefined, "metric"), "3");

  assertEquals(formatDistance(401, "metric"), "401 km");
  assertEquals(formatDistance(401, "imperial"), "249 mi");
  assertEquals(formatDistance(3.25, "metric"), "3.3 km");
  assertEquals(unitsOf("imperial"), "imperial");
  assertEquals(unitsOf(undefined), "metric");
  assertEquals(numberPref("", 30), 30);
  assertEquals(numberPref(14, 30), 14);

  assertEquals(timeAgo(NOW - 60_000, NOW), "just now");
  assertEquals(timeAgo(NOW - 3 * 3600_000, NOW), "3 h ago");
  assertEquals(timeAgo(NOW - 30 * 3600_000, NOW), "yesterday");
  assertEquals(timeAgo(NOW - 12 * 86_400_000, NOW), "12 days ago");
  assertEquals(timeAgo(NOW - 200 * 86_400_000, NOW), "7 months ago");
  assertEquals(day(Date.parse("2026-10-28T18:02:00Z")), "28 Oct 2026");
  assertEquals(sourceName("SIVolcano"), "Smithsonian Global Volcanism Program");
  assertEquals(sourceName("NEW"), "NEW");
});

Deno.test("links and texts", () => {
  const all = parseEvents([FIXTURE]);
  const fire = all.find((e) => e.id === "EONET_25827")!;
  assertEquals(mapUrl(fire), "https://www.openstreetmap.org/?mlat=31.0858&mlon=-89.0978#map=7/31.0858/-89.0978");
  const wv = new URL(worldviewUrl(fire));
  assertEquals(wv.host, "worldview.earthdata.nasa.gov");
  assertEquals(wv.searchParams.get("t"), "2026-10-28");
  assertStringIncludes(wv.searchParams.get("l")!, "Thermal_Anomalies");
  assertEquals(wv.searchParams.get("v"), "-90.598,29.586,-87.598,32.586");
  const ice = all.find((e) => e.id === "EONET_25268")!;
  assert(!new URL(worldviewUrl(ice)).searchParams.get("l")!.includes("Thermal"));

  assertEquals(
    shareText(fire, "metric"),
    "Wildfire South Tank Trail, Perry, Mississippi · Wildfires · 405 ha (1,000 acres) · 31.086, -89.098 · 28 Oct 2026 · " +
      "https://irwin.doi.gov/observer/incidents/2026-MSMNF-000680",
  );
  assertEquals(status(all), "9 events · 3 wildfires, 2 sea and lake ice, 2 volcanoes");
  assertEquals(status([]), "No events");
});

Deno.test("items and sections", () => {
  const all = parseEvents([FIXTURE], chennai);
  const storm = all.find((e) => e.id === "EONET_25729")!;
  const item = eventItem(storm, { units: "metric", now: NOW, section: "Near" });
  assertEquals(item.id, "EONET_25729");
  assertEquals(item.title, "Tropical Cyclone Arnab");
  assertEquals(item.icon, "🌀");
  assertEquals(item.accessories![0], { tag: "Tropical storm", color: "yellow", tooltip: "55 kt (102 km/h)" });
  assertEquals(item.accessories!.at(-1), { tag: "storm", color: "purple" });
  assert(item.accessories!.some((a) => a.tooltip === "From you" && a.text === "404 km NE"));
  const md = item.detail!.markdown!;
  assertStringIncludes(md, "## 🌀 Tropical Cyclone Arnab");
  assertStringIncludes(md, "Reported 5 times since 25 Oct 2026");
  assertStringIncludes(md, "**404 km NE** from you.");
  assertStringIncludes(md, "Winds of **55 kt (102 km/h)**: tropical storm, down from a peak of 65 kt (120 km/h).");
  assertStringIncludes(md, "along its track");
  assertEquals(item.detail!.stats!.map((s) => s.label), ["Sustained wind", "From you", "Reports"]);
  const labels = item.detail!.metadata!.map((m) => m.label);
  for (const l of ["Category", "Status", "Last report", "First report", "Sustained wind", "Peak", "Source", "EONET"]) {
    assert(labels.includes(l), l);
  }
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles.slice(0, 3), [
    "Open on Joint Typhoon Warning Center",
    "Open Map",
    "Open Satellite View (NASA Worldview)",
  ]);
  assert(titles.includes("Copy Summary") && titles.includes("Copy Coordinates"));

  const flood = eventItem(all.find((e) => e.id === "EONET_25895")!, { units: "metric", now: NOW });
  assertStringIncludes(flood.subtitle!, "Ended");
  assert(flood.accessories!.some((a) => a.tag === "Ended"));
  assertStringIncludes(flood.detail!.markdown!, "Ended 30 Oct 2026");
  assert(flood.keywords!.includes("ended"));

  const old = eventItem(all.find((e) => e.id === "EONET_13370")!, { units: "metric", now: NOW });
  assertStringIncludes(old.detail!.markdown!, "may be contained already");
  const volcano = eventItem(all.find((e) => e.id === "EONET_20710")!, { units: "metric", now: NOW });
  assertEquals(volcano.subtitle, "Erupting since 15 Jun 2026");
  assertStringIncludes(volcano.detail!.markdown!, "In eruption since 15 Jun 2026");
  const fire = eventItem(all.find((e) => e.id === "EONET_25827")!, { units: "imperial", now: NOW });
  assertEquals(fire.accessories![0], { text: "1,000 acres", tooltip: "Area burned" });

  // Sections: near you first, nearest first.
  const groups = sections(all, 1000, chennai);
  assertEquals(groups.map((g) => g.title), ["Within 1,000 km of Chennai", "Elsewhere, newest first"]);
  assertEquals(groups[0].events.map((e) => e.id), ["EONET_25729"]);
  assertEquals(groups[1].events.length, 8);
  assertEquals(sections(all, 10, chennai).map((g) => g.title), ["Newest first"]);
  assertEquals(sections(parseEvents([FIXTURE]), 500).map((g) => g.title), ["Newest first"]);
});
