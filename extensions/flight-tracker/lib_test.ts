import { assert, assertAlmostEquals, assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import {
  ago,
  aircraftItem,
  airline,
  altitude,
  areaUrl,
  bearing,
  boundingBox,
  compass,
  creditCost,
  distanceKm,
  elevation,
  emergency,
  flightLevel,
  formatAltitude,
  formatDistance,
  formatSpeed,
  formatVerticalRate,
  geocodingUrl,
  HOSTS,
  icaoUrl,
  lookUp,
  mapUrl,
  matchCallsign,
  measureFrom,
  numberPref,
  parseCoordinates,
  parseQuery,
  parseStates,
  phase,
  pickPlace,
  shareText,
  splitCity,
  type StatesResponse,
  status,
  TOKEN_URL,
  unitsOf,
  viewOf,
  worldUrl,
} from "./lib.ts";
import { credentialsOf, getStates, RateLimited } from "./api.ts";

const fixture = async (name: string) =>
  JSON.parse(await Deno.readTextFile(new URL(`./fixtures/${name}`, import.meta.url))) as StatesResponse;

const nice = { name: "Nice", latitude: 43.7031, longitude: 7.2661 };
const orly = { name: "Orly", latitude: 48.7262, longitude: 2.3652 };

Deno.test("manifest: hosts, commands and preferences", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    extension: { id: string; categories: string[] };
    permissions: { net: string[] };
    commands: { name: string; keywords: string[] }[];
    preferences: { name: string; type?: string }[];
  };
  assertEquals(manifest.extension.id, "flight-tracker");
  assertEquals(manifest.extension.categories, ["everyday"]);
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) {
    await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
    assertEquals(new Set(c.keywords).size, c.keywords.length, `duplicate keywords in ${c.name}`);
  }
  assertEquals(manifest.preferences.map((p) => p.name), ["location", "radius", "units", "clientId", "clientSecret"]);
  assertEquals(manifest.preferences.find((p) => p.name === "clientSecret")?.type, "secret");
  for (const url of [areaUrl(nice, 50), icaoUrl(["3c6521"]), worldUrl(), TOKEN_URL, geocodingUrl("x")]) {
    assert(HOSTS.includes(new URL(url).host), url);
  }
});

Deno.test("location: coordinates or a city", () => {
  assertEquals(parseCoordinates("43.70, 7.27"), { latitude: 43.7, longitude: 7.27 });
  assertEquals(parseCoordinates("-33.9 151.2"), { latitude: -33.9, longitude: 151.2 });
  assertEquals(parseCoordinates("95, 7"), undefined);
  assertEquals(parseCoordinates("Nice"), undefined);
  assertEquals(splitCity("Denver, US"), { name: "Denver", hint: "us" });
  const results = [
    { name: "Paris", country: "France", country_code: "FR", latitude: 48.85, longitude: 2.35 },
    {
      name: "Paris",
      country: "United States",
      country_code: "US",
      admin1: "Texas",
      latitude: 33.66,
      longitude: -95.55,
    },
  ];
  assertEquals(pickPlace(results)?.country, "France");
  assertEquals(pickPlace(results, "tex")?.country, "United States");
  assertEquals(pickPlace([], "x"), undefined);
});

Deno.test("geometry: distances, bearings, elevation and the bounding box", () => {
  assertAlmostEquals(distanceKm(nice, orly), 674, 2);
  assertAlmostEquals(bearing(nice, orly), 327.7, 0.1);
  assertEquals(compass(327.7), "NW");
  assertEquals(compass(359), "N");
  assertEquals(compass(-90), "W");
  // 10 km up, 10 km away: about 45° (a little less with the Earth's curve).
  assertAlmostEquals(elevation(10, 10_000), 44.95, 0.1);
  assertEquals(elevation(0, 1000), 90);
  // An airliner at 11 km sinks below the horizon about 400 km away (with refraction).
  assert(elevation(450, 11_000) < 0);
  assert(elevation(300, 11_000) > 0);

  const box = boundingBox(nice, 50);
  assertAlmostEquals(box.lamax - nice.latitude, 0.4497, 0.001);
  assert(box.lomax - nice.longitude > 0.6 && box.lomax - nice.longitude < 0.65);
  assertEquals(creditCost(box), 1);
  assertEquals(creditCost(boundingBox(nice, 200)), 1);
  assertEquals(creditCost(boundingBox(nice, 400)), 2);
  assertEquals(creditCost(boundingBox(nice, 600)), 3);
  assertEquals(creditCost(undefined), 4);
  // Clamped at the poles and the antimeridian.
  const north = boundingBox({ latitude: 89.8, longitude: 179.9 }, 100);
  assertEquals(north.lamax, 90);
  assertEquals(north.lomax, 180);

  const url = new URL(areaUrl(nice, 50));
  assertEquals(url.pathname, "/api/states/all");
  assertEquals(url.searchParams.get("extended"), "1");
  assertEquals(Number(url.searchParams.get("lamin")), box.lamin);
  assertEquals(
    icaoUrl(["3C6521", "48c2b0"]),
    "https://opensky-network.org/api/states/all?icao24=3c6521&icao24=48c2b0&extended=1",
  );
  assertEquals(worldUrl(), "https://opensky-network.org/api/states/all?extended=1");
});

Deno.test("queries: callsigns and transponder addresses", () => {
  assertEquals(parseQuery(""), { kind: "empty" });
  assertEquals(parseQuery("af"), { kind: "short", text: "af" });
  assertEquals(parseQuery("AFR"), { kind: "callsign", callsign: "AFR" });
  assertEquals(parseQuery("afr 1234"), { kind: "callsign", callsign: "AFR1234" });
  assertEquals(parseQuery("3c6521"), { kind: "icao24", icao24: "3c6521" });
  assertEquals(parseQuery("3C6521"), { kind: "icao24", icao24: "3c6521" });
  // Three letters then digits is a callsign, even when it is also hex…
  assertEquals(parseQuery("ABC123"), { kind: "callsign", callsign: "ABC123" });
  // …unless asked for.
  assertEquals(parseQuery("icao:abc123"), { kind: "icao24", icao24: "abc123" });
  assertEquals(parseQuery("what?"), { kind: "short", text: "what?" });
});

Deno.test("parsing state vectors", async () => {
  const paris = await fixture("paris.json");
  const all = parseStates(paris);
  assertEquals(all.length, 12);
  // Without a location: by callsign, the ones without one last.
  assertEquals(all[0].callsign, "EJU487U");
  assertEquals(all.at(-1)!.callsign, "");
  assertEquals(all.at(-1)!.icao24, "452144");

  const near = parseStates(paris, orly);
  for (let i = 1; i < near.length; i++) assert(near[i - 1].distance! <= near[i].distance!);
  const elal = near.find((a) => a.callsign === "ELY326")!;
  assertEquals(elal.country, "Israel");
  assertEquals(elal.baroAltitude, 1569.72);
  assertEquals(elal.squawk, "7553");
  assertEquals(phase(elal), "climbing");
  assertEquals(airline(elal.callsign), "El Al");
  const parked = near.find((a) => a.callsign === "TVF525R")!;
  assert(parked.onGround);
  assertEquals(altitude(parked), undefined);
  assertEquals(phase(parked), "ground");
  assertEquals(phase(near.find((a) => a.callsign === "EJU487U")!), "descending");

  // Duplicates and states without a position are dropped; nulls are fine.
  const odd = parseStates({
    time: 10,
    states: [
      ["aaaaaa", null, "France", null, 9, null, null, null, false, null, null, null, null, null, null, false, 0],
      ["bbbbbb", "TEST1   ", "France", null, 9, 2, 48, 1000, false, 100, 90, 0, null, null, null, false, 2],
      ["bbbbbb", "TEST1   ", "France", null, 9, 2, 48, 1000, false, 100, 90, 0, null, null, null, false, 2],
    ],
  });
  assertEquals(odd.length, 1);
  assertEquals(odd[0].positionTime, 9);
  assertEquals(odd[0].category, 0);
  assertEquals(phase(odd[0]), "level");
  assertEquals(parseStates({ time: 1, states: null }), []);
  assertEquals(parseStates(undefined), []);

  const measured = measureFrom(all, orly);
  assertEquals(measured.map((a) => a.icao24), all.map((a) => a.icao24));
  assert(measured.every((a) => a.distance !== undefined));
  assertEquals(measureFrom(all), all);
});

Deno.test("callsign search", async () => {
  const all = parseStates(await fixture("paris.json"));
  const easy = matchCallsign(all, "eju");
  assertEquals(easy.length, 6);
  assert(easy.every((a) => a.callsign.startsWith("EJU")));
  assertEquals(matchCallsign(all, "EJU 487U").map((a) => a.callsign), ["EJU487U"]);
  assertEquals(matchCallsign(all, "XYZ"), []);
});

Deno.test("emergencies, airlines and units", () => {
  const base = parseStates({
    time: 0,
    states: [[
      "abcdef",
      "BAW117 ",
      "United Kingdom",
      0,
      0,
      0,
      51,
      11_000,
      false,
      250,
      270,
      -8,
      null,
      11_200,
      "7700",
      false,
      0,
      6,
    ]],
  })[0];
  assertEquals(emergency(base), "General emergency");
  assertEquals(emergency({ ...base, squawk: "1000" }), undefined);
  assertEquals(airline("BAW117"), "British Airways");
  assertEquals(airline("FHBXA"), undefined);
  assertEquals(airline("N123AB"), undefined);

  assertEquals(unitsOf("metric"), "metric");
  assertEquals(unitsOf("Imperial"), "imperial");
  assertEquals(unitsOf(""), "aviation");
  assertEquals(numberPref("75", 50), 75);
  assertEquals(numberPref("", 50), 50);
  assertEquals(numberPref(0, 50), 50);
  assertEquals(viewOf("all"), "all");
  assertEquals(viewOf("nope"), "air");

  assertEquals(formatAltitude(11_000, "aviation"), "36,089 ft");
  assertEquals(formatAltitude(11_000, "metric"), "11,000 m");
  assertEquals(flightLevel(11_000), "FL361");
  assertEquals(flightLevel(1000), undefined);
  assertEquals(formatSpeed(250, "aviation"), "486 kt");
  assertEquals(formatSpeed(250, "metric"), "900 km/h");
  assertEquals(formatSpeed(250, "imperial"), "559 mph");
  assertEquals(formatVerticalRate(-8, "aviation"), "−1,575 ft/min");
  assertEquals(formatVerticalRate(5.08, "metric"), "+5.1 m/s");
  assertEquals(formatVerticalRate(0, "metric"), "0.0 m/s");
  assertEquals(formatDistance(3.4, "metric"), "3.4 km");
  assertEquals(formatDistance(100, "aviation"), "54 NM");
  assertEquals(formatDistance(100, "imperial"), "62 mi");
  assertEquals(ago(100, 102), "just now");
  assertEquals(ago(100, 140), "40 s ago");
  assertEquals(ago(100, 400), "5 min ago");
});

Deno.test("texts and items", async () => {
  const flying = parseStates(await fixture("nice.json"), nice).filter((a) => !a.onGround);
  assertEquals(flying.map((a) => a.callsign).sort(), ["RYR16TW", "RYR679N"]);
  const ryanair = flying.find((a) => a.callsign === "RYR679N")!;
  assertStringIncludes(lookUp(ryanair)!, "Look ");
  assertStringIncludes(lookUp(ryanair)!, "to the SW");
  assertEquals(
    shareText(ryanair, "aviation", nice),
    `RYR679N (Ryanair) · 29,150 ft · 400 kt · ${formatDistance(ryanair.distance!, "aviation")} SW of Nice`,
  );
  assertEquals(mapUrl(ryanair), "https://www.openstreetmap.org/?mlat=43.4306&mlon=7.0022#map=10/43.4306/7.0022");

  const item = aircraftItem(ryanair, { units: "aviation", now: 1793569659, home: nice, section: "Near" });
  assertEquals(item.id, "48c2b0");
  assertEquals(item.title, "RYR679N");
  assertEquals(item.subtitle, "Ryanair · Poland");
  assertEquals(item.icon, "✈️");
  assertEquals(item.accessories!.at(-1), { tag: "29,150 ft", color: "green", tooltip: "Climbing" });
  const md = item.detail!.markdown!;
  assertStringIncludes(md, "## RYR679N · Ryanair");
  assertStringIncludes(md, "Climbing at 29,150 ft (FL292), 400 kt heading NE (54°).");
  assertStringIncludes(md, "Position from ADS-B, 1 s ago".replace("1 s ago", "just now"));
  assertEquals(item.detail!.stats!.map((s) => s.label), ["Altitude", "Speed", "Vertical", "From you"]);
  const labels = item.detail!.metadata!.map((m) => m.label);
  for (const l of ["Callsign", "Airline", "Transponder (ICAO 24)", "Registered in", "Phase", "Squawk", "Live map"]) {
    assert(labels.includes(l), l);
  }
  const titles = item.actions!.map((a) => a.title);
  assertEquals(titles.slice(0, 3), ["Open on ADS-B Exchange", "Open Position on Map", "Open on FlightAware"]);
  assert(titles.includes("Copy Callsign") && titles.includes("Copy ICAO 24 Address"));

  // On the ground, no callsign, an emergency.
  const [ground] = parseStates({
    time: 50,
    states: [[
      "452144",
      "",
      "Bulgaria",
      40,
      40,
      2.55,
      49.01,
      null,
      true,
      7.7,
      354,
      null,
      null,
      null,
      "7600",
      false,
      2,
      0,
    ]],
  });
  const g = aircraftItem(ground, { units: "metric", now: 50 });
  assertEquals(g.title, "452144");
  assertEquals(g.icon, { source: "bs-alert", tint: "red" });
  assertEquals(g.accessories![0], { tag: "7600 Radio failure", color: "red" });
  assertEquals(g.accessories!.at(-1), { tag: "Ground", color: "gray", tooltip: "On the ground" });
  assertStringIncludes(g.detail!.markdown!, "No callsign");
  assertStringIncludes(g.detail!.markdown!, "Squawk 7600: radio failure.");
  assertStringIncludes(g.detail!.markdown!, "Position from MLAT, 10 s ago.");
  assert(!g.actions!.some((a) => a.title === "Open on FlightAware"));

  assertEquals(status(parseStates(await fixture("paris.json"))), "12 aircraft · 8 in the air");
  assertEquals(status([]), "No aircraft");
});

Deno.test("api: anonymous, credits, rate limits and the API client", async () => {
  const real = globalThis.fetch;
  const calls: { url: string; init?: RequestInit }[] = [];
  let answer: () => Response = () => new Response("{}");
  globalThis.fetch = ((url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return Promise.resolve(answer());
  }) as typeof fetch;
  try {
    answer = () =>
      new Response(JSON.stringify({ time: 1, states: [] }), { headers: { "x-rate-limit-remaining": "312" } });
    assertEquals(await getStates(worldUrl(), undefined), { time: 1, states: [] });
    assertEquals(new Headers(calls[0].init!.headers).get("authorization"), null);
    assertEquals((await import("./api.ts")).creditsLeft, 312);

    answer = () =>
      new Response("Too many requests", { status: 429, headers: { "x-rate-limit-retry-after-seconds": "7260" } });
    const err = await assertRejects(() => getStates(worldUrl(), undefined), RateLimited);
    assertStringIncludes(err.message, "come back in 2 h 1 min");
    assertStringIncludes(err.message, "400 a day");

    // An API client: a token first, then the request with it.
    calls.length = 0;
    answer = () =>
      calls.length === 1
        ? new Response(JSON.stringify({ access_token: "tok", expires_in: 1800 }))
        : new Response(JSON.stringify({ time: 2, states: [] }));
    const creds = credentialsOf({ clientId: "me-api-client", clientSecret: "s3cret" })!;
    await getStates(worldUrl(), creds);
    assertEquals(calls[0].url, TOKEN_URL);
    assertEquals(calls[0].init!.method, "POST");
    assertEquals(
      String(calls[0].init!.body),
      "grant_type=client_credentials&client_id=me-api-client&client_secret=s3cret",
    );
    assertEquals(new Headers(calls[1].init!.headers).get("authorization"), "Bearer tok");
    // The token is reused.
    await getStates(worldUrl(), creds);
    assertEquals(calls.length, 3);

    assertEquals(credentialsOf({ clientId: "x" }), undefined);
    assertEquals(credentialsOf({}), undefined);

    // A refused client.
    const other = { clientId: "other", clientSecret: "bad" };
    answer = () => new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
    const refused = await assertRejects(() => getStates(worldUrl(), other));
    assertStringIncludes((refused as Error).message, "refused your API client");

    answer = () => new Response("<html>oops</html>", { status: 503 });
    const down = await assertRejects(() => getStates(worldUrl(), undefined));
    assertEquals((down as Error).message, "OpenSky answered 503");
  } finally {
    globalThis.fetch = real;
  }
});
