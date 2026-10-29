import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  addressLines,
  appleUrl,
  cacheKey,
  contactOf,
  coordinatePlace,
  coords,
  directionsUrl,
  distance,
  formatDistance,
  fullAddress,
  geoUri,
  googleDirectionsUrl,
  googleUrl,
  hoursLines,
  iconOf,
  languageOf,
  modeOf,
  osmUrl,
  parseCoordinates,
  parseCountries,
  parseResults,
  searchable,
  searchUrl,
  subtitleOf,
  telUrl,
  typeLabel,
  wikipediaUrl,
  withSavedFirst,
} from "./lib.ts";

// Shaped like Nominatim's /search?format=jsonv2&addressdetails=1&extratags=1 answer.
const ANSWER = [
  {
    place_id: 1,
    osm_type: "way",
    osm_id: 5013364,
    lat: "48.8582599",
    lon: "2.2945006",
    category: "man_made",
    type: "tower",
    addresstype: "man_made",
    name: "Tour Eiffel",
    display_name: "Tour Eiffel, 5, Avenue Anatole France, Gros-Caillou, Paris, Île-de-France, 75007, France",
    address: {
      man_made: "Tour Eiffel",
      house_number: "5",
      road: "Avenue Anatole France",
      suburb: "Paris 7e Arrondissement",
      city: "Paris",
      postcode: "75007",
      country: "France",
      country_code: "fr",
    },
    extratags: {
      wikipedia: "fr:Tour Eiffel",
      website: "www.toureiffel.paris",
      opening_hours: "Mo-Su 09:30-23:45; Dec 25 off",
      phone: "+33 892 70 12 39;+33 1 00 00 00 00",
      wheelchair: "limited",
    },
  },
  {
    place_id: 2,
    osm_type: "node",
    osm_id: 42,
    lat: "48.8566",
    lon: "2.3522",
    category: "amenity",
    type: "restaurant",
    name: "Chez Nous",
    display_name: "Chez Nous, Rue X, Paris, France",
    address: { road: "Rue X", city: "Paris", country: "France" },
    extratags: { cuisine: "french;wine_bar", "contact:phone": "01 23 45 67 89" },
  },
  { place_id: 3, osm_type: "way", osm_id: 5013364, lat: "48.85", lon: "2.29", name: "Duplicate" },
  { place_id: 4, lat: "not a number", lon: "2" },
];

Deno.test("Nominatim answers", () => {
  const places = parseResults(ANSWER);
  assertEquals(places.map((p) => p.id), ["way/5013364", "node/42"]);
  const eiffel = places[0];
  assertEquals(eiffel.name, "Tour Eiffel");
  assertEquals(eiffel.lat, 48.8582599);
  assertEquals(addressLines(eiffel), ["5 Avenue Anatole France", "75007 Paris", "France"]);
  assertEquals(subtitleOf(eiffel), "5 Avenue Anatole France, Paris, France");
  assertStringIncludes(fullAddress(eiffel), "Avenue Anatole France");
  assertEquals(typeLabel(eiffel), "Tower");
  assertEquals(typeLabel(places[1]), "Restaurant");
  assertEquals(typeLabel({ category: "railway", type: "station" }), "Railway station");
  assertEquals(typeLabel({ category: "building", type: "yes" }), "Building");
  assertEquals(iconOf(places[1]), { source: "bs-coffee", tint: "orange" });
  assertEquals(parseResults({ error: "x" }), []);
  // No name: the street.
  const addr = parseResults([{
    osm_type: "node",
    osm_id: 1,
    lat: "1",
    lon: "2",
    address: { house_number: "3", road: "Main St" },
  }]);
  assertEquals(addr[0].name, "3 Main St");
});

Deno.test("OSM tags", () => {
  const [eiffel, resto] = parseResults(ANSWER);
  const c = contactOf(eiffel.tags);
  assertEquals(c.website, "https://www.toureiffel.paris");
  assertEquals(c.phone, "+33 892 70 12 39");
  assertEquals(c.openingHours, "Mo-Su 09:30-23:45; Dec 25 off");
  assertEquals(hoursLines(c.openingHours!), ["Mo-Su 09:30-23:45", "Dec 25 off"]);
  assertEquals(wikipediaUrl(c.wikipedia!), "https://fr.wikipedia.org/wiki/Tour_Eiffel");
  assertEquals(wikipediaUrl("nope"), undefined);
  assertEquals(contactOf(resto.tags).cuisine, "french, wine bar");
  assertEquals(contactOf(resto.tags).phone, "01 23 45 67 89");
  assertEquals(telUrl("+33 (0)1 23-45"), "tel:+33012345");
});

Deno.test("search requests", () => {
  const url = new URL(searchUrl(" tour eiffel ", { language: "fr", countries: "FR, be, xyz", limit: 5 }));
  assertEquals(url.origin, "https://nominatim.openstreetmap.org");
  assertEquals(url.pathname, "/search");
  assertEquals(url.searchParams.get("q"), "tour eiffel");
  assertEquals(url.searchParams.get("format"), "jsonv2");
  assertEquals(url.searchParams.get("addressdetails"), "1");
  assertEquals(url.searchParams.get("extratags"), "1");
  assertEquals(url.searchParams.get("limit"), "5");
  assertEquals(url.searchParams.get("countrycodes"), "fr,be");
  assertEquals(url.searchParams.get("accept-language"), "fr");
  assertEquals(new URL(searchUrl("x y z")).searchParams.get("countrycodes"), null);
  assertEquals(languageOf("weird value"), "en");
  assertEquals(languageOf("pt-BR"), "pt-br");
  assertEquals(parseCountries("fr;fr de"), ["fr", "de"]);
  assertEquals(cacheKey("  Tour   Eiffel ", "FR", "fr"), "tour eiffel|fr|fr");
  assert(searchable("abc"));
  assert(!searchable("a."));
  assert(!searchable("  !!  "));
});

Deno.test("typed coordinates", () => {
  assertEquals(parseCoordinates("48.8566, 2.3522"), { lat: 48.8566, lon: 2.3522 });
  assertEquals(parseCoordinates("-33.86 151.21"), { lat: -33.86, lon: 151.21 });
  assertEquals(parseCoordinates("geo:48.85,2.35?z=12"), { lat: 48.85, lon: 2.35 });
  assertEquals(parseCoordinates("95, 10"), undefined);
  assertEquals(parseCoordinates("10 Downing Street"), undefined);
  const p = coordinatePlace(48.8566, 2.3522);
  assertEquals(p.name, "48.85660, 2.35220");
  assertEquals(typeLabel(p), "Coordinates");
});

Deno.test("map links", () => {
  const [eiffel] = parseResults(ANSWER);
  assertEquals(osmUrl(eiffel), "https://www.openstreetmap.org/way/5013364");
  assertEquals(
    osmUrl(coordinatePlace(1.5, 2.25)),
    "https://www.openstreetmap.org/?mlat=1.5&mlon=2.25#map=17/1.5/2.25",
  );
  assertEquals(googleUrl(eiffel), "https://www.google.com/maps/search/?api=1&query=48.85826%2C2.294501");
  assertEquals(appleUrl(eiffel), "https://maps.apple.com/?ll=48.85826,2.294501&q=Tour%20Eiffel");
  assertEquals(geoUri({ lat: 48.85826, lon: 2.2945 }), "geo:48.85826,2.2945");
  assertEquals(geoUri({ lat: 1, lon: 2, name: "A B" }), "geo:1,2?q=1,2(A%20B)");
  assertEquals(coords(eiffel), "48.85826, 2.294501");
  const home = { lat: 48.8566, lon: 2.3522 };
  assertEquals(
    directionsUrl(home, eiffel, "bike"),
    "https://www.openstreetmap.org/directions?engine=fossgis_osrm_bike&route=48.8566%2C2.3522%3B48.85826%2C2.294501",
  );
  const g = new URL(googleDirectionsUrl(home, eiffel, "foot"));
  assertEquals(g.searchParams.get("travelmode"), "walking");
  assertEquals(g.searchParams.get("origin"), "48.8566,2.3522");
  assertEquals(modeOf("Vélo"), "bike");
  assertEquals(modeOf("walk"), "foot");
  assertEquals(modeOf(""), "car");
});

Deno.test("distances", () => {
  const paris = { lat: 48.8566, lon: 2.3522 };
  const lyon = { lat: 45.764, lon: 4.8357 };
  const d = distance(paris, lyon);
  assert(d > 390_000 && d < 395_000, String(d));
  assertEquals(distance(paris, paris), 0);
  assertEquals(formatDistance(847), "850 m");
  assertEquals(formatDistance(1500), "1.5 km");
  assertEquals(formatDistance(392_456), "392 km");
});

Deno.test("saved places come first", () => {
  const places = parseResults(ANSWER);
  assertEquals(withSavedFirst(places, [places[1]]).map((p) => p.id), ["node/42", "way/5013364"]);
});
