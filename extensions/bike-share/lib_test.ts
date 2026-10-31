import { assert, assertEquals } from "@std/assert";
import { parse } from "@std/toml";
import {
  age,
  cleanName,
  directionsUrl,
  distance,
  formatDistance,
  hostAllowed,
  HOSTS,
  localized,
  matches,
  parseCoordinates,
  parseDiscovery,
  parseStations,
  parseStatus,
  parseVehicleTypes,
  resolveSystem,
  rows,
  stateOf,
  summary,
  systemName,
  SYSTEMS,
} from "./lib.ts";

Deno.test("manifest hosts match HOSTS", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
  };
  assertEquals(manifest.permissions.net, HOSTS);
});

Deno.test("every shipped system is on an allowed host", () => {
  for (const s of SYSTEMS) assert(hostAllowed(new URL(s.url).hostname), s.url);
  assertEquals(new Set(SYSTEMS.map((s) => s.id)).size, SYSTEMS.length);
});

Deno.test("host wildcards", () => {
  assert(hostAllowed("barcelona.publicbikesystem.net"));
  assert(!hostAllowed("publicbikesystem.net.evil.com"));
  assert(!hostAllowed("example.org"));
});

Deno.test("systems from the preference", () => {
  assertEquals(resolveSystem("")?.id, "velib");
  assertEquals(resolveSystem("Vélo'v")?.id, "velov");
  assertEquals(resolveSystem("lyon")?.id, "velov");
  assertEquals(resolveSystem("V'Lille")?.id, "vlille");
  assertEquals(resolveSystem("bicloo")?.id, "bicloo");
  assertEquals(resolveSystem("naolib")?.id, "bicloo");
  const custom = resolveSystem("https://gbfs.partners.fifteen.eu/gbfs/2.2/brest/en/gbfs.json");
  assertEquals(custom?.id, "custom");
  assertEquals(custom?.name, "gbfs.partners.fifteen.eu");
  assertEquals(resolveSystem(SYSTEMS[2].url)?.id, "vlille");
  assertEquals(resolveSystem("atlantis"), undefined);
});

// Real shapes: Vélib' (GBFS 1.0, numeric ids, num_bikes_available_types), Vélo'v
// (GBFS 3.0, localized names, ISO dates), V'Lille (2.3) and Citi Bike (2.3 + Lyft's extra field).

const VELIB_DISCOVERY = {
  lastUpdatedOther: 1793468540,
  ttl: 3600,
  data: {
    en: {
      feeds: [
        { name: "gbfs", url: "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/gbfs.json" },
        {
          name: "station_information",
          url: "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_information.json",
        },
        {
          name: "station_status",
          url: "https://velib-metropole-opendata.smovengo.cloud/opendata/Velib_Metropole/station_status.json",
        },
      ],
    },
  },
};

const VELOV_DISCOVERY = {
  last_updated: "2026-10-31T17:31:28.443348984Z",
  ttl: 3600,
  version: "3.0",
  data: {
    feeds: [
      { name: "station_information", url: "https://api.cyclocity.fr/contracts/lyon/gbfs/v3/station_information.json" },
      { name: "station_status", url: "https://api.cyclocity.fr/contracts/lyon/gbfs/v3/station_status.json" },
      { name: "vehicle_types", url: "https://api.cyclocity.fr/contracts/lyon/gbfs/v3/vehicle_types.json" },
    ],
  },
};

Deno.test("discovery, v1/v2 by language and v3 flat", () => {
  const velib = parseDiscovery(VELIB_DISCOVERY);
  assertEquals(velib.station_status?.endsWith("station_status.json"), true);
  assertEquals(velib.vehicle_types, undefined);
  const velov = parseDiscovery(VELOV_DISCOVERY);
  assertEquals(velov.vehicle_types, "https://api.cyclocity.fr/contracts/lyon/gbfs/v3/vehicle_types.json");
  // Only French feeds: the first language is used.
  const fr = parseDiscovery({ data: { fr: { feeds: [{ name: "station_status", url: "https://x/fr/s.json" }] } } });
  assertEquals(fr.station_status, "https://x/fr/s.json");
  assertEquals(parseDiscovery({ error: "nope" }), {});
});

Deno.test("stations: names, codes, junk entries", () => {
  const velib = parseStations({
    data: {
      stations: [
        {
          station_id: 213688169,
          stationCode: "16107",
          name: "Benjamin Godard - Victor Hugo",
          lat: 48.865983,
          lon: 2.275725,
          capacity: 35,
          station_opening_hours: null,
        },
      ],
    },
  });
  assertEquals(velib, [{
    id: "213688169",
    name: "Benjamin Godard - Victor Hugo",
    lat: 48.865983,
    lon: 2.275725,
    address: undefined,
    capacity: 35,
    code: "16107",
  }]);
  const velov = parseStations({
    data: {
      stations: [
        {
          station_id: "1031",
          name: [{ text: "1031 - PLACE DE LA PAIX", language: "fr" }, {
            text: "1031 - PLACE DE LA PAIX",
            language: "en",
          }],
          lat: 45.768023,
          lon: 4.831733,
          address: "Place de la Paix - En face de La Poste",
          capacity: 20,
        },
        { station_id: "2", name: [{ text: "", language: "fr" }], lat: 0.0, lon: 0.0, address: "", capacity: 0 },
      ],
    },
  });
  assertEquals(velov.length, 1);
  assertEquals(velov[0].name, "Place de la Paix");
  assertEquals(velov[0].address, "Place de la Paix - En face de La Poste");
  assertEquals(parseStations(null), []);
});

Deno.test("names and localized strings", () => {
  assertEquals(cleanName("3080 - PART-DIEU / VILLETTE"), "Part-Dieu / Villette");
  assertEquals(cleanName("RUE DE LA REPUBLIQUE"), "Rue de la Republique");
  assertEquals(cleanName("Rihour"), "Rihour");
  assertEquals(cleanName("LEOPOLD II"), "Leopold II");
  assertEquals(cleanName("#00004-ROCADE"), "Rocade");
  assertEquals(cleanName("_Guillen_de_Castro"), "Guillen de Castro");
  assertEquals(localized([{ text: "Vélov", language: "fr" }, { text: "Velov EN", language: "en" }]), "Velov EN");
  assertEquals(localized("plain"), "plain");
  assertEquals(systemName({ data: { name: [{ text: "Vélov", language: "fr" }] } }), "Vélov");
});

Deno.test("status: Vélib's mechanical / e-bike split", () => {
  const s = parseStatus({
    data: {
      stations: [{
        station_id: 213688169,
        num_bikes_available: 16,
        numBikesAvailable: 16,
        num_bikes_available_types: [{ mechanical: 13 }, { ebike: 3 }],
        num_docks_available: 19,
        is_installed: 1,
        is_returning: 1,
        is_renting: 1,
        last_reported: 1793467822,
        stationCode: "16107",
      }],
    },
  }).get("213688169")!;
  assertEquals([s.bikes, s.mechanical, s.ebikes, s.docks], [16, 13, 3, 19]);
  assertEquals([s.installed, s.renting, s.returning], [true, true, true]);
  assertEquals(s.reported, 1793467822000);
});

Deno.test("status: GBFS 3.0 with vehicle types", () => {
  const types = parseVehicleTypes({
    data: {
      vehicle_types: [
        { vehicle_type_id: "mechanical", form_factor: "bicycle", propulsion_type: "human" },
        { vehicle_type_id: "electrical", form_factor: "bicycle", propulsion_type: "electric_assist" },
      ],
    },
  });
  assertEquals(types, { mechanical: "human", electrical: "electric" });
  const s = parseStatus({
    data: {
      stations: [{
        station_id: "1024",
        num_vehicles_available: 3,
        vehicle_types_available: [{ vehicle_type_id: "mechanical", count: 1 }, {
          vehicle_type_id: "electrical",
          count: 2,
        }],
        num_vehicles_disabled: 4,
        num_docks_available: 12,
        is_installed: true,
        is_renting: true,
        is_returning: false,
        last_reported: "2026-10-31T12:33:20Z",
      }],
    },
  }, types).get("1024")!;
  assertEquals([s.bikes, s.mechanical, s.ebikes, s.docks, s.disabledBikes], [3, 1, 2, 12, 4]);
  assertEquals(s.returning, false);
  assertEquals(s.reported, Date.parse("2026-10-31T12:33:20Z"));
});

Deno.test("status: V'Lille (mechanical only) and Citi Bike (Lyft)", () => {
  const vlille = parseStatus({
    ttl: 0,
    version: "2.3",
    data: {
      stations: [{
        station_id: "2",
        num_bikes_available: 19,
        vehicle_types_available: [{ count: 19, vehicle_type_id: "bike" }],
        num_docks_available: 12,
        is_installed: true,
        is_renting: true,
        is_returning: true,
        last_reported: 1793468429,
      }],
    },
  }, { bike: "human" }).get("2")!;
  // Only one, mechanical, type: no split to show.
  assertEquals([vlille.bikes, vlille.mechanical, vlille.ebikes], [19, undefined, undefined]);

  // Unknown type ids and no vehicle_types: Lyft's num_ebikes_available still splits them.
  const citi = parseStatus({
    data: {
      stations: [{
        station_id: "66dc292c",
        num_bikes_available: 7,
        num_docks_available: 40,
        is_installed: 1,
        is_renting: 1,
        is_returning: 1,
        last_reported: 1793468400,
        vehicle_types_available: [{ vehicle_type_id: "1", count: 5 }, { vehicle_type_id: "2", count: 2 }],
        num_ebikes_available: 2,
      }],
    },
  }).get("66dc292c")!;
  assertEquals([citi.bikes, citi.mechanical, citi.ebikes], [7, 5, 2]);

  // No split at all.
  const plain = parseStatus({ data: { stations: [{ station_id: 9, num_bikes_available: 4, num_docks_available: 1 }] } })
    .get("9")!;
  assertEquals([plain.bikes, plain.mechanical, plain.ebikes, plain.installed], [4, undefined, undefined, true]);
});

Deno.test("states, filters and summaries", () => {
  const base = { bikes: 5, docks: 3, installed: true, renting: true, returning: true };
  assertEquals(stateOf(base), "ok");
  assertEquals(stateOf({ ...base, bikes: 0 }), "empty");
  assertEquals(stateOf({ ...base, docks: 0 }), "full");
  assertEquals(stateOf({ ...base, bikes: 2 }), "few");
  assertEquals(stateOf({ ...base, installed: false }), "closed");
  assertEquals(stateOf(undefined), "unknown");
  const station = { id: "1", name: "A", lat: 0, lon: 0 };
  assert(matches({ station, status: { ...base, ebikes: 1 } }, "ebikes"));
  assert(!matches({ station, status: { ...base, ebikes: 0 } }, "ebikes"));
  assert(!matches({ station, status: { ...base, returning: false } }, "docks"));
  assert(!matches({ station }, "bikes"));
  assert(matches({ station }, "all"));
  assertEquals(summary({ ...base, ebikes: 1 }), "5 bikes (1 e-bike) · 3 docks");
  assertEquals(summary({ ...base, bikes: 1, docks: 1 }), "1 bike · 1 dock");
});

Deno.test("nearest first from home, else by name", () => {
  const home = { lat: 48.8566, lon: 2.3522 };
  const stations = [
    { id: "far", name: "A far", lat: 48.9, lon: 2.4 },
    { id: "near", name: "B near", lat: 48.857, lon: 2.353 },
  ];
  assertEquals(rows(stations, new Map(), home).map((r) => r.station.id), ["near", "far"]);
  assertEquals(rows(stations, new Map()).map((r) => r.station.id), ["far", "near"]);
});

Deno.test("coordinates, distances and ages", () => {
  assertEquals(parseCoordinates("48.8566, 2.3522"), { lat: 48.8566, lon: 2.3522 });
  assertEquals(parseCoordinates("geo:45.76,4.83"), { lat: 45.76, lon: 4.83 });
  assertEquals(parseCoordinates("45.76 4.83"), { lat: 45.76, lon: 4.83 });
  assertEquals(parseCoordinates("Paris"), undefined);
  assertEquals(parseCoordinates("95, 2"), undefined);
  const d = distance({ lat: 48.8566, lon: 2.3522 }, { lat: 45.764, lon: 4.8357 });
  assert(d > 390_000 && d < 395_000, String(d));
  assertEquals(formatDistance(234), "230 m");
  assertEquals(formatDistance(1530), "1.5 km");
  assertEquals(formatDistance(23_400), "23 km");
  const now = Date.parse("2026-10-31T12:00:00Z");
  assertEquals(age(now - 30_000, now), "just now");
  assertEquals(age(now - 5 * 60_000, now), "5 min ago");
  assertEquals(age(undefined, now), "unknown");
  assertEquals(
    directionsUrl({ lat: 1, lon: 2 }, { lat: 3, lon: 4 }),
    "https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route=1%2C2%3B3%2C4",
  );
});
