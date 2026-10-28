import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { parse } from "@std/toml";
import { HOSTS } from "./api.ts";
import {
  clock,
  co2,
  coverages,
  delayLook,
  type Disruption,
  disruptionColor,
  disruptionText,
  duration,
  journeyMarkdown,
  journeyType,
  legs,
  legsSummary,
  lineColor,
  lineName,
  mergePlaces,
  minutesUntil,
  type NavDeparture,
  type NavJourney,
  navMinutes,
  type NavPlace,
  shortStop,
  stripHtml,
  toDeparture,
  toNav,
  toPlace,
  wait,
} from "./lib.ts";

Deno.test("Navitia datetimes", () => {
  assertEquals(clock("20261028T143000"), "14:30");
  assertEquals(minutesUntil("20261028T143000", "20261028T141200"), 18);
  assertEquals(minutesUntil("20261029T000500", "20261028T235500"), 10);
  assertEquals(navMinutes("bad"), undefined);
  assertEquals(toNav(new Date(2026, 9, 28, 9, 5, 7)), "20261028T090507");
  assertEquals(wait(0), "now");
  assertEquals(wait(7), "7 min");
  assertEquals(wait(65), "1 h 05");
  assertEquals(duration(2700), "45 min");
  assertEquals(duration(4020), "1 h 07");
  assertEquals(duration(7200), "2 h");
});

Deno.test("lines and stops", () => {
  assertEquals(lineColor("E2231A"), "#e2231a");
  assertEquals(lineColor("FFFFFF"), undefined);
  assertEquals(lineColor(""), undefined);
  assertEquals(lineName({ code: "B", commercial_mode: "RER" }), "RER B");
  assertEquals(lineName({ code: "4", commercial_mode: "Métro" }), "Métro 4");
  assertEquals(lineName({ code: "", commercial_mode: "TER", trip_short_name: "886123" }), "TER 886123");
  assertEquals(lineName({ code: "TER", commercial_mode: "TER" }), "TER");
  assertEquals(shortStop("Paris Montparnasse (Paris)"), "Paris Montparnasse");
  assertEquals(shortStop("Gare de Lyon (Paris)"), "Gare de Lyon");
  assertEquals(shortStop("Massy"), "Massy");
  assertEquals(shortStop("Lyon Part-Dieu (Lyon)"), "Lyon Part-Dieu");
});

// Shaped like `GET /v1/coverage/sncf/places?q=montparnasse&type[]=stop_area`.
const PLACES: NavPlace[] = [
  {
    id: "stop_area:SNCF:87391003",
    name: "Paris Montparnasse (Paris)",
    quality: 90,
    embedded_type: "stop_area",
    stop_area: {
      id: "stop_area:SNCF:87391003",
      name: "Paris Montparnasse",
      coord: { lon: "2.320514", lat: "48.841172" },
      administrative_regions: [{ name: "Paris", zip_code: "75015" }],
    },
  },
  {
    id: "2.3201;48.8414",
    name: "Place Raoul Dautry (Paris)",
    quality: 60,
    embedded_type: "address",
    address: { coord: { lon: "2.3201", lat: "48.8414" } },
  },
];

Deno.test("places", () => {
  const sncf = PLACES.map((p) => toPlace(p, "sncf"));
  assertEquals(sncf[0].kind, "stop_area");
  assertEquals(sncf[0].city, "Paris");
  assertEquals(sncf[0].coord?.lat, "48.841172");
  const idf = [toPlace({ ...PLACES[0], quality: 95 }, "fr-idf"), toPlace({ ...PLACES[1], id: "x" }, "fr-idf")];
  const scores = new Map([["stop_area:SNCF:87391003", 95], ["2.3201;48.8414", 60], ["x", 70]]);
  const merged = mergePlaces([sncf, idf], scores);
  assertEquals(merged.map((p) => p.id), ["stop_area:SNCF:87391003", "x", "2.3201;48.8414"]);
  assertEquals(merged[0].coverage, "sncf");
  assertEquals(coverages("auto"), ["sncf", "fr-idf"]);
  assertEquals(coverages(""), ["sncf", "fr-idf"]);
  assertEquals(coverages("fr-se, fr-ne fr-se"), ["fr-se", "fr-ne"]);
});

const DISRUPTION: Disruption = {
  id: "d1",
  status: "active",
  severity: { name: "trafic perturbé", effect: "SIGNIFICANT_DELAYS", color: "#FF0000" },
  messages: [
    { text: "Travaux", channel: { name: "titre" } },
    {
      text: "<p>En raison de travaux,<br/>le trafic est ralenti entre Denfert&nbsp;et Gare du Nord.</p>",
      channel: { name: "web" },
    },
  ],
};

// Shaped like `departures[]` of `GET /v1/coverage/fr-idf/stop_areas/{id}/departures?data_freshness=realtime`.
const DEPARTURE: NavDeparture = {
  display_informations: {
    code: "B",
    color: "5291CE",
    text_color: "FFFFFF",
    direction: "Aéroport CDG 2 TGV (Tremblay-en-France)",
    commercial_mode: "RER",
    physical_mode: "RER",
    network: "RER",
    headsign: "KOHI",
    links: [{ type: "disruption", id: "d1", rel: "disruptions" }],
  },
  stop_point: { id: "stop_point:IDFM:1", name: "Denfert-Rochereau" },
  stop_date_time: {
    departure_date_time: "20261028T143400",
    base_departure_date_time: "20261028T143000",
    data_freshness: "realtime",
    additional_informations: [],
  },
};

Deno.test("departures", () => {
  const d = toDeparture(DEPARTURE, new Map([["d1", DISRUPTION]]));
  assertEquals(d.line, "RER B");
  assertEquals(d.color, "#5291ce");
  assertEquals(d.delay, 4);
  assertEquals(d.realtime, true);
  assertEquals(d.direction, "Aéroport CDG 2 TGV");
  assertEquals(d.disruptions.length, 1);
  assertEquals(delayLook(d), { text: "+4 min", color: "orange" });
  assertEquals(delayLook({ realtime: true, delay: 0 }), { text: "on time", color: "green" });
  assertEquals(delayLook({ realtime: true, delay: 12 }).color, "red");
  assertEquals(delayLook({ realtime: false, delay: undefined }), { text: "scheduled", color: "gray" });
  const base = toDeparture(
    { ...DEPARTURE, stop_date_time: { ...DEPARTURE.stop_date_time, data_freshness: "base_schedule" } },
    new Map(),
  );
  assertEquals(base.delay, undefined);
  assertEquals(base.disruptions, []);
  assertEquals(disruptionColor(DISRUPTION), "red");
  assertEquals(
    disruptionText(DISRUPTION),
    "En raison de travaux,\nle trafic est ralenti entre Denfert et Gare du Nord.",
  );
  assertEquals(stripHtml("A &amp; B&#39;s <b>stop</b>"), "A & B's stop");
});

// Shaped like `journeys[]` of `GET /v1/coverage/fr-idf/journeys`.
const JOURNEY: NavJourney = {
  duration: 2460,
  nb_transfers: 1,
  departure_date_time: "20261028T143000",
  arrival_date_time: "20261028T151100",
  type: "best",
  co2_emission: { value: 152.3, unit: "gEC" },
  durations: { total: 2460, walking: 540 },
  sections: [
    {
      type: "street_network",
      mode: "walking",
      duration: 240,
      from: { name: "10 Rue de Rivoli (Paris)" },
      to: { name: "Châtelet (Paris)" },
      departure_date_time: "20261028T143000",
      arrival_date_time: "20261028T143400",
    },
    {
      type: "waiting",
      duration: 120,
      departure_date_time: "20261028T143400",
      arrival_date_time: "20261028T143600",
    },
    {
      type: "public_transport",
      duration: 720,
      from: { name: "Châtelet (Paris)" },
      to: { name: "Denfert-Rochereau (Paris)" },
      departure_date_time: "20261028T143600",
      arrival_date_time: "20261028T144800",
      display_informations: { code: "4", color: "BE418D", commercial_mode: "Métro", direction: "Bagneux" },
      stop_date_times: [{}, {}, {}, {}, {}, {}, {}],
    },
    {
      type: "transfer",
      transfer_type: "walking",
      duration: 180,
      from: { name: "Denfert-Rochereau (Paris)" },
      to: { name: "Denfert-Rochereau (Paris)" },
      departure_date_time: "20261028T144800",
      arrival_date_time: "20261028T145100",
    },
    {
      type: "public_transport",
      duration: 1020,
      from: { name: "Denfert-Rochereau (Paris)" },
      to: { name: "Massy-Palaiseau (Massy)" },
      departure_date_time: "20261028T145400",
      arrival_date_time: "20261028T151100",
      display_informations: { code: "B", color: "5291CE", commercial_mode: "RER", direction: "Saint-Rémy" },
      stop_date_times: [{}, {}, {}, {}],
    },
    { type: "crow_fly", mode: "walking", duration: 0, from: { name: "Massy" }, to: { name: "Massy" } },
  ],
};

Deno.test("journeys", () => {
  const ls = legs(JOURNEY);
  assertEquals(ls.map((l) => l.kind), ["walk", "wait", "transit", "transfer", "transit"]);
  assertEquals(ls[2].label, "Métro 4");
  assertEquals(ls[2].stops, 6);
  assertEquals(ls[2].color, "#be418d");
  assertEquals(legsSummary(ls), "Walk 4 min › Métro 4 › Transfer 3 min › RER B");
  assertEquals(co2(JOURNEY), "152 g CO₂");
  assertEquals(co2({ co2_emission: { value: 2450, unit: "gEC" } }), "2.5 kg CO₂");
  assertEquals(co2({}), undefined);
  assertEquals(journeyType("comfort"), "Fewer changes");
  const md = journeyMarkdown(JOURNEY);
  assertStringIncludes(md, "**14:36 → 14:48** **Métro 4** towards *Bagneux*");
  assertStringIncludes(md, "Châtelet → Denfert-Rochereau (12 min · 6 stops)");
  assertStringIncludes(md, "- 2 min wait");
  assert(!md.includes("Massy → Massy"));
});

Deno.test("hosts match the manifest", async () => {
  const manifest = parse(await Deno.readTextFile(new URL("./backslash.toml", import.meta.url))) as {
    permissions: { net: string[] };
    commands: { name: string }[];
  };
  assertEquals(manifest.permissions.net, HOSTS);
  for (const c of manifest.commands) await Deno.stat(new URL(`./commands/${c.name}.ts`, import.meta.url));
});
